# Contract Testing (CLI)

Everything the [Contract Testing](../gui/contract-testing.md) panel does is available headlessly through `api-spector contract`, plus extras that only make sense in CI: a deployment gate (`deploy-check`), Pact file import/export, and machine-readable reports (JUnit, JSON, HTML).

```
api-spector contract list          --workspace <path>
api-spector contract pin           --workspace <path> --spec-url <url> | --spec-path <file> [--name <label>]
api-spector contract run           --workspace <path> --mode <mode> [options]
api-spector contract report        --workspace <path> [--html <path>]
api-spector contract deploy-check  --workspace <path> --pacticipant <name> --app-version <ver> [--to <env>]
api-spector contract check         --consumer <name> --consumer-version <ver> --provider <name> --provider-version <ver>
api-spector contract publish-verification --consumer <name> --provider <name> --provider-version <ver> --success <bool>
api-spector contract record-deployment --workspace <path> --pacticipant <name> --app-version <ver> --env <name>
api-spector contract environments  --workspace <path>
api-spector contract webhooks      --workspace <path> [--test]
api-spector contract fuzz          --workspace <path> --provider-base-url <url> [options]
api-spector contract pact-import   --file <pact.json> [--out <collection.json>]
api-spector contract pact-export   --workspace <path> --out <pact.json> [options]
```

Exit code `0` = all checks passed, `1` = failures, `2` = bad invocation. Pipelines fail automatically on non-zero exit.

---

## Local vs cloud

Contract testing works two ways, over the same contracts and commands:

