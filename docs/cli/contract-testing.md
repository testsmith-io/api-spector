# Contract Testing (CLI)

Everything the [Contract Testing](../gui/contract-testing.md) panel does is available headlessly through `api-spector contract`, plus extras that only make sense in CI: a deployment gate (`can-i-deploy`), Pact file import/export, and machine-readable reports (JUnit, JSON, HTML).

```
api-spector contract list          --workspace <path>
api-spector contract pin           --workspace <path> --spec-url <url> | --spec-path <file> [--name <label>]
api-spector contract run           --workspace <path> --mode <mode> [options]
api-spector contract report        --workspace <path> [--html <path>] [--serve [--port <n>]]
api-spector contract can-i-deploy  --workspace <path> --pacticipant <name> --app-version <ver> [--to <env>]
api-spector contract record-deployment --workspace <path> --pacticipant <name> --app-version <ver> --env <name>
api-spector contract environments  --workspace <path>
api-spector contract webhooks      --workspace <path> [--test]
api-spector contract fuzz          --workspace <path> --provider-base-url <url> [options]
api-spector contract pact-import   --file <pact.json> [--out <collection.json>]
api-spector contract pact-export   --workspace <path> --out <pact.json> [options]
```

Exit code `0` = all checks passed, `1` = failures, `2` = bad invocation. Pipelines fail automatically on non-zero exit.

---

## Modes

| Mode | What it does | Needs |
|------|--------------|-------|
| `consumer` | Sends each request live and validates the response against its contract | nothing |
| `provider` | Static check that requests conform to an OpenAPI spec (no HTTP) | a spec |
| `provider-live` | Replays consumer contracts against a **running** provider, seeding provider states first | `--provider-base-url` |
| `bidirectional` | Static spec/contract compatibility **plus** live response check | a spec |

See [Contract Testing Types](../reference/contract-testing-types.md) for how these modes map to consumer-driven, provider-driven, and bi-directional contract testing, and the [GUI guide](../gui/contract-testing.md) for the workflow inside the app.

---

## `contract pin` -- snapshot a spec version

