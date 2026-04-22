import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig( {
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve( __dirname, 'src/main/index.ts' ),
          runner: resolve( __dirname, 'src/cli/runner.ts' ),
          mock:   resolve( __dirname, 'src/cli/mock.ts' ),
          record: resolve( __dirname, 'src/cli/record.ts' ),
          agents: resolve( __dirname, 'src/cli/agents.ts' ),
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
