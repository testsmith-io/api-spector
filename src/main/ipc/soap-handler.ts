// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import https from 'node:https';
import http from 'node:http';
import { DOMParser } from '@xmldom/xmldom';

// WSDL fetch & parse: from a WSDL URL, produce metadata for the request builder -
// endpoint URL, each operation's SOAPAction + soap version, and a schema-aware
// envelope template with real input parameter names. Uses @xmldom/xmldom to walk
// schema imports/refs (the old regex parser couldn't follow part element refs).

export function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
      res.on('error', rejectP);
    });
    req.on('error', rejectP);
    req.setTimeout(15000, () => { req.destroy(); rejectP(new Error('WSDL fetch timed out')); });
  });
}

// WSDL metadata shapes live in src/shared/types/soap-wsdl.ts (shared with the
// renderer). Re-exported here so existing importers of this module keep working.

import type { WsdlParam, WsdlOperation, WsdlEndpoint, WsdlResult } from '../../shared/types';
export type { WsdlParam, WsdlOperation, WsdlEndpoint, WsdlResult };

// DOM helpers

const NS_SOAP  = 'http://schemas.xmlsoap.org/wsdl/soap/';
const NS_SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';

// @xmldom/xmldom NodeLists are array-like but NOT iterable; `for...of` throws.
interface XmlNodeList {
  length: number
  [index: number]: XmlNode
}

interface XmlNode {
  nodeType: number
  tagName?: string
  localName?: string
  namespaceURI?: string | null
  childNodes: XmlNodeList
  attributes?: { length: number; item(i: number): { name: string; value: string } }
  getAttribute?(name: string): string | null
}

function isElement(node: XmlNode): boolean {
  return node.nodeType === 1;
}

function nodeListToArray(list: XmlNodeList | undefined): XmlNode[] {
  if (!list || typeof list.length !== 'number') return [];
  return Array.from(list);
}

function children(node: XmlNode): XmlNode[] {
  return nodeListToArray(node.childNodes).filter(isElement);
}

/** Direct children with a matching local name; namespace-agnostic. */
function childrenByLocalName(node: XmlNode, localName: string): XmlNode[] {
  return children(node).filter(c => (c.localName ?? c.tagName) === localName);
}

function descendantsByLocalName(node: XmlNode, localName: string): XmlNode[] {
  const out: XmlNode[] = [];
  const stack: XmlNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of nodeListToArray(cur.childNodes)) {
      if (isElement(c)) {
        if ((c.localName ?? c.tagName) === localName) out.push(c);
        stack.push(c);
      }
    }
  }
  return out;
}

function attr(node: XmlNode, name: string): string | undefined {
  const v = node.getAttribute?.(name);
  return v == null || v === '' ? undefined : v;
}

/** Strip the prefix from a QName: `tns:Add` to `Add`. */
function localOfQName(q: string): string {
  const i = q.indexOf(':');
  return i === -1 ? q : q.slice(i + 1);
}

// Map element name to its XSD definition node, to resolve
// `<wsdl:part element="tns:Add"/>` to the matching `<xs:element name="Add">`.

function indexSchema(definitions: XmlNode): Map<string, XmlNode> {
  const idx = new Map<string, XmlNode>();
  // There can be multiple <xs:schema> under <wsdl:types>.
  for (const types of childrenByLocalName(definitions, 'types')) {
    for (const schema of childrenByLocalName(types, 'schema')) {
      for (const el of childrenByLocalName(schema, 'element')) {
        const n = attr(el, 'name');
        if (n) idx.set(n, el);
      }
      // Named complexTypes, referenced by element type=
      for (const ct of childrenByLocalName(schema, 'complexType')) {
        const n = attr(ct, 'name');
        if (n) idx.set('__type__:' + n, ct);
      }
    }
  }
  return idx;
}

