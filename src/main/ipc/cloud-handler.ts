// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, shell } from 'electron';
import { fetch } from 'undici';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { getSecret } from './secret-handler';
import { buildDispatcher } from '../request-exec';
import { buildEnvVars, mergeVars, buildUrl } from '../interpolation';
import { getGlobals } from '../globals-store';
import { exportPact } from '../contract/pact-format';
import { designContractToPact } from '../contract/design-pact';
import type { ConsumerContract } from '../../shared/types';
import { load as loadYaml } from 'js-yaml';
import type { MockServer } from '../../shared/types/mock';
import type { ApiRequest, Environment } from '../../shared/types/collection';

/** Keychain ref the cloud API token is stored under (see secret-handler). */
export const CLOUD_TOKEN_REF = 'cloud:token';

/** The cloud API base URL. Fixed to production for end users; the developer can
 *  point it at a local stack via the API_SPECTOR_CLOUD_ENDPOINT env var. Not a
 *  user-facing setting. */
const CLOUD_ENDPOINT = (process.env['API_SPECTOR_CLOUD_ENDPOINT'] || 'https://api-spector.dev').replace(/\/+$/, '');

interface PushMonitorInput {
  request: ApiRequest
  /** "before" hook requests (e.g. authenticate) to run before the check. */
  setup?: ApiRequest[]
  environment: Environment | null
  collectionVars: Record<string, string>
  globals: Record<string, string>
  name?: string
  intervalSeconds?: number
  expectedStatus?: number
}

/** POST/GET JSON to the cloud API with the stored bearer token. Throws a
 *  human-readable Error on any non-2xx so the renderer can surface it. */
async function cloudFetch(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<any> {
  const token = await getSecret(CLOUD_TOKEN_REF);
  if (!token) throw new Error('No cloud API token set. Add one in Settings → Cloud.');

  const dispatcher = await buildDispatcher();
  const url = CLOUD_ENDPOINT + path;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const hint = /ECONNREFUSED|fetch failed|connect|ENOTFOUND/i.test(msg)
      ? ` — is API Spector Cloud running and reachable at ${CLOUD_ENDPOINT}? (set API_SPECTOR_CLOUD_ENDPOINT or start the broker)`
      : '';
    throw new Error(`Could not reach ${url}: ${msg}${hint}`);
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok) {
    let detail = json?.error || json?.message || (res.status === 401 ? 'Unauthorized (check your token)' : `HTTP ${res.status}`);
    // Plan-limit rejections come back as 403 { error, limit } — surface the cap.
    if (res.status === 403 && json?.limit != null) detail += ` (plan limit: ${json.limit})`;
    // 405 almost always means the endpoint isn't the broker API (e.g. the default
    // marketing site rejecting PUT). Point the developer at the endpoint override.
    if (res.status === 405) detail = `HTTP 405 from ${CLOUD_ENDPOINT} — this does not look like the API Spector Cloud API (set API_SPECTOR_CLOUD_ENDPOINT to your broker URL).`;
    throw new Error(detail);
  }
  return json;
}

/** Resolve only static {{vars}} (environment / collection / global). Dynamic
 *  builtins like {{$randomInt}} and inline faker/dayjs expressions like
 *  {{faker.lorem.slug()}} are deliberately LEFT TEMPLATED so the cloud runner
 *  regenerates a fresh value on every check, instead of freezing one value at
 *  push time (which would, e.g., make a "create" call 409 on the second run). */
function interpolateStatic(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (m, key) => {
    const trimmed = String(key).trim();
    return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : m;
  });
}

/** Build the api-spector request the cloud runs: static {{vars}} folded in,
 *  dynamic/faker templates and setup-provided tokens left to resolve at run
 *  time, auth passed through, scripts kept. */
function resolveRequest(req: ApiRequest, vars: Record<string, string>) {
  return {
    id: req.id,
    name: req.name,
    method: req.method,
    url: buildUrl(req.url, req.params ?? [], vars),
    headers: resolveHeaders(req.headers, vars),
    params: [], // folded into url; empty so the runner doesn't re-append
    auth: req.auth ?? { type: 'none' },
    body: resolveBody(req.body, vars),
    preRequestScript: req.preRequestScript || undefined,
    postRequestScript: req.postRequestScript || undefined,
  };
}

