import { describe, it, expect } from 'vitest';
import { uniqueName, colRelPath } from '../renderer/src/store';

// ─── uniqueName ───────────────────────────────────────────────────────────────

describe('uniqueName', () => {
  it('returns the base name when not in the existing list', () => {
    expect(uniqueName('My API', ['Other API'])).toBe('My API');
  });

  it('returns base name when list is empty', () => {
    expect(uniqueName('My API', [])).toBe('My API');
  });

  it('appends (2) on first conflict', () => {
    expect(uniqueName('My API', ['My API'])).toBe('My API (2)');
  });

  it('increments until unique', () => {
    expect(uniqueName('My API', ['My API', 'My API (2)', 'My API (3)'])).toBe('My API (4)');
  });
});

// ─── colRelPath ───────────────────────────────────────────────────────────────

describe('colRelPath', () => {
  it('generates a slug from the name', () => {
    expect(colRelPath('My Collection', 'abc-123')).toBe('collections/my-collection.spector');
  });

  it('lowercases the name', () => {
    expect(colRelPath('USER API', 'abc-123')).toBe('collections/user-api.spector');
  });

  it('replaces spaces with hyphens', () => {
    expect(colRelPath('my api v2', 'abc-123')).toBe('collections/my-api-v2.spector');
  });

  it('strips special characters', () => {
    expect(colRelPath('my (api)!', 'abc-123')).toBe('collections/my-api.spector');
  });

  it('collapses multiple hyphens', () => {
    expect(colRelPath('foo  --  bar', 'abc-123')).toBe('collections/foo-bar.spector');
  });

  it('falls back to the first 8 chars of the id for empty/unslugifiable names', () => {
    expect(colRelPath('!!!', 'abc12345-rest')).toBe('collections/abc12345.spector');
  });

  it('always uses .spector extension', () => {
    expect(colRelPath('anything', 'id-1')).toMatch(/\.spector$/);
  });

  it('always prefixes with collections/', () => {
    expect(colRelPath('test', 'id-1')).toMatch(/^collections\//);
  });
});
