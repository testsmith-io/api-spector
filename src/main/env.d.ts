// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// Globals injected by electron-vite's `define` for all main-process bundles
// (Electron entry + every CLI in src/cli/). See electron.vite.config.ts.
declare global {
  const __APP_VERSION__: string;
}

export {};
