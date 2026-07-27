// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { validateHttpSemantics, type HttpResponseView } from '../shared/http-semantics';

function res(over: Partial<HttpResponseView>): HttpResponseView {
  return { method: 'GET', status: 200, statusText: 'OK', headers: {}, body: '', bodySize: 0, ...over };
}
const rules = (r: HttpResponseView) => validateHttpSemantics(r).map(x => x.rule);

describe('validateHttpSemantics', () => {
  it('returns nothing for a transport failure (status 0)', () => {
    expect(validateHttpSemantics(res({ status: 0 }))).toEqual([]);
  });

  it('accepts a clean JSON 200', () => {
    const r = res({
      status: 200,
      headers: { 'content-type': 'application/json', date: 'now' },
      body: '{"ok":true}', bodySize: 11,
    });
    expect(rules(r)).toEqual([]);
  });

  it('flags 204/205/304 that declare a body via Content-Length (body is stripped by the client)', () => {
    // Real clients discard the body for these statuses; the tell is Content-Length.
    expect(rules(res({ status: 204, body: '', bodySize: 0, headers: { date: 'n', 'content-length': '62' } }))).toContain('no-body-204');
    expect(rules(res({ status: 205, body: '', bodySize: 0, headers: { date: 'n', 'content-length': '65' } }))).toContain('no-body-205');
    expect(rules(res({ status: 304, body: '', bodySize: 0, headers: { date: 'n', 'content-length': '64' } }))).toContain('no-body-304');
    // Well-behaved bodiless responses (no Content-Length) are clean.
    expect(rules(res({ status: 204, headers: { date: 'n' } }))).not.toContain('no-body-204');
    expect(rules(res({ status: 304, headers: { date: 'n', etag: '"x"' } }))).not.toContain('no-body-304');
  });

  it('does not double-report a bodiless status as a Content-Length mismatch', () => {
    expect(rules(res({ status: 205, body: '', bodySize: 0, headers: { date: 'n', 'content-length': '65' } })))
      .not.toContain('content-length-mismatch');
  });

  it('flags a 1xx with a declared body', () => {
    expect(rules(res({ status: 100, headers: { 'content-length': '10' } }))).toContain('no-body-1xx');
  });

  it('flags 206 without Content-Range (error) and 416 without it (warning)', () => {
    const r206 = validateHttpSemantics(res({ status: 206, headers: { date: 'n', 'content-type': 'application/json' }, body: '{}', bodySize: 2 }));
    expect(r206.find(x => x.rule === '206-no-content-range')?.severity).toBe('error');
    const r416 = validateHttpSemantics(res({ status: 416, headers: { date: 'n' } }));
    expect(r416.find(x => x.rule === '416-no-content-range')?.severity).toBe('warning');
    // With Content-Range present, no finding.
    expect(rules(res({ status: 206, headers: { date: 'n', 'content-range': 'bytes 0-1/10', 'content-type': 'application/json' }, body: '{}', bodySize: 2 }))).not.toContain('206-no-content-range');
  });

  it('flags malformed XML when a checkXml parser is supplied', () => {
    const badXml = '<a><b></a>';
    const check = (body: string) => body === badXml ? false : true;
    const findings = validateHttpSemantics(
      res({ status: 200, headers: { date: 'n', 'content-type': 'application/xml' }, body: badXml, bodySize: badXml.length }),
      { checkXml: check },
    );
    expect(findings.map(x => x.rule)).toContain('xml-invalid');
    // Without a checker, XML is not structurally validated (stays dependency-free).
    expect(rules(res({ status: 200, headers: { date: 'n', 'content-type': 'application/xml' }, body: badXml, bodySize: badXml.length }))).not.toContain('xml-invalid');
  });

  it('flags a HEAD response with a body', () => {
    expect(rules(res({ method: 'HEAD', body: 'x', bodySize: 1, headers: { date: 'n', 'content-type': 'text/plain; charset=utf-8' } }))).toContain('no-body-head');
  });

  it('flags a redirect without Location', () => {
    expect(rules(res({ status: 302, headers: { date: 'n' } }))).toContain('redirect-no-location');
    expect(rules(res({ status: 302, headers: { date: 'n', location: '/x' } }))).not.toContain('redirect-no-location');
  });

  it('flags 401 without WWW-Authenticate and 405 without Allow', () => {
    expect(rules(res({ status: 401, headers: { date: 'n' } }))).toContain('401-no-www-authenticate');
    expect(rules(res({ status: 405, headers: { date: 'n' } }))).toContain('405-no-allow');
  });

  it('flags JSON content-type with a non-JSON body', () => {
    const r = res({ status: 200, headers: { 'content-type': 'application/json', date: 'n' }, body: 'not json', bodySize: 8 });
    expect(rules(r)).toContain('json-invalid');
  });

  it('accepts a valid +json subtype', () => {
    const r = res({ status: 200, headers: { 'content-type': 'application/vnd.api+json', date: 'n' }, body: '{}', bodySize: 2 });
    expect(rules(r)).not.toContain('json-invalid');
  });

  it('flags a Content-Length mismatch, but not when compressed or HEAD', () => {
    expect(rules(res({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': '99', date: 'n' }, body: 'hi', bodySize: 2 }))).toContain('content-length-mismatch');
    // gzip: the body is decoded, so the length legitimately differs
    expect(rules(res({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': '99', 'content-encoding': 'gzip', date: 'n' }, body: 'hi', bodySize: 2 }))).not.toContain('content-length-mismatch');
  });

  it('flags a body with no Content-Type', () => {
    expect(rules(res({ status: 200, headers: { date: 'n' }, body: 'stuff', bodySize: 5 }))).toContain('body-no-content-type');
  });

  it('warns on out-of-range status and 201 without Location', () => {
    expect(rules(res({ status: 799, headers: { date: 'n' } }))).toContain('status-out-of-range');
    expect(rules(res({ status: 201, headers: { date: 'n', 'content-type': 'application/json' }, body: '{}', bodySize: 2 }))).toContain('201-no-location');
  });

  it('hints missing Date and Retry-After', () => {
    expect(rules(res({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}', bodySize: 2 }))).toContain('no-date');
    expect(rules(res({ status: 503, headers: { date: 'n' } }))).toContain('no-retry-after');
  });

  it('sorts errors before warnings before hints', () => {
    const findings = validateHttpSemantics(res({ status: 204, body: 'x', bodySize: 1, headers: {} }));
    const sev = findings.map(x => x.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ({ error: 0, warning: 1, hint: 2 }[a] - { error: 0, warning: 1, hint: 2 }[b])));
  });
});
