// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { blockIO } from '../shared/flow-io';
import type { FlowBlock } from '../shared/types';

const b = (type: FlowBlock['type'], config?: FlowBlock['config']): FlowBlock =>
  ({ id: 'x', type, position: { x: 0, y: 0 }, config });

describe('blockIO', () => {
  it('reports a request block writes `response`', () => {
    expect(blockIO(b('request', { ref: { collectionId: 'c', requestId: 'r' } }))).toEqual({ reads: [], writes: ['response'] });
  });

  it('extracts reads from {{templates}} and sp.*.get, writes from sp.*.set', () => {
    const io = blockIO(b('evaluate', { script: "const t = sp.variables.get('token'); sp.globals.set('userId', sp.response.json().id); const u = '{{baseUrl}}';" }));
    expect(io.reads.sort()).toEqual(['baseUrl', 'token']);
    expect(io.writes).toEqual(['userId']);
  });

  it('forEach writes its item and index variables', () => {
    expect(blockIO(b('forEach', { expression: 'data.list', itemVar: 'row', indexVar: 'i' }))).toEqual({
      reads: ['list'], writes: ['row', 'i'],
    });
  });

  it('setVar writes its variable name', () => {
    expect(blockIO(b('setVar', { varName: 'token', valueExpression: 'sp.response.json().token' })).writes).toEqual(['token']);
  });

  it('start writes its declared flow inputs', () => {
    expect(blockIO(b('start', { inputs: [{ key: 'env', value: 'ci' }, { key: 'retries', value: '3' }] })).writes).toEqual(['env', 'retries']);
  });

  it('a name that is both read and written counts only as a write', () => {
    const io = blockIO(b('collect', { intoVar: 'results', valueExpression: 'results' }));
    expect(io.writes).toContain('results');
    expect(io.reads).not.toContain('results');
  });
});
