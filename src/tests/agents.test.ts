// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const CLI = join(__dirname, '..', 'cli', 'agents.ts');
const run = (args: string, cwd: string) =>
  execSync(`npx tsx "${CLI}" ${args}`, { cwd, encoding: 'utf8', timeout: 15000 });

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agents-test-'));
}

describe('api-spector agents', () => {
  it('list shows all available agents', () => {
    const out = run('list', makeTmpDir());
    expect(out).toContain('claude');
    expect(out).toContain('copilot');
    expect(out).toContain('cursor');
    expect(out).toContain('windsurf');
    expect(out).toContain('aider');
    expect(out).toContain('all');
  });

  it('init claude creates skill files and shared docs', () => {
    const dir = makeTmpDir();
    const out = run('init claude', dir);
    expect(out).toContain('Claude Code');
    expect(out).toContain('created');

    expect(existsSync(join(dir, '.claude/skills/api-spector-functional-tests/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/api-spector-security-tests/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/docs/api-spector-scripting-reference.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/docs/functional-testing-guide.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/docs/security-testing-guide.md'))).toBe(true);
  });

  it('init copilot creates copilot-instructions.md', () => {
    const dir = makeTmpDir();
    run('init copilot', dir);
    expect(existsSync(join(dir, '.github/copilot-instructions.md'))).toBe(true);
  });

  it('init cursor creates .cursor/rules/api-spector.mdc', () => {
    const dir = makeTmpDir();
    run('init cursor', dir);
    expect(existsSync(join(dir, '.cursor/rules/api-spector.mdc'))).toBe(true);
  });

  it('init windsurf creates .windsurfrules', () => {
    const dir = makeTmpDir();
    run('init windsurf', dir);
    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
  });

  it('init aider creates conventions.md', () => {
    const dir = makeTmpDir();
    run('init aider', dir);
    expect(existsSync(join(dir, 'conventions.md'))).toBe(true);
  });

  it('init all creates files for every agent', () => {
    const dir = makeTmpDir();
    run('init all', dir);
    expect(existsSync(join(dir, '.claude/skills/api-spector-functional-tests/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.github/copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(dir, '.cursor/rules/api-spector.mdc'))).toBe(true);
    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
    expect(existsSync(join(dir, 'conventions.md'))).toBe(true);
  });

  it('running init twice reports unchanged files', () => {
    const dir = makeTmpDir();
    run('init claude', dir);
    const out2 = run('init claude', dir);
    expect(out2).toContain('unchanged');
  });

  it('shared docs contain the sp.* API reference', () => {
    const dir = makeTmpDir();
    run('init claude', dir);
    const content = readFileSync(join(dir, '.claude/docs/api-spector-scripting-reference.md'), 'utf8');
    expect(content).toContain('sp.test');
    expect(content).toContain('sp.expect');
    expect(content).toContain('sp.response.json');
    expect(content).toContain('sp.totp');
  });
});
