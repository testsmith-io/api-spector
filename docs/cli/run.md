# Running Tests from the CLI

The `api-spector run` command executes all requests in a workspace, runs their post-response scripts, and reports pass/fail results.

## Basic usage

```bash
api-spector run --workspace ./my-workspace.spector
```

## Options

| Option | Description |
|---|---|
| `--workspace <path>` | Path to `.spector` workspace file **(required)** |
| `--env <name>` | Environment name to activate |
| `--collection <name>` | Run only this collection (by name) |
| `--tags <a,b>` | Comma-separated tag filter — only run requests with matching tags |
| `--output <path>` | Write a results report to file (`.json` or `.xml`) |
| `--format json\|junit` | Report format — inferred from `--output` extension if omitted |
| `--verbose` | Print per-request console output and individual test results |
| `--bail` | Stop after the first failed or errored request |
| `--help` | Show usage |

## Examples

Run with an environment:

```bash
api-spector run --workspace ./project.spector --env staging
```

Filter by tag:

```bash
api-spector run --workspace ./project.spector --tags smoke,regression
```

Limit to one collection and write a JUnit report:

```bash
api-spector run \
  --workspace ./project.spector \
  --collection "User API" \
  --output results.xml
```

Write a JSON report:

```bash
api-spector run --workspace ./project.spector --output results.json
```

Stop on first failure:

```bash
api-spector run --workspace ./project.spector --bail
```

## Output

### Terminal

```
  API Test Runner
  Workspace:   ./project.spector
  Environment: staging

  ┌ User API
  ✓  GET      Get users  200  45ms
  ✓  POST     Create user  201  112ms
  ✗  DELETE   Delete user  404  23ms
     ✗ status should be 200 — Expected 200 to equal 404

  3 passed · 1 failed · 4 total · 180ms
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All requests passed |
| `1` | One or more failures or errors |
| `2` | Fatal error (could not load workspace, etc.) |

## Report formats

### JSON

```json
{
  "meta": {
    "workspace": "./project.spector",
    "environment": "staging",
    "timestamp": "2025-01-15T10:00:00.000Z"
  },
  "summary": {
    "total": 4,
    "passed": 3,
    "failed": 1,
    "errors": 0,
    "durationMs": 180
  },
  "results": [...]
}
```

### JUnit XML

Compatible with CI systems that consume JUnit reports (Jenkins, GitLab CI, GitHub Actions test summary).

## Encrypted secrets

Set `API_SPECTOR_MASTER_KEY` in the environment before running:

```bash
export API_SPECTOR_MASTER_KEY="your-password"
api-spector run --workspace ./project.spector
```

Or inline:

```bash
API_SPECTOR_MASTER_KEY="your-password" api-spector run --workspace ./project.spector
```

If the key is not set, secrets will not be decrypted and a warning is printed per affected variable.
