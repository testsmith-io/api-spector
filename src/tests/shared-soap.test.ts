// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { contentTypeForSoap, withContentType, SOAP_11_CONTENT_TYPE, SOAP_12_CONTENT_TYPE } from '../shared/soap';

describe('contentTypeForSoap', () => {
  it('returns text/xml for SOAP 1.1', () => {
    expect(contentTypeForSoap('1.1')).toBe(SOAP_11_CONTENT_TYPE);
    expect(contentTypeForSoap('1.1')).toMatch(/^text\/xml/);
  });

  it('returns application/soap+xml for SOAP 1.2', () => {
    expect(contentTypeForSoap('1.2')).toBe(SOAP_12_CONTENT_TYPE);
    expect(contentTypeForSoap('1.2')).toMatch(/^application\/soap\+xml/);
  });
});

describe('withContentType', () => {
  it('appends Content-Type when no header exists', () => {
    const out = withContentType([], SOAP_11_CONTENT_TYPE);
    expect(out).toEqual([{ key: 'Content-Type', value: SOAP_11_CONTENT_TYPE, enabled: true }]);
  });

  it('replaces an existing header value (case-insensitive match)', () => {
    const headers = [
      { key: 'X-Trace', value: 'abc', enabled: true },
      { key: 'content-type', value: 'application/json', enabled: true },
    ];
    const out = withContentType(headers, SOAP_12_CONTENT_TYPE);
    expect(out).toHaveLength(2);
    expect(out.find(h => h.key.toLowerCase() === 'content-type')?.value).toBe(SOAP_12_CONTENT_TYPE);
    // Other headers preserved
    expect(out[0]).toEqual({ key: 'X-Trace', value: 'abc', enabled: true });
  });

  it('re-enables a disabled Content-Type header', () => {
    const out = withContentType(
      [{ key: 'Content-Type', value: 'old', enabled: false }],
      SOAP_11_CONTENT_TYPE,
    );
    expect(out[0].enabled).toBe(true);
  });

  it('does not mutate the input array', () => {
    const headers = [{ key: 'Content-Type', value: 'old', enabled: true }];
    const before = JSON.stringify(headers);
    withContentType(headers, SOAP_11_CONTENT_TYPE);
    expect(JSON.stringify(headers)).toBe(before);
  });
});
