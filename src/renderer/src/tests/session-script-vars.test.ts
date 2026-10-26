// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Session-scoped script writes. sp.environment/collection/folder/globals.set made
// during a manual send are kept in memory (sessionScriptVars) so the NEXT
// manually-sent request can read them, but are never written to disk and clear
// on workspace close. sp.variables (local) is request-scoped and not recorded.
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { withEnvOverrides } from '../hooks/useActiveEnvironment';
import type { Environment } from '../../../shared/types';

function reset() {
  useStore.setState({
    sessionScriptVars: { env: {}, collection: {}, folder: {}, globals: {} },
  });
}

describe('recordScriptSession', () => {
  beforeEach(reset);

  it('merges a delta into the matching scope bucket', () => {
    useStore.getState().recordScriptSession({ env: { authToken: 'abc' } });
    expect(useStore.getState().sessionScriptVars.env).toEqual({ authToken: 'abc' });
    // Other buckets untouched.
    expect(useStore.getState().sessionScriptVars.collection).toEqual({});
  });

  it('accumulates across sends (later send sees an earlier value)', () => {
    useStore.getState().recordScriptSession({ env: { authToken: 'abc' } });
    useStore.getState().recordScriptSession({ collection: { userId: '42' } });
    useStore.getState().recordScriptSession({ env: { refresh: 'r1' } });
    const s = useStore.getState().sessionScriptVars;
    expect(s.env).toEqual({ authToken: 'abc', refresh: 'r1' });
    expect(s.collection).toEqual({ userId: '42' });
  });

  it('a later write to the same key overwrites (dynamic reassignment)', () => {
    useStore.getState().recordScriptSession({ env: { authToken: 'old' } });
    useStore.getState().recordScriptSession({ env: { authToken: 'new' } });
    expect(useStore.getState().sessionScriptVars.env.authToken).toBe('new');
  });

  it('ignores empty / undefined deltas (no bucket churn)', () => {
    useStore.getState().recordScriptSession({ env: { a: '1' } });
    const before = useStore.getState().sessionScriptVars.env;
    useStore.getState().recordScriptSession({ env: {}, collection: undefined });
    // Same reference-equal bucket: nothing merged.
    expect(useStore.getState().sessionScriptVars.env).toBe(before);
  });

  it('clears on workspace close', () => {
    useStore.getState().recordScriptSession({
      env: { authToken: 'abc' }, collection: { userId: '42' },
      folder: { petId: '7' }, globals: { shared: 'x' },
    });
    useStore.getState().closeWorkspace();
    expect(useStore.getState().sessionScriptVars).toEqual({ env: {}, collection: {}, folder: {}, globals: {} });
  });
});

describe('withEnvOverrides', () => {
  const env: Environment = {
    version: '1.0', id: 'e1', name: 'dev',
    variables: [
      { key: 'BASE_URL', value: 'https://dev', enabled: true },
      { key: 'secretTok', value: '', enabled: true, secret: true, secretEncrypted: 'x' },
    ],
  };

  it('returns the env unchanged when there are no overrides', () => {
    expect(withEnvOverrides(env, {})).toBe(env);
  });

  it('appends a new session var (e.g. an extracted token) to the environment', () => {
    const out = withEnvOverrides(env, { authToken: 'abc' });
    expect(out?.variables.find(v => v.key === 'authToken')).toEqual({ key: 'authToken', value: 'abc', enabled: true });
    // Existing vars preserved.
    expect(out?.variables.find(v => v.key === 'BASE_URL')?.value).toBe('https://dev');
  });

  it('updates an existing non-secret var in place', () => {
    const out = withEnvOverrides(env, { BASE_URL: 'https://override' });
    expect(out?.variables.find(v => v.key === 'BASE_URL')?.value).toBe('https://override');
  });

  it('never overwrites a secret var with a plaintext', () => {
    const out = withEnvOverrides(env, { secretTok: 'leak' });
    const sec = out?.variables.find(v => v.key === 'secretTok');
    expect(sec?.value).toBe('');        // untouched
    expect(sec?.secret).toBe(true);
  });

  it('synthesizes an environment when none is active (the no-environment bug)', () => {
    // Regression: with no active environment, sp.environment.set values used to
    // be dropped because there was no env object to attach them to.
    const out = withEnvOverrides(null, { authToken: 'abc' });
    expect(out).not.toBeNull();
    expect(out?.variables).toEqual([{ key: 'authToken', value: 'abc', enabled: true }]);
  });

  it('returns null for no env and no overrides (unchanged behavior)', () => {
    expect(withEnvOverrides(null, {})).toBeNull();
  });
});
