# Contract Testing (CLI)

Everything the [Contract Testing](../gui/contract-testing.md) panel does is available headlessly through `api-spector contract`, plus extras that only make sense in CI: a deployment gate (`can-i-deploy`), Pact file import/export, and machine-readable reports (JUnit, JSON, HTML).

```
api-spector contract list          --workspace <path>
api-spector contract run           --workspace <path> --mode <mode> [options]
api-spector contract report        --workspace <path> [--html <path>]
api-spector contract can-i-deploy  --workspace <path> --pacticipant <name> --app-version <ver>
api-spector contract pact-import   --file <pact.json> [--out <collection.json>]
api-spector contract pact-export   --workspace <path> --out <pact.json> [options]
```

Exit code `0` = all checks passed, `1` = failures, `2` = bad invocation. Pipelines fail automatically on non-zero exit.

---

## Modes

| Mode | What it does | Needs |
|------|--------------|-------|
| `consumer` | Sends each request live and validates the response against its contract | — |
| `provider` | Static check that requests conform to an OpenAPI spec (no HTTP) | a spec |
| `provider-live` | Replays consumer contracts against a **running** provider, seeding provider states first | `--provider-base-url` |
| `bidirectional` | Static spec/contract compatibility **plus** live response check | a spec |

See the [GUI guide](../gui/contract-testing.md) for the conceptual difference between modes.

---

## `contract run`

Run options:

| Flag | Applies to | Purpose |
|------|------------|---------|
| `--mode <mode>` | all | `consumer` \| `provider` \| `provider-live` \| `bidirectional` |
| `--snapshot <id\|name>` | provider, bidir | Run against a [pinned snapshot](../gui/contract-testing.md) (takes priority over `--spec-*`) |
| `--spec-url <url>` | provider, bidir | Fetch the OpenAPI spec from a URL for this run |
| `--spec-path <path>` | provider, bidir | Read the OpenAPI spec from a local file |
| `--provider-base-url <url>` | provider-live | Rebase every request onto this origin before replaying |
| `--states-url <url>` | provider-live | Provider state handler endpoint (Pact "state change URL") |
| `--collection <name>` | all | Limit to a single collection (default: all) |
| `--environment <name>` | all | Environment used to resolve `{{variables}}` |
| `--request-base-url <url>` | provider, bidir | Strip this host from request URLs before matching spec paths |
| `--output <path>` | all | Write the raw `ContractReport` JSON |
| `--junit <path>` | all | Write a JUnit XML report (for CI test reporters) |
| `--html <path>` | all | Write a self-contained HTML report |
| `--record` | all | Record the result for `can-i-deploy` |
| `--pacticipant <name>` | all | Name to record under (default: the collection name) |
| `--app-version <ver>` | all | Version to record under (**required** with `--record`) |

### Examples

Consumer check against the live API:

```bash
api-spector contract run --workspace . --mode consumer --environment staging --junit results.xml
```

Live provider verification with state seeding, recording the result for the gate:

```bash
api-spector contract run \
  --workspace . \
  --mode provider-live \
  --provider-base-url http://localhost:3000 \
  --states-url http://localhost:3000/_pact/provider-states \
  --html report.html \
  --record --pacticipant pets-api --app-version "$GIT_SHA"
```

Static check of the whole collection against a pinned spec snapshot:

```bash
api-spector contract run --workspace . --mode provider --snapshot pets-v1
```

---

## Provider states

In `provider-live` mode, list the states an interaction depends on in its contract (`providerStates`). Before each interaction the CLI sends:

```http
POST <states-url>
Content-Type: application/json

{ "state": "pet 1 exists", "action": "setup" }
```

and, after the interaction, the same payload with `"action": "teardown"`. Your handler puts the provider into the named state (seeds a row, clears a cache, …) and returns any `2xx`. A missing handler, an unreachable URL, or a non-2xx response yields a `provider_state_failed` violation and the interaction is **not** replayed (so you never get a misleading pass/fail).

This is wire-compatible with Pact's state change URL, so an existing Pact provider-states endpoint works unchanged.

