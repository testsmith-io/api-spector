# Contract Testing Types

"Contract testing" covers three distinct approaches that differ in **who authors the contract** and **which side is verified against it**. This page defines the three industry-standard types, maps each to API Spector's modes, and explains how to pick one.

A *contract* is an agreement about an API interaction: request shape in, and status / headers / body shape out. A *consumer* is whoever calls the API; the *provider* is whoever serves it.

---

## Consumer-driven contract testing (CDCT)

**The consumer writes the contract. The provider is verified against it.**

Each consumer records exactly what it relies on: "when I `GET /users/1`, I need a `200` with an `id` (integer) and a `name` (string)". The provider team then replays every consumer's contract against their service; they may not break any field a consumer declared, but can freely change anything nobody declared. This is the model made famous by [Pact](https://pact.io): contracts flow from consumer to provider, and the provider's CI fails when a change would break a real consumer.

**In API Spector:**

| Step | Feature |
|---|---|
| Consumer declares expectations | The **Contract tab** on each request (expected status, required headers, body schema or Pact-style body matchers; `⚡ Infer from response` gets you started) |
| Consumer validates its own assumptions | **Consumer mode**: sends each request live and asserts the response matches the expectation |
| Provider is verified against consumer contracts | **Provider-live mode**: replays every contract-carrying request against a provider base URL, with [provider state](../cli/contract-testing.md#provider-states) setup/teardown between interactions. This is the real Pact-style provider verification |
| Contracts travel between teams | **Pact import/export** (`contract pact-import` / `pact-export`): exchange standard Pact v2/v3/v4 files with teams using Pact tooling |

**Commands** (consumer `product-listing`, provider `toolshop-api`):

```bash
# 1 · consumer publishes its pact (cloud broker, keyed to the git SHA)
api-spector contract publish --broker --workspace ./toolshop.spector \
  --consumer product-listing --provider toolshop-api

# 2 · provider replays the pact against the running service; --record stores the verdict
api-spector contract run --workspace ./toolshop.spector --mode provider-live \
  --provider-base-url "https://api.practicesoftwaretesting.com" \
  --states-url "https://api.practicesoftwaretesting.com/_states" \
  --record --pacticipant toolshop-api --app-version "$(git rev-parse HEAD)"

# 3 · gate the deploy (local file-based; add --broker to gate across teams)
api-spector contract deploy-check --workspace ./toolshop.spector \
  --pacticipant toolshop-api --app-version "$(git rev-parse HEAD)" --to production
```

`run --mode provider-live` is always local — it replays on your machine; the cloud enters only at *publish* and *gate* time (a hosted `verify-runtime` agent can run the same replay behind a firewall). Needs a **known** set of consumers, so it is not for public APIs.

## Provider-driven contract testing

**The provider publishes the contract (an OpenAPI spec). Consumers are verified against it.**

Here the spec is the source of truth: the provider documents what it offers, and each consumer checks that its requests are well-formed against that document: right paths, right body shapes, required parameters present. The check is static; nothing is deployed or called. Weakness: it proves your *requests* are valid, not that the provider actually behaves as documented.

**In API Spector:**

| Step | Feature |
|---|---|
| Provider publishes a spec | Any OpenAPI 3.x document, by URL or file |
| Consumer verifies its collection against it | **Provider mode**: static analysis of every request against the spec, no HTTP |
| Pin the exact spec version you develop against | **Snapshots**: `Pin` in the GUI or `api-spector contract pin` in the CLI capture a verbatim, sha256-stamped copy under `contracts/` in your workspace (commit it to git). Verify against the pinned version even after the provider ships changes, and review spec diffs before you upgrade |

**Commands** (consumer `product-listing` conforms to provider `toolshop-api`'s spec):

```bash
# 1 · provider pins / publishes its spec (add --broker to publish to the cloud broker)
api-spector contract publish-spec --workspace ./toolshop.spector \
  --provider toolshop-api \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"

# 2 · consumer checks its requests conform to the spec (static, no HTTP)
api-spector contract run --workspace ./toolshop.spector --mode provider \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"

# 3 · gate the consumer against the provider spec live in the target environment
api-spector contract deploy-check --workspace ./toolshop.spector \
  --pacticipant product-listing --app-version 3.8.0 --to production
```

Consumers can also develop against a mock generated from the spec (`api-spector mock`), so an undeclared call surfaces as a 404 before you touch the real API. Medium guarantee: it holds consumers to a *declared* spec, but nothing proves the spec matches the provider's real behavior.

## Bi-directional contract testing (BDCT)

**Both sides publish an artifact; a static compatibility check cross-verifies them.**

The consumer publishes its expectations, the provider publishes its OpenAPI spec, and a comparison proves the consumer's required subset fits inside what the provider offers, without either side running the other's tests. This is the model PactFlow introduced: cheaper to adopt than full CDCT (the provider doesn't need to run consumer contracts in its CI), while still catching incompatibilities before deployment.

**In API Spector:** **Bi-directional mode** does both checks per request:

1. **Static compatibility**: every field the consumer *requires* (from its body schema, or from its body matchers compiled to a schema) must exist in the provider spec's documented response with a compatible type. Extra provider fields are fine.
2. **Live verification**: the request is also sent and the response validated against the consumer contract, so you catch spec-vs-reality drift in the same run.

**Commands** (both sides publish independently, then a static compare):

```bash
# 1 · provider publishes the spec, consumer publishes the pact (independently)
api-spector contract publish-spec --broker --provider toolshop-api \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"
api-spector contract publish --broker --workspace ./toolshop.spector \
  --consumer product-listing --provider toolshop-api

# 2 · static compatibility: does the pact fit inside the spec?
api-spector contract run --workspace ./toolshop.spector --mode bidirectional \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"
# cloud: ask the broker whether one named pair is compatible (read-only, exit 1 = no)
api-spector contract check \
  --consumer product-listing --consumer-version 2.4.0 \
  --provider toolshop-api --provider-version 6.1.0

# 3 · gate the deploy (env-aware; add --broker for the shared cross-team gate)
api-spector contract deploy-check --workspace ./toolshop.spector \
  --pacticipant product-listing --to production
```

`contract check` compares *one pair of artifacts* (are these two compatible?); `deploy-check` is *environment-aware* (given everything live in the target env, is this version safe to ship?). The lightest, cheapest variant — only the two documents you already produce, no runtime — and the recommended starting point, including for public APIs.

---

## Choosing a type

| | Consumer-driven | Provider-driven | Bi-directional |
|---|---|---|---|
| Contract author | Consumer | Provider (spec) | Both |
| What is verified | Provider, against consumer needs | Consumer requests, against the spec | Compatibility of the two artifacts (+ live check) |
| Needs a running provider | Yes (provider-live) | No, fully static | Only for the live half |
| Catches provider breaking a consumer | ✓ precisely (only declared fields) | Only if the spec changes | ✓ statically |
| Catches consumer sending bad requests | No | ✓ | partially |
| Provider team buy-in required | High (runs consumer contracts in CI) | None | Low (just publish an accurate spec) |
| API Spector modes | `consumer`, `provider-live` | `provider` (+ snapshots) | `bidirectional` |

Practical guidance:

- **You consume a third-party API you don't control** → provider-driven: pin their spec, run `provider` mode in CI, and `consumer` mode to detect behavioral drift the spec doesn't capture.
- **Your org owns both sides and wants strong guarantees** → consumer-driven: contracts on the consumer side, `provider-live` in the provider's CI, exchange via Pact files if the other team uses Pact.
- **You want cross-team safety without asking the provider team to run your tests** → bi-directional: they keep their spec accurate, you run `bidirectional` mode.

All four modes produce the same `ContractReport` (JSON / JUnit / HTML via the [CLI](../cli/contract-testing.md#reports)), and results can be recorded per pacticipant + version for the [`deploy-check` gate](../cli/contract-testing.md#deploy-check-the-deployment-gate).

---

## Do you need a contract broker?

Tools like the **Pact Broker** exist to share contracts and verification results *between repositories and teams*: consumers publish pacts, providers fetch and verify them, results land in a compatibility matrix, and `can-i-deploy` queries that matrix before a release.

API Spector ships a file-based, git-native equivalent instead of a server:

- **Contracts and pinned specs live in the workspace** (`contracts/*.contract.json`, request contracts in the collection files), versioned, diffed, and shared through the git repo itself.
- **Verification results** are recorded per pacticipant/version under `contracts/results/` by `contract run --record`.
- **`api-spector contract deploy-check`** reads those recorded results as a deployment gate (fail-closed), and **`contract report`** renders the compatibility dashboard.

For a single repo or a small set of repos sharing a workspace, git *is* the broker. If your organization already runs a real Pact Broker, use `pact-export` to publish contracts to it with the standard Pact CLI, and `pact-import` to bring pacts from it into a collection.

---

## How this compares to PactFlow

[PactFlow](https://pactflow.io) (SmartBear) is the commercial, hosted evolution of the open-source Pact Broker. API Spector's contract stack covers the same core workflow with a different architecture: PactFlow is a SaaS platform your pipelines talk to; API Spector is local-first with git as the transport.

### Feature by feature

| Capability | PactFlow | API Spector |
|---|---|---|
| Consumer contracts | Pact files, published to the broker | Contract tab on each request; Pact v2/v3/v4 import & export |
| Provider verification (CDCT) | Pact libraries verify in provider CI, results published back | `provider-live` mode: replays contracts against a running provider, with provider states |
| Bi-directional contract testing | Paid feature: consumer pact statically compared against the provider's uploaded OpenAPI spec; the spec is "proven" by the provider's own uploaded test results | `bidirectional` mode: the same static contract-vs-spec comparison, plus a **live verification in the same run**, so the API itself proves the spec and there is no self-attestation step |
| Spec pinning | Provider uploads spec versions to the platform | `contract pin` snapshots the spec into the workspace (sha256-stamped, git-committed) |
| `can-i-deploy` | Queries the hosted compatibility matrix | Local command over recorded results in `contracts/results/` (fail-closed) |
| Dashboard / matrix | Hosted web UI | Static HTML export (`contract report --html`), publishable as a CI artifact |
| Result recording | `pact publish` / verification uploads over HTTP | CLI `--record` or the Record button in the app; results are files |
| Sharing between teams | Central server, API tokens | Git: commit contracts + results, pull to see them |
| Webhooks (new contract triggers provider CI) | Built in | Built in: outbound webhooks configured in `contracts/webhooks.json` (`contract webhooks --test`) |
| Spec-driven fuzzing (malformed inputs, never-5xx oracle) | Not built in | Built in: `contract fuzz`, generates malformed requests from the spec |
| Environment & deployment tracking (`record-deployment`, "what's in prod") | Built in | Built in: `record-deployment` / `environments` commands, environment files in git, dashboard view |
| WIP / pending pacts (soft-fail for new consumers) | Built in | Built in: `contract run --allow-pending` with a git-tracked first-pass ledger |
| Auth, teams, RBAC, audit | Built in (SaaS) | Git repository permissions |
| Cost / hosting | Commercial SaaS (free tier limits) | MIT, no server, no accounts |

### Centralized vs decentralized

PactFlow centralizes: contracts, verification results, and deploy decisions live on their platform. That gives you organization-wide visibility, webhooks, and environment tracking, and it means every workflow runs through a hosted service. API Spector decentralizes: every artifact is a file in your repo, every decision is reproducible offline, and "publishing" is a git push. No data leaves your machines; the dashboard container cannot even accept a write.

PactFlow is the stronger option for **many independent teams** that need cross-repo discovery, deployment tracking, and automated provider triggers. API Spector is the stronger option when you want **contract testing without new infrastructure**: one tool for exploring, testing, mocking, and contracts, with the audit trail your repo already provides.

The two interoperate rather than compete: `pact-export` produces standard Pact files a PactFlow/Pact Broker instance accepts, and `pact-import` consumes pacts coming out of one, so adopting either later doesn't strand your contracts.
