// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import {
  extractAskVars,
  askVarsInRequest,
  resolveAskValues,
  missingAskMessages,
} from '../shared/ask-vars';
import type { ApiRequest } from '../shared/types';

function req(extra: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r', name: 'R', method: 'GET', url: 'https://x/', headers: [], params: [],
    auth: { type: 'none' }, body: { mode: 'none' }, ...extra,
  };
}

describe('extractAskVars', () => {
  it('finds a plain ask variable and its message', () => {
    const vars = extractAskVars(['Bearer {{@API Token}}']);
    expect(vars).toEqual([{ key: '@API Token', message: 'API Token' }]);
  });

  it('parses a choice list into a dropdown', () => {
    const vars = extractAskVars(['{{@Region[eu, us, ap]}}']);
    expect(vars[0].message).toBe('Region');
    expect(vars[0].choices).toEqual(['eu', 'us', 'ap']);
    expect(vars[0].key).toBe('@Region[eu, us, ap]');
  });

  it('deduplicates repeats by token', () => {
    const vars = extractAskVars(['{{@Name}}', 'x {{@Name}} y']);
    expect(vars).toHaveLength(1);
  });

  it('ignores normal variables and dynamic vars', () => {
    expect(extractAskVars(['{{baseUrl}} {{$uuid}}'])).toEqual([]);
  });
});

describe('askVarsInRequest', () => {
  it('scans url, headers, params and body', () => {
    const r = req({
      url: 'https://x/{{@Env[dev,prod]}}',
      headers: [{ key: 'Authorization', value: 'Bearer {{@Token}}', enabled: true }],
      params: [{ key: 'q', value: '{{@Query}}', enabled: true }],
      body: { mode: 'json', json: '{"name":"{{@Name}}"}' },
    });
    const messages = askVarsInRequest(r).map(a => a.message).sort();
    expect(messages).toEqual(['Env', 'Name', 'Query', 'Token']);
  });
});

describe('resolveAskValues / missingAskMessages', () => {
  const asks = extractAskVars(['{{@Token}}', '{{@Region[eu,us]}}']);

  it('maps answers by message onto the token keys', () => {
    const values = resolveAskValues(asks, { Token: 'abc', Region: 'eu' });
    expect(values['@Token']).toBe('abc');
    expect(values['@Region[eu,us]']).toBe('eu');
  });

  it('treats a missing answer as empty string', () => {
    const values = resolveAskValues(asks, { Token: 'abc' });
    expect(values['@Region[eu,us]']).toBe('');
  });

  it('reports which messages have no answer', () => {
    expect(missingAskMessages(asks, { Token: 'abc' })).toEqual(['Region']);
    expect(missingAskMessages(asks, { Token: 'a', Region: 'eu' })).toEqual([]);
  });
});
