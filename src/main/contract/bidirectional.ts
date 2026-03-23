import type {
  ApiRequest,
  ContractResult,
  ContractReport,
  ContractViolation,
} from '../../shared/types';
import { loadSpec, resolveSchema, findOperation } from './provider-verifier';
import { validateConsumerResponse } from './consumer-verifier';
import { fetch, Headers } from 'undici';
import { interpolate, buildUrl } from '../interpolation';
import { buildAuthHeaders } from '../auth-builder';

// ─── Bi-directional contract verifier ────────────────────────────────────────
//
// Bi-directional: both sides publish.
//   • Consumer side  — the request's ContractExpectation (status, headers, body schema)
//   • Provider side  — an OpenAPI spec describing what the provider actually offers
//
// Two things are verified:
//   1. Static compatibility: the consumer's expected body schema is compatible
//      with the provider's documented response schema (no live HTTP call needed).
//   2. Live verification: the real request is sent and the response is validated
//      against the consumer's contract (same as consumer mode).
//
// "Schema compatible" means every field the consumer *requires* exists in the
// provider's schema with a compatible type.  The provider may return more fields
// than the consumer expects — that is fine.

// ─── Schema compatibility checker ────────────────────────────────────────────

/**
 * Recursively check that consumerSchema expectations can be satisfied by
 * providerSchema.  Returns violations for any incompatibility found.
 *
 * The key rule: if the consumer requires a field, the provider must define it
 * with a compatible type.  Extra fields in the provider are always allowed.
 */
export function checkSchemaCompatibility(
  consumerSchema: Record<string, unknown>,
  providerSchema: Record<string, unknown>,
  path = '',
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  if (!consumerSchema || !providerSchema) return violations;

  // ── Root type mismatch ──
  const cType = consumerSchema['type'] as string | undefined;
  const pType = providerSchema['type'] as string | undefined;

  if (cType && pType && cType !== pType) {
    // integer is compatible with number
    const ok = (cType === 'integer' && pType === 'number') || (cType === 'number' && pType === 'integer');
    if (!ok) {
      violations.push({
        type:     'schema_incompatible',
        message:  `Type mismatch${path ? ` at "${path}"` : ''}: consumer expects "${cType}", provider offers "${pType}"`,
        path:     path || '/',
        expected: cType,
        actual:   pType,
      });
      return violations;  // no point checking properties if root type differs
    }
  }

  // ── Array items ──
  if (cType === 'array' || Array.isArray(consumerSchema['items'])) {
    const cItems = consumerSchema['items'] as Record<string, unknown> | undefined;
    const pItems = providerSchema['items'] as Record<string, unknown> | undefined;
    if (cItems && pItems) {
      violations.push(...checkSchemaCompatibility(cItems, pItems, path ? `${path}[]` : '[]'));
    }
    return violations;
  }

  // ── Object properties ──
  if (cType === 'object' || consumerSchema['properties']) {
    const cProps    = (consumerSchema['properties'] as Record<string, unknown>) ?? {};
    const pProps    = (providerSchema['properties'] as Record<string, unknown>) ?? {};
    const cRequired = (consumerSchema['required'] as string[]) ?? [];

    for (const field of cRequired) {
      const fieldPath = path ? `${path}.${field}` : field;
      if (!(field in pProps)) {
        violations.push({
          type:     'schema_incompatible',
          message:  `Consumer requires field "${fieldPath}" which is not defined in provider schema`,
          path:     fieldPath,
          expected: '(defined)',
          actual:   '(absent)',
        });
      }
    }

    // Recursively check shared properties
    for (const [field, cPropSchema] of Object.entries(cProps)) {
      if (field in pProps) {
        const fieldPath = path ? `${path}.${field}` : field;
        violations.push(...checkSchemaCompatibility(
          cPropSchema as Record<string, unknown>,
          pProps[field] as Record<string, unknown>,
          fieldPath,
        ));
      }
    }
  }

  return violations;
}

// ─── Provider spec response schema lookup ────────────────────────────────────

