// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Renderer helpers for "Push to cloud". They assemble the same variable /
// auth / header context the normal send uses, then hand off to the main
// process (cloud-handler) which resolves the URL and POSTs to the cloud API.

import { useStore } from '../store';
import { resolveEnvironmentById } from '../hooks/useActiveEnvironment';
import { authIsConfigured, getHooksForRequest } from '../../../shared/request-collection';
import type { ApiRequest, Collection, Folder } from '../../../shared/types/collection';
import type { Flow } from '../../../shared/types/flow';
import type { MockServer } from '../../../shared/types/mock';
import type { KeyValuePair } from '../../../shared/types/http';
import type { FlowRunSummary } from '../../../shared/flow-engine';

/** Whether a request carries a usable contract (so it can become a pact interaction). */
export function hasContract(r: ApiRequest): boolean {
  const c = r.contract;
  return !!c && (
    c.statusCode != null ||
    !!c.bodySchema ||
    !!c.bodyMatcher ||
    (c.headers?.length ?? 0) > 0 ||
    (c.providerStates?.length ?? 0) > 0
  );
}

const { electron } = window;

/** Whether the workspace has cloud integration enabled. */
export function cloudEnabled(): boolean {
  return Boolean(useStore.getState().workspace?.settings?.cloud?.enabled);
}

function assertEnabled(): void {
  if (!cloudEnabled()) throw new Error('Cloud is off. Enable it in Settings → Cloud.');
}

export type PactVerification = { success: boolean; checks: { interaction: string; passed: boolean; error: string | null }[] } | null;

/** Publish a consumer pact built from the given requests (those with contracts). */
export async function pushContractToCloud(
  requests: ApiRequest[],
  opts: { consumer: string; provider: string; version: string },
): Promise<{ id: number; content_sha: string; verification: PactVerification }> {
  assertEnabled();
  return electron.cloudPushPact({
    consumer: opts.consumer,
    provider: opts.provider,
    consumerVersion: opts.version,
    requests,
  });
}

/** Publish a provider OpenAPI spec (raw JSON/YAML text) for bi-directional testing. */
export async function pushProviderSpecToCloud(
  opts: { pacticipant: string; version: string; spec: string },
): Promise<{ verified_contracts: number; results: { consumer: string; version: string; success: boolean }[] }> {
  assertEnabled();
  return electron.cloudPushSpec(opts);
}

/** Open the cloud deployment matrix in the browser. */
export function openCloudMatrix(): void {
  void electron.cloudOpenMatrix();
}

// ─── Flows ────────────────────────────────────────────────────────────────

/** Upload a flow to the cloud as a self-contained definition (graph + the
 *  referenced requests + resolved environment/globals). The main process bakes
 *  the definition; the cloud stores it and a Node runtime runs it. */
export async function pushFlowToCloud(flow: Flow): Promise<{ url?: string; slug: string }> {
  assertEnabled();
  const s = useStore.getState();
  const environment = resolveEnvironmentById(s.environments, s.activeEnvironmentId);
  return electron.cloudPushFlow({
    flow,
    collections: Object.values(s.collections).map(c => c.data),
    flows: Object.values(s.flows).map(f => f.data),
    environment,
    globals: { ...s.globals },
  });
}

/** Trigger a server-side run and poll until it completes (or times out). */
export async function runFlowInCloud(
  flow: Flow,
  onStatus?: (status: string) => void,
): Promise<FlowRunSummary> {
  assertEnabled();
  const started = await electron.cloudRunFlow(flow.name);
  onStatus?.(started.status);
  const deadlineMs = 2 * 60 * 1000;
  const t0 = Date.now();
  // Poll the run until it reaches a terminal state.
  for (;;) {
    const run = await electron.cloudGetFlowRun({ name: flow.name, runId: started.id });
    onStatus?.(run.status);
    if (run.status === 'passed' || run.status === 'failed' || run.status === 'error' || run.status === 'done') {
      if (run.summary) return run.summary;
      throw new Error('Flow run finished but no summary was returned.');
    }
    if (Date.now() - t0 > deadlineMs) throw new Error('Timed out waiting for the cloud flow run.');
    await new Promise(r => setTimeout(r, 1500));
  }
}

/** Open the flow's page in the cloud UI. */
export function openCloudFlow(flow: Flow): void {
  void electron.cloudOpenFlow(flow.name);
}

// ─── Share collections / requests (public read-only links) ──────────────────

export type ShareResult = { token: string; url: string; deep_link: string; expires_at?: string | null };
export type ShareLookup = { exists: boolean; token?: string; url?: string; deep_link?: string; expires_at?: string | null };

/** Share a whole collection as a public read-only link. The main process strips
 *  data sets / saved examples; the definition carries only {{variable}} refs.
 *  Idempotent: re-sharing the same collection refreshes its one link. */
export async function shareCollectionToCloud(collection: Collection): Promise<ShareResult> {
  assertEnabled();
  return electron.cloudShareCollection(collection);
}

/** Share a single request as a public read-only link. */
export async function shareRequestToCloud(request: ApiRequest): Promise<ShareResult> {
  assertEnabled();
  return electron.cloudShareRequest(request);
}