/** Resolve an `<xs:element>` to its `<xs:complexType>`, or null for a primitive. */
function resolveComplexType(el: XmlNode, schemaIdx: Map<string, XmlNode>): XmlNode | null {
  const inlineCt = childrenByLocalName(el, 'complexType')[0];
  if (inlineCt) return inlineCt;

  const typeAttr = attr(el, 'type');
  if (typeAttr) {
    const local = localOfQName(typeAttr);
    const named = schemaIdx.get('__type__:' + local);
    if (named) return named;
    return null; // primitive
  }
  return null;
}

type Param = WsdlParam

function buildParams(complexType: XmlNode, schemaIdx: Map<string, XmlNode>, depth = 0): Param[] {
  if (depth > 5) return []; // guard against type cycles
  const params: Param[] = [];
  // Look inside <xs:sequence>, <xs:all>, <xs:choice>
  const containers = ['sequence', 'all', 'choice'].flatMap(n => childrenByLocalName(complexType, n));
  for (const container of containers) {
    for (const childEl of childrenByLocalName(container, 'element')) {
      const name = attr(childEl, 'name') ?? attr(childEl, 'ref');
      if (!name) continue;
      const local = localOfQName(name);
      const typeAttr = attr(childEl, 'type');
      let typeHint = 'string';
      if (typeAttr) typeHint = localOfQName(typeAttr);
      const nested = resolveComplexType(childEl, schemaIdx);
      if (nested) {
        params.push({ name: local, typeHint: 'complex', children: buildParams(nested, schemaIdx, depth + 1) });
      } else {
        params.push({ name: local, typeHint });
      }
    }
  }
  return params;
}

// Envelope template builder

function indent(level: number): string {
  return '  '.repeat(level);
}

function renderParams(params: Param[], level: number): string {
  return params.map(p => {
    if (p.children?.length) {
      return `${indent(level)}<tns:${p.name}>\n${renderParams(p.children, level + 1)}\n${indent(level)}</tns:${p.name}>`;
    }
    return `${indent(level)}<tns:${p.name}><!-- ${p.typeHint} --></tns:${p.name}>`;
  }).join('\n');
}

