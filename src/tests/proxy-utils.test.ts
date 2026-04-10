// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, expect, it } from 'vitest';
import { buildProxyUri } from '../main/proxy-utils';

describe('buildProxyUri', () => {
  it('adds http scheme when missing', () => {
    expect(buildProxyUri({ url: 'proxy.local:8080' })).toBe('http://proxy.local:8080/');
  });

  it('keeps explicit scheme', () => {
    expect(buildProxyUri({ url: 'http://proxy.local:8080' })).toBe('http://proxy.local:8080/');
  });

  it('supports windows-style protocol map and prefers https entry', () => {
    expect(buildProxyUri({ url: 'http=proxy1.local:8080;https=proxy2.local:8443' }))
      .toBe('http://proxy2.local:8443/');
  });

  it('injects auth safely via URL fields', () => {
    expect(buildProxyUri({
      url: 'proxy.local:8080',
      auth: { username: 'DOMAIN\\john', password: 'p@ss:word' },
    })).toBe('http://DOMAIN%5Cjohn:p%40ss%3Aword@proxy.local:8080/');
  });

  it('throws for empty URL', () => {
    expect(() => buildProxyUri({ url: '   ' })).toThrow('Proxy URL is empty');
  });
});
