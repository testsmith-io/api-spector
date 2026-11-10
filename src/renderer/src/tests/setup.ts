// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Renderer component-test setup (vitest.renderer.config.ts). Stubs the window.electron
// IPC bridge with a no-op so components don't blow up on render; tests override methods.

import '@testing-library/jest-dom';

 
const electronStub: any = new Proxy({}, {
  get: () => async () => undefined,
});

 
(globalThis as any).window = (globalThis as any).window ?? {};
 
(globalThis as any).window.electron = electronStub;

// matchMedia stub for components that read prefers-color-scheme
 
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
