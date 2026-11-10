// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ApiRequest, AuthConfig, Collection, Environment, Folder, KeyValuePair } from '../../shared/types';
import { authIsConfigured } from '../../shared/request-collection';
import { parsePostScript } from './script-parser';

// Shared helpers for the code generators. Generated output must stay byte-identical,
// so behaviour changes here require updating the generator snapshot tests.

/** Lowercase, hyphenated file-stem (e.g. for spec/test filenames). */
export function slug(name: string): string {
  return name.replaceAll(/\W+/g, '-').toLowerCase().replaceAll(/^-|-$/g, '');
}

/** SHOUTY_SNAKE_CASE env-variable name for a `{{var}}` key. */
export function toEnvVar(key: string): string {
  return key.replaceAll(/\W+/g, '_').toUpperCase();
}

/** Replace `{{var}}` tokens with JS template expressions: `${VAR}` when in
 *  `sharedVars`, otherwise `${process.env.VAR ?? ''}`. */
export function interpolateEnvVars(value: string, sharedVars: Set<string> = new Set()): string {
  return value.replaceAll(/\{\{([^}]+)\}\}/g, (_, key) => {
    const envKey = toEnvVar(key.trim());
    return sharedVars.has(envKey) ? `\${${envKey}}` : `\${process.env.${envKey} ?? ''}`;
  });
}

/** Render a parsed JSON value as a JS literal, converting {{VAR}} to template expressions. */
export function renderJsValue(value: unknown, indent: string, sharedVars: Set<string> = new Set()): string {
  const next = indent + '  ';
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('{{')) {
      return '`' + interpolateEnvVars(value, sharedVars) + '`';
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(v => next + renderJsValue(v, next, sharedVars)).join(',\n')},\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${next}${k}: ${renderJsValue(v, next, sharedVars)}`).join(',\n')},\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Assign a unique display name to every request in a folder (dedupes with " 2", " 3", …). */
export function buildNameMap(folder: Folder, requests: Collection['requests']): Map<string, string> {
  const map  = new Map<string, string>();
  const used = new Set<string>();
  for (const id of folder.requestIds) {
    const req = requests[id];
    if (!req) continue;
    const base = req.name;
    let name = base;
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${base} ${i}`)) i++;
      name = `${base} ${i}`;
    }
    used.add(name);
    map.set(id, name);
  }
  return map;
}

/** UpperCamelCase Java class name from a display name. */
export function javaClass(name: string): string {
  return name.replaceAll(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** Request's own auth wins; `type: 'none'` falls back to inherited
 *  folder/collection auth. */
export function resolveEffectiveAuth(
  req: ApiRequest,
  inherited: { auth: AuthConfig | null },
): AuthConfig {
  return authIsConfigured(req.auth) ? req.auth : (inherited.auth ?? req.auth);
}

/** Inherited (collection/folder) headers first, then the request's own - enabled + non-empty only. */
export function mergeHeaders(
  req: ApiRequest,
  inherited: { headers: KeyValuePair[] },
): KeyValuePair[] {
  return [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];
}

/** True when the request has a body to send (any mode except 'none', and not a GET/HEAD). */
export function hasBody(req: ApiRequest): boolean {
  return req.body.mode !== 'none' && !['get', 'head'].includes(req.method.toLowerCase());
}

/** Pick the base URL out of an environment (base_url / baseUrl / base-url, non-secret). */
export function getEnvBaseUrl(environment: Environment | null, fallback: string): string {
  return environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? fallback;
}

/** ASCII tree rendering of a file-path list (for generated READMEs). */
export function renderTree(paths: string[]): string {
  interface Node { [k: string]: Node }
  const root: Node = {};
  for (const p of [...paths].sort((a, b) => a.localeCompare(b))) {
    let cur = root;
    for (const part of p.split('/')) { cur = (cur[part] ??= {}); }
  }
  function render(node: Node, prefix = ''): string[] {
    const entries = Object.entries(node);
    return entries.flatMap(([name, children], i) => {
      const last = i === entries.length - 1;
      const lines = [`${prefix}${last ? '└── ' : '├── '}${name}`];
      if (Object.keys(children).length) lines.push(...render(children, prefix + (last ? '    ' : '│   ')));
      return lines;
    });
  }
  return ['.', ...render(root)].join('\n');
}

// Per-framework method support. Verbs beyond the classic set (notably QUERY) aren't
// first-class in every library; generators fall back to a generic form or skip with a note.

/** Verb helpers on Playwright's APIRequestContext. Anything else goes through
 *  `request.fetch()` with an explicit `method`. */
export const PLAYWRIGHT_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head'];

/** Verb helpers supertest exposes. QUERY has none; callers skip those with a note. */
export const SUPERTEST_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** REST Assured call suffix: verb helper when one exists, generic
 *  `.request("VERB", path)` otherwise. */
export function restAssuredCall(method: string, pathArg: string): string {
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  return verbs.includes(method) ? `.${method}(${pathArg})` : `.request("${method.toUpperCase()}", ${pathArg})`;
}

/** Keywords from robotframework-requests. QUERY is absent; callers WARN + skip. */
export const ROBOT_REQUESTS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// JSONPath extraction rendering. `sp.jsonPath` uses jsonpath-plus (Jayway) syntax, shared by
// JS targets, Karate and REST Assured, so the query string passes through verbatim.

/** JS expression resolving a JSONPath query against `jsonVar`, with optional
 *  index and `?? fallback`. Needs `jsonpath-plus`' `JSONPath` imported. */
export function jsJsonPathExpr(
  q: { query: string; index: number | null; fallback: string | null },
  jsonVar: string
): string {
  const base = `JSONPath({ path: ${JSON.stringify(q.query)}, json: ${jsonVar} })`;
  const picked = q.index !== null ? `${base}[${q.index}]` : base;
  if (q.fallback !== null) return `(${picked} ?? ${JSON.stringify(q.fallback)})`;
  return picked;
}

/** Karate expression resolving a JSONPath query via `karate.jsonPath`, with
 *  optional index and `||` fallback. */
export function karateJsonPathExpr(
  q: { query: string; index: number | null; fallback: string | null }
): string {
  const base = `karate.jsonPath(response, '${q.query.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}')`;
  const picked = q.index !== null ? `${base}[${q.index}]` : base;
  if (q.fallback !== null) return `(${picked} || '${q.fallback.replaceAll("'", "\\'")}')`;
  return picked;
}

/** True when any request's post-script extracts a value via `sp.jsonPath(...)`. */
export function collectionUsesJsonPath(collection: Collection): boolean {
  return Object.values(collection.requests).some(req =>
    parsePostScript(req.postRequestScript).extractions.some(e => e.jsonPath)
  );
}

/** True when any request in this folder (non-recursive) uses a `sp.jsonPath(...)` extraction. */
export function folderUsesJsonPath(folder: Folder, collection: Collection): boolean {
  return folder.requestIds.some(id => {
    const req = collection.requests[id];
    return !!req && parsePostScript(req.postRequestScript).extractions.some(e => e.jsonPath);
  });
}