Pin captures a verbatim copy of an OpenAPI spec into `<workspace>/contracts/` (with a sha256 and the spec's `info.version`), registers it in the workspace file, and prints the snapshot ID. Same result as the Pin button in the GUI, but scriptable:

```bash
api-spector contract pin --workspace ./ws --spec-url https://api.example.com/openapi.json
api-spector contract pin --workspace ./ws --spec-path ./specs/v4.yaml --name "orders-v4"
```

Commit the resulting `contracts/*.contract.json` file to git; `contract run --snapshot <id|name>` then verifies against that exact spec version forever, regardless of what the provider ships later.

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
| `--environment <name>` | all | Environment used to resolve `{{variables}}` (default: the workspace's default environment, else the first one) |
| `--request-base-url <url>` | provider, bidir | Strip this host from request URLs before matching spec paths |
| `--output <path>` | all | Write the raw `ContractReport` JSON |
| `--junit <path>` | all | Write a JUnit XML report (for CI test reporters) |
| `--html <path>` | all | Write a self-contained HTML report |
| `--record` | all | Record the result for `can-i-deploy` |
| `--pacticipant <name>` | all | Name to record under (default: the collection name) |
| `--app-version <ver>` | all | Version to record under (**required** with `--record`) |
| `--allow-pending` | all | Failures of never-verified interactions report as pending instead of blocking (see [Pending contracts](#pending-contracts)) |

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

## `can-i-deploy`: the deployment gate

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
  ✓ Computer says yes - safe to deploy.
  pets-api@1a2b3c4 passed all 12 contract checks (verified 2026-06-26T22:00:00.000Z).
```

- Exit `0` when the recorded result for that exact version passed; exit `1` otherwise.
- **Fails closed:** an unknown pacticipant/version is *not* deployable, so a missing verification can never wave a release through.

Results are stored under `<workspace>/contracts/results/<pacticipant>/<version>.json`. They are safe to commit, and they are the input to the dashboard below.

> **Scope:** this is local-first (per-workspace), which gates a single repo/CI well. It is not a shared cross-team broker; that is a future addition.

---


## Deployment tracking

Record which version runs in which environment. Like results, deployments are plain files (`contracts/environments/<env>.json`) that you commit to git, so "what is in prod" has history and needs no server.

```bash
# After a successful deploy
api-spector contract record-deployment --workspace ./ws \
  --pacticipant web-app --app-version 1.2.0 --env prod

# What runs where
api-spector contract environments --workspace ./ws

# Gate with upgrade context: shows what prod currently runs
api-spector contract can-i-deploy --workspace ./ws \
  --pacticipant web-app --app-version 1.3.0 --to prod
```

`record-deployment` never blocks: it documents a fact. If the recorded version has no passing verification it prints a warning, because that means the `can-i-deploy` gate was skipped. The intended pipeline order is: verify with `--record`, gate with `can-i-deploy`, deploy, then `record-deployment`.

The dashboard (static export and `--serve`) renders an Environments table showing each deployment with a pass/fail badge linking to its verification run.

## Pending contracts

A brand-new contract fails provider verification until the provider implements it. With `--allow-pending`, failures of interactions that have never passed before are reported as **pending** instead of blocking the build (exit code stays 0). Once an interaction passes for the first time, it stops being pending; later failures block again. Changing a contract's expectations resets it to pending. This mirrors Pact's pending pacts and lets consumers add expectations without breaking the provider's CI.

```bash
api-spector contract run --workspace ./ws --mode provider-live \
  --provider-base-url http://localhost:3000 --allow-pending
```

The first-pass ledger is `contracts/pending.json`, committed to git. It only updates on runs that use the flag. Pending interactions show a PENDING badge in HTML reports and a `"pending"` count in the JSON report.

## Fuzzing

Spec-driven fuzzing generates malformed variants of each request's JSON body, sends them to the provider, and flags responses that reveal a robustness or validation gap. It is single-fault: each case mutates exactly one field, so a finding names one cause and hands you a request you can replay.

```bash
api-spector contract fuzz --workspace ./ws \
  --snapshot my-api --provider-base-url http://localhost:3000 \
  --include-writes --cases 40 --seed 1 --html fuzz.html
```

Input source, in order: a pinned snapshot (`--snapshot`), `--spec-url`, `--spec-path`, or, with none of those, the request's own body. A spec produces richer inputs because it knows every field and constraint; without one, fuzzing mutates the body you already have.

The oracles (what counts as a finding):

| Oracle | Meaning | Default |
|---|---|---|
| `never-5xx` | The server returned 5xx (or dropped the connection) on malformed input. It should reject with 4xx, not crash. | always on |
| `accepted-invalid` | The server returned 2xx to a body that provably violates the spec schema. Missing input validation. | on in spec mode |
| `undocumented-status` | The response status is not documented in the spec for that operation. Can be noisy when specs under-document errors. | `--strict-status` |
| `response-schema` | A 2xx response body does not match the documented schema. | `--check-responses` |

Options: `--cases <n>` (mutations per operation, default 40), `--seed <n>` (default 1; runs are deterministic, so a finding always reproduces), `--trace` (record every case that was sent, not just findings: the request body and the response it produced, printed to the console and included in `--output` JSON and `--html`), `--include-writes` (fuzz POST/PUT/PATCH/DELETE, which send malformed writes; off by default, so point it at staging or a mock), `--collection`, `--environment`, `--request-base-url`, `--output <json>`, `--html <path>`. Exit code is 0 when there are no findings, 1 otherwise.

Safety: without `--include-writes`, write-method requests are skipped and the count is reported. Fuzzing sends deliberately broken input, so run it against a test environment, not production.

## Webhooks

The served dashboard is the always-on process in the setup, so it also handles notifications. Configure outbound webhooks in `contracts/webhooks.json`:

```json
{
  "webhooks": [
    {
      "name": "trigger provider CI",
      "url": "https://ci.example.com/api/trigger",
      "events": ["result-recorded", "deployment-recorded"],
      "headers": { "Authorization": "Bearer $CI_TOKEN" }
    }
  ]
}
```

While `contract report --serve` runs, it polls the workspace (default every 10 seconds, `--webhook-interval <seconds>` to change) and POSTs a JSON payload to each matching URL when a new verification result or deployment appears, whether written locally or arriving through `git pull`. `$NAME` tokens in URLs and header values are replaced from the serving process environment, so secrets stay out of the committed file.

Webhooks are outbound only. The server still accepts no writes; data reaches it exclusively through the filesystem. Inspect the configuration with `contract webhooks --workspace <path>`, and send a test event with `--test`.

## Reports

| Format | Flag | Best for |
|--------|------|----------|
| JSON | `--output report.json` | Custom processing / downstream tooling |
| JUnit XML | `--junit results.xml` | GitHub Actions, GitLab, Azure DevOps, Jenkins dashboards |
| HTML | `--html report.html` | A shareable artifact a human opens |

### HTML run report

`--html` writes a **single self-contained file** (inline CSS, no external assets): a pass/fail headline and ratio bar, run metadata, and one expandable card per interaction with full violation detail. It is the same report the GUI's **Export HTML** button produces.

### Serving the dashboard

`contract report --serve [--port <n>]` starts a read-only HTTP server rendering the dashboard live (results re-read on every request), with each matrix cell linking to the full run report. See [Docker](docker.md#the-contract-dashboard) for running it as a container.

### HTML dashboard

`contract report` aggregates every recorded `can-i-deploy` result into a **pacticipant × version matrix**: the "can I ship this version?" view.

```bash
api-spector contract report --workspace . --html dashboard.html
```

---

## Pact interoperability

API Spector reads and writes standard [Pact](https://docs.pact.io/) files (v2/v3/v4), so it slots into an existing Pact ecosystem. The Pact file format and tooling are open source (MIT); only the hosted PactFlow broker is commercial, and the two features it charges for (bi-directional testing and `can-i-deploy`) have local equivalents here.

### Import a pact

```bash
api-spector contract pact-import --file web-pets.json --out collection.json
```

Each interaction becomes a runnable request: the request side maps to method/path/query/headers (the URL is prefixed with `{{baseUrl}}`), and the response side becomes a consumer contract: status, required headers, provider states, and a **body matcher** built from the pact's `matchingRules`. Set the `baseUrl` collection variable (or use `--provider-base-url`) and verify with `provider-live`.

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
