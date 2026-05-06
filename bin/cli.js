#!/usr/bin/env node
'use strict'

const path = require('path')
const { spawn } = require('child_process')

const [, , cmd = 'ui', ...rest] = process.argv

// ─── Command dispatch ────────────────────────────────────────────────────────
//
// Each entry maps a top-level command to the bundled JS file that handles it.
// `entrypoint: null` is reserved for `ui`, which spawns electron itself rather
// than a node script. Adding a new CLI surface is one line here + one entry in
// electron.vite.config.ts.

const COMMANDS = {
  ui:       { entrypoint: null,        runner: 'electron' },
  run:      { entrypoint: 'runner.js',  runner: 'node' },
  mock:     { entrypoint: 'mock.js',    runner: 'node' },
  record:   { entrypoint: 'record.js',  runner: 'node' },
  agents:   { entrypoint: 'agents.js',  runner: 'node' },
  contract: { entrypoint: 'contract.js',runner: 'node' },
  wsdl:     { entrypoint: 'wsdl.js',    runner: 'node' },
}

function printHelp() {
  console.log('')
  console.log('  API Spector — local-first API testing tool')
  console.log('')
  console.log('  Usage:')
  console.log('    api-spector ui                            Launch the app')
  console.log('    api-spector run      --workspace <path>   Run tests from CLI')
  console.log('    api-spector mock     --workspace <path>   Start mock servers from CLI')
  console.log('    api-spector record   --upstream <url>     Record API traffic as mock stubs')
  console.log('    api-spector contract list|run             Manage & run pinned contract snapshots')
  console.log('    api-spector wsdl     describe|import-*    Inspect a WSDL or import as collection/mock')
  console.log('')
  console.log('  Options:')
  console.log('    api-spector agents init <name>            Initialize AI agent files')
  console.log('    api-spector agents list                   Show available agents')
  console.log('')
  console.log('    api-spector run    --help                 Show run options')
  console.log('    api-spector mock   --help                 Show mock options')
  console.log('    api-spector record --help                 Show record options')
  console.log('')
  console.log('  Environment:')
  console.log('    ELECTRON_NO_SANDBOX=1                     Disable Chromium sandbox')
  console.log('                                              (needed on locked-down Linux)')
  console.log('')
}

if (cmd === '--help' || cmd === '-h') {
  printHelp()
  process.exit(0)
}

const command = COMMANDS[cmd]
if (!command) {
  console.error(`API Spector — unknown command: "${cmd}"`)
  printHelp()
  process.exit(1)
}

// ui: spawn electron with the app dir
if (command.runner === 'electron') {
  const electron = require('electron')
  const appDir = path.join(__dirname, '..')
  // Forward the user's cwd so the main process can decide whether to open a
  // workspace in this folder, or fall through to the welcome screen. Without
  // this, the app would always auto-load the previously-opened workspace
  // even when launched from an empty/different directory.
  const proc = spawn(String(electron), [appDir, ...rest], {
    stdio: 'inherit',
    env: { ...process.env, API_SPECTOR_LAUNCH_CWD: process.cwd() },
  })
  proc.on('close', code => process.exit(code ?? 0))
} else {
  // node-runnable bundles in out/main/<entrypoint>
  const target = path.join(__dirname, '..', 'out', 'main', command.entrypoint)
  const proc = spawn(process.execPath, [target, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
}
