# Package managers

API Spector is published to per-OS package managers so users can install without
the npm / Node.js path. Each subfolder holds the package definition plus a README
with the one-time setup and per-release steps.

| OS | Manager | Definition | Source asset |
|----|---------|-----------|--------------|
| Windows | **Chocolatey** | [`chocolatey/`](chocolatey/) | `API-Spector-Setup-<version>.exe` |
| Windows | **Scoop** (self-hosted bucket) | live at [`testsmith-io/scoop-bucket`](https://github.com/testsmith-io/scoop-bucket) | `API-Spector-<version>-x64.zip` |

The Linux AppImage/`.deb` are built and attached to each GitHub Release by
[`desktop-release.yml`](../.github/workflows/desktop-release.yml) alongside the
Windows `.exe`. All release tags are the bare version (e.g. `0.9.16`, no `v`
prefix), and asset names are space-free and versioned so the `checkver`/bump
automation stays stable.

> **macOS** is distributed via the npm package (it runs under Electron's own
> notarized binary, so no Gatekeeper prompt). A Homebrew cask was considered but
> dropped for now: it would require a `.dmg` that is signed **and** Apple-notarized
> (paid Developer Program) to avoid Gatekeeper, which we don't want to take on yet.

---

## Windows installer facts

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

## Scoop  (self-hosted bucket — you control it, no approval)

**Already live and self-maintaining** at
[`testsmith-io/scoop-bucket`](https://github.com/testsmith-io/scoop-bucket)
(built from the ScoopInstaller bucket template). The **Excavator** workflow there
runs on a schedule and bumps `bucket/api-spector.json` to each new release via the
manifest's `checkver`/`autoupdate` blocks — no manual steps. It tracks the
**portable zip** (Electron NSIS installers don't 7-zip-extract cleanly).

Users install with:
```
scoop bucket add testsmith https://github.com/testsmith-io/scoop-bucket
scoop install api-spector
```

---

## Chocolatey  (community repo — first version is moderated)

Package: [`chocolatey/`](chocolatey/). Downloads the signed `.exe` and verifies
its checksum. See [`chocolatey/README.md`](chocolatey/README.md) for pack/push.

```
choco install api-spector
```

## Not covered

- **PatchMyPC** is **curated by PatchMyPC** — you don't self-publish. Request
  inclusion via their "request a product" process; the signed installer + `/S`
  switch + stable download URL above are what they need.