---

## `can-i-deploy` — the deployment gate

A local, broker-free deployment gate. Record verification results keyed by **pacticipant + version**, then ask whether a given version is safe to ship.

```bash
# 1. record a verification result (during contract run)
api-spector contract run --workspace . --mode provider-live \
  --provider-base-url http://localhost:3000 \
  --record --pacticipant pets-api --app-version "$GIT_SHA"

# 2. gate the deploy
api-spector contract can-i-deploy --workspace . --pacticipant pets-api --app-version "$GIT_SHA"
```

```
  ✓ Computer says yes — safe to deploy.
  pets-api@1a2b3c4 passed all 12 contract checks (verified 2026-06-26T22:00:00.000Z).
```

- Exit `0` when the recorded result for that exact version passed; exit `1` otherwise.
- **Fails closed:** an unknown pacticipant/version is *not* deployable, so a missing verification can never wave a release through.

Results are stored under `<workspace>/contracts/results/<pacticipant>/<version>.json` — safe to commit, and the input to the dashboard below.

> **Scope:** this is local-first (per-workspace), which gates a single repo/CI well. It is not a shared cross-team broker — that is a future addition.

---

## Reports

| Format | Flag | Best for |
|--------|------|----------|
| JSON | `--output report.json` | Custom processing / downstream tooling |
| JUnit XML | `--junit results.xml` | GitHub Actions, GitLab, Azure DevOps, Jenkins dashboards |
| HTML | `--html report.html` | A shareable artifact a human opens |

### HTML run report

`--html` writes a **single self-contained file** (inline CSS, no external assets): a pass/fail headline and ratio bar, run metadata, and one expandable card per interaction with full violation detail. It is the same report the GUI's **Export HTML** button produces.

### HTML dashboard

`contract report` aggregates every recorded `can-i-deploy` result into a **pacticipant × version matrix** — the "can I ship this version?" view.

```bash
api-spector contract report --workspace . --html dashboard.html
```

---

## Pact interoperability

API Spector reads and writes standard [Pact](https://docs.pact.io/) files (v2/v3/v4), so it slots into an existing Pact ecosystem. The Pact file format and tooling are open source (MIT); only the hosted PactFlow broker is commercial — and the two features it charges for (bi-directional testing and `can-i-deploy`) have local equivalents here.

### Import a pact

```bash
api-spector contract pact-import --file web-pets.json --out collection.json
```

Each interaction becomes a runnable request: the request side maps to method/path/query/headers (the URL is prefixed with `{{baseUrl}}`), and the response side becomes a consumer contract — status, required headers, provider states, and a **body matcher** built from the pact's `matchingRules`. Set the `baseUrl` collection variable (or use `--provider-base-url`) and verify with `provider-live`.

### Export a pact

```bash
api-spector contract pact-export --workspace . --out pacts/web-pets.json \
  --consumer web --provider pets-api --collection "Pets"
```

Every request carrying a contract becomes a Pact v3 interaction; body matchers are translated back into `matchingRules`. See **[Pact Compatibility & Matchers](../reference/pact-compatibility.md)** for the exact mapping and supported matchers.

---

## GitHub Actions example

Provider-side verification gating a deploy:

```yaml
name: Contract Verification

on:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
      - run: npm install -g @testsmith/api-spector

      - name: Start provider
        run: npm start &        # your service, with a /_pact/provider-states test endpoint

      - name: Verify contracts
        run: |
          api-spector contract run \
            --workspace . \
            --mode provider-live \
            --provider-base-url http://localhost:3000 \
            --states-url http://localhost:3000/_pact/provider-states \
            --junit contract-results.xml \
            --html contract-report.html \
            --record --pacticipant pets-api --app-version "$GITHUB_SHA"

      - name: Gate the deploy
        run: api-spector contract can-i-deploy --workspace . --pacticipant pets-api --app-version "$GITHUB_SHA"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: contract-report
          path: |
            contract-results.xml
            contract-report.html
```

For the general pipeline setup (secrets, other CI systems), see **[Pipeline Integration](cicd.md)**.
