// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Git ──────────────────────────────────────────────────────────────────────

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitFile {
  path: string
  status: GitFileStatus
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
  /** Commits ahead/behind upstream — informational, only set for tracking branches. */
  ahead?: number
  behind?: number
}

export interface GitRemote {
  name: string
  url: string
}

export type CiPlatform = 'github' | 'gitlab' | 'azure' | 'unknown'
