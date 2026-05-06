// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { v4 as uuidv4 } from 'uuid';
import type {
  Workspace, Collection, ApiRequest, MockServer, MockRoute,
} from '../../shared/types';
import { contentTypeForSoap, withContentType } from '../../shared/soap';
import { parseWsdl, buildResponseEnvelope, buildMockDispatchScript, type WsdlResult } from '../ipc/soap-handler';

// ─── WSDL → request collection ───────────────────────────────────────────────
//
// Lift each WSDL operation into a SOAP-typed ApiRequest, fully wired:
//   • POST method
//   • Content-Type header (1.1 vs 1.2)
//   • Endpoint URL set from <soap:address>
//   • Envelope pre-stubbed with parameter names from the schema
//
// Shared between UI (electron IPC) and CLI so they don't drift.

export function buildRequestsFromWsdl(parsed: WsdlResult): ApiRequest[] {
  const out: ApiRequest[] = [];
  // Group operations by `name` and prefer SOAP 1.1; users can switch versions later.
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

/** Wrap the per-operation request list into a fresh Collection ready for
 *  workspace registration. Folder structure is flat — one folder named after
 *  the service, holding all operations. */
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
    description: `Imported from WSDL — ${parsed.endpoints[0]?.address ?? parsed.targetNamespace}`,
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

// ─── WSDL → mock server ──────────────────────────────────────────────────────

/** Derive the `path` portion of a URL — defaults to `/` for hosts with no path. */
function pathFromUrl(url: string): string {
  try { return new URL(url).pathname || '/'; } catch { return '/'; }
}

/** Pick a usable port for a generated mock server. We default to 3900 (matches
 *  the existing `addMock` default) but increment if the workspace already has
 *  a mock on that port. */
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
      description: `SOAP ${version} — dispatched per operation`,
      script: buildMockDispatchScript(opMap),
      // Externalized so workspace JSON stays compact: the dispatch script reads
      // these via the script-runner's `metadata` context binding instead of
      // baking each envelope as a JS string literal.
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

// ─── Convenience: full pipeline from WSDL text ───────────────────────────────

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
  const safe = collection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wsdl';
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
