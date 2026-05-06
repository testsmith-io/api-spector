// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// Renderer-side test config — uses jsdom for React Testing Library tests.
// Run with: npx vitest --config vitest.renderer.config.ts
//
// Requires devDeps: @testing-library/react, @testing-library/jest-dom, jsdom
// Once those are installed, drop tests under `src/renderer/src/tests/**/*.test.{ts,tsx}`.

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/renderer/src/tests/setup.ts'],
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['src/renderer/src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'lcov'],
    },
  },
})