/** All request ids under a folder, including nested folders. */
function collectFolderRequestIds(folder: Folder): string[] {
  return [...folder.requestIds, ...folder.folders.flatMap(collectFolderRequestIds)];
}

/** Share a folder subtree as a public read-only link. Assembled as a
 *  collection-shaped payload (the folder as its root + the subtree's requests)
 *  so the viewer and importer reuse the collection path. */
export async function shareFolderToCloud(collection: Collection, folder: Folder): Promise<ShareResult> {
  assertEnabled();
  const ids = new Set(collectFolderRequestIds(folder));
  const requests: Record<string, ApiRequest> = {};
  for (const id of ids) {
    const r = collection.requests[id];
    if (r) requests[id] = r;
  }
  const payload: Collection = {
    version: '1.0',
    id: folder.id,
    name: folder.name,
    rootFolder: folder,
    requests,
    collectionVariables: collection.collectionVariables,
  };
  return electron.cloudShareFolder({ sourceId: folder.id, name: folder.name, payload });
}

/** Whether a local collection/request/folder already has a public link. */
export async function lookupShare(type: 'collection' | 'request' | 'folder', sourceId: string): Promise<ShareLookup> {
  assertEnabled();
  return electron.cloudShareLookup({ type, sourceId });
}

/** Restrict a share: set an expiry in days, or 0 for "never expires". */
export async function restrictShare(token: string, expiresDays: number): Promise<ShareResult> {
  assertEnabled();
  return electron.cloudShareUpdate({ token, expiresDays });
}

/** Revoke a share link so it stops working. */
export async function revokeShare(token: string): Promise<void> {
  assertEnabled();
  await electron.cloudShareRevoke(token);
}

/** Fetch a shared collection/request by token (from a spector://import link).
 *  No cloud account needed on the receiving side, so this does NOT assert that
 *  cloud is enabled. */
export async function importShareFromCloud(
  token: string,
): Promise<{ type: 'collection' | 'request'; name: string; payload: unknown }> {
  return electron.cloudImportShare(token);
}

/** The routes an existing cloud mock already has (for overwrite warnings), or
 *  null if the mock does not exist yet or the lookup failed. */
export async function getCloudMockRoutes(name: string): Promise<{ method: string; path: string }[] | null> {
  if (!cloudEnabled()) return null;
  try {
    const res = await electron.cloudGetMock(name);
    return res.exists ? (res.routes ?? []) : null;
  } catch {
    return null;
  }
}

/** Push a mock. When routeIds is given, only those routes are sent (the cloud
 *  mock ends up with just the selected endpoints). */
export async function pushMockToCloud(server: MockServer, routeIds?: string[]): Promise<{ id: number; url: string }> {
  assertEnabled();
  const routes = routeIds
    ? (server.routes ?? []).filter(r => routeIds.includes(r.id))
    : (server.routes ?? []);
  return electron.cloudPushMock({ ...server, routes });
}

/** Push a request as a monitor. The main process resolves the URL variables to
 *  concrete values; auth/headers pass through so the request's pre-request
 *  (setup) script re-authenticates on each check. */
export async function pushRequestAsMonitor(
  request: ApiRequest,
  opts?: { intervalSeconds?: number; expectedStatus?: number },
): Promise<{ id: number }> {
  assertEnabled();
  const s = useStore.getState();

  // Collection vars: collection-level + folder-chain + any session script values
  // (sp.*.set from earlier sends). The monitor re-runs its setup chain, so these
  // are a seed; its own setup hooks refresh them at run time.
  const colEntry = Object.values(s.collections).find(c => c.data.requests[request.id]);
  const collectionVars: Record<string, string> = {
    ...colEntry?.data.collectionVariables,
    ...s.getInheritedVariables(request.id),
    ...s.sessionScriptVars.globals,
    ...s.sessionScriptVars.env,
    ...s.sessionScriptVars.collection,
    ...s.sessionScriptVars.folder,
  };

  // "before" hooks in this request's folder chain (e.g. an authenticate step)
  // become the monitor's setup chain, run in order before the check.
  const setup = colEntry ? getHooksForRequest(request.id, colEntry.data).before : [];

  const environment = resolveEnvironmentById(s.environments, s.activeEnvironmentId);
  const globals = { ...s.globals };

  // Fold inherited (folder/collection) auth + headers into the request, exactly
  // like the send path, so a monitor authenticates the same way.
  const inherited = s.getInheritedAuthAndHeaders(request.id);
  const mergedAuth = authIsConfigured(request.auth) ? request.auth : (inherited.auth ?? request.auth);
  const mergedHeaders: KeyValuePair[] = [
    ...inherited.headers.filter(h => h.enabled),
    ...request.headers,
  ];
  const mergedRequest: ApiRequest = { ...request, auth: mergedAuth, headers: mergedHeaders };

  return electron.cloudPushMonitor(
    {
      request: mergedRequest,
      setup,
      environment,
      collectionVars,
      globals,
      name: request.name,
      intervalSeconds: opts?.intervalSeconds,
      expectedStatus: opts?.expectedStatus,
    },
  );
}