export function buildEnvelopeTemplate(
  operationName: string,
  namespace: string,
  params: Param[] = [],
  soapVersion: '1.1' | '1.2' = '1.1',
): string {
  const envNs = soapVersion === '1.2'
    ? 'http://www.w3.org/2003/05/soap-envelope'
    : 'http://schemas.xmlsoap.org/soap/envelope/';

  const body = params.length
    ? `\n${renderParams(params, 3)}\n    `
    : `\n      <!-- Add parameters here -->\n    `;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="${envNs}"
  xmlns:tns="${namespace}">
  <soap:Header/>
  <soap:Body>
    <tns:${operationName}>${body}</tns:${operationName}>
  </soap:Body>
</soap:Envelope>`;
}

// Main parser

export function parseWsdl(wsdlText: string): WsdlResult {
  let doc: XmlNode;
  try {
    doc = new DOMParser().parseFromString(wsdlText, 'text/xml') as unknown as XmlNode;
  } catch (err) {
    throw new Error(`WSDL parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const definitions = childrenByLocalName(doc, 'definitions')[0]
    ?? descendantsByLocalName(doc, 'definitions')[0];
  if (!definitions) {
    return { targetNamespace: '', endpoints: [], operations: [] };
  }

  const targetNamespace = attr(definitions, 'targetNamespace') ?? '';

  const schemaIdx = indexSchema(definitions);

  // portType operations: name to input message qname
  const portTypeInputs: Record<string, string | undefined> = {};
  for (const pt of childrenByLocalName(definitions, 'portType')) {
    for (const op of childrenByLocalName(pt, 'operation')) {
      const name = attr(op, 'name');
      if (!name) continue;
      const inputEl = childrenByLocalName(op, 'input')[0];
      portTypeInputs[name] = inputEl ? attr(inputEl, 'message') : undefined;
    }
  }

  // messages: qname to element ref
  const messageElements: Record<string, string | undefined> = {};
  for (const msg of childrenByLocalName(definitions, 'message')) {
    const name = attr(msg, 'name');
    if (!name) continue;
    const part = childrenByLocalName(msg, 'part')[0];
    if (!part) continue;
    messageElements[name] = attr(part, 'element');
  }

  // bindings: list operations + their SOAPAction + version
  interface BindingInfo {
    name: string
    soapVersion: '1.1' | '1.2'
    operations: { name: string; soapAction?: string }[]
  }
  const bindings: BindingInfo[] = [];

  for (const binding of childrenByLocalName(definitions, 'binding')) {
    const bindingName = attr(binding, 'name') ?? '';
    // SOAP version from the inner <soap:binding> / <soap12:binding>
    let soapVersion: '1.1' | '1.2' = '1.1';
    for (const c of children(binding)) {
      if ((c.localName ?? c.tagName) === 'binding') {
        if (c.namespaceURI === NS_SOAP12) soapVersion = '1.2';
        else if (c.namespaceURI === NS_SOAP) soapVersion = '1.1';
      }
    }

    const ops: { name: string; soapAction?: string }[] = [];
    for (const op of childrenByLocalName(binding, 'operation')) {
      const opName = attr(op, 'name');
      if (!opName) continue;
      let soapAction: string | undefined;
      for (const c of children(op)) {
        if ((c.localName ?? c.tagName) === 'operation' &&
            (c.namespaceURI === NS_SOAP || c.namespaceURI === NS_SOAP12)) {
          soapAction = attr(c, 'soapAction');
        }
      }
      ops.push({ name: opName, soapAction });
    }
    bindings.push({ name: bindingName, soapVersion, operations: ops });
  }

  // services: binding name to endpoint address
  const endpoints: WsdlEndpoint[] = [];
  for (const svc of childrenByLocalName(definitions, 'service')) {
    for (const port of childrenByLocalName(svc, 'port')) {
      const bindingRef = attr(port, 'binding');
      if (!bindingRef) continue;
      let address: string | undefined;
      let addrVersion: '1.1' | '1.2' = '1.1';
      for (const c of children(port)) {
        if ((c.localName ?? c.tagName) === 'address') {
          address = attr(c, 'location');
          if (c.namespaceURI === NS_SOAP12) addrVersion = '1.2';
        }
      }
      if (address) {
        endpoints.push({ binding: localOfQName(bindingRef), address, soapVersion: addrVersion });
      }
    }
  }

  // Compose: portType (input message) + binding (SOAPAction) + service (endpoint)
  const operations: WsdlOperation[] = [];
  const seenOpNames = new Set<string>();
  for (const binding of bindings) {
    const endpoint = endpoints.find(e => e.binding === binding.name)?.address;
    for (const op of binding.operations) {
      if (seenOpNames.has(op.name + '@' + binding.name)) continue;
      seenOpNames.add(op.name + '@' + binding.name);

      const messageQName = portTypeInputs[op.name];
      const messageLocal = messageQName ? localOfQName(messageQName) : undefined;
      const elementQName = messageLocal ? messageElements[messageLocal] : undefined;
      const elementLocal = elementQName ? localOfQName(elementQName) : op.name;

      // Resolve the schema element to its complexType to params
      const schemaEl = schemaIdx.get(elementLocal);
      let params: Param[] = [];
      if (schemaEl) {
        const ct = resolveComplexType(schemaEl, schemaIdx);
        if (ct) params = buildParams(ct, schemaIdx);
      }

      operations.push({
        name: op.name,
        binding: binding.name,
        soapAction: op.soapAction,
        soapVersion: binding.soapVersion,
        endpoint,
        inputTemplate: buildEnvelopeTemplate(elementLocal, targetNamespace, params, binding.soapVersion),
        params,
      });
    }
  }

  // Fallback for WSDLs without proper bindings: regex-style name extraction.
  if (operations.length === 0) {
    const regex = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["']/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(wsdlText)) !== null) seen.add(m[1]);
    // Also pull soapAction by name from the raw text
    const soapActionByName: Record<string, string> = {};
    const blockRx = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:wsdl:)?operation>/g;
    while ((m = blockRx.exec(wsdlText)) !== null) {
      const sa = /soapAction\s*=\s*["']([^"']*)["']/.exec(m[2]);
      if (sa) soapActionByName[m[1]] = sa[1];
    }
    for (const name of seen) {
      operations.push({
        name,
        soapAction: soapActionByName[name],
        soapVersion: '1.1',
        inputTemplate: buildEnvelopeTemplate(name, targetNamespace, [], '1.1'),
        params: [],
      });
    }
  }

  return { targetNamespace, endpoints, operations };
}

