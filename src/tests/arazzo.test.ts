// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  importArazzo,
  importArazzoFiles,
  translateRuntimeExpr,
  translateTemplateValue,
  buildValidateScript,
  buildOutputsScript,
} from '../main/importers/arazzo';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('arazzo runtime-expression translation', () => {
  it('maps $statusCode and $response.body', () => {
    expect(translateRuntimeExpr('$statusCode')).toBe('sp.response.code');
    expect(translateRuntimeExpr('$response.body')).toBe('sp.response.json()');
  });

  it('maps a JSON pointer into a JS accessor', () => {
    expect(translateRuntimeExpr('$response.body#/token')).toBe('sp.response.json().token');
    expect(translateRuntimeExpr('$response.body#/items/0/id')).toBe('sp.response.json().items[0].id');
  });

  it('maps inputs and step outputs to variables', () => {
    expect(translateRuntimeExpr('$inputs.username')).toBe('sp.variables.get("username")');
    expect(translateRuntimeExpr('$steps.login.outputs.token')).toBe('sp.variables.get("token")');
  });

  it('flags an expression it cannot translate', () => {
    const warnings: string[] = [];
    const out = translateRuntimeExpr('$method', m => warnings.push(m));
    expect(out).toContain('TODO');
    expect(warnings).toHaveLength(1);
  });

  it('rewrites embedded {$expr} references to {{var}} in template values', () => {
    expect(translateTemplateValue('Bearer {$steps.login.outputs.token}')).toBe('Bearer {{token}}');
    expect(translateTemplateValue('{$inputs.petId}')).toBe('{{petId}}');
  });
});

describe('arazzo criteria + outputs scripts', () => {
  it('builds a validate script from a simple status criterion', () => {
    const s = buildValidateScript([{ condition: '$statusCode == 200' }]);
    expect(s).toContain('sp.test(');
    expect(s).toContain('sp.response.code');
    expect(s).toContain('=== 200');
  });

  it('builds a jsonpath criterion against sp.jsonPath', () => {
    const s = buildValidateScript([{ context: '$response.body', condition: '$.id', type: 'jsonpath' }]);
    expect(s).toContain('sp.jsonPath(sp.response.json(), "$.id")');
  });

  it('builds an outputs script that sets variables', () => {
    const s = buildOutputsScript({ token: '$response.body#/token' });
    expect(s).toBe('sp.variables.set("token", sp.response.json().token);');
  });
});

describe('importArazzo end to end', () => {
  it('imports the source spec and builds one flow per workflow', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-workflow.json'));
    expect(res.flows).toHaveLength(1);
    expect(res.flows[0].name).toBe('loginAndGetPet');
    expect(res.warnings).toEqual([]);
    // Base requests from the OpenAPI source are present.
    const ops = Object.values(res.collection.requests).map(r => (r.meta as { operationId?: string })?.operationId).filter(Boolean);
    expect(ops).toContain('loginUser');
    expect(ops).toContain('getPet');
  });

  it('wires start, request, validate, evaluate and end blocks', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-workflow.json'));
    const flow = res.flows[0];
    const types = flow.nodes.map(n => n.type).sort();
    expect(types.filter(t => t === 'request')).toHaveLength(2);
    expect(types.filter(t => t === 'validate')).toHaveLength(2);
    expect(types.filter(t => t === 'evaluate')).toHaveLength(2);
    expect(types).toContain('start');
    expect(types).toContain('end');
  });

  it('seeds workflow inputs into the start block', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-workflow.json'));
    const start = res.flows[0].nodes.find(n => n.type === 'start');
    const keys = (start?.config?.inputs ?? []).map(i => i.key);
    expect(keys).toContain('username');
    expect(keys).toContain('petId');
    expect((start?.config?.inputs ?? []).find(i => i.key === 'petId')?.value).toBe('42');
  });

  it('applies step parameter overrides to a cloned request (with {{var}})', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-workflow.json'));
    // The getPet step clones the request and sets its path id + auth header.
    const clone = Object.values(res.collection.requests).find(r => r.name === 'getPet');
    expect(clone?.params.find(p => p.key === 'id')?.value).toBe('{{petId}}');
    expect(clone?.headers.find(h => h.key === 'Authorization')?.value).toBe('Bearer {{token}}');
  });

  it('translates an object request body payload', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-workflow.json'));
    const login = Object.values(res.collection.requests).find(r => r.name === 'login');
    expect(login?.body.mode).toBe('json');
    expect(login?.body.json).toContain('{{username}}');
  });
});

describe('importArazzoFiles (select Arazzo + OpenAPI together)', () => {
  it('detects the Arazzo file among the selected files, in any order', async () => {
    const res = await importArazzoFiles([
      join(FIXTURES, 'arazzo-petstore-openapi.json'),  // the OpenAPI source, first
      join(FIXTURES, 'arazzo-workflow.json'),          // the Arazzo doc, second
    ]);
    expect(res.flows).toHaveLength(1);
    expect(res.warnings).toEqual([]);
    const ops = Object.values(res.collection.requests).map(r => (r.meta as { operationId?: string })?.operationId);
    expect(ops).toContain('loginUser');
  });

  it('resolves the spec from the supplied file when the sourceDescription url is unreachable', async () => {
    const res = await importArazzoFiles([
      join(FIXTURES, 'arazzo-badurl.json'),            // url points to a missing path
      join(FIXTURES, 'arazzo-petstore-openapi.json'),  // but the spec is supplied
    ]);
    expect(res.warnings).toEqual([]);
    const ops = Object.values(res.collection.requests).map(r => (r.meta as { operationId?: string })?.operationId);
    expect(ops).toContain('getPet');
  });

  it('throws when no Arazzo document is among the selected files', async () => {
    await expect(importArazzoFiles([join(FIXTURES, 'arazzo-petstore-openapi.json')]))
      .rejects.toThrow(/No Arazzo/);
  });

  it('resolves source-qualified operation references (sourceName.operationId)', async () => {
    const res = await importArazzo(join(FIXTURES, 'arazzo-qualified.json'));
    expect(res.warnings).toEqual([]);
    const requestBlocks = res.flows[0].nodes.filter(n => n.type === 'request');
    expect(requestBlocks).toHaveLength(2);
    // Both request blocks resolved to a real request (have a ref).
    expect(requestBlocks.every(b => b.config?.ref?.requestId)).toBe(true);
  });
});
