// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import https from 'https';
import http from 'http';
import { DOMParser } from '@xmldom/xmldom';

// ─── WSDL fetch & parse ───────────────────────────────────────────────────────
//
// Goal: from a WSDL URL the user pastes (e.g. dneonline calculator.asmx?WSDL)
// produce enough metadata to drive the request builder end-to-end:
//   • the service endpoint URL (so the user doesn't need to copy it manually)
//   • each operation's SOAPAction + soap version
//   • a schema-aware envelope template with the actual input parameter names
//     instead of a generic "Add parameters here" comment.
//
// We use @xmldom/xmldom so we can walk schema imports/refs reliably; the old
// regex parser couldn't follow `<wsdl:part element="tns:Add"/>` to the matching
// `<xs:element name="Add">` definition in `<wsdl:types>`.

function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
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

// ─── Public types ────────────────────────────────────────────────────────────

export interface WsdlParam {
  name: string
  typeHint: string
  children?: WsdlParam[]
}

export interface WsdlOperation {
  name: string
  /** Binding this operation is exposed by — useful when WSDL has both 1.1 and 1.2. */
  binding?: string
  soapAction?: string
  soapVersion: '1.1' | '1.2'
  /** Resolved endpoint from the matching <soap:address> / <soap12:address>. */
  endpoint?: string
  /** Ready-to-send envelope with parameter elements pre-stubbed. */
  inputTemplate: string
  /** Input message parameters resolved from the schema (empty if WSDL omits a schema). */
  params?: WsdlParam[]
}

export interface WsdlEndpoint {
  binding: string
  address: string
  soapVersion: '1.1' | '1.2'
}