/** Resolve {{var}} in enabled headers to concrete values, dropping disabled ones. */
function resolveHeaders(
  headers: ApiRequest['headers'] | undefined,
  vars: Record<string, string>,
): Array<{ key: string; value: string; enabled: true }> {
  return (headers ?? [])
    .filter(h => h.enabled !== false && h.key)
    .map(h => ({ key: interpolateStatic(h.key, vars), value: interpolateStatic(h.value ?? '', vars), enabled: true }));
}

/** Resolve static {{var}} in the body's text fields; dynamic/faker templates are
 *  left in place so the runner regenerates fresh data on every check. */
function resolveBody(body: ApiRequest['body'] | undefined, vars: Record<string, string>): ApiRequest['body'] {
  if (!body || !body.mode || body.mode === 'none') return { mode: 'none' };
  const b: ApiRequest['body'] = { ...body };
  if (body.mode === 'json' && body.json != null) b.json = interpolateStatic(body.json, vars);
  else if (body.mode === 'raw' && body.raw != null) b.raw = interpolateStatic(body.raw, vars);
  else if (body.mode === 'form' && body.form) {
    b.form = body.form.map(f => ({ ...f, key: interpolateStatic(f.key, vars), value: interpolateStatic(f.value ?? '', vars) }));
  } else if (body.mode === 'graphql' && body.graphql) {
    b.graphql = {
      ...body.graphql,
      query: interpolateStatic(body.graphql.query ?? '', vars),
      variables: interpolateStatic(body.graphql.variables ?? '', vars),
    };
  } else if (body.mode === 'soap' && body.soap) {
    b.soap = { ...body.soap, envelope: interpolateStatic(body.soap.envelope ?? '', vars) };
  }
  return b;
}

/** Variable names a setup chain SETS at run time (sp.environment.set('x', ...),
 *  sp.collectionVariables.set(...), sp.variables.set(...), sp.globals.set(...)).
 *  These must stay templated at push time so the setup's fresh value (e.g. a
 *  freshly fetched auth token) is used on each check, not a stale baked one. */
