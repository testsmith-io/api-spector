// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Opt-in OWASP API Top 10 test generator. Given a normal request, produce a set
// of security test requests pre-loaded with attack payloads and a post-request
// script that asserts the expected *safe* behaviour. Test names carry the
// `[TAG]` prefix used by the security guide and by the SARIF exporter, so
// findings map straight onto the OWASP category. Nothing here runs unless the
// user explicitly invokes "Generate security tests".

import type { ApiRequest, KeyValuePair } from './types';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Deterministic-ish id — callers may re-id, but this keeps the tests valid
 *  standalone. Uses crypto.randomUUID (available in renderer and main). */
function newId(): string {
  try { return crypto.randomUUID(); } catch { return `sec-${Math.random().toString(36).slice(2)}`; }
}

function clone(base: ApiRequest, patch: Partial<ApiRequest>): ApiRequest {
  const copy = structuredClone(base) as ApiRequest;
  copy.id = newId();
  delete copy.examples;
  delete copy.contract;
  copy.hookType = undefined;
  copy.disabled = false;
  return { ...copy, ...patch };
}

/** Whether the URL looks like it targets a specific object (path param), which
 *  is what BOLA/object-level authorization tests need. */
function hasObjectId(url: string): boolean {
  return /\/:[A-Za-z_]/.test(url) || /\{\{[^}]+\}\}/.test(url) || /\/\d+(\/|$|\?)/.test(url);
}

function firstEnabledParam(params: KeyValuePair[]): KeyValuePair | undefined {
  return (params ?? []).find(p => p.enabled && p.key);
}

/**
 * Generate OWASP-tagged security tests for a single request. Returns an empty
 * array only if the base request is unusable. The set adapts to the request:
 * mass-assignment only for JSON writes, injection only when there is a query
 * param, BOLA only for object-scoped URLs.
 */
export function generateSecurityTests(base: ApiRequest): ApiRequest[] {
  const out: ApiRequest[] = [];
  const name = base.name || base.method;

  // API2 — Broken Authentication: missing credential.
  out.push(clone(base, {
    name: `[AUTH] ${name} - missing token`,
    auth: { type: 'none' },
    headers: base.headers.filter(h => h.key.toLowerCase() !== 'authorization'),
    postRequestScript:
      "sp.test('[AUTH] missing token is rejected', function () {\n" +
      "  sp.expect(sp.response.code).to.be.oneOf([401, 403]);\n" +
      "});\n",
  }));

  // API2 — Broken Authentication: garbage bearer token.
  out.push(clone(base, {
    name: `[AUTH] ${name} - invalid token`,
    auth: { type: 'bearer', token: 'invalid.token.value' },
    postRequestScript:
      "sp.test('[AUTH] invalid token is rejected', function () {\n" +
      "  sp.expect(sp.response.code).to.equal(401);\n" +
      "});\n",
  }));

  // API8 — Security Misconfiguration: headers + error verbosity.
  out.push(clone(base, {
    name: `[CONFIG] ${name} - security headers & error hygiene`,
    postRequestScript:
      "sp.test('[CONFIG] sends X-Content-Type-Options: nosniff', function () {\n" +
      "  sp.expect(sp.response.headers.get('x-content-type-options')).to.equal('nosniff');\n" +
      "});\n" +
      "sp.test('[CONFIG] does not leak a stack trace', function () {\n" +
      "  const body = sp.response.text();\n" +
      "  sp.expect(body).to.not.include('at Object.');\n" +
      "  sp.expect(body).to.not.include('node_modules');\n" +
      "});\n",
  }));

  // API1 — BOLA: object-scoped URL accessed as another identity.
  if (hasObjectId(base.url)) {
    out.push(clone(base, {
      name: `[BOLA] ${name} - access another user's object`,
      description: "Point this at another user's object id (or run as a different identity). It must be denied.",
      postRequestScript:
        "sp.test('[BOLA] cannot access another user\\'s object', function () {\n" +
        "  sp.expect(sp.response.code).to.be.oneOf([401, 403, 404]);\n" +
        "});\n",
    }));
  }

  // API3 — Mass assignment: privileged fields in a JSON write body.
  if (WRITE_METHODS.has(base.method) && base.body?.mode === 'json') {
    let mutated = base.body.json ?? '{}';
    try {
      const obj = JSON.parse(base.body.json ?? '{}');
      obj.role = 'admin';
      obj.is_admin = true;
      mutated = JSON.stringify(obj, null, 2);
    } catch {
      // Non-object / template body — fall back to the original; the assertion
      // still documents the intent.
    }
    out.push(clone(base, {
      name: `[MASS-ASSIGN] ${name} - privileged fields`,
      body: { ...base.body, mode: 'json', json: mutated },
      postRequestScript:
        "sp.test('[MASS-ASSIGN] cannot set privileged fields', function () {\n" +
        "  sp.expect(sp.response.code).to.be.oneOf([200, 201, 400, 422]);\n" +
        "  if (sp.response.code < 300) {\n" +
        "    const json = sp.response.json();\n" +
        "    if (json && json.role !== undefined) sp.expect(json.role).to.not.equal('admin');\n" +
        "    if (json && json.is_admin !== undefined) sp.expect(json.is_admin).to.not.equal(true);\n" +
        "  }\n" +
        "});\n",
    }));
  }

  // API10 — Injection: SQL payload in the first query parameter.
  const param = firstEnabledParam(base.params);
  if (param) {
    out.push(clone(base, {
      name: `[INJECTION] ${name} - SQL in ${param.key}`,
      params: base.params.map(p => p === param ? { ...p, value: "' OR '1'='1" } : p),
      postRequestScript:
        "sp.test('[INJECTION] SQL injection is handled safely', function () {\n" +
        "  sp.expect(sp.response.code).to.be.oneOf([200, 400, 422]);\n" +
        "  if (sp.response.code === 200) {\n" +
        "    const json = sp.response.json();\n" +
        "    const items = Array.isArray(json) ? json : (json && json.data) || [];\n" +
        "    sp.expect(items.length).to.be.below(1000); // should not dump the table\n" +
        "  }\n" +
        "});\n",
    }));
  }

  return out;
}
