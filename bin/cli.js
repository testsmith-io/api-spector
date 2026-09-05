#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

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
  coverage: { entrypoint: 'coverage.js',runner: 'node' },
  'generate-tests': { entrypoint: 'generate-tests.js', runner: 'node' },
  compare:  { entrypoint: 'compare.js', runner: 'node' },
  wsdl:     { entrypoint: 'wsdl.js',    runner: 'node' },
}

function printHelp() {
  console.log('')
  console.log('  API Spector - local-first API testing tool')
  console.log('')
  console.log('  Usage:')
  console.log('    api-spector ui                            Launch the app')
  console.log('    api-spector run      --workspace <path>   Run tests from CLI')
  console.log('    api-spector mock     --workspace <path>   Start mock servers from CLI')
  console.log('    api-spector record   --upstream <url>     Record API traffic as mock stubs')
  console.log('    api-spector contract list|run             Manage & run pinned contract snapshots')
  console.log('    api-spector coverage --spec <file>        Measure OpenAPI test coverage')
  console.log('    api-spector generate-tests --spec <file>  Generate tests from an OpenAPI spec')
  console.log('    api-spector compare <old> <new>           Diff specs; find breaking changes + impact')
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
  console.error(`API Spector - unknown command: "${cmd}"`)
  printHelp()
  process.exit(1)
}

// ─── Electron binary self-repair ─────────────────────────────────────────────
//
// `require('electron')` throws when the postinstall didn't download the
// platform binary. On corporate machines the ~100 MB zip often IS fully
// downloaded into electron's cache — it's the extraction into node_modules
// that got interrupted (antivirus, killed install, …). In that case we can
// repair the install ourselves, using the OS's own unzip tooling (which is
// not affected by whatever broke Node's extractor), and launch anyway.

// Mirrors getPlatformPath() in electron's install.js — path.txt must contain
// exactly this value.
function electronPlatformPath() {
  switch (process.platform) {
    case 'win32': return 'electron.exe'
    case 'darwin':
    case 'mas': return 'Electron.app/Contents/MacOS/Electron'
    default: return 'electron'
  }
}

// Default cache roots used by @electron/get, per OS. `electron_config_cache`
// overrides them (same variable electron's own installer respects).
function electronCacheDirs() {
  if (process.env.electron_config_cache) return [process.env.electron_config_cache]
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache')]
  }
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Caches', 'electron')]
  }
  return [path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron')]
}

// Find a fully-downloaded electron zip for this version/platform/arch in the
// cache. Entries live in hash-named subdirectories; a real zip is >20 MB —
// anything smaller is a truncated download or a proxy's HTML block page.
function findCachedElectronZip(version) {
  const wanted = `electron-v${version}-${process.platform}-${process.arch}.zip`
  for (const root of electronCacheDirs()) {
    let entries
    try { entries = fs.readdirSync(root) } catch { continue }
    for (const entry of ['', ...entries]) {
      const candidate = path.join(root, entry, wanted)
      try {
        if (fs.statSync(candidate).size > 20 * 1024 * 1024) return candidate
      } catch { /* not there — keep looking */ }
    }
  }
  return null
}

// Extract with OS-native tools: PowerShell on Windows, ditto on macOS (it
// preserves the symlinks inside Electron.app, plain unzip does not), unzip on
// Linux. Deliberately NOT extract-zip — when we get here, that path already
// failed once on this machine.
function extractZipNative(zip, destDir) {
  let r
  if (process.platform === 'win32') {
    r = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${destDir}" -Force`,
    ], { stdio: 'ignore' })
  } else if (process.platform === 'darwin') {
    r = spawnSync('ditto', ['-x', '-k', zip, destDir], { stdio: 'ignore' })
  } else {
    r = spawnSync('unzip', ['-o', '-q', zip, '-d', destDir], { stdio: 'ignore' })
  }
  return Boolean(r && r.status === 0)
}

// Attempt to rebuild node_modules/electron/dist from a cached zip.
// Returns 'repaired', 'no-zip', or a { zip } object when extraction failed.
function tryRepairElectron() {
  let pkgPath
  try { pkgPath = require.resolve('electron/package.json') } catch { return 'no-zip' }
  const electronDir = path.dirname(pkgPath)
  const version = require(pkgPath).version
  const zip = findCachedElectronZip(version)
  if (!zip) return 'no-zip'

  console.error(`  Electron ${version} was already downloaded - repairing the`)
  console.error('  installation from the local cache...')
  const distDir = path.join(electronDir, 'dist')
  try { fs.rmSync(distDir, { recursive: true, force: true }) } catch { /* best effort */ }
  if (!extractZipNative(zip, distDir) || !fs.existsSync(path.join(distDir, electronPlatformPath()))) {
    return { zip }
  }
  fs.writeFileSync(path.join(electronDir, 'path.txt'), electronPlatformPath())
  console.error('  Repaired.')
  console.error('')
  return 'repaired'
}