function setVarNames(reqs: ApiRequest[]): Set<string> {
  const names = new Set<string>();
  const re = /sp\.(?:environment|collectionVariables|variables|globals)\.set\(\s*['"`]([^'"`]+)['"`]/g;
  for (const r of reqs) {
    for (const script of [r.preRequestScript, r.postRequestScript]) {
      if (!script) continue;
      let m: RegExpExecArray | null;
      while ((m = re.exec(script)) !== null) names.add(m[1]);
    }
  }
  return names;
}

function omitKeys(vars: Record<string, string>, names: Set<string>): Record<string, string> {
  if (!names.size) return vars;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (!names.has(k)) out[k] = v;
  return out;
}

function slugify(name: string): string {
  return (name || 'mock')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'mock';
}

export function registerCloudHandlers(ipc: IpcMain): void {
  // Verify the token against the configured endpoint.
  handleIpc(ipc, IPC.cloud.test, async () => {
    return cloudFetch('/api/me', 'GET');
  });

  // Push a mock server definition. Maps the app's MockRoute shape to the cloud's.
  handleIpc(ipc, IPC.cloud.pushMock, async (_e, server: MockServer) => {
    const payload = {
      name: server.name,
      slug: slugify(server.name),
      enabled: true,
      auth_type: 'none',
      routes: (server.routes ?? []).map(r => ({
        method: r.method,
        path: r.path,
        status: r.statusCode,
        headers: r.headers ?? {},
        body: r.body ?? '',
        delay: r.delay ?? 0,
        script: r.script ?? null,
      })),
    };
    return cloudFetch('/api/mocks', 'POST', payload);
  });

  // Look up an existing cloud mock's routes (by the slug derived from the name)
  // so the UI can warn before overwriting. Returns { exists, routes? }.
  handleIpc(ipc, IPC.cloud.getMock, async (_e, name: string) => {
    return cloudFetch('/api/mocks/' + encodeURIComponent(slugify(name)), 'GET');
  });

  // Publish a consumer pact built from the requests that carry a contract.
  handleIpc(ipc, IPC.cloud.pushPact, async (_e, input: { consumer: string; provider: string; consumerVersion: string; requests: ApiRequest[] }) => {
    const pact = exportPact(input.consumer, input.provider, input.requests ?? []);

    return cloudFetch('/api/contracts', 'PUT', {
      consumer: input.consumer,
      consumerVersion: input.consumerVersion,
      provider: input.provider,
      content: pact,
    });
  });

  // Publish a design-first consumer contract. It compiles to the same Pact v3
  // document `pushPact` sends, so it flows through the identical broker /
  // verification / can-i-deploy machinery — the difference is only that it was
  // authored up front rather than captured from a live call.
  handleIpc(ipc, IPC.cloud.pushDesignContract, async (_e, input: { contract: ConsumerContract; consumerVersion: string }) => {
    const pact = designContractToPact(input.contract);
    return cloudFetch('/api/contracts', 'PUT', {
      consumer: input.contract.consumer,
      consumerVersion: input.consumerVersion,
      provider: input.contract.provider,
      content: pact,
    });
  });

  // Publish a provider OpenAPI spec (raw JSON or YAML text) for bi-directional
  // verification.
  handleIpc(ipc, IPC.cloud.pushSpec, async (_e, input: { pacticipant: string; version: string; spec?: string; specUrl?: string }) => {
    let specText = input.spec;
    if (! specText && input.specUrl) {
      const res = await fetch(input.specUrl, { dispatcher: await buildDispatcher() });
      if (! res.ok) throw new Error(`Could not fetch spec from ${input.specUrl} (HTTP ${res.status})`);
      specText = await res.text();
    }
    if (! specText) throw new Error('Provide an OpenAPI spec (text or a spec URL).');

    let spec: unknown;
    try {
      spec = JSON.parse(specText);
    } catch {
      spec = loadYaml(specText);
    }
    if (! spec || typeof spec !== 'object') {
      throw new Error('Could not parse the OpenAPI spec (expected JSON or YAML).');
    }

    return cloudFetch('/api/provider-contracts', 'PUT', {
      pacticipant: input.pacticipant,
      version: input.version,
      spec,
    });
  });

  // Open the cloud deployment matrix in the default browser.
  handleIpc(ipc, IPC.cloud.openMatrix, async () => {
    await shell.openExternal(CLOUD_ENDPOINT + '/matrix');
  });

  // Push a request as a monitor. The URL is resolved to a concrete value here
  // (path + query variables folded in) exactly like a normal send, so the cloud
  // runner hits the real endpoint. Auth and headers pass through unresolved: the
  // pre-request (setup) script re-authenticates on each check instead of baking
  // in a token that would expire.
  handleIpc(ipc, IPC.cloud.pushMonitor, async (_e, input: PushMonitorInput) => {
    const { request, environment, collectionVars, globals } = input;

    const envVars = await buildEnvVars(environment);
    const liveGlobals = { ...globals, ...getGlobals() };
    // Only static vars are folded in. Dynamic builtins ({{$randomInt}}) and inline
    // faker/dayjs expressions ({{faker.lorem.slug()}}) are intentionally NOT
    // resolved here: they stay templated so the cloud runner regenerates a fresh
    // value on every check (freezing one would make e.g. a create call 409 on the
    // second run).
    const staticVars = mergeVars(envVars, collectionVars ?? {}, liveGlobals, {}, {});

    // "before" hooks (e.g. authenticate) run first in the cloud, threading the
    // variables they set (a token) into the check. Static vars resolve now, but
    // any variable a setup step SETS is kept templated so its fresh run-time
    // value is used each check (not a stale one baked at push time).
    const setup = input.setup ?? [];
    const resolveVars = omitKeys(staticVars, setVarNames(setup));

    const monitorRequest = resolveRequest(request, resolveVars);
    const setupRequests = setup.map(h => resolveRequest(h, resolveVars));

    const payload = {
      name: input.name || request.name || 'Monitor',
      target_url: monitorRequest.url,
      method: request.method,
      expected_status: input.expectedStatus ?? 200,
      interval_seconds: input.intervalSeconds ?? 300,
      request: monitorRequest,
      setup: setupRequests,
    };
    return cloudFetch('/api/monitors', 'POST', payload);
  });
}
