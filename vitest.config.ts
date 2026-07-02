import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two projects run under one `vitest run`: the node-env main/shared/CLI tests
// and the jsdom React tests. Use `--project node` / `--project renderer` to
// run one side alone.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['src/tests/setup.ts'],
          include: ['src/tests/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['src/renderer/src/tests/setup.ts'],
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
          globals: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Everything with runtime behavior; keep this a broad pattern so new
      // files are counted by default instead of silently excluded.
      include: [
        'src/main/**/*.ts',
        'src/shared/**/*.ts',
        'src/cli/**/*.ts',
        'src/preload/**/*.ts',
        'src/renderer/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/tests/**',
        'src/renderer/src/tests/**',
        'src/**/*.d.ts',
      ],
      reporter: ['text', 'lcov'],
    },
  },
})