// Resolve the electron executable, classifying the failure modes.
function loadElectron() {
  try {
    const electron = require('electron')
    // path.txt can exist while dist/ is incomplete (interrupted extraction) —
    // require() succeeds but points at a binary that isn't there.
    if (typeof electron === 'string' && !fs.existsSync(electron)) {
      return { status: 'binary-missing' }
    }
    return { status: 'ok', electron }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    if (/Cannot find module 'electron'/i.test(msg)) return { status: 'not-installed' }
    if (/Electron failed to install correctly/i.test(msg)) return { status: 'binary-missing' }
    return { status: 'error', message: msg }
  }
}

const TROUBLESHOOTING_URL =
  'https://github.com/testsmith-io/api-spector/blob/main/docs/getting-started/troubleshooting.md'

// ui: spawn electron with the app dir
if (command.runner === 'electron') {
  // Immediate feedback: on machines where antivirus scans Electron's binary
  // at every launch (common on managed Windows), the window can take 10-30 s
  // to appear — without this line the command looks hung.
  console.log('Launching API Spector...')
  let loaded = loadElectron()
  let failedZip = null

  if (loaded.status === 'binary-missing') {
    const repair = tryRepairElectron()
    if (repair === 'repaired') {
      loaded = loadElectron()
    } else if (repair && repair.zip) {
      failedZip = repair.zip
    }
  }

  if (loaded.status !== 'ok') {
    console.error('')
    console.error('  API Spector - failed to launch the UI.')
    console.error('')
    if (loaded.status === 'not-installed') {
      console.error('  The electron package is not installed alongside API Spector.')
      console.error('  Versions 0.3.1 and 0.3.2 shipped without it by mistake.')
      console.error('')
      console.error('  Fix options:')
      console.error('')
      console.error('    1. Update API Spector (0.3.3 or later includes electron):')
      console.error('         npm install -D @testsmith/api-spector@latest')
      console.error('       (use -g instead of -D if you installed globally)')
      console.error('')
      console.error('    2. Or keep this version and install electron yourself:')
      console.error('         npm install -D electron@31')
    } else if (loaded.status === 'binary-missing') {
      let electronDir = null
      let version = '<version>'
      try {
        const pkgPath = require.resolve('electron/package.json')
        electronDir = path.dirname(pkgPath)
        version = require(pkgPath).version
      } catch { /* keep placeholders */ }
      const zipName = `electron-v${version}-${process.platform}-${process.arch}.zip`

      if (failedZip) {
        console.error('  Electron\'s binary is missing. A downloaded copy exists at')
        console.error(`    ${failedZip}`)
        console.error('  but it could not be extracted - the file may be corrupt (delete')
        console.error('  it and reinstall), or antivirus is blocking the extraction.')
      } else {
        console.error('  Electron is installed, but its platform binary is missing and no')
        console.error('  usable download was found in the local cache. The download during')
        console.error('  `npm install` was probably blocked.')
        console.error('')
        console.error('  Common causes on corporate machines:')
        console.error('')
        console.error('    - Proxy blocks github.com downloads. Note: npm\'s proxy settings')
        console.error('      do NOT apply to electron\'s downloader - it needs:')
        console.error('        ELECTRON_GET_USE_PROXY=1')
        console.error('        GLOBAL_AGENT_HTTPS_PROXY=http://your-proxy:port')
        console.error('      then: npm install -D @testsmith/api-spector --force')
        console.error('')
        console.error('    - TLS-intercepting proxy (certificate errors): point Node at')
        console.error('      your corporate root CA:')
        console.error('        NODE_EXTRA_CA_CERTS=/path/to/corporate-root-ca.pem')
        console.error('')
        console.error('    - ELECTRON_SKIP_BINARY_DOWNLOAD=1 set machine-wide (some IT')
        console.error('      images do this) - unset it and reinstall.')
      }
      console.error('')
      console.error('  Manual fix (works without any of the above): download')
      console.error(`    https://github.com/electron/electron/releases/download/v${version}/${zipName}`)
      console.error('  in a browser, extract ALL of it into:')
      console.error(`    ${electronDir ? path.join(electronDir, 'dist') : '<node_modules>/electron/dist'}`)
      console.error(`  and create a file "path.txt" next to "dist" containing exactly:`)
      console.error(`    ${electronPlatformPath()}`)
    } else {
      console.error(`  ${loaded.message}`)
    }
    console.error('')
    console.error('  CLI subcommands (run / mock / record / contract / wsdl) do not')
    console.error('  need the UI binary and work even while this is broken.')
    console.error('')
    console.error(`  Full troubleshooting guide: ${TROUBLESHOOTING_URL}`)
    console.error('')
    process.exit(1)
  }

  const electron = loaded.electron
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
