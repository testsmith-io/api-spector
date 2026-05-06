// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// Setup hooks for renderer-side component tests (run via vitest.renderer.config.ts).
//
// Mocks the `window.electron` IPC bridge with a no-op stub so components that
// call `electron.foo()` during render don't blow up. Individual tests can
// override specific methods on this object.

import '@testing-library/jest-dom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const electronStub: any = new Proxy({}, {
  get: () => async () => undefined,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = (globalThis as any).window ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window.electron = electronStub;

// matchMedia stub for components that read prefers-color-scheme
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window.matchMedia = (globalThis as any).window.matchMedia ?? ((q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));
