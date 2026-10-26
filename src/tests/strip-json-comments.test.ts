// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { stripJsonComments, jsonCommentRanges } from '../shared/strip-json-comments';
import { buildBodyAndApplyHeaders } from '../main/request-exec';
import type { ApiRequest } from '../shared/types';

describe('stripJsonComments', () => {
  it('removes line comments', () => {
    const out = stripJsonComments('{\n  "a": 1 // the a value\n}');
    expect(out).not.toContain('the a value');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('removes block comments (including multi-line)', () => {
    const out = stripJsonComments('{ /* intro\n spanning lines */ "a": 1 }');
    expect(out).not.toContain('intro');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('keeps // inside string values (URLs)', () => {
    const src = '{"url":"https://api.example.com//v2"}';
    expect(stripJsonComments(src)).toBe(src);
    expect(JSON.parse(stripJsonComments(src)).url).toBe('https://api.example.com//v2');
  });

  it('keeps /* inside string values', () => {
    const src = '{"glob":"src/*.js"}';
    expect(stripJsonComments(src)).toContain('src/*.js');
  });

  it('honours escaped quotes inside strings', () => {
    const src = '{"q":"he said \\"// not a comment\\""}';
    const out = stripJsonComments(src);
    expect(JSON.parse(out).q).toBe('he said "// not a comment"');
  });

  it('parses a full JSONC document after stripping', () => {
    const jsonc = `{
  // credentials
  "email": "user@example.com", // the login
  /* never commit real secrets */
  "password": "welcome01"
}`;
    expect(JSON.parse(stripJsonComments(jsonc))).toEqual({
      email: 'user@example.com',
      password: 'welcome01',
    });
  });

  it('leaves comment-free JSON unchanged', () => {
    const src = '{"a":1,"b":[1,2,3]}';
    expect(stripJsonComments(src)).toBe(src);
  });
});

describe('jsonCommentRanges', () => {
  it('reports a line comment span (excluding the newline)', () => {
    const src = '{\n  "a": 1 // note\n}';
    const ranges = jsonCommentRanges(src);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('line');
    expect(src.slice(ranges[0].from, ranges[0].to)).toBe('// note');
  });

  it('reports a block comment span', () => {
    const src = '{ /* x */ "a": 1 }';
    const ranges = jsonCommentRanges(src);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('block');
    expect(src.slice(ranges[0].from, ranges[0].to)).toBe('/* x */');
  });

  it('reports no ranges for // inside a string', () => {
    expect(jsonCommentRanges('{"u":"http://x"}')).toHaveLength(0);
  });
});

describe('buildBodyAndApplyHeaders with a commented JSON body', () => {
  it('strips comments before sending and sets the JSON content type', () => {
    const req = { body: { mode: 'json', json: '{\n  // a note\n  "a": 1\n}' } } as unknown as ApiRequest;
    const headers = new Headers();
    const body = buildBodyAndApplyHeaders(req, {}, headers);
    expect(body).toBeDefined();
    expect(body).not.toContain('a note');
    expect(JSON.parse(body!)).toEqual({ a: 1 });
    expect(headers.get('content-type')).toBe('application/json');
  });
});
