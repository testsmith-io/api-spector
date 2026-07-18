// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { resolveEnvironmentChain, selectEnvironment } from '../shared/environments';
import type { Environment, Workspace } from '../shared/types';

function env(name: string, vars: Record<string, string>, extendsName?: string): Environment {
  return {
    version: '1.0', id: name, name,
    variables: Object.entries(vars).map(([key, value]) => ({ key, value, enabled: true })),
    extends: extendsName,
  };
}

const base    = env('base',    { HOST: 'example.com', TIMEOUT: '30' });
const staging = env('staging', { HOST: 'staging.example.com', TOKEN: 'st' }, 'base');
const eu      = env('staging-eu', { REGION: 'eu' }, 'staging');

describe('resolveEnvironmentChain', () => {
  it('returns the environment unchanged without extends', () => {
    expect(resolveEnvironmentChain(base, [base, staging])).toBe(base);
  });

  it('merges parent variables with child overriding per key', () => {
    const resolved = resolveEnvironmentChain(staging, [base, staging]);
    const byKey = Object.fromEntries(resolved.variables.map(v => [v.key, v.value]));
    expect(byKey).toEqual({ HOST: 'staging.example.com', TIMEOUT: '30', TOKEN: 'st' });
  });

  it('resolves multi-level chains root-first', () => {
    const resolved = resolveEnvironmentChain(eu, [base, staging, eu]);
    const byKey = Object.fromEntries(resolved.variables.map(v => [v.key, v.value]));
    expect(byKey).toEqual({
      HOST: 'staging.example.com', TIMEOUT: '30', TOKEN: 'st', REGION: 'eu',
    });
  });

  it('a disabled child variable overrides an enabled inherited one', () => {
    const child = env('child', {}, 'base');
    child.variables.push({ key: 'HOST', value: 'off', enabled: false });
    const resolved = resolveEnvironmentChain(child, [base, child]);
    const host = resolved.variables.find(v => v.key === 'HOST');
    expect(host?.enabled).toBe(false);
  });

  it('survives cycles', () => {
    const a = env('a', { X: '1' }, 'b');
    const b = env('b', { Y: '2' }, 'a');
    const resolved = resolveEnvironmentChain(a, [a, b]);
    const byKey = Object.fromEntries(resolved.variables.map(v => [v.key, v.value]));
    expect(byKey).toEqual({ X: '1', Y: '2' });
  });

  it('tolerates a missing parent', () => {
    const orphan = env('orphan', { X: '1' }, 'ghost');
    expect(resolveEnvironmentChain(orphan, [orphan]).variables).toHaveLength(1);
  });
});

describe('selectEnvironment', () => {
  const ws = (defaultEnvironment?: string): Workspace => ({
    version: '1.0', collections: [], environments: [], activeEnvironmentId: null,
    settings: defaultEnvironment ? { defaultEnvironment } : {},
  } as unknown as Workspace);

  it('explicit name wins over the workspace default', () => {
    const picked = selectEnvironment(ws('base'), [base, staging], 'staging');
    expect(picked?.name).toBe('staging');
  });

  it('falls back to the workspace default environment', () => {
    const picked = selectEnvironment(ws('staging'), [base, staging]);
    expect(picked?.name).toBe('staging');
    const byKey = Object.fromEntries((picked?.variables ?? []).map(v => [v.key, v.value]));
    expect(byKey.TIMEOUT).toBe('30'); // inherited, so the chain was resolved
  });

  it('returns null with no name and no default', () => {
    expect(selectEnvironment(ws(), [base])).toBeNull();
  });

  it('matches names case-insensitively', () => {
    expect(selectEnvironment(ws(), [base], 'BASE')?.name).toBe('base');
  });
});
