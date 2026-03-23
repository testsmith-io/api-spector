import { describe, it, expect } from 'vitest';
import { interpolate, buildUrl, mergeVars } from '../main/interpolation';
import type { KeyValuePair } from '../shared/types';

// ─── interpolate ─────────────────────────────────────────────────────────────

describe('interpolate', () => {
  it('replaces a single variable', () => {
    expect(interpolate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });

  it('replaces multiple variables', () => {
    expect(interpolate('{{a}}-{{b}}', { a: 'foo', b: 'bar' })).toBe('foo-bar');
  });

  it('leaves unknown variables as-is', () => {
    expect(interpolate('{{unknown}}', {})).toBe('{{unknown}}');
  });

  it('handles variables with surrounding whitespace in the key', () => {
    expect(interpolate('{{ name }}', { name: 'world' })).toBe('world');
  });

  it('returns the string unchanged when there are no placeholders', () => {
    expect(interpolate('no variables here', { name: 'world' })).toBe('no variables here');
  });

  it('handles empty string', () => {
    expect(interpolate('', { name: 'world' })).toBe('');
  });

  it('replaces the same variable appearing multiple times', () => {
    expect(interpolate('{{x}} and {{x}}', { x: 'yes' })).toBe('yes and yes');
  });

  it('replaces variables inside a URL', () => {
    const result = interpolate('https://{{host}}/api/{{version}}', { host: 'example.com', version: 'v2' });
    expect(result).toBe('https://example.com/api/v2');
  });
});

// ─── buildUrl ─────────────────────────────────────────────────────────────────

describe('buildUrl', () => {
  function p(key: string, value: string, enabled = true): KeyValuePair {
    return { key, value, enabled };
  }

  it('returns the interpolated URL when no params', () => {
    expect(buildUrl('https://{{host}}', [], { host: 'api.example.com' }))
      .toBe('https://api.example.com');
  });

  it('appends enabled params as query string', () => {
    const url = buildUrl('https://example.com', [p('foo', 'bar')], {});
    expect(url).toBe('https://example.com?foo=bar');
  });

  it('appends multiple params joined with &', () => {
    const url = buildUrl('https://example.com', [p('a', '1'), p('b', '2')], {});
    expect(url).toBe('https://example.com?a=1&b=2');
  });

  it('uses & when URL already contains ?', () => {
    const url = buildUrl('https://example.com?existing=1', [p('foo', 'bar')], {});
    expect(url).toBe('https://example.com?existing=1&foo=bar');
  });

  it('skips disabled params', () => {
    const url = buildUrl('https://example.com', [p('a', '1', false), p('b', '2')], {});
    expect(url).toBe('https://example.com?b=2');
  });

  it('skips params with empty keys', () => {
    const url = buildUrl('https://example.com', [p('', 'value')], {});
    expect(url).toBe('https://example.com');
  });

  it('interpolates variables in param values', () => {
    const url = buildUrl('https://example.com', [p('token', '{{authToken}}')], { authToken: 'abc123' });
    expect(url).toBe('https://example.com?token=abc123');
  });

  it('URL-encodes param values', () => {
    const url = buildUrl('https://example.com', [p('q', 'hello world')], {});
    expect(url).toBe('https://example.com?q=hello%20world');
  });
});

// ─── mergeVars ───────────────────────────────────────────────────────────────

describe('mergeVars', () => {
  it('merges all scopes', () => {
    const result = mergeVars({ env: 'e' }, { col: 'c' }, { glob: 'g' });
    expect(result).toMatchObject({ env: 'e', col: 'c', glob: 'g' });
  });

  it('local vars override all other scopes', () => {
    const result = mergeVars({ key: 'env' }, { key: 'col' }, { key: 'glob' }, { key: 'local' });
    expect(result.key).toBe('local');
  });

  it('env vars override collection and globals', () => {
    const result = mergeVars({ key: 'env' }, { key: 'col' }, { key: 'glob' });
    expect(result.key).toBe('env');
  });

  it('collection vars override globals', () => {
    const result = mergeVars({}, { key: 'col' }, { key: 'glob' });
    expect(result.key).toBe('col');
  });

  it('handles empty scopes', () => {
    const result = mergeVars({}, {}, {});
    expect(result).toEqual({});
  });
});
