# API Spector

Local-first API testing tool. Inspect, test and mock APIs. Secrets stay on your machine.

- GUI built with Electron + React
- CLI for running tests and mock servers in CI/CD pipelines
- Robot Framework & Playwright code generation
- AES-256-GCM encrypted secrets, never stored in plain text

## Install

```bash
npm install -g @testsmith/api-spector
```

> UI not starting after install (common on corporate machines: proxies, antivirus)?
> See [Troubleshooting: the UI won't start](docs/getting-started/troubleshooting.md).

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

## External secret managers

Instead of storing a secret, reference one in your secret manager and resolve it at run time — nothing is written to the workspace, results, or console. Put a reference in an environment variable (`secretRef`), an auth field, or inline as `{{vault:...}}` anywhere in a request (URL, header, body, or script). Built-in backends:

| Provider | Reference |
|---|---|
| HashiCorp Vault | `vault:secret/data/app#api_key` |
| AWS Secrets Manager | `aws:prod/db#password` |
| Azure Key Vault | `azure:acme-kv/db-password` |
| 1Password | `op://Prod/Database/password` |

Credentials come from the environment (the same conventions each tool already uses), so the same workspace runs unchanged on a laptop and in CI:

```bash
vault login -method=oidc                 # or AWS/Azure/1Password env
api-spector run --workspace ./ws.spector --env prod
```

The design is pluggable — more backends drop in as providers. See [Secret Managers](docs/reference/secrets-vault.md).

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

## Code review agents

Two read-only review agents live in [`.claude/agents/`](.claude/agents/) and run inside Claude Code. They audit the codebase and write a markdown report; they never edit source, so you stay in control of what gets changed.

| Agent | What it reviews |
| --- | --- |
| `ts-reviewer` | TypeScript/React best practices and maintainability: type safety, the main/preload/renderer boundary, React 19 and zustand patterns, async/resource handling, and oversized files, functions, components, and slices. |
| `a11y-reviewer` | Accessibility and colour contrast against WCAG 2.1 AA, checked in both the dark and light themes: contrast ratios, keyboard operability, semantics/ARIA, state announced to assistive tech, and reduced-motion. |

### How to use them

1. In a Claude Code session, invoke an agent and give it a scope:

   ```
   use ts-reviewer on the recent diff
   use a11y-reviewer on src/renderer/src/components/GitPanel
   ```

   Scope is optional. Name files, a directory, or "the recent diff"; leave it out and the agent reviews recent changes plus the code they touch.

2. The agent writes a report to `reviews/<agent>-<date>.md` (or a path you give it) and prints the file path. `reviews/` is gitignored, so these audits are not committed.

3. Read the report and decide which findings to act on. Each finding has a location, severity, suggested change, and effort estimate.

4. Apply the changes you picked as a separate, deliberate step. Implementing the fixes is never done by the review agent.

The agents default to the `opus` model for depth; switch the `model:` line in the agent file to `sonnet` for faster, cheaper runs.

## License

API Spector is released under the [MIT License](LICENSE): free to use, modify, and distribute, including for commercial purposes.

Copyright (c) 2024-2026 Testsmith.io
