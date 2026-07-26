#!/usr/bin/env node
// Patches the Electron.app bundle name so macOS shows "API Spector" in the dock
// when running via `api-spector ui` (non-packaged). Runs automatically on postinstall.
//
// Electron's macOS binary ships ad-hoc code-signed. Editing Info.plist
// invalidates that signature, and a broken-signature Electron.app is what
// macOS Gatekeeper/XProtect quarantines as "malware" (a known false-positive
// pattern for Electron apps). So we MUST re-sign the bundle ad-hoc after the
// edit to restore its integrity.

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

if (process.platform !== 'darwin') process.exit(0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'node_modules/electron/dist/Electron.app')
const plist = join(app, 'Contents/Info.plist')

if (!existsSync(plist)) {
  console.log('patch-electron-name: Electron.app not found, skipping')
  process.exit(0)
}

try {
  execSync(`plutil -replace CFBundleName        -string "API Spector" "${plist}"`)
  execSync(`plutil -replace CFBundleDisplayName -string "API Spector" "${plist}"`)
  // Re-sign ad-hoc so the bundle is not seen as tampered. --deep re-signs the
  // nested frameworks/helpers too; matches how Electron ships the binary.
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'ignore' })
  console.log('patch-electron-name: renamed Electron.app → API Spector (re-signed)')
} catch (e) {
  // Non-fatal: if signing is unavailable the app may still launch, but macOS
  // may flag it. The name patch is cosmetic; never break install over it.
  console.warn('patch-electron-name: could not patch/re-sign Electron.app:', e.message)
}
