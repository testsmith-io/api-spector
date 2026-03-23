#!/usr/bin/env node
'use strict'

const path = require('path')
const { spawn } = require('child_process')
const electron = require('electron')

const [, , cmd = 'ui', ...rest] = process.argv

function printHelp() {
  console.log('')
  console.log('  api Spector — local-first API testing tool')
  console.log('')
  console.log('  Usage:')
  console.log('    api-spector ui                            Launch the app')
  console.log('    api-spector run  --workspace <path>       Run tests from CLI')
  console.log('    api-spector mock --workspace <path>       Start mock servers from CLI')
  console.log('')
  console.log('  Options:')
  console.log('    api-spector run  --help                   Show run options')
  console.log('    api-spector mock --help                   Show mock options')
  console.log('')
}

if (cmd === '--help' || cmd === '-h') {
  printHelp()
  process.exit(0)
} else if (cmd === 'ui') {
  const appDir = path.join(__dirname, '..')
  const proc = spawn(String(electron), [appDir], {
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
} else {
  console.error(`api Spector — unknown command: "${cmd}"`)
  printHelp()
  process.exit(1)
}
