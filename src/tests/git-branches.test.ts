// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Branch listing must classify local vs remote by ref namespace, not by a '/'
// in the name — local branch names routinely contain slashes (feat/…, fix/…),
// and the old check wrongly hid those from the local list (so a freshly created
// `feat/x` branch never appeared on the Branches tab).
import { describe, it, expect } from 'vitest';
import { parseBranchRefs } from '../main/git-branch-parse';

// Lines as `git for-each-ref --format=BRANCH_REF_FORMAT refs/heads refs/remotes`
// would emit: refname|refname:short|HEAD|upstream:short|upstream:track
const RAW = [
  'refs/heads/main|main| |origin/main|',
  'refs/heads/feat/open-from-git|feat/open-from-git|*|origin/feat/open-from-git|[ahead 2]',
  'refs/heads/fix/bug-123|fix/bug-123| ||',
  'refs/remotes/origin/main|origin/main| ||',
  'refs/remotes/origin/feat/open-from-git|origin/feat/open-from-git| ||',
  'refs/remotes/origin/HEAD|origin/HEAD| ||',
].join('\n');

describe('parseBranchRefs', () => {
  const branches = parseBranchRefs(RAW, 'feat/open-from-git');
  const byName = (n: string) => branches.find(b => b.name === n);

  it('treats a slashed local branch as local, not remote', () => {
    expect(byName('feat/open-from-git')).toMatchObject({ remote: false, current: true });
    expect(byName('fix/bug-123')).toMatchObject({ remote: false, current: false });
  });

  it('keeps remote branches (incl. slashed ones) as remote', () => {
    expect(byName('origin/main')?.remote).toBe(true);
    expect(byName('origin/feat/open-from-git')?.remote).toBe(true);
  });

  it('skips the remote HEAD pointer', () => {
    expect(byName('origin/HEAD')).toBeUndefined();
  });

  it('parses ahead/behind from the track field', () => {
    expect(byName('feat/open-from-git')).toMatchObject({ ahead: 2, behind: undefined, upstream: 'origin/feat/open-from-git' });
  });

  it('marks exactly one local branch current', () => {
    expect(branches.filter(b => b.current)).toHaveLength(1);
  });

  it('a brand-new slashed local branch shows up as a local row', () => {
    // Simulates the state right after `git checkout -b feature/new` with no commits yet.
    const fresh = parseBranchRefs('refs/heads/feature/new|feature/new|*||', 'feature/new');
    expect(fresh).toEqual([{ name: 'feature/new', current: true, remote: false, upstream: undefined, ahead: undefined, behind: undefined }]);
  });
});
