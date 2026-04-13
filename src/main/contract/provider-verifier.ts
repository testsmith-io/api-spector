// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { readFile } from 'fs/promises';
import { fetch } from 'undici';
import { load as yamlLoad } from 'js-yaml';
import Ajv from 'ajv';
import type {
  ApiRequest,
  ContractResult,
  ContractReport,
  ContractViolation,
} from '../../shared/types';
import { interpolate } from '../interpolation';

// ─── Provider contract verifier ───────────────────────────────────────────────
//
// Provider-driven contract testing: the provider publishes an OpenAPI spec.
// We validate that each request in the collection conforms to what the spec
// says the provider accepts — correct paths, methods, request body schema,
// and required query parameters.  No live HTTP calls; pure static analysis.

const ajv = new Ajv({ allErrors: true, strict: false });

// ─── Spec loading ─────────────────────────────────────────────────────────────

export async function loadSpec(specUrl?: string, specPath?: string): Promise<unknown> {
  if (specUrl) {
    const resp = await fetch(specUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading spec from ${specUrl}`);
    const text = await resp.text();
    const ct   = resp.headers.get('content-type') ?? '';
    return (ct.includes('yaml') || specUrl.endsWith('.yaml') || specUrl.endsWith('.yml'))
      ? yamlLoad(text)
      : JSON.parse(text);
  }
  if (specPath) {
    const raw = await readFile(specPath, 'utf8');
    return (specPath.endsWith('.yaml') || specPath.endsWith('.yml'))
      ? yamlLoad(raw)
      : JSON.parse(raw);
  }
  throw new Error('Either specUrl or specPath must be provided');
}

// ─── Spec helpers ─────────────────────────────────────────────────────────────

function resolveRef(spec: Record<string, unknown>, ref: string): unknown {
  const parts = ref.replace(/^#\//, '').split('/');
  return parts.reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], spec);
}

export function resolveSchema(spec: Record<string, unknown>, obj: unknown, seen = new Set<unknown>()): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return {};
  if (Array.isArray(obj)) { seen.add(obj); return obj.map(i => resolveSchema(spec, i, seen)); }
  const o = obj as Record<string, unknown>;
  if ('$ref' in o) {
    const target = resolveRef(spec, o['$ref'] as string);
    return resolveSchema(spec, target, seen);
  }
  seen.add(obj);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveSchema(spec, v, seen)]));
}

function getServerBases(spec: Record<string, unknown>): string[] {
  const servers = (spec['servers'] as { url?: string }[] | undefined) ?? [];
  if (!servers.length) return [''];
  return servers.map(s => {
    const raw = s.url ?? '';
    try {
      // Keep only the path prefix so the regex matches against urlPathname()
      return new URL(raw).pathname.replace(/\/$/, '');
    } catch {
      return raw.replace(/\/$/, '');
    }
  });
}

function urlPathname(raw: string, baseUrl?: string): string {
  try {
    const pathname = new URL(raw).pathname;
    if (baseUrl) {
      try {
        const basePath = new URL(baseUrl).pathname.replace(/\/$/, '');
        if (basePath && pathname.startsWith(basePath)) return pathname.slice(basePath.length) || '/';
      } catch { /* ignore invalid baseUrl */ }
    }
    return pathname;
  } catch {
    return raw.split('?')[0];
  }
}

function pathTemplateToRegex(base: string, template: string): RegExp {
  const combined = (base + template).replace(/\/+/g, '/');
  const pattern  = combined.replace(/\{[^}]+\}/g, '[^/]+');
  return new RegExp('^' + pattern + '/?$');
}

// ─── Pure validation — exported for unit testing ──────────────────────────────

export interface MatchedOperation {
  pathTemplate: string
  operation: Record<string, unknown>
}

export function findOperation(
  spec:           Record<string, unknown>,
  method:         string,
  reqUrl:         string,
  requestBaseUrl?: string,
): MatchedOperation | null {
  const bases    = getServerBases(spec);
  const pathname = urlPathname(reqUrl, requestBaseUrl);
  const paths    = (spec['paths'] as Record<string, unknown>) ?? {};

  for (const [template, pathItem] of Object.entries(paths)) {
    const resolved = resolveSchema(spec, pathItem) as Record<string, unknown>;
    for (const base of bases) {
      if (pathTemplateToRegex(base, template).test(pathname)) {
        const op = resolved[method.toLowerCase()];
        return op ? { pathTemplate: template, operation: op as Record<string, unknown> } : null;
      }
    }
  }
  return null;
}

export function validateRequestAgainstSpec(
  spec:            Record<string, unknown>,
  req:             ApiRequest,
  envVars:         Record<string, string>,
  requestBaseUrl?: string,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const vars = envVars;
  const url  = req.url.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);

  const match = findOperation(spec, req.method, url, requestBaseUrl);
  if (!match) {
    violations.push({
      type:    'unknown_path',
      message: `No operation found in spec for ${req.method} ${url}`,
    });
    return violations;
  }

  const { operation } = match;

  // ── Request body ──
  if (req.body.mode === 'json' && req.body.json?.trim()) {
    const requestBody = resolveSchema(spec, (operation as Record<string, unknown>)['requestBody']) as Record<string, unknown> | null;
    const content     = (requestBody?.['content'] as Record<string, unknown>) ?? {};
    const jsonContent = content['application/json'] as Record<string, unknown> | undefined;

    if (jsonContent?.['schema']) {
      try {
        const data     = JSON.parse(interpolate(req.body.json, vars));
        const schema   = resolveSchema(spec, jsonContent['schema']);
        const validate = ajv.compile(schema as object);
        if (!validate(data)) {
          for (const err of validate.errors ?? []) {
            violations.push({
              type:    'request_body_invalid',
              message: err.message ?? 'Request body schema violation',
              path:    err.instancePath || '/',
            });
          }
        }
      } catch (e) {
        violations.push({
          type:    'request_body_invalid',
          message: `Could not validate request body: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  // ── Required query parameters ──
  const parameters = resolveSchema(spec, (operation as Record<string, unknown>)['parameters'] ?? []) as unknown[];
  for (const param of parameters) {
    const p = param as Record<string, unknown>;
    if (p['in'] === 'query' && p['required'] === true) {
      const name = p['name'] as string;
      if (!req.params.some(kv => kv.enabled && kv.key === name)) {
        violations.push({
          type:    'request_body_invalid',
          message: `Required query parameter "${name}" is missing`,
          path:    `query.${name}`,
        });
      }
    }
  }

  return violations;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runProviderVerification(
  requests:         ApiRequest[],
  envVars:          Record<string, string>,
  specUrl?:         string,
  specPath?:        string,
  requestBaseUrl?:  string,
): Promise<ContractReport> {
  const spec  = await loadSpec(specUrl, specPath) as Record<string, unknown>;
  const start = Date.now();

  const activeRequests = requests.filter(r => !r.disabled);
  const results: ContractResult[] = activeRequests.map(req => {
    const violations = validateRequestAgainstSpec(spec, req, envVars, requestBaseUrl);
    const url = req.url.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => envVars[k] ?? `{{${k}}}`);
    return {
      requestId:   req.id,
      requestName: req.name,
      method:      req.method,
      url,
      passed:      violations.length === 0,
      violations,
    };
  });

  const passed = results.filter(r => r.passed).length;
  return {
    mode:      'provider',
    total:     results.length,
    passed,
    failed:    results.length - passed,
    results,
    durationMs: Date.now() - start,
  };
}