function getProviderResponseSchema(
  spec:            Record<string, unknown>,
  req:             ApiRequest,
  envVars:         Record<string, string>,
  statusCode:      number,
  requestBaseUrl?: string,
): Record<string, unknown> | null {
  const url   = req.url.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => envVars[k] ?? `{{${k}}}`);
  const match = findOperation(spec, req.method, url, requestBaseUrl);
  if (!match) return null;

  const responses = (match.operation['responses'] as Record<string, unknown>) ?? {};
  // Try exact status, then 2xx wildcard, then 'default'
  const candidates = [String(statusCode), `${String(statusCode)[0]}xx`, '2XX', '2xx', 'default'];
  for (const candidate of candidates) {
    const resp = responses[candidate];
    if (resp) {
      const resolved = resolveSchema(spec, resp) as Record<string, unknown>;
      const content  = (resolved['content'] as Record<string, unknown>) ?? {};
      const json     = content['application/json'] as Record<string, unknown> | undefined;
      if (json?.['schema']) {
        return resolveSchema(spec, json['schema']) as Record<string, unknown>;
      }
    }
  }
  return null;
}

// ─── HTTP execution (same as consumer) ───────────────────────────────────────

async function executeRequest(
  req:  ApiRequest,
  vars: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; body: string; durationMs: number } | Error> {
  const url = buildUrl(req.url, req.params, vars);
  const start = Date.now();
  try {
    const headers = new Headers();
    for (const h of req.headers) {
      if (h.enabled && h.key) headers.set(interpolate(h.key, vars), interpolate(h.value, vars));
    }
    const authHeaders = await buildAuthHeaders(req.auth, vars);
    for (const [k, v] of Object.entries(authHeaders)) headers.set(k, v);

    let body: string | undefined;
    if (req.body.mode === 'json' && req.body.json) {
      body = interpolate(req.body.json, vars);
      if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
    }

    const resp     = await fetch(url, {
      method: req.method, headers,
      body:   !['GET', 'HEAD'].includes(req.method) ? body : undefined,
    } as Parameters<typeof fetch>[1]);
    const bodyText = await resp.text();
    const rawHdrs: Record<string, string> = {};
    resp.headers.forEach((v, k) => { rawHdrs[k] = v; });
    return { status: resp.status, headers: rawHdrs, body: bodyText, durationMs: Date.now() - start };
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runBidirectional(
  requests:         ApiRequest[],
  envVars:          Record<string, string>,
  collectionVars:   Record<string, string> = {},
  specUrl?:         string,
  specPath?:        string,
  requestBaseUrl?:  string,
): Promise<ContractReport> {
  const spec  = await loadSpec(specUrl, specPath) as Record<string, unknown>;
  const vars  = { ...envVars, ...collectionVars };
  const start = Date.now();

  // Only requests that have a consumer contract
  const contractRequests = requests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.headers?.length),
  );

  const results: ContractResult[] = await Promise.all(contractRequests.map(async req => {
    const url        = buildUrl(req.url, req.params, vars);
    const violations: ContractViolation[] = [];

    // ── 1. Static schema compatibility check ──
    const expectedStatus = req.contract!.statusCode ?? 200;
    const consumerSchema = req.contract!.bodySchema
      ? (() => { try { return JSON.parse(req.contract!.bodySchema!) as Record<string, unknown>; } catch { return null; } })()
      : null;

    if (consumerSchema) {
      const providerSchema = getProviderResponseSchema(spec, req, vars, expectedStatus, requestBaseUrl);
      if (!providerSchema) {
        violations.push({
          type:    'schema_incompatible',
          message: `No response schema found in spec for ${req.method} ${url} → ${expectedStatus}`,
        });
      } else {
        violations.push(...checkSchemaCompatibility(consumerSchema, providerSchema));
      }
    }

    // ── 2. Live consumer verification ──
    const result = await executeRequest(req, vars);
    if (result instanceof Error) {
      violations.push({ type: 'status_mismatch', message: `Request failed: ${result.message}` });
      return { requestId: req.id, requestName: req.name, method: req.method, url, passed: false, violations };
    }

    const liveViolations = validateConsumerResponse(
      req.contract!, result.status, result.headers, result.body,
    );
    violations.push(...liveViolations);

    return {
      requestId:    req.id,
      requestName:  req.name,
      method:       req.method,
      url,
      passed:       violations.length === 0,
      violations,
      durationMs:   result.durationMs,
      actualStatus: result.status,
    };
  }));

  const passed = results.filter(r => r.passed).length;
  return {
    mode:      'bidirectional',
    total:     results.length,
    passed,
    failed:    results.length - passed,
    results,
    durationMs: Date.now() - start,
  };
}
