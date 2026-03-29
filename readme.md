# api Spector

Local-first API testing tool. Inspect, test and mock APIs. Secrets stay on your machine.

- GUI built with Electron + React
- CLI for running tests and mock servers in CI/CD pipelines
- Robot Framework & Playwright code generation
- AES-256-GCM encrypted secrets, never stored in plain text

## Install

```bash
npm install -g @testsmith/api-spector
```

## Usage

### GUI

```bash
api-spector ui
```

Opens the desktop app. On first launch you'll be prompted to open or create a workspace.

### Run tests

```bash
api-spector run --workspace ./my-workspace.spector [options]
```

| Option | Description |
|---|---|
| `--workspace <path>` | Path to `.spector` workspace file (required) |
| `--env <name>` | Environment name to activate |
| `--collection <name>` | Limit to a specific collection |
| `--tags <a,b>` | Comma-separated tag filter |
| `--output <path>` | Write results to file (`.json` or `.xml`) |
| `--format json\|junit` | Output format (inferred from `--output` extension) |
| `--verbose` | Print per-request console output and test details |
| `--bail` | Stop after first failure |

Exit code `0` = all passed, `1` = failures/errors.

### Start mock servers

```bash
api-spector mock --workspace ./my-workspace.spector [options]
```

| Option | Description |
|---|---|
| `--workspace <path>` | Path to `.spector` workspace file (required) |
| `--name <name>` | Start only the named server (repeat for multiple) |

Keeps running until `Ctrl+C`.

## Workspaces

A workspace is a `.spector` file that references your collections, environments and mock servers. Safe to commit to Git. Secrets are encrypted, not stored in plain text.

```
my-project/
├── my-workspace.spector
├── collections/
│   └── my-api.spector
└── environments/
    ├── dev.env.json
    └── prod.env.json
```

## Encrypted secrets

Secret variables are encrypted with AES-256-GCM using a master password. Set `API_SPECTOR_MASTER_KEY` in your shell profile to avoid being prompted each session:

**macOS / Linux** (`~/.zshrc` or `~/.bashrc`):
```bash
export API_SPECTOR_MASTER_KEY="your-password"
```

**Windows (PowerShell profile):**
```powershell
$env:API_SPECTOR_MASTER_KEY = "your-password"
```

**Windows (Command Prompt, permanent):**
```cmd
setx API_SPECTOR_MASTER_KEY "your-password"
```

### CI/CD

Set `API_SPECTOR_MASTER_KEY` as a secret in your pipeline:

```yaml
# GitHub Actions
env:
  API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}
```

If the key is not set, encrypted secrets will not be resolved and a warning will appear in the console output.

## Development

```bash
# Install dependencies
npm install

# Start in dev mode (hot reload)
npm run dev

# Build
npm run build

# Package as native app (macOS / Windows / Linux)
npm run package
```

## License

Copyright (c) 2024-2026 Testsmith.io. All rights reserved.

This repository is publicly viewable for reference purposes only.

Commercial use, public hosting, redistribution, and use for third-party services are not permitted without prior written permission. See [LICENSE](LICENSE) for full terms.
