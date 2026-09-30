# Windows package managers

API Spector for Windows is distributed as a **code-signed NSIS installer**
(`API-Spector-Setup-<version>.exe`) and a **portable zip**
(`API-Spector-<version>-x64.zip`), both attached to each GitHub Release.

Shared facts every package manager needs:

- **Silent install switch:** `API-Spector-Setup-<version>.exe /S` (electron-builder
  one-click NSIS). `/D=<path>` overrides the directory.
- **Per-user install**, no admin (installs to `%LOCALAPPDATA%\Programs\API Spector`).
- **Signed** (Azure Trusted Signing) and **timestamped**, so signatures stay valid.
- Asset names are **space-free and versioned**, so `checkver`/regex automation is stable.

Fill in the `REPLACE_WITH_...` placeholders per release (or let the automation do it).

---

## 1. winget  (highest reach — built into Windows 10/11)

Manifests live in `microsoft/winget-pkgs`, not here. Automation is in
[`.github/workflows/winget.yml`](../.github/workflows/winget.yml).

**One-time setup:**
1. Create a GitHub PAT and add it as the repo secret **`WINGET_TOKEN`**
   (classic: `public_repo`; or fine-grained with fork + PR rights on winget-pkgs).
2. Submit the **first** version manually so the package exists:
   ```
   winget install wingetcreate
   wingetcreate new https://github.com/testsmith-io/api-spector/releases/download/v<version>/API-Spector-Setup-<version>.exe
   ```
   Set PackageIdentifier `Testsmith.APISpector`, InstallerType `nullsoft`,
   silent switch `/S`, scope `user`. Submit the PR it generates.

After that, the workflow auto-opens an update PR to winget-pkgs on every stable
release. Users then: `winget install Testsmith.APISpector`.

---

## 2. Scoop  (self-hosted bucket — you control it, no approval)

Manifest: [`scoop/api-spector.json`](scoop/api-spector.json). It uses the
**portable zip** (Electron NSIS installers don't 7-zip-extract cleanly).

**One-time setup:**
1. Create a repo `testsmith-io/scoop-bucket`.
2. Copy `scoop/api-spector.json` into it (root or a `bucket/` folder).
3. Fill `version` + the `hash` (sha256 of the zip) for the current release, or run
   `scoop update` locally which uses the `autoupdate` block to fill them.
4. Add a scheduled GitHub Action in the bucket repo (the community
   `scoop-update` action) so `checkver`/`autoupdate` bumps it automatically.

Users then:
```
scoop bucket add testsmith https://github.com/testsmith-io/scoop-bucket
scoop install api-spector
```

> Note: verify on Windows that `API Spector.exe` sits at the **root** of the zip
> (electron-builder's zip target). If it's nested, adjust `bin`/`shortcuts`.

---

## 3. Chocolatey  (community repo — moderated)

Package: [`chocolatey/`](chocolatey/) — `api-spector.nuspec` +
`tools/chocolateyinstall.ps1` (downloads the signed `.exe`, installs with `/S`)
and `tools/chocolateyuninstall.ps1`.

**Per release:**
1. Bump `<version>` in `api-spector.nuspec` and `tools/chocolateyinstall.ps1`.
2. Set `checksum64` to the sha256 of the signed `.exe`:
   `Get-FileHash API-Spector-Setup-<version>.exe -Algorithm SHA256`.
3. Pack + push:
   ```
   choco pack packaging/chocolatey/api-spector.nuspec
   choco push api-spector.<version>.nupkg --source https://push.chocolatey.org/ --api-key <key>
   ```
4. First submission goes through **Chocolatey community moderation**.

Users then: `choco install api-spector`.

> Note: Chocolatey runs elevated, so the per-user NSIS install lands under the
> elevated user's profile. Verify placement on Windows if this matters for your
> users; per-machine would need admin either way.

---

## Not covered

- **PatchMyPC** is **curated by PatchMyPC** — you don't self-publish. Request
  inclusion via their "request a product" process; the signed installer + `/S`
  switch + stable download URL above are what they need.
- **Homebrew (macOS)** would need the macOS build re-added **and** Apple
  notarization ($99/yr) to avoid Gatekeeper — deferred; mac/Linux use npm.
