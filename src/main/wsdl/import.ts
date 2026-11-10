// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { v4 as uuidv4 } from 'uuid';
import type {
  Workspace, Collection, ApiRequest, MockServer, MockRoute,
} from '../../shared/types';
import { contentTypeForSoap, withContentType } from '../../shared/soap';
import { parseWsdl, buildResponseEnvelope, buildMockDispatchScript, type WsdlResult } from '../ipc/soap-handler';

// WSDL to request collection: lift each WSDL operation into a fully-wired SOAP-typed
// ApiRequest (POST, Content-Type 1.1/1.2, endpoint from <soap:address>, pre-stubbed
// envelope). Shared by UI and CLI.

export function buildRequestsFromWsdl(parsed: WsdlResult): ApiRequest[] {
  const out: ApiRequest[] = [];
  // Group by `name`, preferring SOAP 1.1; users can switch versions later.
  const byName = new Map<string, typeof parsed.operations[number]>();
  for (const op of parsed.operations) {
    const existing = byName.get(op.name);
    if (!existing || (existing.soapVersion === '1.2' && op.soapVersion === '1.1')) byName.set(op.name, op);
  }

  for (const op of byName.values()) {
    const ct = contentTypeForSoap(op.soapVersion);
    const req: ApiRequest = {
      id: uuidv4(),
      name: op.name,
      method: 'POST',
      url: op.endpoint ?? '',
      headers: withContentType([], ct),
      params: [],
      auth: { type: 'none' },
      protocol: 'soap',
      body: {
        mode: 'soap',
        soap: {
          wsdlUrl:       '',
          operationName: op.name,
          soapAction:    op.soapAction ?? '',
          envelope:      op.inputTemplate,
        },
      },
      description: op.soapAction ? `SOAPAction: ${op.soapAction}` : undefined,
    };
    out.push(req);
  }
  return out;
}

/** Wrap the per-operation requests into a fresh Collection. Flat structure: one
 *  root folder holding all operations. */
export function buildCollectionFromWsdl(name: string, parsed: WsdlResult): {
  collection: Collection
  requestIds: string[]
} {
  const requests = buildRequestsFromWsdl(parsed);
  const requestMap: Record<string, ApiRequest> = {};
  for (const r of requests) requestMap[r.id] = r;

  const collection: Collection = {
    version: '1.0',
    id: uuidv4(),
    name,
    description: `Imported from WSDL - ${parsed.endpoints[0]?.address ?? parsed.targetNamespace}`,
    rootFolder: {
      id: uuidv4(),
      name: 'root',
      description: '',
      folders: [],
      requestIds: requests.map(r => r.id),
    },
    requests: requestMap,
  };
  return { collection, requestIds: requests.map(r => r.id) };
}

// WSDL to mock server

/** The `path` portion of a URL; `/` when there is none. */
function pathFromUrl(url: string): string {
  try { return new URL(url).pathname || '/'; } catch { return '/'; }
}

/** Free port for a generated mock: 3900 (the addMock default), incremented past
 *  any port the workspace already uses. */
function pickFreePort(existing: number[]): number {
  let p = 3900;
  while (existing.includes(p)) p++;
  return p;
}

export function buildMockFromWsdl(name: string, parsed: WsdlResult, existingPorts: number[] = []): MockServer {
  const opMap: Record<string, string> = {};
  const seen = new Set<string>();
  for (const op of parsed.operations) {
    if (seen.has(op.name)) continue;
    seen.add(op.name);
    opMap[op.name] = buildResponseEnvelope(op.name, parsed.targetNamespace, op.soapVersion);
  }

  // Group by endpoint path so each address gets one dispatch route.
  const pathsByVersion = new Map<string, '1.1' | '1.2'>();
  for (const ep of parsed.endpoints) {
    pathsByVersion.set(pathFromUrl(ep.address), ep.soapVersion);
  }
  if (pathsByVersion.size === 0) pathsByVersion.set('/', '1.1');

  const routes: MockRoute[] = [];
  for (const [routePath, version] of pathsByVersion.entries()) {
    routes.push({
      id: uuidv4(),
      method: 'POST',
      path: routePath,
      statusCode: 200,
      headers: { 'Content-Type': contentTypeForSoap(version) },
      body: '',
      description: `SOAP ${version} - dispatched per operation`,
      script: buildMockDispatchScript(opMap),
      // Kept off the script (read via the script-runner's `metadata` binding)
      // so the workspace JSON stays compact.
      metadata: { soapEnvelopes: opMap, soapVersion: version },
    });
  }

  return {
    version: '1.0',
    id: uuidv4(),
    name,
    port: pickFreePort(existingPorts),
    routes,
  };
}

// Full pipeline from WSDL text

export interface WsdlImportResult {
  parsed: WsdlResult
  collection: Collection
  mock: MockServer
}

export function importWsdl(wsdlText: string, opts: { name?: string; existingMockPorts?: number[] } = {}): WsdlImportResult {
  const parsed = parseWsdl(wsdlText);
  const baseName = opts.name?.trim() || (() => {
    try { return new URL(parsed.endpoints[0]?.address ?? '').hostname || 'WSDL service'; }
    catch { return 'WSDL service'; }
  })();
  const { collection } = buildCollectionFromWsdl(baseName, parsed);
  const mock = buildMockFromWsdl(`${baseName} (mock)`, parsed, opts.existingMockPorts ?? []);
  return { parsed, collection, mock };
}

/** Workspace-relative path helpers, used after importing into a workspace. */
export function defaultCollectionRelPath(ws: Workspace, collection: Collection): string {
  const safe = collection.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'wsdl';
  let i = 0;
  let candidate = `collections/${safe}.json`;
  const existing = new Set(ws.collections);
  while (existing.has(candidate)) {
    i++;
    candidate = `collections/${safe}-${i}.json`;
  }
  return candidate;
}

export function defaultMockRelPath(mock: MockServer): string {
  return `mocks/${mock.id}.mock.json`;
}
