# Running Flows from the CLI

The `api-spector flow` command lists and runs [flows](../gui/flows.md) from a workspace, headlessly, with the same engine the desktop app uses — so CI runs a flow exactly as you designed it.

## Usage

```bash
api-spector flow list --workspace ./my-workspace.spector
api-spector flow run <name> --workspace ./my-workspace.spector [options]
```

## Options (`flow run`)

| Option | Description |
|---|---|
| `--workspace <path>` | Path to the `.spector` workspace (file or its folder) **(required)** |
| `--environment <name>` | Environment to activate (also accepted: `--env`) |
| `--output <path>` | Write a report to a file (`.json`, `.xml`, or `.html`) |
| `--format json\|junit\|html` | Report format; inferred from the `--output` extension if omitted |
| `--verbose` | Print each block's script output, assertion detail, and the final variables |
| `--help` | Show usage |

The flow name is matched case-insensitively. Exit code is **non-zero** when any block failed or errored, so it gates a pipeline.

## Output

Each block prints as it runs, with its status, HTTP code, timing, and loop iteration:

```
  ✓  Send Request 200 180ms
  •  Set Variable
  ✓  Send Request 201 47ms
  ✓  Send Request [#0] 200 55ms
  ✓  Send Request [#1] 200 55ms
  · item=10
  ▣ Invoice: { "invoice_number": "INV-2026000020", ... }

  7 passed  11 blocks · 548ms
```

`Log` lines appear as `·` and `Display` values as `▣`. With `--verbose`, the final variables are printed too.

## Reports

```bash
# JSON (the full run summary: blocks, variables, traversed route)
api-spector flow run checkout --workspace ./ws.spector --output report.json

# JUnit XML (request + validate blocks as test cases) for CI
api-spector flow run checkout --workspace ./ws.spector --output report.xml

# Self-contained HTML report
api-spector flow run checkout --workspace ./ws.spector --output report.html
```

## Examples

```bash
# List the flows in a workspace
api-spector flow run --help
api-spector flow list --workspace ./toolshop.spector

# Run a flow against the CI environment, failing the build on any error
api-spector flow run checkout \
  --workspace ./toolshop.spector \
  --environment ci \
  --output reports/checkout.xml --verbose
```

Prefer `npx --yes @testsmith/api-spector flow run …` in CI so there's no install step.

See also: [Flows (GUI)](../gui/flows.md).
