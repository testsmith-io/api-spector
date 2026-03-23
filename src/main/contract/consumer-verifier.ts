import { fetch, Headers } from 'undici';
import Ajv from 'ajv';
import type {
  ApiRequest,
  ContractExpectation,
  ContractResult,
  ContractReport,
  ContractViolation,
} from '../../shared/types';
import { interpolate, buildUrl } from '../interpolation';
import { buildAuthHeaders } from '../auth-builder';

// ─── Consumer contract verifier ───────────────────────────────────────────────
//
// Consumer-driven contract testing: the consumer (this collection) defines
// what it *expects* from the provider — status code, required headers, and a
// response body JSON Schema.  We send the real request and assert the contract.

const ajv = new Ajv({ allErrors: true, strict: false });

// ─── Pure validation (no HTTP) — exported for unit testing ───────────────────

/**
 * Validate an already-received response against a ContractExpectation.
 * Returns an array of violations (empty = passed).
 */
export function validateConsumerResponse(
  contract: ContractExpectation,
  actualStatus: number,
  actualHeaders: Record<string, string>,
  bodyText: string,
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  // ── Status code ──
  if (contract.statusCode !== undefined && actualStatus !== contract.statusCode) {
    violations.push({
      type:     'status_mismatch',
      message:  `Expected status ${contract.statusCode}, got ${actualStatus}`,
      expected: String(contract.statusCode),
      actual:   String(actualStatus),
    });
  }

  // ── Required headers ──
  for (const expected of contract.headers ?? []) {
    if (!expected.required) continue;
    const actual = actualHeaders[expected.key.toLowerCase()];
    if (actual === undefined) {
      violations.push({
        type:     'missing_header',
        message:  `Required header "${expected.key}" is absent`,
        expected: expected.value || '(any)',
        actual:   '(absent)',
      });
    } else if (expected.value && actual.split(';')[0].trim().toLowerCase() !== expected.value.split(';')[0].trim().toLowerCase()) {
      violations.push({
        type:     'missing_header',
        message:  `Header "${expected.key}" has unexpected value`,
        expected: expected.value,
        actual,
      });
    }
  }

  // ── Body schema ──
  if (contract.bodySchema?.trim()) {
    let schema: unknown;
    try {
      schema = JSON.parse(contract.bodySchema);
    } catch {
      violations.push({
        type:    'schema_violation',
        message: 'Contract bodySchema is not valid JSON',
      });
      return violations;
    }

    let data: unknown;
    try {
      data = JSON.parse(bodyText);
    } catch {
      violations.push({
        type:    'schema_violation',
        message: 'Response body is not valid JSON — cannot validate against schema',
      });
      return violations;
    }

    try {
      const validate = ajv.compile(schema as object);
      if (!validate(data)) {
        for (const err of validate.errors ?? []) {
          violations.push({
            type:    'schema_violation',
            message: err.message ?? 'Schema violation',
            path:    err.instancePath || '/',
          });
        }
      }
    } catch (e) {
      violations.push({
        type:    'schema_violation',
        message: `Schema compile error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return violations;
}

// ─── HTTP execution ───────────────────────────────────────────────────────────

async function executeContract(
  req: ApiRequest,
  vars: Record<string, string>,
): Promise<ContractResult> {
  const url   = buildUrl(req.url, req.params, vars);
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
    } else if (req.body.mode === 'raw' && req.body.raw) {
      body = interpolate(req.body.raw, vars);
    }

    const resp = await fetch(url, {
      method:  req.method,
      headers,
      body:    !['GET', 'HEAD'].includes(req.method) ? body : undefined,
    } as Parameters<typeof fetch>[1]);

    const bodyText = await resp.text();
    const rawHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { rawHeaders[k] = v; });

    const violations = validateConsumerResponse(req.contract!, resp.status, rawHeaders, bodyText);

    return {
      requestId:    req.id,
      requestName:  req.name,
      method:       req.method,
      url,
      passed:       violations.length === 0,
      violations,
      durationMs:   Date.now() - start,
      actualStatus: resp.status,
    };
  } catch (err) {
    return {
      requestId:   req.id,
      requestName: req.name,
      method:      req.method,
      url,
      passed:      false,
      violations:  [{
        type:    'status_mismatch',
        message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
      durationMs: Date.now() - start,
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runConsumerContracts(
  requests: ApiRequest[],
  envVars: Record<string, string>,
  collectionVars: Record<string, string> = {},
): Promise<ContractReport> {
  const vars = { ...envVars, ...collectionVars };
  // Only run requests that have a contract with at least one expectation
  const contractRequests = requests.filter(r =>
    r.contract && (r.contract.statusCode !== undefined || r.contract.bodySchema || r.contract.headers?.length),
  );

  const start   = Date.now();
  const results = await Promise.all(contractRequests.map(r => executeContract(r, vars)));
  const passed  = results.filter(r => r.passed).length;

  return {
    mode:      'consumer',
    total:     results.length,
    passed,
    failed:    results.length - passed,
    results,
    durationMs: Date.now() - start,
  };
}
