#!/usr/bin/env node
// Patches the Electron.app bundle name so macOS shows "api Spector" in the dock
// when running via `apispector ui` (non-packaged). Runs automatically on postinstall.

import { execSync } from 'child_process'
import { existsSync }  from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

if (process.platform !== 'darwin') process.exit(0)

const root  = join(dirname(fileURLToPath(import.meta.url)), '..')
const plist = join(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')

if (!existsSync(plist)) {
  console.log('patch-electron-name: Electron.app not found, skipping')
  process.exit(0)
}

try {
  execSync(`plutil -replace CFBundleName        -string "api Spector" "${plist}"`)
  execSync(`plutil -replace CFBundleDisplayName -string "api Spector" "${plist}"`)
  console.log('patch-electron-name: renamed Electron.app → api Spector')
} catch (e) {
  console.warn('patch-electron-name: failed to patch Info.plist:', e.message)
}
