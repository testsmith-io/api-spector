// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { parseCurl } from '../shared/curl-import';

describe('parseCurl', () => {
  it('parses method, url, header and JSON body across line continuations', () => {
    const r = parseCurl(`curl -X POST https://api.example.com/users \\
      -H 'Content-Type: application/json' \\
      -d '{"name":"Ada","email":"ada@example.com"}'`);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.headers).toContainEqual({ key: 'Content-Type', value: 'application/json', enabled: true });
    expect(r.body).toEqual({ mode: 'json', json: '{"name":"Ada","email":"ada@example.com"}' });
  });

  it('defaults to GET with no data and to POST when data is present', () => {
    expect(parseCurl('curl https://x.test/a').method).toBe('GET');
    expect(parseCurl(`curl https://x.test/a -d 'q=1'`).method).toBe('POST');
  });

  it('treats a bare token as the URL regardless of position', () => {
    expect(parseCurl('curl -sS https://x.test/a -H "Accept: */*"').url).toBe('https://x.test/a');
  });

  it('folds a Bearer Authorization header into structured auth', () => {
    const r = parseCurl(`curl https://x.test -H 'Authorization: Bearer abc123'`);
    expect(r.auth).toEqual({ type: 'bearer', token: 'abc123' });
    expect(r.headers.find(h => h.key.toLowerCase() === 'authorization')).toBeUndefined();
  });

  it('maps -u to basic auth, and decodes a Basic header', () => {
    expect(parseCurl('curl -u ada:secret https://x.test').auth).toEqual({ type: 'basic', username: 'ada', password: 'secret' });
    const enc = typeof btoa === 'function' ? btoa('ada:secret') : Buffer.from('ada:secret').toString('base64');
    expect(parseCurl(`curl https://x.test -H 'Authorization: Basic ${enc}'`).auth).toEqual({ type: 'basic', username: 'ada', password: 'secret' });
  });

  it('maps -F to a form body and joins repeated -d with &', () => {
    expect(parseCurl('curl https://x.test -F name=ada -F role=admin').body).toEqual({
      mode: 'form',
      form: [
        { key: 'name', value: 'ada', enabled: true },
        { key: 'role', value: 'admin', enabled: true },
      ],
    });
    expect(parseCurl(`curl https://x.test -d 'a=1' -d 'b=2'`).body).toEqual({
      mode: 'raw', raw: 'a=1&b=2', rawContentType: 'application/x-www-form-urlencoded',
    });
  });

  it('keeps {{variables}} intact and derives a name from the path', () => {
    const r = parseCurl('curl {{BASE_URL}}/users/{{id}}');
    expect(r.url).toBe('{{BASE_URL}}/users/{{id}}');
    expect(r.name).toContain('GET');
  });

  it('throws when no URL is present', () => {
    expect(() => parseCurl('curl -X GET -H "Accept: application/json"')).toThrow(/No URL/);
  });
});
