// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { parsePostScript, accessorToJsonPath } from '../main/generators/script-parser';

describe('parsePostScript', () => {
  it('returns empty results for undefined/empty scripts', () => {
    expect(parsePostScript(undefined)).toEqual({ assertions: [], extractions: [] });
    expect(parsePostScript('')).toEqual({ assertions: [], extractions: [] });
  });

  it('parses an equals assertion', () => {
    const script = `sp.test('name equals "alice"', function() {
  const json = sp.response.json();
  sp.expect(json.user.name).to.equal("alice");
});`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('equals');
    expect(assertions[0].accessor).toBe('json.user.name');
    expect(assertions[0].expected).toBe('"alice"');
  });

  it('parses an exists assertion', () => {
    const script = `sp.test('id exists', function() {
  const json = sp.response.json();
  sp.expect(json.id).to.not.be.oneOf([null, undefined]);
});`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('exists');
    expect(assertions[0].accessor).toBe('json.id');
  });

  it('parses a type assertion', () => {
    const script = `sp.test('age is number', function() {
  const json = sp.response.json();
  sp.expect(json.age).to.be.a("number");
});`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('type');
    expect(assertions[0].expected).toBe('"number"');
  });

  it('parses a contains assertion', () => {
    const script = `sp.test('name contains "ali"', function() {
  const json = sp.response.json();
  sp.expect(json.name).to.include("ali");
});`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('contains');
    expect(assertions[0].expected).toBe('"ali"');
  });

  it('parses a status code assertion', () => {
    const script = `sp.response.to.have.status(201);`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('status');
    expect(assertions[0].expected).toBe('201');
  });

  it('parses multiple assertions', () => {
    const script = `sp.test('name', function() {
  const json = sp.response.json();
  sp.expect(json.name).to.equal("alice");
});
sp.test('age', function() {
  const json = sp.response.json();
  sp.expect(json.age).to.be.a("number");
});`;
    const { assertions } = parsePostScript(script);
    expect(assertions).toHaveLength(2);
  });

  it('parses variable extractions', () => {
    const script = `const json = sp.response.json();
sp.variables.set("token", String(json.access_token));
sp.environment.set("userId", String(json.user.id));`;
    const { extractions } = parsePostScript(script);
    expect(extractions).toHaveLength(2);
    expect(extractions[0]).toEqual({ varName: 'token', accessor: 'json.access_token', target: 'variables' });
    expect(extractions[1]).toEqual({ varName: 'userId', accessor: 'json.user.id', target: 'environment' });
  });

  it('handles mixed assertions and extractions', () => {
    const script = `sp.test('status ok', function() {
  sp.expect(sp.response.code).to.equal(200);
});
sp.variables.set("id", String(sp.response.json().id));`;
    const result = parsePostScript(script);
    expect(result.assertions.length).toBeGreaterThan(0);
    expect(result.extractions).toHaveLength(1);
  });
});

describe('accessorToJsonPath', () => {
  it('strips the json. prefix', () => {
    expect(accessorToJsonPath('json.users[0].name')).toBe('users[0].name');
  });

  it('handles bracket notation', () => {
    expect(accessorToJsonPath('json["my key"].val')).toBe("['my key'].val");
  });

  it('handles plain json', () => {
    expect(accessorToJsonPath('json')).toBe('');
  });
});
