// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  interactionKey, loadPendingStore, savePendingStore, applyPendingSemantics,
} from '../main/contract/pending';
import {
  substituteEnv, snapshotState, diffState, fireWebhooks,
} from '../main/contract/webhooks';
import type { ApiRequest, ContractReport } from '../shared/types';
import type { RecordedResult, EnvironmentState } from '../main/contract/results-store';

function makeReq(id: string, statusCode = 200): ApiRequest {
  return {
    id, name: id, method: 'GET', url: 'http://x.test/' + id,
    headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' },
    contract: { statusCode },
  };
}

function makeReport(results: Array<{ id: string; passed: boolean }>): ContractReport {
  return {
    mode: 'provider-live',
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    durationMs: 10,
    results: results.map(r => ({
      requestId: r.id, requestName: r.id, method: 'GET', url: 'http://x.test/' + r.id,
      passed: r.passed, violations: r.passed ? [] : [{ type: 'status_mismatch', message: 'nope' }],
    })),
  };
}

describe('pending contracts', () => {
  it('marks never-passed failures as pending and excludes them from failed', () => {
    const store = { firstPassed: {} };
    const requests = [makeReq('new-one'), makeReq('old-one')];
    const report = makeReport([{ id: 'new-one', passed: false }, { id: 'old-one', passed: true }]);

    applyPendingSemantics(report, requests, store, '2026-07-13T10:00:00Z');

    expect(report.failed).toBe(0);
    expect(report.pending).toBe(1);
    expect(report.results.find(r => r.requestId === 'new-one')?.pending).toBe(true);
    expect(store.firstPassed[interactionKey(requests[1])]).toBe('2026-07-13T10:00:00Z');
  });

  it('failures of previously-passed interactions stay real failures', () => {
    const requests = [makeReq('flaky')];
    const store = { firstPassed: { [interactionKey(requests[0])]: '2026-07-01T00:00:00Z' } };
    const report = makeReport([{ id: 'flaky', passed: false }]);

    applyPendingSemantics(report, requests, store, '2026-07-13T10:00:00Z');

    expect(report.failed).toBe(1);
    expect(report.pending).toBeUndefined();
  });

  it('changing the contract makes the interaction pending again', () => {
    const before = makeReq('r1', 200);
    const after = makeReq('r1', 201);
    expect(interactionKey(before)).not.toBe(interactionKey(after));
  });

  it('store round-trips through disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spector-pending-'));
    await savePendingStore(dir, { firstPassed: { 'a:b': '2026-01-01T00:00:00Z' } });
    const loaded = await loadPendingStore(dir);
    expect(loaded.firstPassed['a:b']).toBe('2026-01-01T00:00:00Z');
  });
});

describe('webhooks', () => {
  it('substitutes $ENV tokens in strings', () => {
    expect(substituteEnv('Bearer $TOKEN', { TOKEN: 'abc' })).toBe('Bearer abc');
    expect(substituteEnv('no tokens', {})).toBe('no tokens');
    expect(substituteEnv('Bearer $MISSING', {})).toBe('Bearer ');
  });

  it('diffs state into result and deployment events, ignoring unchanged data', () => {
    const results: RecordedResult[] = [
      { pacticipant: 'web', version: '1.0.0', recordedAt: 't1', passed: true, report: makeReport([]) },
      { pacticipant: 'web', version: '1.1.0', recordedAt: 't2', passed: false, report: makeReport([]) },
    ];
    const envs: EnvironmentState[] = [
      { name: 'prod', deployed: { web: { version: '1.0.0', recordedAt: 't3' } } },
    ];
    const prev = snapshotState([results[0]], []);
    const next = snapshotState(results, envs);

    const events = diffState(prev, next, results);
    expect(events).toHaveLength(2);
    const resultEvent = events.find(e => e.event === 'result-recorded');
    expect(resultEvent?.version).toBe('1.1.0');
    expect(resultEvent?.passed).toBe(false);
    const deployEvent = events.find(e => e.event === 'deployment-recorded');
    expect(deployEvent?.environment).toBe('prod');
  });

  it('delivers a POST with payload and substituted headers', async () => {
    const received: Array<{ auth?: string; body: unknown }> = [];
    const server = createServer((req, res) => {
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => {
        received.push({ auth: req.headers.authorization, body: JSON.parse(b) });
        res.writeHead(200); res.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    await fireWebhooks(
      [{ name: 't', url: `http://127.0.0.1:${port}/hook`, headers: { Authorization: 'Bearer $HOOK_TOKEN' } }],
      { event: 'result-recorded', pacticipant: 'web', version: '2.0.0', passed: true, recordedAt: 'now' },
      { HOOK_TOKEN: 'secret123' },
      () => {},
    );
    server.close();

    expect(received).toHaveLength(1);
    expect(received[0].auth).toBe('Bearer secret123');
    expect((received[0].body as { pacticipant: string }).pacticipant).toBe('web');
  });

  it('filters by configured events', async () => {
    let hits = 0;
    const server = createServer((_req, res) => { hits++; res.writeHead(200); res.end(); });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const hooks = [{ url: `http://127.0.0.1:${port}/`, events: ['deployment-recorded' as const] }];
    await fireWebhooks(hooks, { event: 'result-recorded', pacticipant: 'x', version: '1', recordedAt: 'now' }, {}, () => {});
    await fireWebhooks(hooks, { event: 'deployment-recorded', pacticipant: 'x', version: '1', environment: 'prod', recordedAt: 'now' }, {}, () => {});
    server.close();

    expect(hits).toBe(1);
  });
});
