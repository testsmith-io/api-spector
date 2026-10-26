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
| `--tags <a,b>` | Comma-separated tag filter; only run requests with matching tags |
| `--var "key=value"` | Override a variable for this run (repeatable). CLI tier: overrides stored environment/collection/folder/request values; a runtime script `.set()` overrides it. |
| `--env-var "key=value"` | Set an environment variable for this run (repeatable). Seeds the environment scope; a script `sp.environment.set` may override it. |
| `--global-var "key=value"` | Set a global variable for this run (repeatable). Seeds the globals scope; a script `sp.globals.set` may override it. |
| `--ask "Message=value"` | Supply an ask variable (`{{@Message}}`) for this run (repeatable) |
| `--output <path>` | Write a results report to file (`.json`, `.xml`, `.html`, `.sarif`) |
| `--format json\|junit\|html\|sarif` | Report format; inferred from `--output` extension if omitted |
| `--concurrency <n>` | Run n requests at a time (default 1 = sequential) |
| `--verbose` | Print per-request console output and individual test results |
| `--bail` | Stop after the first failed or errored request |
| `--help` | Show usage |

## Examples

Without `--environment`, the run uses the workspace's default environment when one is set (Workspace Settings, General tab). Environment `extends` chains are resolved automatically.

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

## Overriding variables

Three repeatable flags override variables for a single run, each at a different scope:

```bash
# Scope-agnostic override at the CLI tier (overrides stored values)
api-spector run --workspace ./project.spector --var "email=admin"

# Postman/Bruno-style scope seeds
api-spector run --workspace ./project.spector \
  --env-var "BASE_URL=https://staging.example.com" \
  --global-var "apiKey=ci-key-123"
```

Each is repeatable (`--var "a=1" --var "b=2"`). How they interact with the rest of the [variable precedence](../reference/variables.md#resolution-order-precedence):

- `--var` sits at the **CLI tier** — above the stored environment / collection / folder / request values, below data-row and runtime values. It is the *initial* value: the moment a script `sp.*.set()`s that key during the run, the script's value takes over for later requests.
- `--env-var` and `--global-var` **seed** the environment and globals scopes. They override the stored value in that scope, resolve at that scope's precedence (so a collection/folder/request value of the same name still wins, since collection outranks environment here), and a script `sp.environment.set` / `sp.globals.set` overrides them for later requests.

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
     ✗ status should be 200 - Expected 200 to equal 404

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
