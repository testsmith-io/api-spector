// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Renderer helpers for "Push to cloud". They assemble the same variable /
// auth / header context the normal send uses, then hand off to the main
// process (cloud-handler) which resolves the URL and POSTs to the cloud API.

import { useStore } from '../store';
import { resolveEnvironmentById } from '../hooks/useActiveEnvironment';
import { authIsConfigured, getHooksForRequest } from '../../../shared/request-collection';
import type { ApiRequest } from '../../../shared/types/collection';
import type { MockServer } from '../../../shared/types/mock';
import type { KeyValuePair } from '../../../shared/types/http';

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

  // Collection vars: collection-level + folder-chain + session (same as send).
  const colEntry = Object.values(s.collections).find(c => c.data.requests[request.id]);
  const collectionVars: Record<string, string> = {
    ...(colEntry?.data.collectionVariables ?? {}),
    ...s.getInheritedVariables(request.id),
    ...s.sessionVars,
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