export interface WsdlResult {
  targetNamespace: string
  endpoints: WsdlEndpoint[]
  operations: WsdlOperation[]
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

const NS_SOAP  = 'http://schemas.xmlsoap.org/wsdl/soap/';
const NS_SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';

// `@xmldom/xmldom` returns array-like NodeLists (length + indexed access) that
// are NOT iterable, so we have to walk by index — `for...of` throws on them.
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
  const out: XmlNode[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

function children(node: XmlNode): XmlNode[] {
  return nodeListToArray(node.childNodes).filter(isElement);
}

/** Find direct children of `node` whose local name matches. Namespace-agnostic
 *  (we accept both `<wsdl:operation>` and `<operation>`). */
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

/** Strip the prefix from a QName like `tns:Add` → `Add`. */
function localOfQName(q: string): string {
  const i = q.indexOf(':');
  return i === -1 ? q : q.slice(i + 1);
}

// ─── Schema indexing ─────────────────────────────────────────────────────────
//
// Build a map from element name → its XSD definition node so we can resolve
// `<wsdl:part element="tns:Add"/>` to the matching `<xs:element name="Add">`.

function indexSchema(definitions: XmlNode): Map<string, XmlNode> {
  const idx = new Map<string, XmlNode>();
  // Find <wsdl:types><xs:schema>* — there can be multiple schemas.
  for (const types of childrenByLocalName(definitions, 'types')) {
    for (const schema of childrenByLocalName(types, 'schema')) {
      // Top-level <xs:element name="..."> entries
      for (const el of childrenByLocalName(schema, 'element')) {
        const n = attr(el, 'name');
        if (n) idx.set(n, el);
      }
      // Top-level named complexTypes — referenced by element type=
      for (const ct of childrenByLocalName(schema, 'complexType')) {
        const n = attr(ct, 'name');
        if (n) idx.set('__type__:' + n, ct);
      }
    }
  }
  return idx;
}

/** Resolve an `<xs:element ref|type|name>` to the inner `<xs:complexType>`
 *  (or null if it's a primitive / nothing to expand). */
function resolveComplexType(el: XmlNode, schemaIdx: Map<string, XmlNode>): XmlNode | null {
  // Inline complexType inside the element
  const inlineCt = childrenByLocalName(el, 'complexType')[0];
  if (inlineCt) return inlineCt;

  const typeAttr = attr(el, 'type');
  if (typeAttr) {
    const local = localOfQName(typeAttr);
    const named = schemaIdx.get('__type__:' + local);
    if (named) return named;
    return null; // primitive (xs:string, xs:int, …)
  }
  return null;
}

type Param = WsdlParam

function buildParams(complexType: XmlNode, schemaIdx: Map<string, XmlNode>, depth = 0): Param[] {
  if (depth > 5) return []; // guard against pathological recursion via type cycles
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

// ─── Envelope template builder ───────────────────────────────────────────────

function indent(level: number): string {
  return '  '.repeat(level);
}

function renderParams(params: Param[], level: number): string {
  return params.map(p => {
    if (p.children && p.children.length) {
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

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseWsdl(wsdlText: string): WsdlResult {
  let doc: XmlNode;
  try {
    doc = new DOMParser().parseFromString(wsdlText, 'text/xml') as unknown as XmlNode;
  } catch (err) {
    throw new Error(`WSDL parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The <definitions> root may be `<wsdl:definitions>` or `<definitions>`.
  const definitions = childrenByLocalName(doc, 'definitions')[0]
    ?? descendantsByLocalName(doc, 'definitions')[0];
  if (!definitions) {
    return { targetNamespace: '', endpoints: [], operations: [] };
  }

  const targetNamespace = attr(definitions, 'targetNamespace') ?? '';

  // ── Index schema elements + named complexTypes ──────────────────────────────
  const schemaIdx = indexSchema(definitions);

  // ── portType operations: name → input message qname ────────────────────────
  const portTypeInputs: Record<string, string | undefined> = {};
  for (const pt of childrenByLocalName(definitions, 'portType')) {
    for (const op of childrenByLocalName(pt, 'operation')) {
      const name = attr(op, 'name');
      if (!name) continue;
      const inputEl = childrenByLocalName(op, 'input')[0];
      portTypeInputs[name] = inputEl ? attr(inputEl, 'message') : undefined;
    }
  }

  // ── messages: qname → element ref (e.g. "tns:Add") ──────────────────────────
  const messageElements: Record<string, string | undefined> = {};
  for (const msg of childrenByLocalName(definitions, 'message')) {
    const name = attr(msg, 'name');
    if (!name) continue;
    const part = childrenByLocalName(msg, 'part')[0];
    if (!part) continue;
    messageElements[name] = attr(part, 'element');
  }

  // ── bindings: list operations + their SOAPAction + version ─────────────────
  interface BindingInfo {
    name: string
    soapVersion: '1.1' | '1.2'
    operations: { name: string; soapAction?: string }[]
  }
  const bindings: BindingInfo[] = [];

  for (const binding of childrenByLocalName(definitions, 'binding')) {
    const bindingName = attr(binding, 'name') ?? '';
    // Detect SOAP version by the inner <soap:binding> / <soap12:binding>
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
      // Find <soap:operation soapAction="..."/> or <soap12:operation soapAction="..."/>
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

  // ── services: binding name → endpoint address ───────────────────────────────
  const endpoints: WsdlEndpoint[] = [];
  for (const svc of childrenByLocalName(definitions, 'service')) {
    for (const port of childrenByLocalName(svc, 'port')) {
      const bindingRef = attr(port, 'binding');
      if (!bindingRef) continue;
      // Find the address element (soap:address or soap12:address)
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

  // ── Compose operations: combine portType (input message) + binding (SOAPAction) + service (endpoint) ──
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

      // Resolve the schema element → its complexType → params
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

  // Fallback: WSDLs without proper bindings (the old test fixtures) — keep
  // the regex-style name extraction so existing simple cases still work.
  if (operations.length === 0) {
    const regex = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["']/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(wsdlText)) !== null) seen.add(m[1]);
    // Also pull soapAction by name from the raw text
    const soapActionByName: Record<string, string> = {};
    const blockRx = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:wsdl:)?operation>/g;
    while ((m = blockRx.exec(wsdlText)) !== null) {
      const sa = m[2].match(/soapAction\s*=\s*["']([^"']*)["']/);
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

// ─── Response envelope template (used for mocking) ──────────────────────────
//
// SOAP response shape mirrors the request: `<tns:{Op}Response><tns:{Op}Result>...`.
// Real schemas vary, but this template is a sensible default for stubbing —
// users can edit per-operation in the Mock detail panel after import.

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

/** JS source for a mock route's `script` field. Branches on the incoming
 *  SOAPAction (or fallback: operation element in the body) and writes the
 *  matching response envelope.
 *
 *  Envelopes themselves are NOT embedded in the script — they live on the
 *  route's `metadata.soapEnvelopes` map so the workspace JSON stays compact
 *  (otherwise a 25-operation WSDL bakes ~30KB into each route). */
export function buildMockDispatchScript(_opMap: Record<string, string>): string {
  return `// Auto-generated by Import WSDL — dispatches per SOAP operation.
// Envelopes come from route metadata.soapEnvelopes (set by the WSDL importer).
const envelopes = (metadata && metadata.soapEnvelopes) || {};
const ct = (metadata && metadata.soapVersion === '1.2')
  ? 'application/soap+xml; charset=utf-8'
  : 'text/xml; charset=utf-8';

const headers = request.headers || {};
const sa      = String(headers['soapaction'] || headers['SOAPAction'] || '').replace(/"/g, '');
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

// ─── IPC handler ─────────────────────────────────────────────────────────────

export function registerSoapHandlers(ipc: IpcMain): void {
  ipc.handle('wsdl:fetch', async (_event, url: string, extraHeaders: Record<string, string> = {}): Promise<WsdlResult> => {
    // Lazy import so the test runner doesn't need electron + ajv on disk for
    // the soap-handler unit tests.
    const { validateWsdlFetchUrl } = await import('./ipc-validate');
    validateWsdlFetchUrl(url);
    const wsdlText = await fetchUrl(url, extraHeaders);
    return parseWsdl(wsdlText);
  });

  // Import a WSDL — returns a ready-to-register Collection + MockServer.
  // Renderer is responsible for persisting them via the existing save flows.
  ipc.handle('wsdl:import', async (_event, opts: { url?: string; xml?: string; name?: string; existingMockPorts?: number[] }) => {
    const { validateWsdlImport } = await import('./ipc-validate');
    validateWsdlImport(opts);
    const { importWsdl } = await import('../wsdl/import');
    const wsdlText = opts.xml ?? (opts.url ? await fetchUrl(opts.url) : '');
    if (!wsdlText) throw new Error('wsdl:import requires either `url` or `xml`');
    return importWsdl(wsdlText, { name: opts.name, existingMockPorts: opts.existingMockPorts });
  });
}
