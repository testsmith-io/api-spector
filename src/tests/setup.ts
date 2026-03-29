// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// Stub browser APIs needed by renderer modules loaded in Node test environment
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage;
