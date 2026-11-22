// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// A workspace settings file carries only the shareable settings: the
// machine/identity-local cloud and sync blocks never travel, importing never
// repoints this workspace's sync, and a foreign file is rejected with a message.
import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_SETTINGS_FILE_TYPE,
  buildSettingsFile,
  parseSettingsFile,
  portableSettings,
  mergeSettings,
} from '../shared/workspace-settings-transfer';
import type { WorkspaceSettings } from '../shared/workspace-settings-transfer';

const FULL: WorkspaceSettings = {
  proxy: { url: 'http://proxy:8080', auth: { username: 'u', password: 'p' } },
  piiMaskPatterns: ['authorization'],
  defaultRequestTab: 'body',
  theme: 'light',
  zoom: 1.25,
  secrets: { vault: { address: 'https://vault.acme:8200' } },
  cloud: { enabled: true, tokenSet: true },
  sync: { mode: 'cloud', cloudWorkspaceId: 42, baseVersion: 7 },
};

describe('portableSettings', () => {
  it('drops the machine/identity-local cloud, sync and proxy blocks', () => {
    const p = portableSettings(FULL);
    expect(p.cloud).toBeUndefined();
    expect(p.sync).toBeUndefined();
    expect(p.proxy).toBeUndefined();
    // Everything shareable stays.
    expect(p.theme).toBe('light');
    expect(p.secrets?.vault?.address).toBe('https://vault.acme:8200');
  });

  it('does not mutate the input', () => {
    portableSettings(FULL);
    expect(FULL.cloud).toBeDefined();
    expect(FULL.sync).toBeDefined();
    expect(FULL.proxy?.auth).toEqual({ username: 'u', password: 'p' });
  });

  it('tolerates undefined', () => {
    expect(portableSettings(undefined)).toEqual({});
  });
});

describe('buildSettingsFile', () => {
  it('wraps the portable settings in a typed, versioned envelope', () => {
    const file = buildSettingsFile(FULL, '2026-11-20T00:00:00.000Z');
    expect(file.type).toBe(WORKSPACE_SETTINGS_FILE_TYPE);
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe('2026-11-20T00:00:00.000Z');
    expect(file.settings.cloud).toBeUndefined();
    expect(file.settings.sync).toBeUndefined();
    expect(file.settings.zoom).toBe(1.25);
  });

  it('omits exportedAt when not given', () => {
    expect(buildSettingsFile(FULL).exportedAt).toBeUndefined();
  });
});

describe('parseSettingsFile', () => {
  it('round-trips a built file back to its portable settings', () => {
    const text = JSON.stringify(buildSettingsFile(FULL, '2026-11-20T00:00:00.000Z'));
    const parsed = parseSettingsFile(text);
    expect(parsed.piiMaskPatterns).toEqual(['authorization']);
    expect(parsed.proxy).toBeUndefined();
    expect(parsed.cloud).toBeUndefined();
    expect(parsed.sync).toBeUndefined();
  });

  it('strips cloud/sync even if a hand-edited file smuggles them in', () => {
    const text = JSON.stringify({
      type: WORKSPACE_SETTINGS_FILE_TYPE,
      version: 1,
      settings: { theme: 'dark', cloud: { enabled: true }, sync: { mode: 'cloud' } },
    });
    const parsed = parseSettingsFile(text);
    expect(parsed.theme).toBe('dark');
    expect(parsed.cloud).toBeUndefined();
    expect(parsed.sync).toBeUndefined();
  });

  it('rejects a file that is not ours', () => {
    const text = JSON.stringify({ type: 'postman_collection', settings: {} });
    expect(() => parseSettingsFile(text)).toThrow(/not a workspace settings file/i);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseSettingsFile('{ not json')).toThrow(/valid JSON/i);
  });

  it('rejects our type with no settings', () => {
    const text = JSON.stringify({ type: WORKSPACE_SETTINGS_FILE_TYPE, version: 1 });
    expect(() => parseSettingsFile(text)).toThrow(/nothing to import/i);
  });
});

describe('mergeSettings', () => {
  it('overlays imported settings but keeps the local cloud and sync', () => {
    const current: WorkspaceSettings = {
      theme: 'dark',
      cloud: { enabled: true, tokenSet: true },
      sync: { mode: 'cloud', cloudWorkspaceId: 99 },
    };
    const imported: WorkspaceSettings = { theme: 'light', piiMaskPatterns: ['x-secret'] };
    const merged = mergeSettings(current, imported);
    // Imported values win for shared keys...
    expect(merged.theme).toBe('light');
    expect(merged.piiMaskPatterns).toEqual(['x-secret']);
    // ...but this workspace's own sync/cloud are never repointed.
    expect(merged.cloud).toEqual({ enabled: true, tokenSet: true });
    expect(merged.sync).toEqual({ mode: 'cloud', cloudWorkspaceId: 99 });
  });

  it('ignores any cloud/sync/proxy carried on the imported object', () => {
    const current: WorkspaceSettings = { sync: { mode: 'git' }, proxy: { url: 'http://local:8080' } };
    const imported = { theme: 'dark', sync: { mode: 'cloud' }, proxy: { url: 'http://foreign:1' } } as WorkspaceSettings;
    const merged = mergeSettings(current, imported);
    expect(merged.sync).toEqual({ mode: 'git' });
    expect(merged.proxy).toEqual({ url: 'http://local:8080' });
    expect(merged.theme).toBe('dark');
  });
});
