// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// SoapUI / ReadyAPI project importer: parses project XML into a Collection, running every Groovy
// artefact through the Groovy->sp.* converter and returning review candidates plus a summary report.
// Namespace-prefix tolerant (matches on localName); unknown steps / non-Groovy assertions warn, never throw.

import { v4 as uuidv4 } from 'uuid';
import { DOMParser } from '@xmldom/xmldom';
import type { Collection, ApiRequest, Folder, RequestBody, KeyValuePair, SoapUiImportReport } from '../../shared/types';
import { normalizeHttpMethod } from '../../shared/types';

export type { SoapUiImportReport };
import { convertGroovyScript, type GroovyConversionStatus, type GroovyUnmapped } from './groovy-script';

// xmldom nodes are structurally typed; treat them as `any` and read through the
// helpers below.
type El = any // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ConversionCandidate {
  id: string
  /** Breadcrumb, e.g. "Orders / Create order / Status check". */
  location: string
  kind: 'assertion' | 'script-step' | 'setup' | 'teardown'
  /** Original Groovy source. */
  original: string
  /** Converted JavaScript (best effort). */
  js: string
  status: GroovyConversionStatus
  notes: string[]
  unmapped: GroovyUnmapped[]
  /** The request this script is attached to (assertion / carrier step). */
  requestId: string
}

export interface SoapUiImportResult {
  collection: Collection
  candidates: ConversionCandidate[]
  report: SoapUiImportReport
}

// XML helpers (namespace-prefix tolerant)

function localName(el: El): string {
  return el.localName ?? String(el.tagName ?? el.nodeName ?? '').replace(/^.*:/, '');
}

function childElements(el: El): El[] {
  const out: El[] = [];
  const kids = el?.childNodes;
  if (!kids) return out;
  for (let i = 0; i < kids.length; i++) if (kids[i].nodeType === 1) out.push(kids[i]);
  return out;
}

/** Direct child elements whose localName matches `name`. */
function childrenByLocal(el: El, name: string): El[] {
  return childElements(el).filter(c => localName(c) === name);
}

function firstChildByLocal(el: El, name: string): El | null {
  return childElements(el).find(c => localName(c) === name) ?? null;
}

/** First descendant (any depth) whose localName matches `name`. */
function firstDescByLocal(el: El, name: string): El | null {
  for (const c of childElements(el)) {
    if (localName(c) === name) return c;
    const deep = firstDescByLocal(c, name);
    if (deep) return deep;
  }
  return null;
}

function textOf(el: El | null): string {
  return (el?.textContent ?? '').trim();
}

function attr(el: El, name: string): string {
  return (el?.getAttribute?.(name) ?? '').trim();
}

// SoapUI property bags -> variable records
// <con:properties><con:property><con:name>k</con:name><con:value>v</con:value>…
function readProperties(container: El | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!container) return out;
  const props = firstChildByLocal(container, 'properties');
  if (!props) return out;
  for (const p of childrenByLocal(props, 'property')) {
    const key = textOf(firstChildByLocal(p, 'name'));
    if (!key) continue;
    out[key] = textOf(firstChildByLocal(p, 'value'));
  }
  return out;
}

// Main entry

