// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Stub browser APIs needed by renderer modules loaded in Node test environment
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage;
