// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { fetch, Headers } from 'undici';
import type {
  ApiRequest,
  ContractResult,
  ContractReport,
  ContractViolation,
} from '../../shared/types';
import { interpolate, buildUrl } from '../interpolation';
import { buildAuthHeaders } from '../auth-builder';
import { validateConsumerResponse, hasContract } from './consumer-verifier';

// ─── Live provider verification ───────────────────────────────────────────────
//
// The real "Pact provider verification": take the consumer-side expectations
// (the ContractExpectation on each request) and REPLAY them against a really
// running provider, asserting the live response satisfies the contract.
//
// Two things make this different from consumer mode:
//   1. Requests are rebased onto `providerBaseUrl` so the same contracts can be
//      verified against any environment (localhost, staging, …) without editing
//      every request URL.
//   2. Provider states (Pact `given(...)`) are seeded before each interaction by
//      POSTing to a state-handler URL, so the provider can be put in a known
//      state (e.g. "user 123 exists") before the request is sent.

/** Swap the origin (and optional base path) of a request URL for the provider
 *  base URL, keeping the request's own path and query string. */
export function rebaseUrl(fullUrl: string, providerBaseUrl?: string): string {
  if (!providerBaseUrl) return fullUrl;
  try {
    const orig = new URL(fullUrl, 'http://placeholder.invalid');
    const base = new URL(providerBaseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = (basePath + orig.pathname).replace(/\/{2,}/g, '/');
    base.search = orig.search;
    return base.toString();
  } catch {
    return fullUrl;
  }
}

/** Seed a single provider state via the state-handler URL (Pact convention).
 *  Returns a violation if the handler is missing or responds non-2xx. */
async function setupState(
  stateHandlerUrl: string | undefined,
  state: string,
  action: 'setup' | 'teardown',
): Promise<ContractViolation | null> {
  if (!stateHandlerUrl) {
    return {
      type:    'provider_state_failed',
      message: `Interaction requires provider state "${state}" but no --states-url / stateHandlerUrl was configured`,
      expected: state,
    };
  }
  try {
    const resp = await fetch(stateHandlerUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ state, action }),
    } as Parameters<typeof fetch>[1]);
    if (!resp.ok) {
      return {
        type:    'provider_state_failed',
        message: `State handler returned HTTP ${resp.status} setting up "${state}"`,
        expected: state,
        actual:  String(resp.status),
      };
    }
    return null;
  } catch (err) {
    return {
      type:    'provider_state_failed',
      message: `State handler unreachable for "${state}": ${err instanceof Error ? err.message : String(err)}`,
      expected: state,
    };
  }
}

async function verifyInteraction(
  req:             ApiRequest,
  vars:            Record<string, string>,
  providerBaseUrl?: string,
  stateHandlerUrl?: string,
): Promise<ContractResult> {
  const url   = rebaseUrl(buildUrl(req.url, req.params, vars), providerBaseUrl);
  const start = Date.now();
  const violations: ContractViolation[] = [];
  const states = req.contract?.providerStates ?? [];

  // ── 1. Seed provider states ──
  for (const state of states) {
    const v = await setupState(stateHandlerUrl, state, 'setup');
    if (v) violations.push(v);
  }
  // Don't replay if state setup already failed — the result would be misleading.
  if (violations.length > 0) {
    return { requestId: req.id, requestName: req.name, method: req.method, url, passed: false, violations, durationMs: Date.now() - start };
  }

  // ── 2. Replay the request against the provider ──
  try {
    const headers = new Headers();
    for (const h of req.headers) {
      if (h.enabled && h.key) headers.set(interpolate(h.key, vars), interpolate(h.value, vars));
    }
    const authHeaders = await buildAuthHeaders(req.auth, vars);
    for (const [k, v] of Object.entries(authHeaders)) headers.set(k, v);

    let body: string | undefined;
    if (req.body.mode === 'json' && req.body.json) {
      body = interpolate(req.body.json, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    } else if (req.body.mode === 'raw' && req.body.raw) {
      body = interpolate(req.body.raw, vars);
    }

    const resp = await fetch(url, {
      method:  req.method,
      headers,
      body:    !['GET', 'HEAD'].includes(req.method) ? body : undefined,
    } as Parameters<typeof fetch>[1]);

    const bodyText = await resp.text();
    const rawHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { rawHeaders[k] = v; });

    violations.push(...validateConsumerResponse(req.contract!, resp.status, rawHeaders, bodyText));

    return {
      requestId:    req.id,
      requestName:  req.name,
      method:       req.method,
      url,
      passed:       violations.length === 0,
      violations,
      durationMs:   Date.now() - start,
      actualStatus: resp.status,
    };
  } catch (err) {
    violations.push({
      type:    'status_mismatch',
      message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { requestId: req.id, requestName: req.name, method: req.method, url, passed: false, violations, durationMs: Date.now() - start };
  } finally {
    // ── 3. Tear states back down (best effort) ──
    for (const state of states) await setupState(stateHandlerUrl, state, 'teardown');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runLiveProviderVerification(
  requests:         ApiRequest[],
  envVars:          Record<string, string>,
  collectionVars:   Record<string, string> = {},
  providerBaseUrl?: string,
  stateHandlerUrl?: string,
): Promise<ContractReport> {
  const vars  = { ...envVars, ...collectionVars };
  const start = Date.now();

  const contractRequests = requests.filter(r => !r.disabled && hasContract(r.contract));
  // Run sequentially: provider states mutate shared server state, so parallel
  // replays would race each other's setup/teardown.
  const results: ContractResult[] = [];
  for (const req of contractRequests) {
    results.push(await verifyInteraction(req, vars, providerBaseUrl, stateHandlerUrl));
  }

  const passed = results.filter(r => r.passed).length;
  return {
    mode:      'provider-live',
    total:     results.length,
    passed,
    failed:    results.length - passed,
    results,
    durationMs: Date.now() - start,
  };
}
