import { describe, it, expect } from 'vitest';
import { maskPii, maskHeaders } from '../main/ipc/request-handler';

// ─── maskPii ─────────────────────────────────────────────────────────────────

describe('maskPii', () => {
  it('returns data unchanged when no patterns', () => {
    const data = JSON.stringify({ password: 'secret' });
    expect(maskPii(data, [])).toBe(data);
  });

  it('redacts a matching top-level field', () => {
    const result = JSON.parse(maskPii(JSON.stringify({ password: 'secret' }), ['password']));
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts fields by partial name match (case-insensitive)', () => {
    const result = JSON.parse(maskPii(JSON.stringify({ userPassword: 'secret' }), ['password']));
    expect(result.userPassword).toBe('[REDACTED]');
  });

  it('redacts nested fields', () => {
    const data = JSON.stringify({ user: { token: 'abc', name: 'jane' } });
    const result = JSON.parse(maskPii(data, ['token']));
    expect(result.user.token).toBe('[REDACTED]');
    expect(result.user.name).toBe('jane');
  });

  it('redacts fields inside arrays', () => {
    const data = JSON.stringify([{ secret: 'x' }, { secret: 'y' }]);
    const result = JSON.parse(maskPii(data, ['secret']));
    expect(result[0].secret).toBe('[REDACTED]');
    expect(result[1].secret).toBe('[REDACTED]');
  });

  it('does not redact non-matching fields', () => {
    const data = JSON.stringify({ name: 'jane', password: 'secret' });
    const result = JSON.parse(maskPii(data, ['password']));
    expect(result.name).toBe('jane');
  });

  it('returns non-JSON strings unchanged', () => {
    const raw = 'not json at all';
    expect(maskPii(raw, ['password'])).toBe(raw);
  });
});

// ─── maskHeaders ─────────────────────────────────────────────────────────────

describe('maskHeaders', () => {
  it('returns headers unchanged when no patterns', () => {
    const headers = { Authorization: 'Bearer token', 'X-Custom': 'value' };
    expect(maskHeaders(headers, [])).toEqual(headers);
  });

  it('always masks Authorization regardless of patterns', () => {
    const headers = { authorization: 'Bearer secret' };
    const result = maskHeaders(headers, ['something-else']);
    expect(result.authorization).toBe('[REDACTED]');
  });

  it('always masks cookie header', () => {
    const headers = { cookie: 'session=abc' };
    const result = maskHeaders(headers, ['x']);
    expect(result.cookie).toBe('[REDACTED]');
  });

  it('always masks set-cookie header', () => {
    const headers = { 'set-cookie': 'session=abc' };
    const result = maskHeaders(headers, ['x']);
    expect(result['set-cookie']).toBe('[REDACTED]');
  });

  it('masks headers matching a custom pattern', () => {
    const headers = { 'x-api-key': '12345', 'content-type': 'application/json' };
    const result = maskHeaders(headers, ['api-key']);
    expect(result['x-api-key']).toBe('[REDACTED]');
    expect(result['content-type']).toBe('application/json');
  });

  it('is case-insensitive for custom patterns', () => {
    const headers = { 'X-API-KEY': '12345' };
    const result = maskHeaders(headers, ['api-key']);
    expect(result['X-API-KEY']).toBe('[REDACTED]');
  });

  it('does not mask unrelated headers', () => {
    const headers = { 'content-type': 'application/json', 'x-request-id': 'abc' };
    const result = maskHeaders(headers, ['token']);
    expect(result['content-type']).toBe('application/json');
    expect(result['x-request-id']).toBe('abc');
  });
});