export function importSoapUiProject(xml: string, fallbackName = 'SoapUI Import'): SoapUiImportResult {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as El;
  const project = firstDescByLocal(doc, 'soapui-project') ?? doc.documentElement;
  const projectName = attr(project, 'name') || fallbackName;

  const requests: Record<string, ApiRequest> = {};
  const candidates: ConversionCandidate[] = [];
  const warnings: string[] = [];
  const report: SoapUiImportReport = {
    project: projectName,
    testSuites: 0,
    testCases: 0,
    requests: 0,
    scripts: { total: 0, clean: 0, partial: 0, unsupported: 0 },
    warnings,
  };

  const rootFolder: Folder = { id: uuidv4(), name: '', folders: [], requestIds: [] };

  // Convert a Groovy artefact: record a candidate, update counts, return the JS.
  const convert = (original: string, kind: ConversionCandidate['kind'], location: string, requestId: string): string => {
    const c = convertGroovyScript(original);
    candidates.push({ id: uuidv4(), location, kind, original, js: c.js, status: c.status, notes: c.notes, unmapped: c.unmapped, requestId });
    report.scripts.total++;
    report.scripts[c.status]++;
    return c.js;
  };

  // A no-URL carrier request holding a standalone script in postRequestScript.
  // API Spector attaches scripts to requests, so script-only steps need a host.
  const scriptCarrier = (name: string, js: string, originKind: string): ApiRequest => ({
    id: uuidv4(),
    name,
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
    protocol: 'http',
    postRequestScript: js,
    description: `SoapUI ${originKind} (imported as a script step)`,
    meta: { tags: ['soapui-script'] },
  });

  const projectVars = readProperties(project);
  // A test step references an interface operation by name only; index the
  // operations so request steps can resolve their verb + params.
  const methodIndex = indexInterfaceMethods(project);
  const fallbackEndpoint = firstInterfaceEndpoint(project);

  // Project-level setup/teardown -> carrier requests at the root.
  for (const [tag, kind] of [['setupScript', 'setup'], ['tearDownScript', 'teardown']] as const) {
    const el = firstChildByLocal(project, tag);
    const src = textOf(el);
    if (!src) continue;
    const carrier = scriptCarrier(`Project ${kind}`, '', kind);
    carrier.postRequestScript = convert(src, kind, `${projectName} / project ${kind}`, carrier.id);
    requests[carrier.id] = carrier;
    rootFolder.requestIds.push(carrier.id);
  }

  for (const suite of firstDescAll(project, 'testSuite')) {
    report.testSuites++;
    const suiteFolder: Folder = {
      id: uuidv4(),
      name: attr(suite, 'name') || `TestSuite ${report.testSuites}`,
      folders: [],
      requestIds: [],
      variables: readProperties(suite),
    };
    rootFolder.folders.push(suiteFolder);

    for (const tc of childrenByLocal(suite, 'testCase')) {
      report.testCases++;
      const caseFolder: Folder = {
        id: uuidv4(),
        name: attr(tc, 'name') || `TestCase ${report.testCases}`,
        folders: [],
        requestIds: [],
        variables: readProperties(tc),
      };
      suiteFolder.folders.push(caseFolder);
      const crumb = `${suiteFolder.name} / ${caseFolder.name}`;

      // TestCase setup/teardown scripts.
      for (const [tag, kind] of [['setupScript', 'setup'], ['tearDownScript', 'teardown']] as const) {
        const src = textOf(firstChildByLocal(tc, tag));
        if (!src) continue;
        const carrier = scriptCarrier(`${caseFolder.name} ${kind}`, '', kind);
        carrier.postRequestScript = convert(src, kind, `${crumb} / ${kind}`, carrier.id);
        requests[carrier.id] = carrier;
        caseFolder.requestIds.push(carrier.id);
      }

      for (const step of childrenByLocal(tc, 'testStep')) {
        const type = attr(step, 'type').toLowerCase();
        const stepName = attr(step, 'name') || 'Step';

        if (type === 'groovy') {
          const src = textOf(firstDescByLocal(step, 'script'));
          if (!src.trim()) { warnings.push(`Empty Groovy step "${stepName}" skipped.`); continue; }
          const carrier = scriptCarrier(stepName, '', 'Groovy step');
          carrier.postRequestScript = convert(src, 'script-step', `${crumb} / ${stepName}`, carrier.id);
          requests[carrier.id] = carrier;
          caseFolder.requestIds.push(carrier.id);
          continue;
        }

        if (type === 'restrequest' || type === 'request' || type === 'httprequest') {
          const req = buildRequest(step, type, stepName, convert, warnings, `${crumb} / ${stepName}`, methodIndex, fallbackEndpoint);
          requests[req.id] = req;
          caseFolder.requestIds.push(req.id);
          report.requests++;
          continue;
        }

        if (type === 'transfer' || type === 'datasource' || type === 'datasink') {
          warnings.push(`Property Transfer / data step "${stepName}" (${type}) needs manual setup — not imported.`);
          continue;
        }
        warnings.push(`Unsupported step type "${type}" ("${stepName}") skipped.`);
      }
    }
  }

  // Interface/mock-only projects: import REST operations as requests so the
  // project isn't empty. Skipped when test steps already produced requests.
  if (report.requests === 0) {
    importInterfaceDefinitions(project, rootFolder, requests, report, warnings);
  }
  if (report.requests === 0 && report.scripts.total === 0) {
    warnings.push('No requests or scripts were found to import in this project.');
  }

  const collection: Collection = {
    version: '1.0',
    id: uuidv4(),
    name: projectName,
    rootFolder,
    requests,
    collectionVariables: Object.keys(projectVars).length ? projectVars : undefined,
    description: 'Imported from SoapUI / ReadyAPI',
  };

  return { collection, candidates, report };
}

