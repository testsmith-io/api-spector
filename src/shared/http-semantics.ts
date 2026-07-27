// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── HTTP semantics validation ────────────────────────────────────────────────
//
// Checks a response against the HTTP specification (RFC 9110 "HTTP Semantics"
// and RFC 9111 "HTTP Caching"), independent of any user test or OpenAPI spec.
// This catches responses that are malformed as HTTP regardless of what the API
// is "supposed" to return. Every check is conservative to keep false positives
// near zero: the value is trust, so we only flag clear violations.
//
// Pure and dependency-free so it runs identically in the renderer (a passive
// "HTTP" panel on the response) and, later, in the CLI runner for CI gating.

export type HttpSeverity = 'error' | 'warning' | 'hint'

export interface HttpFinding {
  /** Stable short id, e.g. 'no-body-204'. */
  rule: string
  severity: HttpSeverity
  message: string
  /** Spec reference, e.g. 'RFC 9110 §15.3.5'. */
  ref?: string
}

export interface HttpResponseView {
  /** Request method (some rules depend on it, e.g. HEAD must have no body). */
  method: string
  status: number
  statusText?: string
  headers: Record<string, string>
  body: string
  /** Byte length of the received body (undici's decoded length). */
  bodySize?: number
}

/** Case-insensitive header lookup. */
function header(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function hasBody(res: HttpResponseView): boolean {
  return (res.bodySize ?? res.body.length) > 0;
}

const REDIRECTS_NEEDING_LOCATION = new Set([301, 302, 303, 307, 308]);

// Statuses whose responses must not carry content. HTTP clients discard the
// body for these before the app sees it, so a declared Content-Length is the
// reliable tell that a server wrongly sent one. HEAD is handled separately: its
// Content-Length legitimately mirrors what a GET body would be.
const BODILESS: Record<number, { label: string; ref: string }> = {
  204: { label: 'No Content', ref: 'RFC 9110 §15.3.5' },
  205: { label: 'Reset Content', ref: 'RFC 9110 §15.3.6' },
  304: { label: 'Not Modified', ref: 'RFC 9110 §15.4.5' },
};

export interface HttpSemanticsOptions {
  /** Well-formedness check for XML bodies. Returns false when the body is not
   *  well-formed XML. Injected by the caller (renderer uses DOMParser, the CLI
   *  an XML parser) so this module stays dependency-free. */
  checkXml?: (body: string) => boolean
}

/**
 * Validate a response against HTTP semantics. Returns findings ordered by
 * severity (errors first). Returns [] for transport failures (status 0) since
 * there is no real HTTP response to judge.
 */
export function validateHttpSemantics(res: HttpResponseView, opts: HttpSemanticsOptions = {}): HttpFinding[] {
  if (!res.status || res.status === 0) return [];
  const f: HttpFinding[] = [];
  const method = res.method.toUpperCase();
  const { status } = res;
  const body = hasBody(res);
  const contentType = header(res.headers, 'content-type');
  const contentEncoding = header(res.headers, 'content-encoding');
  const clNum = Number(header(res.headers, 'content-length') ?? NaN);
  const isBodiless = status in BODILESS || (status >= 100 && status < 200);

  // ── Bodies that must be empty ─────────────────────────────────────────────
  // The client strips the body for these statuses, so detect the violation via
  // a non-zero Content-Length (or a body that somehow slipped through).
  if (isBodiless) {
    const declaresBody = body || (Number.isFinite(clNum) && clNum > 0);
    if (declaresBody) {
      const info = BODILESS[status] ?? { label: 'Informational', ref: 'RFC 9110 §15.2' };
      const via = body ? '' : ` (it declares Content-Length: ${clNum}; the body was discarded by the client)`;
      f.push({
        rule: status in BODILESS ? `no-body-${status}` : 'no-body-1xx',
        severity: 'error',
        message: `${status} ${info.label} must not include a message body${via}.`,
        ref: info.ref,
      });
    }
  }
  if (method === 'HEAD' && body) {
    f.push({ rule: 'no-body-head', severity: 'error', message: 'Response to a HEAD request must not include a body.', ref: 'RFC 9110 §9.3.2' });
  }

  // ── Range responses ───────────────────────────────────────────────────────
  if (status === 206 && !header(res.headers, 'content-range')) {
    f.push({ rule: '206-no-content-range', severity: 'error', message: '206 Partial Content must include a Content-Range header.', ref: 'RFC 9110 §15.3.7' });
  }
  if (status === 416 && !header(res.headers, 'content-range')) {
    f.push({ rule: '416-no-content-range', severity: 'warning', message: '416 Range Not Satisfiable should include a Content-Range header (e.g. "bytes */1234").', ref: 'RFC 9110 §15.5.17' });
  }

  // ── Redirects ─────────────────────────────────────────────────────────────
  if (REDIRECTS_NEEDING_LOCATION.has(status) && !header(res.headers, 'location')) {
    f.push({ rule: 'redirect-no-location', severity: 'error', message: `${status} redirect has no Location header, so the client cannot follow it.`, ref: 'RFC 9110 §15.4' });
  }

  // ── Auth / method-negotiation headers the spec requires ──────────────────
  if (status === 401 && !header(res.headers, 'www-authenticate')) {
    f.push({ rule: '401-no-www-authenticate', severity: 'error', message: '401 Unauthorized must include a WWW-Authenticate header.', ref: 'RFC 9110 §15.5.2' });
  }
  if (status === 405 && !header(res.headers, 'allow')) {
    f.push({ rule: '405-no-allow', severity: 'error', message: '405 Method Not Allowed must include an Allow header listing valid methods.', ref: 'RFC 9110 §15.5.6' });
  }

  // ── Content-Type and body correctness ────────────────────────────────────
  if (body && !contentType && status !== 204 && status !== 304) {
    f.push({ rule: 'body-no-content-type', severity: 'warning', message: 'Response has a body but no Content-Type header; clients must guess how to parse it.', ref: 'RFC 9110 §8.3' });
  }
  if (body && contentType && /application\/(json|.*\+json)/i.test(contentType)) {
    try {
      JSON.parse(res.body);
    } catch {
      f.push({ rule: 'json-invalid', severity: 'error', message: `Content-Type is "${contentType}" but the body is not valid JSON.`, ref: 'RFC 8259' });
    }
  }
  if (body && contentType && /[/+]xml\b/i.test(contentType) && opts.checkXml?.(res.body) === false) {
    f.push({ rule: 'xml-invalid', severity: 'error', message: `Content-Type is "${contentType}" but the body is not well-formed XML.`, ref: 'XML 1.0 §2.1' });
  }
  if (contentType && /^text\//i.test(contentType) && !/charset=/i.test(contentType)) {
    f.push({ rule: 'text-no-charset', severity: 'hint', message: `"${contentType}" has no charset parameter; clients may misinterpret the encoding.`, ref: 'RFC 9110 §8.3.2' });
  }

  // ── Content-Length accuracy (skip when compressed, HEAD, or bodiless) ─────
  const clRaw = header(res.headers, 'content-length');
  if (clRaw !== undefined && !contentEncoding && method !== 'HEAD' && !isBodiless) {
    const actual = res.bodySize ?? res.body.length;
    if (Number.isFinite(clNum) && clNum !== actual) {
      f.push({ rule: 'content-length-mismatch', severity: 'error', message: `Content-Length is ${clNum} but the body is ${actual} bytes.`, ref: 'RFC 9110 §8.6' });
    }
  }

  // ── General ───────────────────────────────────────────────────────────────
  if (status < 100 || status > 599) {
    f.push({ rule: 'status-out-of-range', severity: 'warning', message: `${status} is not a valid HTTP status code (must be 100-599).`, ref: 'RFC 9110 §15' });
  }
  if (!header(res.headers, 'date') && status >= 200) {
    f.push({ rule: 'no-date', severity: 'hint', message: 'No Date header; origin servers are expected to send one.', ref: 'RFC 9110 §6.6.1' });
  }
  if ((status === 429 || status === 503) && !header(res.headers, 'retry-after')) {
    f.push({ rule: 'no-retry-after', severity: 'hint', message: `${status} should include a Retry-After header telling clients when to retry.`, ref: 'RFC 9110 §10.2.3' });
  }
  if (status === 201 && !header(res.headers, 'location')) {
    f.push({ rule: '201-no-location', severity: 'warning', message: '201 Created should include a Location header pointing at the new resource.', ref: 'RFC 9110 §15.3.2' });
  }

  const order: Record<HttpSeverity, number> = { error: 0, warning: 1, hint: 2 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