// Response envelope template (for mocking). Shape mirrors the request:
// `<tns:{Op}Response><tns:{Op}Result>...`. A default for stubbing; users edit
// per-operation in the Mock detail panel after import.

export function buildResponseEnvelope(
  operationName: string,
  namespace: string,
  soapVersion: '1.1' | '1.2' = '1.1',
): string {
  const envNs = soapVersion === '1.2'
    ? 'http://www.w3.org/2003/05/soap-envelope'
    : 'http://schemas.xmlsoap.org/soap/envelope/';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="${envNs}"
  xmlns:tns="${namespace}">
  <soap:Body>
    <tns:${operationName}Response>
      <tns:${operationName}Result><!-- replace with mock value --></tns:${operationName}Result>
    </tns:${operationName}Response>
  </soap:Body>
</soap:Envelope>`;
}

/** JS source for a mock route's `script`: branches on the incoming SOAPAction (or
 *  body operation element) and writes the matching response envelope from the
 *  route's `metadata.soapEnvelopes` map. */
export function buildMockDispatchScript(_opMap: Record<string, string>): string {
  return `// Auto-generated by Import WSDL - dispatches per SOAP operation.
// Envelopes come from route metadata.soapEnvelopes (set by the WSDL importer).
const envelopes = (metadata && metadata.soapEnvelopes) || {};
const ct = (metadata && metadata.soapVersion === '1.2')
  ? 'application/soap+xml; charset=utf-8'
  : 'text/xml; charset=utf-8';

const headers = request.headers || {};
const sa      = String(headers['soapaction'] || headers['SOAPAction'] || '').replaceAll('"', '');
const body    = request.body || '';

let opName = null;
for (const k of Object.keys(envelopes)) {
  if (sa && (sa === k || sa.endsWith('/' + k) || sa.endsWith(':' + k))) { opName = k; break; }
  if (body.indexOf('<' + k + ' ') !== -1 || body.indexOf('<' + k + '>') !== -1
      || body.indexOf(':' + k + ' ') !== -1 || body.indexOf(':' + k + '>') !== -1) {
    opName = k; break;
  }
}

response.headers['Content-Type'] = ct;
if (opName) {
  response.statusCode = 200;
  response.body       = envelopes[opName];
} else {
  response.statusCode = 500;
  response.body = '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>Unknown SOAP operation</faultstring></soap:Fault></soap:Body></soap:Envelope>';
}
`;
}

// IPC handler

export function registerSoapHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.wsdl.fetch, async (_event, url: string, extraHeaders: Record<string, string> = {}): Promise<WsdlResult> => {
    // Lazy import so the unit tests don't need electron + ajv on disk.
    const { validateWsdlFetchUrl } = await import('./ipc-validate');
    validateWsdlFetchUrl(url);
    const wsdlText = await fetchUrl(url, extraHeaders);
    return parseWsdl(wsdlText);
  });

  // Import a WSDL into a ready-to-register Collection + MockServer; the renderer
  // persists them via the existing save flows.
  handleIpc(ipc, IPC.wsdl.import, async (_event, opts: { url?: string; xml?: string; name?: string; existingMockPorts?: number[] }) => {
    const { validateWsdlImport } = await import('./ipc-validate');
    validateWsdlImport(opts);
    const { importWsdl } = await import('../wsdl/import');
    const wsdlText = opts.xml ?? (opts.url ? await fetchUrl(opts.url) : '');
    if (!wsdlText) throw new Error('wsdl:import requires either `url` or `xml`');
    return importWsdl(wsdlText, { name: opts.name, existingMockPorts: opts.existingMockPorts });
  });
}