// All descendants (any depth) with the given localName.
function firstDescAll(root: El, name: string): El[] {
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of childElements(el)) {
      if (localName(c) === name) out.push(c);
      else walk(c); // don't recurse into a matched node (test suites don't nest)
    }
  };
  walk(root);
  return out;
}

// Request step -> ApiRequest

interface MethodDef { verb: string; params: KeyValuePair[] }

function buildRequest(
  step: El,
  type: string,
  name: string,
  convert: (src: string, kind: ConversionCandidate['kind'], location: string, requestId: string) => string,
  warnings: string[],
  crumb: string,
  methodIndex: Map<string, MethodDef>,
  fallbackEndpoint: string,
): ApiRequest {
  const id = uuidv4();
  // Config sits under <con:config>; its localName varies (restRequest / request
  // / httpRequest), so take the first element holding an endpoint/method/assertion.
  const config = firstChildByLocal(step, 'config') ?? step;
  const reqEl = childElements(config).find(c => firstDescByLocal(c, 'endpoint') || firstChildByLocal(c, 'method')) ?? config;

  const endpoint = textOf(firstDescByLocal(reqEl, 'endpoint')) || fallbackEndpoint;
  // resourcePath + verb live on <con:config> (verb via methodName -> interface
  // method). Fall back to child elements/attributes for other variants.
  const resourcePath = attr(config, 'resourcePath')
    || textOf(firstChildByLocal(reqEl, 'resourcePath')) || textOf(firstChildByLocal(reqEl, 'path'));
  const methodDef = methodIndex.get(attr(config, 'methodName'));
  const isSoap = type === 'request';
  const method = normalizeHttpMethod(
    methodDef?.verb
    || attr(reqEl, 'method') || attr(config, 'method')
    || textOf(firstChildByLocal(reqEl, 'method'))
    || (isSoap ? 'POST' : 'GET'),
  );
  const url = joinUrl(endpoint, resourcePath);

  const rawBody = textOf(firstChildByLocal(reqEl, 'request'));
  let body: RequestBody = { mode: 'none' };
  if (rawBody) {
    body = isSoap
      ? { mode: 'raw', raw: rawBody, rawContentType: 'text/xml' }
      : { mode: 'raw', raw: rawBody, rawContentType: looksJson(rawBody) ? 'application/json' : 'text/plain' };
  }

  const req: ApiRequest = {
    id,
    name,
    method,
    url,
    headers: [],
    params: readStepParams(reqEl) ?? methodDef?.params ?? [],
    auth: { type: 'none' },
    body,
    protocol: isSoap ? 'soap' : 'http',
  };

  // SoapUI auth isn't mapped; flag it so an auth'd request doesn't import as no-auth.
  const authType = textOf(firstDescByLocal(reqEl, 'authType'));
  if (authType && !/^no authorization$/i.test(authType)) {
    warnings.push(`Request "${name}" uses "${authType}" auth in SoapUI — set up authentication manually.`);
  }

  // Script Assertions -> converted postRequestScript; non-Groovy ones are reported.
  const scripts: string[] = [];
  for (const a of firstDescAllIn(reqEl, 'assertion')) {
    const aType = attr(a, 'type');
    if (/script/i.test(aType)) {
      const src = textOf(firstDescByLocal(a, 'scriptText')) || textOf(firstDescByLocal(a, 'script'));
      if (!src.trim()) continue;
      const aName = attr(a, 'name') || 'Script Assertion';
      const js = convert(src, 'assertion', `${crumb} / ${aName}`, id);
      scripts.push(`// ${aName}\n${js}`);
    } else if (aType) {
      warnings.push(`Assertion "${attr(a, 'name') || aType}" (${aType}) on "${name}" is not a Script Assertion — re-create with sp.expect.`);
    }
  }
  if (scripts.length) req.postRequestScript = scripts.join('\n\n');

  return req;
}

