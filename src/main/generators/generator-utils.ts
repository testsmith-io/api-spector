// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ApiRequest, AuthConfig, Collection, Environment, Folder, KeyValuePair } from '../../shared/types';

// ─── Shared helpers for the code generators ──────────────────────────────────
//
// Every function in this file was copy-pasted verbatim across two or more
// generators before being extracted here. Generated output must stay
// byte-identical, so behaviour-affecting changes to these helpers require
// updating the generator snapshot tests.

/** Lowercase, hyphenated file-stem (e.g. for spec/test filenames). */
export function slug(name: string): string {
  return name.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '');
}

/** SHOUTY_SNAKE_CASE env-variable name for a `{{var}}` key. */
export function toEnvVar(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

/**
 * Replace `{{var}}` tokens with JS template expressions: `${VAR}` if the
 * variable was extracted by a hook (present in `sharedVars`), otherwise
 * `${process.env.VAR ?? ''}`.
 */
export function interpolateEnvVars(value: string, sharedVars: Set<string> = new Set()): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
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
  return name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * The request's own auth wins; a request with `type: 'none'` falls back to
 * the auth inherited from its folder/collection (or its own 'none' config
 * when nothing is inherited).
 */
export function resolveEffectiveAuth(
  req: ApiRequest,
  inherited: { auth: AuthConfig | null },
): AuthConfig {
  return req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
}

/** Inherited (collection/folder) headers first, then the request's own — enabled + non-empty only. */
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
  for (const p of [...paths].sort()) {
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
