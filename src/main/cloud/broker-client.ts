// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Headless client for the API Spector Cloud broker, used by the CLI in CI (and
// reusable by the desktop app). Auth is an env bearer token — the desktop
// keychain is not available in a pipeline — with the endpoint overridable for a
// local stack. No Electron imports, so it bundles into the plain-Node CLI.

import { fetch } from 'undici';

export interface BrokerConfig {
  endpoint: string
  token: string
}

/** Resolve the broker config from the environment. Token: API_SPECTOR_TOKEN. */
export function brokerConfigFromEnv(): BrokerConfig {
  return {
    endpoint: (process.env['API_SPECTOR_CLOUD_ENDPOINT'] || 'https://api-spector.dev').replace(/\/+$/, ''),
    token: process.env['API_SPECTOR_TOKEN'] || '',
  };
}

interface BrokerResponse { status: number; ok: boolean; json: any }

async function brokerFetch(cfg: BrokerConfig, path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<BrokerResponse> {
  if (!cfg.token) throw new Error('No API token. Set API_SPECTOR_TOKEN (create one in the cloud dashboard under Tokens).');

  const url = cfg.endpoint + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${(err as Error).message}`);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function fail(r: BrokerResponse, what: string): never {
  const detail = r.json?.error || r.json?.message || (r.status === 401 ? 'Unauthorized (check API_SPECTOR_TOKEN)' : `HTTP ${r.status}`);
  throw new Error(`${what}: ${detail}`);
}

/** Publish a consumer pact. `pact` is the exportPact() document. */
export async function publishPact(cfg: BrokerConfig, input: { consumer: string; provider: string; consumerVersion: string; pact: object }): Promise<void> {
  const r = await brokerFetch(cfg, '/api/contracts', 'PUT', {
    consumer: input.consumer,
    consumerVersion: input.consumerVersion,
    provider: input.provider,
    content: input.pact,
  });
  if (!r.ok) fail(r, 'Publish pact failed');
}

/** Publish a provider OpenAPI spec (already parsed to an object). */
export async function publishSpec(cfg: BrokerConfig, input: { pacticipant: string; version: string; spec: object; results?: object }): Promise<void> {
  const r = await brokerFetch(cfg, '/api/provider-contracts', 'PUT', {
    pacticipant: input.pacticipant,
    version: input.version,
    spec: input.spec,
    // Optional provider self-verification (its own tests run against this spec).
    ...(input.results ? { results: input.results } : {}),
  });
  if (!r.ok) fail(r, 'Publish spec failed');
}

/** The gate. Returns deployable + the broker's reason. HTTP 200 = yes, 409 = no. */
export async function canIDeploy(cfg: BrokerConfig, input: { pacticipant: string; version: string; environment: string }): Promise<{ deployable: boolean; reason: string }> {
  const q = new URLSearchParams({ pacticipant: input.pacticipant, version: input.version, environment: input.environment }).toString();
  const r = await brokerFetch(cfg, '/can-i-deploy?' + q, 'GET');
  if (r.status !== 200 && r.status !== 409) fail(r, 'can-i-deploy failed');
  return { deployable: r.status === 200, reason: r.json?.summary?.reason || '' };
}

/** Non-gating deploy preview: the who/what/why + a PR-ready markdown summary. */
export async function deployPreview(cfg: BrokerConfig, input: { pacticipant: string; version: string; environment: string }): Promise<{ deployable: boolean; reasons: string[]; check: { conclusion: string; title: string; summary: string } }> {
  const q = new URLSearchParams({ pacticipant: input.pacticipant, version: input.version, environment: input.environment }).toString();
  const r = await brokerFetch(cfg, '/api/deploy-preview?' + q, 'GET');
  if (!r.ok) fail(r, 'deploy-preview failed');
  return r.json;
}

/** Record a version as deployed to an environment (so the next gate compares against reality). */
export async function recordDeployment(cfg: BrokerConfig, input: { pacticipant: string; version: string; environment: string }): Promise<void> {
  const path = `/pacticipants/${encodeURIComponent(input.pacticipant)}/versions/${encodeURIComponent(input.version)}/deployed-versions/environment/${encodeURIComponent(input.environment)}`;
  const r = await brokerFetch(cfg, path, 'POST', {});
  if (!r.ok) fail(r, 'record-deployment failed');
}

export interface CompatCheck { interaction: string; passed: boolean; error: string | null; mismatches?: Array<{ location: string; consumer: string; provider: string; reason: string }> }

/** Compatibility check: can provider@version satisfy consumer@version? Read-only
 *  (no verification recorded, no deployment considered). 200 = compatible,
 *  409 = incompatible; both carry the per-interaction checks. */
export async function checkCompatibility(cfg: BrokerConfig, input: { consumer: string; consumerVersion: string; provider: string; providerVersion: string }): Promise<{ compatible: boolean; checks: CompatCheck[] }> {
  const q = new URLSearchParams({ consumer: input.consumer, consumerVersion: input.consumerVersion, provider: input.provider, providerVersion: input.providerVersion }).toString();
  const r = await brokerFetch(cfg, '/api/compatibility?' + q, 'GET');
  if (r.status !== 200 && r.status !== 409) fail(r, 'Compatibility check failed');
  return { compatible: r.json?.compatible === true, checks: r.json?.checks ?? [] };
}

/** Fetch consumer contracts in the active project (optionally filtered). */
export async function fetchContracts(cfg: BrokerConfig, input: { consumer?: string; provider?: string } = {}): Promise<Array<{ id: number; consumer: string; consumerVersion: string; provider: string; content: object }>> {
  const q = new URLSearchParams();
  if (input.consumer) q.set('consumer', input.consumer);
  if (input.provider) q.set('provider', input.provider);
  const suffix = q.toString() ? '?' + q.toString() : '';
  const r = await brokerFetch(cfg, '/api/contracts' + suffix, 'GET');
  if (!r.ok) fail(r, 'Fetch contracts failed');
  return r.json?.contracts ?? [];
}

/** Publish a provider verification result for a contract. */
export async function publishVerification(cfg: BrokerConfig, input: { contractId: number; providerVersion: string; success: boolean; buildUrl?: string }): Promise<void> {
  const r = await brokerFetch(cfg, '/api/verifications', 'POST', {
    contractId: input.contractId,
    providerVersion: input.providerVersion,
    success: input.success,
    ...(input.buildUrl ? { buildUrl: input.buildUrl } : {}),
  });
  if (!r.ok) fail(r, 'Publish verification failed');
}