// Assertions can be nested under a config wrapper; collect all descendants.
function firstDescAllIn(root: El, name: string): El[] {
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of childElements(el)) {
      if (localName(c) === name) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

function joinUrl(endpoint: string, path: string): string {
  if (!endpoint) return path;
  if (!path) return endpoint;
  return endpoint.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function looksJson(s: string): boolean {
  const t = s.trim();
  return t.startsWith('{') || t.startsWith('[');
}

// Interface (REST service) definitions

// Interface operations by SoapUI method name, so a request step (storing only
// `methodName`) can resolve its verb and params.
function indexInterfaceMethods(project: El): Map<string, MethodDef> {
  const map = new Map<string, MethodDef>();
  for (const iface of firstDescAll(project, 'interface')) {
    for (const method of firstDescAllIn(iface, 'method')) {
      const name = attr(method, 'name');
      if (!name) continue;
      map.set(name, { verb: attr(method, 'method') || 'GET', params: methodParams(method) });
    }
  }
  return map;
}

function firstInterfaceEndpoint(project: El): string {
  const iface = firstDescByLocal(project, 'interface');
  return iface ? textOf(firstDescByLocal(iface, 'endpoint')) : '';
}

// A REST method's declared params -> request params (TEMPLATE style = path, else query).
function methodParams(method: El): KeyValuePair[] {
  const out: KeyValuePair[] = [];
  const pc = firstChildByLocal(method, 'parameters');
  if (!pc) return out;
  for (const p of childrenByLocal(pc, 'parameter')) {
    const key = textOf(firstChildByLocal(p, 'name'));
    if (!key) continue;
    const style = textOf(firstChildByLocal(p, 'style')).toUpperCase();
    out.push({ key, value: '', enabled: true, paramType: style === 'TEMPLATE' ? 'path' : 'query' });
  }
  return out;
}

// A request step's own concrete param values, or null so the caller falls back
// to the interface method's declared params.
function readStepParams(reqEl: El): KeyValuePair[] | null {
  const pc = firstChildByLocal(reqEl, 'parameters');
  if (!pc) return null;
  const entries = childrenByLocal(pc, 'entry');
  if (!entries.length) return null;
  return entries.map(e => ({ key: attr(e, 'key'), value: attr(e, 'value'), enabled: true }));
}

// Import each REST interface's resources/methods as requests. Used only when the
// project has no request test steps.
function importInterfaceDefinitions(
  project: El,
  rootFolder: Folder,
  requests: Record<string, ApiRequest>,
  report: SoapUiImportReport,
  warnings: string[],
): void {
  for (const iface of firstDescAll(project, 'interface')) {
    const ifaceName = attr(iface, 'name') || 'API';
    const ifaceType = (attr(iface, 'type') || '').toLowerCase();
    const endpoint = textOf(firstDescByLocal(iface, 'endpoint'));
    const resources = childrenByLocal(iface, 'resource');
    if (!resources.length) {
      warnings.push(`Interface "${ifaceName}"${ifaceType ? ` (${ifaceType})` : ''} has no REST resources to import.`);
      continue;
    }
    const folder: Folder = { id: uuidv4(), name: ifaceName, folders: [], requestIds: [] };

    const addResource = (res: El, basePath: string): void => {
      const path = joinUrl(basePath, attr(res, 'path'));
      for (const method of childrenByLocal(res, 'method')) {
        const verb = normalizeHttpMethod(attr(method, 'method') || 'GET');
        const reqDef = firstChildByLocal(method, 'request');
        const ep = (reqDef ? textOf(firstChildByLocal(reqDef, 'endpoint')) : '') || endpoint;
        const rawBody = reqDef ? textOf(firstChildByLocal(reqDef, 'request')) : '';
        const req: ApiRequest = {
          id: uuidv4(),
          name: attr(method, 'name') || `${verb} ${path}`,
          method: verb,
          url: joinUrl(ep, path),
          headers: [],
          params: methodParams(method),
          auth: { type: 'none' },
          body: rawBody
            ? { mode: 'raw', raw: rawBody, rawContentType: looksJson(rawBody) ? 'application/json' : 'text/plain' }
            : { mode: 'none' },
          protocol: 'http',
        };
        requests[req.id] = req;
        folder.requestIds.push(req.id);
        report.requests++;
      }
      for (const sub of childrenByLocal(res, 'resource')) addResource(sub, path);
    };

    for (const res of resources) addResource(res, '');
    if (folder.requestIds.length) rootFolder.folders.push(folder);
  }
}
