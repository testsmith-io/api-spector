# Troubleshooting: the UI won't start

`api-spector ui` launches the desktop app through the `electron` npm package. That package downloads a ~100 MB platform binary from GitHub Releases during `npm install`. On locked-down or corporate machines, that download or its extraction is the thing that breaks. The CLI subcommands (`run`, `mock`, `record`, `contract`, `wsdl`) never need this binary and keep working regardless.

Since **0.3.4** the launcher repairs itself when it can: if the binary is missing but a fully-downloaded Electron zip already sits in the local cache, `api-spector ui` extracts it automatically (using the operating system's own unzip tooling) and starts. You'll see:

```
  Electron 31.7.7 was already downloaded - repairing the
  installation from the local cache...
  Repaired.
```

When self-repair isn't possible, the error message tells you which of the cases below you're in.

## "The electron package is not installed alongside API Spector"

You're on **0.3.1 or 0.3.2**; those two versions shipped without electron by mistake. Update:

```bash
npm install -D @testsmith/api-spector@latest
```

(use `-g` instead of `-D` if you installed globally). Alternatively, keep your version and add electron to your own project: `npm install -D electron@31`.

## "…its platform binary is missing and no usable download was found"

The binary download during `npm install` was blocked. Almost always a corporate network. Work through these in order:

### 1. Proxy: npm's proxy settings are not enough

Electron's downloader (`@electron/get`) ignores `npm config set proxy`. It needs its own environment variables:

```powershell
# PowerShell
$env:ELECTRON_GET_USE_PROXY = "1"
$env:GLOBAL_AGENT_HTTPS_PROXY = "http://your-proxy:port"
npm install -D @testsmith/api-spector --force
```

```bash
# bash/zsh
export ELECTRON_GET_USE_PROXY=1
export GLOBAL_AGENT_HTTPS_PROXY=http://your-proxy:port
npm install -D @testsmith/api-spector --force
```

> Proxies that require NTLM/Kerberos authentication are **not supported** by electron's downloader at all. Use a mirror (below) or the manual install.

### 2. Internal mirror

If your company mirrors Electron in Artifactory/Nexus (common), point the downloader at it:

```bash
export ELECTRON_MIRROR=https://artifactory.yourcompany.com/artifactory/electron/
npm install -D @testsmith/api-spector --force
```

### 3. TLS-intercepting proxy (certificate errors)

If the underlying error mentions `self signed certificate in certificate chain` or `unable to verify the first certificate`, your proxy re-signs TLS traffic and Node doesn't trust its certificate. Proxy settings won't fix this; Node needs the corporate root CA:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corporate-root-ca.pem
```

Ask IT for the root CA file, or export it from the OS certificate store.

### 4. `ELECTRON_SKIP_BINARY_DOWNLOAD`

Some IT-managed machines set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` globally (it stops npm installs from hanging behind firewalls). It makes electron's installer exit **silently without doing anything**: install "succeeds", no binary, no error. Check for it:

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD      # PowerShell
npm config get electron_skip_binary_download
```

Unset it and reinstall.

## "A downloaded copy exists … but it could not be extracted"

The zip is in the cache but broken, or something on the machine is interfering with extraction:

- **Corrupt / truncated download**: check the file size. A real Electron zip is ~100 MB; a few KB means your proxy saved its HTML block page under a `.zip` name (open it in a text editor to see the block reason, useful evidence for IT). Delete the file and reinstall.
- **Antivirus / endpoint protection**: real-time scanners can break extraction into `node_modules` or quarantine `electron.exe` after the fact. Check the protection history (Windows Security → Protection history, or your CrowdStrike/SentinelOne console) and ask IT to allowlist it.

The cache lives at:

| OS | Cache location |
|---|---|
| Windows | `%LOCALAPPDATA%\electron\Cache` |
| macOS | `~/Library/Caches/electron` |
| Linux | `~/.cache/electron` (or `$XDG_CACHE_HOME/electron`) |

Zips sit inside hash-named subdirectories, e.g. `...\Cache\5e0e70…\electron-v31.7.7-win32-x64.zip`.

## Manual install: works offline, no scripts

Everything electron's installer does can be done by hand. A browser download usually succeeds even where Node's downloader is blocked:

1. Find the exact version needed (inside the `electron` folder shown by the error message):
   ```bash
   node -p "require('./package.json').version"
   ```
2. Download `https://github.com/electron/electron/releases/download/v<version>/electron-v<version>-<platform>-<arch>.zip` in a browser (`win32-x64`, `darwin-arm64`, `linux-x64`, etc.). Verify it's roughly 100 MB.
3. Extract the **entire** zip into a `dist` folder inside the electron package, so this file exists:
   - Windows: `node_modules\electron\dist\electron.exe`
   - macOS: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
   - Linux: `node_modules/electron/dist/electron`
4. Create a plain-text file `path.txt` next to `dist` containing exactly (no trailing newline):
   - Windows: `electron.exe`
   - macOS: `Electron.app/Contents/MacOS/Electron`
   - Linux: `electron`

If the zip is already in the cache (see table above), you can extract that copy instead of downloading. On Windows:

```powershell
cd <path-to>\node_modules\electron
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Expand-Archive "$env:LOCALAPPDATA\electron\Cache\<hash>\electron-v<version>-win32-x64.zip" -DestinationPath dist
Set-Content path.txt "electron.exe" -NoNewline
```

> This fix lives inside `node_modules`, so the next `npm install` can wipe it. Fix the underlying network/AV issue (or use the desktop app) for a durable solution.

## Locked-down machines: use the desktop app instead

If IT policy keeps blocking downloads into `node_modules`, the most reliable setup is to split UI and CLI:

- **UI**: install the packaged desktop app (`.exe` / `.dmg` / `.AppImage`), which has Electron bundled inside and downloads nothing at install time. See [Building Desktop Apps](reference/building-desktop-apps.md).
- **CLI**: keep the npm package for `run` / `mock` / `record` / `contract` / `wsdl`; it needs no Electron binary.

## Slow startup on Windows

If `api-spector` (the UI) takes 10 to 30 seconds to show a window on a managed Windows machine, the time is almost never spent in API Spector itself. The usual causes, in order of likelihood:

1. **Endpoint protection scans Electron at every launch.** `electron.exe` plus its DLLs are ~200 MB of unsigned binaries sitting inside `node_modules`. Real-time AV (Defender, CrowdStrike, …) rescans them on each start because unsigned files in user directories don't get a cached reputation. This is even more pronounced right after a manual binary install. Fix: ask IT for a scan exclusion on the project's `node_modules\electron\dist` folder, or use the signed desktop installer, which gets scanned once and then trusted.
2. **The install lives on a network drive.** Corporate folder redirection often puts the profile (and the npm global prefix) on a file server; every launch then streams Electron over the network. Check with `npm config get prefix`. If it points at a UNC path or a redirected drive, install into a project on the local disk (`C:\`) instead.
3. **Node itself is slow to start** (rarer). Compare: `Measure-Command { node --version }`.

To tell 1 from 2/3 apart:

```powershell
Measure-Command { node --version }          # baseline: Node startup
Measure-Command { api-spector run --help }  # CLI path, no Electron
# then time `api-spector` itself
```

If only the UI launch is slow, it's Electron being scanned (case 1). If everything is slow, look at cases 2 and 3.

The CLI subcommands (`run`, `mock`, `record`, `contract`, `wsdl`) never load Electron and are unaffected by case 1.