- **Local (free, the default).** Everything is file-based and git-native — no account, no token. `contract run` verifies against a provider or spec on your machine; `--record` writes the verdict into the workspace (`contracts/results/…`); the deploy gate and deployment records read and write those files; `pin` snapshots a spec into git. This gates a single repo/CI perfectly.
- **Cloud (the broker).** [API Spector Cloud](https://api-spector.dev) is the shared source of truth for when consumer and provider are different teams, repos, and pipelines. You **publish** contracts and specs to it, it verifies-on-publish and hosts the dependency **Matrix**, and a cross-service deploy gate checks every pipeline against what's actually live. Reached by adding `--broker` and authenticating with a token.

> **`contract run` itself is always local** — it replays / compares on your machine and never calls the broker. The cloud enters at *publish* and *gate* time; cloud-side verification (replaying against your provider) is done by a hosted or private **verify-runtime agent**, not `contract run`.

| Concern | Local (free) | Cloud (`--broker`) |
|---|---|---|
| Verify a contract | `contract run` (this page) | `verify-runtime` agent; verify-on-publish (bi-directional) |
| Store the result | `--record` → `contracts/results/*.json` (git) | published to the broker, shown on the Matrix |
| Publish a contract / spec | committed under `pacts/`; `contract pin` | `contract publish`; `contract publish-spec --broker` |
| Deploy gate | `contract deploy-check --workspace …` | `contract deploy-check --broker …` (Matrix + live prod) |
| Record a deployment | `contract record-deployment --workspace …` | `contract record-deployment --broker …` |
| Auth | none | `API_SPECTOR_TOKEN` (self-host: `API_SPECTOR_CLOUD_ENDPOINT`) |

The cloud is **additive**: the free CLI is complete on its own, and each cloud-capable command falls back to its local, file-based behaviour when no `--broker` flag or token is set.

> The gate is `deploy-check`; `can-i-deploy` (used in the examples below and by the wider Pact ecosystem) is a compatible alias for the same command.

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
| `--workspace <path>` | all | The workspace to load — the `.spector` file, or a folder containing one. **Required.** |
| `--mode <mode>` | all | `consumer` \| `provider` \| `provider-live` \| `bidirectional` (see [Modes](#modes)) |
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
| `--record` | all | Record the result for `deploy-check` |
| `--pacticipant <name>` | all | Name to record under (default: the collection name) |
| `--app-version <ver>` | all | Version to record under (**required** with `--record`) |
| `--allow-pending` | all | Failures of never-verified interactions report as pending instead of blocking (see [Pending contracts](#pending-contracts)) |

### Every argument, explained

A full `provider-live` run, with each argument spelled out:

```bash
npx api-spector contract run \
  --workspace ./new-api.spector \
  --mode provider-live \
  --provider-base-url "https://api.practicesoftwaretesting.com" \
  --record --app-version 1.0.0 \
  --pacticipant toolshop-api
```

- **`--workspace ./new-api.spector`** — the workspace to load. `contract run` reads its collections, environments, and design-first contracts from here. Pass the `.spector` file itself, or a folder that contains one.
- **`--mode provider-live`** — *how* to verify. `provider-live` replays each consumer interaction against a **running** provider and checks that the real response satisfies the contract (status + body, matched by type). The four modes — `consumer`, `provider`, `provider-live`, `bidirectional` — are described under [Modes](#modes).
- **`--provider-base-url "https://api.practicesoftwaretesting.com"`** — the running provider to replay against. Each interaction's path is rebased onto this origin, so a contract for `/brands` is sent to `https://api.practicesoftwaretesting.com/brands`. **Required for `provider-live`.**
- **`--record`** — persist the pass/fail verdict to `contracts/results/<pacticipant>/<app-version>.json` in the workspace, so [`deploy-check`](#deploy-check-the-deployment-gate) can gate on it later. Without `--record`, the run just prints its result and exits (non-zero if anything failed).
- **`--app-version 1.0.0`** — the version this result belongs to: a release tag, build number, or git SHA. **Required whenever `--record` is set** — it is the key `deploy-check` looks the result up by. In CI, use the commit: `--app-version "$(git rev-parse HEAD)"`. In a folder with no git history that command expands to *nothing* and `--record` errors with `--record requires --app-version`, so pass a literal version there.
- **`--pacticipant toolshop-api`** — which application the result is recorded under (here, the provider being verified). Defaults to the collection name. A later `deploy-check --pacticipant toolshop-api` reads exactly this.

**Where the interactions come from:** `contract run` gathers what to verify from two places in the workspace — **collections** (requests that carry a Contract) **and** **design-first contracts** (the Contract Designer's `designContracts` plus any `pacts/*.json`), with no manual `pact-import`. When the latter contribute, the run prints a `+ N design-first interaction(s)` line.

> Two other flags you may add here: **`--states-url <url>`** seeds provider state before any interaction that declares one (it is never called otherwise), and **`--html` / `--junit` / `--output`** write reports for humans or CI. See the table above.

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

## `check`: the compatibility check (vs `deploy-check`)

Two *different* questions:

- **`contract check`** — *pairwise* and **read-only**: is `consumer@version` compatible with `provider@version`? It compares the consumer's published pact against that exact provider spec version via the broker's compatibility engine, records nothing, and ignores what's deployed. Exit `0` = compatible, `1` = incompatible (with per-field reasons).
- **`deploy-check`** — the *deployment* gate: is a version safe to ship to an environment given **everything currently deployed there** and its verification results (see below).

```bash
# Cloud (--broker / API_SPECTOR_TOKEN): compatibility of two specific versions
api-spector contract check \
  --consumer webshop-ui --consumer-version 2.4.0 \
  --provider orders-api --provider-version 6.1.0
# ✗ webshop-ui@2.4.0 is INCOMPATIBLE with orders-api@6.1.0
#     get order
#       response.body.status: consumer requires string, provider integer
```

Backed by `GET /api/compatibility?consumer&consumerVersion&provider&providerVersion` (200 compatible / 409 incompatible).

**Publishing a provider verification result** — when the provider verifies a consumer's pact in its own CI, publish the verdict so the Matrix and `deploy-check` see it:

```bash
api-spector contract publish-verification \
  --consumer webshop-ui --provider orders-api \
  --provider-version "$(git rev-parse HEAD)" --success true [--build-url "$CI_URL"]
```

It resolves the contract via the broker and records the result against the provider version (`POST /api/verifications`).

## `deploy-check`: the deployment gate

The deployment gate — **file-based locally, or against the shared cloud broker** with `--broker`. It answers one question: is a given version safe to ship, i.e. is every contract it shares with what's live still satisfied?

```bash
# LOCAL (free): record a result during a run, then gate from the workspace files
api-spector contract run --workspace . --mode provider-live \
  --provider-base-url http://localhost:3000 \
  --record --pacticipant pets-api --app-version "$GIT_SHA"

api-spector contract deploy-check --workspace . \
  --pacticipant pets-api --app-version "$GIT_SHA" --to production

# CLOUD (--broker): gate against the shared Matrix + what's live in prod
api-spector contract deploy-check --broker \
  --pacticipant pets-api --environment production
```

```
  ✓ Computer says yes - safe to deploy.
  pets-api@1a2b3c4 passed all 12 contract checks (verified 2026-06-26T22:00:00.000Z).
```

- Exit `0` when the version is safe to deploy; exit `1` otherwise (CI stops).
- **Fails closed:** an unknown pacticipant/version is *not* deployable, so a missing verification can never wave a release through.
- **Local** uses `--to <env>` and reads recorded results in the workspace; **cloud** (`--broker`) uses `--environment <env>`, reads the broker Matrix, and defaults the version to the git SHA.

Results are stored under `<workspace>/contracts/results/<pacticipant>/<version>.json`. They are safe to commit, and they are the input to the dashboard below.

> **Scope:** this is the **local** gate (per-workspace), which gates a single repo/CI well. For a shared cross-team gate — one broker that knows every consumer, provider, and environment — publish to [API Spector Cloud](https://api-spector.dev) and add `--broker` (see [Local vs cloud](#local-vs-cloud)).

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
api-spector contract deploy-check --workspace ./ws \
  --pacticipant web-app --app-version 1.3.0 --to prod
```

`record-deployment` never blocks: it documents a fact. If the recorded version has no passing verification it prints a warning, because that means the `deploy-check` gate was skipped. The intended pipeline order is: verify with `--record`, gate with `deploy-check`, deploy, then `record-deployment`.

The dashboard (static export via `--html`) renders an Environments table showing each deployment with a pass/fail badge linking to its verification run.

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

Configure outbound webhooks in `contracts/webhooks.json` to notify other systems (e.g. trigger a provider's CI) about recorded results and deployments:

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

Webhooks are outbound only. `$NAME` tokens in URLs and header values are replaced from the process environment, so secrets stay out of the committed file. Inspect the configuration with `contract webhooks --workspace <path>`, and send a test event to each configured URL with `--test`.

## Reports

| Format | Flag | Best for |
|--------|------|----------|
| JSON | `--output report.json` | Custom processing / downstream tooling |
| JUnit XML | `--junit results.xml` | GitHub Actions, GitLab, Azure DevOps, Jenkins dashboards |
| HTML | `--html report.html` | A shareable artifact a human opens |

### HTML run report

`--html` writes a **single self-contained file** (inline CSS, no external assets): a pass/fail headline and ratio bar, run metadata, and one expandable card per interaction with full violation detail. It is the same report the GUI's **Export HTML** button produces.

### HTML dashboard

`contract report` aggregates every recorded `deploy-check` result into a **pacticipant × version matrix**: the "can I ship this version?" view.

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
        run: api-spector contract deploy-check --workspace . --pacticipant pets-api --app-version "$GITHUB_SHA"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: contract-report
          path: |
            contract-results.xml
            contract-report.html
```

For the general pipeline setup (secrets, other CI systems), see **[Pipeline Integration](cicd.md)**.
