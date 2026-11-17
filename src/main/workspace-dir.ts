// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The open workspace directory, held in an Electron-free module so IPC handlers
// (request/runner) can read it without importing file-handler, which touches
// `app` at load time and so cannot be pulled into unit tests.

let workspaceDir: string | null = null;

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}

export function setWorkspaceDir(dir: string | null): void {
  workspaceDir = dir;
}
