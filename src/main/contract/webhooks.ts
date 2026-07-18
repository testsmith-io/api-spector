// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile } from 'fs/promises';
import { join } from 'path';
import { fetch } from 'undici';
import { listResults, listEnvironments, type RecordedResult, type EnvironmentState } from './results-store';

// ─── Outbound webhooks for the served dashboard ───────────────────────────────
//
// The serve mode (`contract report --serve`) is the one always-on process in
// the setup, so it is where notifications live. It polls the workspace's
// contract data; when a new verification result or deployment appears (written
// locally or arriving via `git pull`), it POSTs to the configured URLs. This
// covers the Pact Broker's "contract changed, trigger provider CI" workflow.
//
// Direction matters: webhooks are OUTBOUND ONLY. The server still accepts no
// writes; results reach it through the filesystem. Configuration lives in
// `contracts/webhooks.json` (committed to git). Secrets do not belong in that
// file: `$NAME` tokens in URLs and header values are replaced from the serving
// process's environment at fire time.

const WEBHOOKS_FILE = 'contracts/webhooks.json';

export type WebhookEvent = 'result-recorded' | 'deployment-recorded';

export interface WebhookConfig {
  name?: string
  url: string
  /** Which events to deliver. Missing/empty = all events. */
  events?: WebhookEvent[]
  /** Extra request headers. Values may contain $ENV_NAME tokens. */
  headers?: Record<string, string>
}

export interface WebhookPayload {
  event: WebhookEvent
  pacticipant: string
  version: string
  /** result-recorded only */
  passed?: boolean
  /** deployment-recorded only */
  environment?: string
  recordedAt: string
}

/** Replace $NAME tokens with values from `env`. Unknown names resolve to ''. */
export function substituteEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => env[name] ?? '');
}

export async function loadWebhookConfig(dir: string): Promise<WebhookConfig[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, WEBHOOKS_FILE), 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as { webhooks?: WebhookConfig[] };
  const hooks = parsed.webhooks ?? [];
  return hooks.filter(h => typeof h.url === 'string' && h.url.trim().length > 0);
}

/** Deliver one event to every matching webhook. Failures are logged, never thrown. */
export async function fireWebhooks(
  hooks: WebhookConfig[],
  payload: WebhookPayload,
  env: Record<string, string | undefined> = process.env,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const matching = hooks.filter(h => !h.events?.length || h.events.includes(payload.event));
  await Promise.all(matching.map(async hook => {
    const url = substituteEnv(hook.url, env);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(hook.headers ?? {})) headers[k] = substituteEnv(v, env);
    const label = hook.name ?? url;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      log(`  [webhook] ${payload.event} → ${label}: ${res.status}`);
    } catch (e) {
      log(`  [webhook] ${payload.event} → ${label}: failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }));
}

// ─── Change detection ─────────────────────────────────────────────────────────

export interface ContractDataState {
  /** pacticipant@@version → recordedAt */
  results: Record<string, string>
  /** env@@pacticipant → version@@recordedAt */
  deployments: Record<string, string>
}

export function snapshotState(results: RecordedResult[], envs: EnvironmentState[]): ContractDataState {
  const state: ContractDataState = { results: {}, deployments: {} };
  for (const r of results) state.results[`${r.pacticipant}@@${r.version}`] = r.recordedAt;
  for (const e of envs) {
    for (const [p, d] of Object.entries(e.deployed)) {
      state.deployments[`${e.name}@@${p}`] = `${d.version}@@${d.recordedAt}`;
    }
  }
  return state;
}

/** Events representing what changed between two state snapshots. */
export function diffState(
  prev: ContractDataState,
  next: ContractDataState,
  results: RecordedResult[],
): WebhookPayload[] {
  const events: WebhookPayload[] = [];

  for (const [key, recordedAt] of Object.entries(next.results)) {
    if (prev.results[key] === recordedAt) continue;
    const [pacticipant, version] = key.split('@@');
    const rec = results.find(r => r.pacticipant === pacticipant && r.version === version);
    events.push({
      event: 'result-recorded',
      pacticipant,
      version,
      passed: rec?.passed,
      recordedAt,
    });
  }

  for (const [key, value] of Object.entries(next.deployments)) {
    if (prev.deployments[key] === value) continue;
    const [environment, pacticipant] = key.split('@@');
    const [version, recordedAt] = value.split('@@');
    events.push({
      event: 'deployment-recorded',
      pacticipant,
      version,
      environment,
      recordedAt,
    });
  }

  return events;
}

/** Poll the workspace for new results/deployments and fire webhooks for the
 *  difference. Returns a stop function. The first scan only establishes the
 *  baseline; pre-existing data does not fire events. */
export function watchContractEvents(
  dir: string,
  hooks: WebhookConfig[],
  intervalMs = 10_000,
  log: (msg: string) => void = console.log,
): () => void {
  let prev: ContractDataState | null = null;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // skip overlapping scans
    running = true;
    try {
      const [results, envs] = await Promise.all([listResults(dir), listEnvironments(dir)]);
      const next = snapshotState(results, envs);
      if (prev !== null) {
        for (const payload of diffState(prev, next, results)) {
          await fireWebhooks(hooks, payload, process.env, log);
        }
      }
      prev = next;
    } catch (e) {
      log(`  [webhook] scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return () => clearInterval(timer);
}
