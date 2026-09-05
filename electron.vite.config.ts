import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig( {
  main: {
    plugins: [externalizeDepsPlugin()],
    // Inject the package version into all main-process bundles (the Electron
    // entry plus every CLI binary). Lets `api-spector run` print its version
    // alongside the workspace banner without re-reading package.json at
    // runtime.
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? ''),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve( __dirname, 'src/main/index.ts' ),
          runner:   resolve( __dirname, 'src/cli/runner.ts' ),
          mock:     resolve( __dirname, 'src/cli/mock.ts' ),
          record:   resolve( __dirname, 'src/cli/record.ts' ),
          agents:   resolve( __dirname, 'src/cli/agents.ts' ),
          contract: resolve( __dirname, 'src/cli/contract.ts' ),
          coverage: resolve( __dirname, 'src/cli/coverage.ts' ),
          'generate-tests': resolve( __dirname, 'src/cli/generate-tests.ts' ),
          compare:  resolve( __dirname, 'src/cli/compare.ts' ),
          wsdl:     resolve( __dirname, 'src/cli/wsdl.ts' ),
          // Node-only engine library, importable as '@testsmith/api-spector/engine'.
          lib:      resolve( __dirname, 'src/lib/index.ts' ),
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve( __dirname, 'src/preload/index.ts' )
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? ''),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve( __dirname, 'src/renderer/index.html' )
        }
      }
    },
    plugins: [react()]
  }
} )
