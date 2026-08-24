// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ConsumerContract, KeyValuePair, MockServer, MockRoute, HttpMethod } from './types';

function kvToHeaders(kv?: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of kv ?? []) {
    if (p.enabled === false || !p.key) continue;
    out[p.key] = p.value;
  }
  return out;
}

/** Compile a design-first consumer contract into a runnable MockServer — each
 *  interaction becomes a route returning its designed response, so the consumer
 *  can develop against the contract with no provider. Pure (shared between the
 *  renderer's "Create mock" action and the main process). */
export function designContractToMock(cc: ConsumerContract, port = 4100): MockServer {
  const routes: MockRoute[] = cc.interactions.map((it, i) => ({
    id: it.id || `route-${i}`,
    // Pact path templates use {id}; the mock router uses :id.
    method: (it.request.method || 'GET').toUpperCase() as HttpMethod | 'ANY',
    path: (it.request.path || '/').replace(/\{([^}]+)\}/g, ':$1'),
    statusCode: it.response.status,
    headers: { 'Content-Type': 'application/json', ...kvToHeaders(it.response.headers) },
    body: it.response.body?.trim() ? it.response.body : '',
    description: it.description || undefined,
  }));
  return {
    version: '1.0',
    id: `mock-${cc.id}`,
    name: `${cc.consumer} → ${cc.provider} (contract mock)`,
    port,
    routes,
  };
}
