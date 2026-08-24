// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * API Spector private runner (agent).
 *
 * Runs monitor checks for internal/local APIs that API Spector Cloud can never
 * reach (localhost, VPN, a service mesh) without any inbound connection. All
 * traffic is outbound: the agent polls the cloud, runs each due check with the
 * real api-spector engine (the same one the desktop app and CLI use), and posts
 * the result back.
 *
 *   APP_URL=https://your-cloud AGENT_TOKEN=<token> npx @testsmith/api-spector-agent
 *
 * Environment:
 *   APP_URL            Base URL of your API Spector Cloud       (required)
 *   AGENT_TOKEN        Org API token with the 'agent' ability   (required)
 *   POLL_INTERVAL_MS   Poll cadence in ms                       (default 5000)
 *   RUNTIME_TOKEN      Shared runtime token (cloud-internal use; AGENT_TOKEN wins)
 *
 * The engine is bundled in; this has no install-time dependencies and needs
 * only Node 18+ (for global fetch).
 */

// Replaced at build time by the agent bundler (esbuild `define`).
declare const __APP_VERSION__: string;

import { buildDispatcher, executeRunnerRequest } from '../lib';

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const RUNTIME_TOKEN = process.env.RUNTIME_TOKEN || '';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

// Private agent: authenticate as the org with a Bearer token. Falls back to the
// shared X-Runtime-Token only if that is all that is provided.
const authHeaders: Record<string, string> = AGENT_TOKEN
  ? { Authorization: `Bearer ${AGENT_TOKEN}` }
  : RUNTIME_TOKEN
    ? { 'X-Runtime-Token': RUNTIME_TOKEN }
    : {};

// A due monitor as sent by GET /api/monitor-runtime/due.
interface DueMonitor {
  id: number | string;
  expectedStatus?: number;
  setup?: unknown[];
  request: unknown;
}

async function postResult(m: DueMonitor, fields: Record<string, unknown>): Promise<void> {
  await fetch(`${APP_URL}/api/monitor-runtime/${m.id}/result`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      up: false, http_status: null, latency_ms: null, error: null,
      assertions: [], response_headers: null, response_body: null, ...fields,
    }),
  }).catch((e) => console.warn('[agent] posting result failed:', (e as Error).message));
}

async function runOne(m: DueMonitor): Promise<void> {
  let up = false;
  let httpStatus: number | null = null;
  let latency: number | null = null;
  let error: string | null = null;
  let assertions: Array<{ name: string; passed: boolean; error?: string }> = [];
  let responseHeaders: unknown = null, responseBody: string | null = null;
  let sentHeaders: unknown = null, sentBody: string | null = null;

  try {
    const dispatcher = await buildDispatcher(undefined, undefined);

    // Setup chain: run each "before" hook (e.g. authenticate) in order, threading
    // the variables it sets into the next hook and the main check. If a setup
    // request errors, the check is down with that reason.
    let envVars: Record<string, unknown> = {}, collectionVars: Record<string, unknown> = {};
    let globals: Record<string, unknown> = {}, localVars: Record<string, unknown> = {};
    for (const setupReq of (m.setup || [])) {
      const s = await executeRunnerRequest({
        req: setupReq as never, collectionVars, envVars, globals, localVars, dispatcher, piiMaskPatterns: [],
      });
      envVars = s.updatedEnvVars ?? envVars;
      collectionVars = s.updatedCollectionVars ?? collectionVars;
      globals = s.updatedGlobals ?? globals;
      localVars = s.updatedLocalVars ?? localVars;
      const setupErr = s.result?.error || s.result?.preScriptError || s.result?.postScriptError;
      if (setupErr) {
        const name = (setupReq as { name?: string })?.name || 'step';
        await postResult(m, { up: false, error: `Setup "${name}" failed: ${setupErr}`.slice(0, 250) });
        return;
      }
    }

    const { result } = await executeRunnerRequest({
      req: m.request as never, collectionVars, envVars, globals, localVars, dispatcher, piiMaskPatterns: [],
    });

    httpStatus = result.httpStatus ?? null;
    latency = result.durationMs ?? null;
    assertions = (result.testResults ?? []).map((t) => ({ name: t.name, passed: t.passed, error: t.error }));
    const scriptError = result.preScriptError || result.postScriptError;

    const recv = result.receivedResponse;
    if (recv) {
      responseHeaders = recv.headers ?? null;
      responseBody = typeof recv.body === 'string' ? recv.body.slice(0, 16000) : null;
    }
    const sent = result.sentRequest;
    if (sent) {
      sentHeaders = sent.headers ?? null;
      sentBody = typeof sent.body === 'string' ? sent.body.slice(0, 16000) : null;
    }

    if (result.error || scriptError) { up = false; error = result.error || scriptError || null; }
    else if (assertions.length) up = assertions.every((a) => a.passed);
    else up = httpStatus === m.expectedStatus;
  } catch (e) {
    up = false;
    error = String((e && (e as Error).message) || e).slice(0, 250);
  }

  await postResult(m, {
    up, http_status: httpStatus, latency_ms: latency, error, assertions,
    response_headers: responseHeaders, response_body: responseBody,
    sent_headers: sentHeaders, sent_body: sentBody,
  });
  const label = (m.request as { name?: string })?.name || m.id;
  console.log(`[agent] ${label}: ${up ? 'up' : 'down'} (${latency ?? '?'}ms)`);
}

async function tick(): Promise<void> {
  let monitors: DueMonitor[];
  try {
    const res = await fetch(`${APP_URL}/api/monitor-runtime/due`, { headers: authHeaders });
    if (res.status === 401 || res.status === 403) {
      console.error('[agent] rejected by the cloud (check AGENT_TOKEN / the agent ability)');
      return;
    }
    if (!res.ok) throw new Error(`due feed responded ${res.status}`);
    monitors = ((await res.json()) as { monitors?: DueMonitor[] }).monitors || [];
  } catch (e) {
    console.warn('[agent] due fetch failed, will retry:', (e as Error).message);
    return;
  }
  for (const m of monitors) await runOne(m);
}

function main(): void {
  if (!APP_URL) {
    console.error('[agent] APP_URL is required (e.g. https://your-cloud-host)');
    process.exit(1);
  }
  if (!AGENT_TOKEN && !RUNTIME_TOKEN) {
    console.error('[agent] AGENT_TOKEN is required (generate one under Private runner in the cloud)');
    process.exit(1);
  }
  console.log(`[agent] API Spector private runner${VERSION ? ` ${VERSION}` : ''} started -> ${APP_URL} (poll ${POLL_MS}ms)`);
  void tick();
  setInterval(() => void tick(), POLL_MS);
}

main();
