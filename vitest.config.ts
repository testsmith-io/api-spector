import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/tests/setup.ts'],
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/auth-builder.ts',
        'src/main/interpolation.ts',
        'src/main/ipc/request-handler.ts',
        'src/main/ipc/secret-handler.ts',
        'src/main/mock-server.ts',
        'src/main/recorder.ts',
        'src/main/script-runner.ts',
        'src/shared/ci-generators.ts',
        'src/shared/report.ts',
        'src/renderer/src/store/index.ts',
      ],
      reporter: ['text', 'lcov'],
    },
  },
})
