#!/usr/bin/env node
'use strict'

const path = require('path')
const { spawn } = require('child_process')

const [, , cmd = 'ui', ...rest] = process.argv

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
} else if (cmd === 'ui') {
  const electron = require('electron')
  const appDir = path.join(__dirname, '..')
  const proc = spawn(String(electron), [appDir, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else if (cmd === 'run') {
  const runnerPath = path.join(__dirname, '..', 'out', 'main', 'runner.js')
  const proc = spawn(process.execPath, [runnerPath, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else if (cmd === 'mock') {
  const mockPath = path.join(__dirname, '..', 'out', 'main', 'mock.js')
  const proc = spawn(process.execPath, [mockPath, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else if (cmd === 'record') {
  const recordPath = path.join(__dirname, '..', 'out', 'main', 'record.js')
  const proc = spawn(process.execPath, [recordPath, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else if (cmd === 'agents') {
  const agentsPath = path.join(__dirname, '..', 'out', 'main', 'agents.js')
  const proc = spawn(process.execPath, [agentsPath, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else if (cmd === 'contract') {
  const contractPath = path.join(__dirname, '..', 'out', 'main', 'contract.js')
  const proc = spawn(process.execPath, [contractPath, ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('close', code => process.exit(code ?? 0))
} else {
  console.error(`API Spector — unknown command: "${cmd}"`)
  printHelp()
  process.exit(1)
}
