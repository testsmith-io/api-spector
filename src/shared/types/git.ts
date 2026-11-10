// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Git

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFile {
  path: string
  status: GitFileStatus
}

/** Where the open workspace stands relative to a git repository.
 *  - `none`: not in any repo.
 *  - `own`: the workspace dir is the repo root.
 *  - `scoped`: a subfolder of an enclosing repo, scoped mode on - git ops limited to this subtree.
 *  - `enclosing-available`: inside an enclosing repo but scoped mode off. */
export type GitRepoState = 'none' | 'own' | 'scoped' | 'enclosing-available'

export interface GitRepoInfo {
  state: GitRepoState
  /** Enclosing repo's folder name (states `scoped` / `enclosing-available`). */
  repoName?: string
  /** Workspace subtree relative to the repo root (states `scoped` / `enclosing-available`). */
  scope?: string
}

export interface GitStatus {
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  conflicted: string[]   // paths with merge conflicts
  branch: string
  ahead: number
  behind: number
  remote: string | null
  rebasing: boolean      // a rebase is in progress (resolve conflicts, then continue/abort)
}

export interface GitCommit {
  hash: string
  short: string
  message: string
  author: string
  email: string
  date: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  /** For local branches: their upstream short ref (e.g. "origin/main"). */
  upstream?: string
  /** Commits ahead/behind upstream - informational, only set for tracking branches. */
  ahead?: number
  behind?: number
}

export interface GitRemote {
  name: string
  url: string
}

export interface GitStash {
  /** Stash index (0 = most recent), i.e. the N in `stash@{N}`. */
  index: number
  /** Short ref used by git, e.g. "stash@{0}". */
  ref: string
  /** The branch the stash was created on. */
  branch: string
  /** Human-readable stash message. */
  message: string
}

export interface GitTag {
  name: string
  /** Tag subject: the annotation message for annotated tags, else the pointed
   *  commit's summary. */
  subject: string
}

/** The git author identity (`user.name` / `user.email`). Either may be empty
 *  when unset at every scope, which is what blocks a commit. */
export interface GitIdentity {
  name: string
  email: string
}

export type CiPlatform = 'github' | 'gitlab' | 'azure' | 'unknown'
