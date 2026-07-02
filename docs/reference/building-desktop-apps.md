# Building Desktop Apps

> Contributor / maintainer reference. End users should just `npm install -g @testsmith/api-spector` (see [Installation](../getting-started/installation.md)).

API Spector ships as native desktop installers (macOS `.dmg`, Windows `.exe`) built with [electron-builder](https://www.electron.build/), in addition to the npm package.

## Build locally

```bash
npm run build          # compile main, preload, and renderer (electron-vite)
npx electron-builder --mac     # → dist/*.dmg + dist/*.zip   (run on macOS)
npx electron-builder --win     # → dist/*.exe                (run on Windows)
```

`npm run dist` runs the build and packages for the current platform in one step.

> Each binary must be built on its own OS — you can't reliably produce a Windows NSIS installer or sign a macOS app from Linux. `electron-builder` isn't on the bare shell PATH; invoke it via `npx` or an npm script.

### `electron` must be a devDependency

electron-builder requires `electron` in `devDependencies`, not `dependencies` — at packaging time the Electron binary is bundled into the app, so listing it as a runtime dependency double-packages it and fails the build with:

```
Package "electron" is only allowed in "devDependencies".
```

If you add Electron, keep it under `devDependencies`.

## Releasing via GitHub Actions

Two workflows fire when a GitHub Release is **published**:

| Workflow | File | Output |
|----------|------|--------|
| **Publish to npm** | `.github/workflows/release.yml` | Pushes the package to the npm registry |
| **Build Desktop Apps** | `.github/workflows/desktop-release.yml` | Builds the macOS + Windows installers and attaches them to the release |

`desktop-release.yml` runs a matrix of `macos-latest` and `windows-latest`, builds on each, and uploads the artifacts to the triggering release with `softprops/action-gh-release` (authenticated by the built-in `GITHUB_TOKEN` — no extra secrets needed). It uses `--publish never` so electron-builder packages locally and the explicit upload step controls exactly what gets attached.

### Cutting a release

1. Bump `version` in `package.json`.
2. Create a GitHub Release whose tag matches the version (e.g. `v0.3.1` for `0.3.1`) — electron-builder locates the release by `v<version>`.
3. Publish the release. Both workflows run; the `.dmg`, `.zip`, and `.exe` appear under the release **Assets** when the desktop build finishes.

### Code signing

Builds are currently **unsigned** (no certificates configured), so users see Gatekeeper / SmartScreen warnings. To sign, add the relevant secrets — electron-builder picks them up automatically:

- **macOS:** `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`; for notarization also `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows:** `CSC_LINK`, `CSC_KEY_PASSWORD`.

### macOS architectures

`macos-latest` runners are Apple Silicon, so the default build produces an **arm64** `.dmg`. Add an `x64` target in the `build.mac` config if Intel coverage is needed.
