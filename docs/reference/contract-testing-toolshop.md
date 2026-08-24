<!-- Copyright (c) 2024-2026 Testsmith.io -->
<!-- SPDX-License-Identifier: MIT -->

# Contract testing, end to end: the Toolshop API

A concrete walkthrough of all three contract-testing variants against the real
**[Toolshop API](https://api.practicesoftwaretesting.com/api/documentation)**
(`api.practicesoftwaretesting.com`) — real endpoints, a real pact, real commands.
Everything here works **with or without** API Spector Cloud; the cloud steps are
marked **☁ Cloud** and the local steps **▢ Free**.

- **Provider**: `toolshop-api` — OpenAPI 3.2.0, served live at
  `https://api.practicesoftwaretesting.com/docs?api-docs.json`.
- **Consumer**: `product-listing` — a client that lists brands.

## The two artifacts

Contract testing compares two documents: the **pact** (what the consumer needs)
and the **spec** (what the provider offers). Everything below is built from one
real endpoint:

```
GET https://api.practicesoftwaretesting.com/brands/{brandId}  →  200
{ "id": "01M0NGYMKFAJW322ASNJZSWYYM", "name": "ForgeFlex Tools", "slug": "forgeflex-tools" }
```

The consumer depends on exactly this: a brand has an `id`, a `name`, and a `slug`.

## Which variant? Toolshop is a public API

Because Toolshop is **public**, a provider can't gather pacts from every unknown
consumer — so **consumer-driven contract testing is not the right fit**. Use
**bi-directional** (recommended) or **provider-driven**. Consumer-driven is shown
last, and only applies here because *you* own both sides of the demo.

> See [Contract Testing Workflows](contract-testing-workflows.md) for the
> conceptual model behind the three variants and the free/cloud split.

---

## 1. The consumer pact

Two interactions — list brands, and fetch one by id — matched **by type, not
value** so the real ULIDs and names don't make the contract brittle. Author it in
the desktop app's **Contract Designer** (Contracts panel → *Design a contract*),
then **Save to workspace** — it lands at
`pacts/product-listing-toolshop-api.pact.json`:

```json
{
  "consumer": { "name": "product-listing" },
  "provider": { "name": "toolshop-api" },
  "interactions": [
    {
      "description": "get all brands",
      "request":  { "method": "GET", "path": "/brands" },
      "response": {
        "status": 200,
        "body": [ { "id": "01M0NGYMKFAJW322ASNJZSWYYM", "name": "ForgeFlex Tools", "slug": "forgeflex-tools" } ],
        "matchingRules": { "body": {
          "$":         { "matchers": [{ "match": "type", "min": 1 }] },
          "$[*].id":   { "matchers": [{ "match": "type" }] },
          "$[*].name": { "matchers": [{ "match": "type" }] },
          "$[*].slug": { "matchers": [{ "match": "type" }] }
        } }
      }
    },
    {
      "description": "get brand by id",
      "providerStates": [ { "name": "brand 01M0NGYMKFAJW322ASNJZSWYYM exists" } ],
      "request":  { "method": "GET", "path": "/brands/01M0NGYMKFAJW322ASNJZSWYYM" },
      "response": {
        "status": 200,
        "body": { "id": "01M0NGYMKFAJW322ASNJZSWYYM", "name": "ForgeFlex Tools", "slug": "forgeflex-tools" },
        "matchingRules": { "body": {
          "$.id":   { "matchers": [{ "match": "type" }] },
          "$.name": { "matchers": [{ "match": "type" }] },
          "$.slug": { "matchers": [{ "match": "type" }] }
        } }
      }
    }
  ],
  "metadata": { "pactSpecification": { "version": "3.0.0" } }
}
```

The Contract Designer emits this exact shape (type matchers, provider states)
from the fields you fill in — no endpoint required.

---

## 2. Bi-directional (recommended for a public API)

Publish the provider's spec, publish the consumer's pact, statically compare
`pact ⊆ spec` — nobody runs the other's code.

### Step 1 — Provider publishes the Toolshop spec

The spec is the one the API already serves.

```bash
# ▢ Free — pin the spec into the workspace (git-tracked)
api-spector contract publish-spec --workspace ./toolshop.spector \
  --provider toolshop-api \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"

# ☁ Cloud — publish to the broker
api-spector contract publish-spec --broker \
  --provider toolshop-api \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"
```

In the app: **Contracts** panel → *Provider / Bi-directional* mode → paste the
spec URL → **Pin** (local) or **Publish spec to cloud**.

### Step 2 — Consumer publishes the pact

Locally the pact is just the `pacts/…json` file from step 1. To share it via the
broker:

```bash
# ☁ Cloud
api-spector contract publish --broker --workspace ./toolshop.spector \
  --consumer product-listing --provider toolshop-api
```

### Step 3 — Compare (pact ⊆ spec)

```bash
# ▢ Free — runs the static compare locally
api-spector contract run --workspace ./toolshop.spector --mode bidirectional \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"
# ✓ GET /brands       → 200 [ { id, name, slug } ]  covered by the spec
# ✓ GET /brands/{id}  → 200 { id, name, slug }       covered by the spec
```

**☁ Cloud** runs the same compare automatically on publish (the `BdctVerifier`)
and shows it on the **Matrix**.

### Step 4 — Gate the deploy

```bash
# ▢ Free — file-based gate in the workspace (--app-version keys the check)
api-spector contract deploy-check --workspace ./toolshop.spector \
  --pacticipant product-listing --app-version "$(git rev-parse HEAD)" --to production

# ☁ Cloud — gate against what's actually live in prod (version defaults to the git SHA)
api-spector contract deploy-check --broker \
  --pacticipant product-listing --environment production
```

### What a break looks like

One of the Toolshop **`5-with-bugs`** builds renames `name` → `title` on a brand.
The compare fails — `$.name not found in the provider spec` — the Matrix goes red,
and `deploy-check` blocks the release. This is the evolving-contract story across
the six Toolshop versions, now automated.

---

## 3. Provider-driven (consumer conforms to the spec)

Same spec, but now the provider's spec is the source of truth and consumers stay
inside it — building against a mock of the spec **before** hitting the real API.

### Step 1 — Provider publishes the spec

Same `publish-spec` command as in variant 2 (free pin or `--broker`).

### Step 2 — Consumer develops against a spec-mock

Serve a mock generated from the Toolshop spec and point `product-listing` at it.
An undeclared call `404`s, so drift surfaces before you touch the real service.
(This is the one-click equivalent of loading a pact into a `MockHttpServer` stub
by hand.)

```bash
# ▢ Free — in the app: Import OpenAPI (the Toolshop spec URL) → save it as a mock
#          in your workspace, then serve it:
api-spector mock --workspace ./toolshop.spector --name "toolshop-api mock"

# ☁ Cloud — a hosted mock generated from the published spec
curl -X POST "$API_SPECTOR_CLOUD_ENDPOINT/api/mocks/from-spec/toolshop-api" \
  -H "Authorization: Bearer $API_SPECTOR_TOKEN"
```

The mock serves the spec's shape straight back:

```
GET http://localhost:4100/brands  →  200        (served from the spec)
[ { "id": "01M0NGYMKFAJW322ASNJZSWYYM", "name": "ForgeFlex Tools", "slug": "forgeflex-tools" } ]

GET http://localhost:4100/brands/nope           (undeclared) →  404
```

### Step 3 — Consumer checks conformance

Does `product-listing` stay inside the spec (no undeclared params, statuses, or
shapes)? `200` = yes, `422` = no.

```bash
# ▢ Free — static conformance check against the pinned spec (no HTTP)
api-spector contract run --workspace ./toolshop.spector --mode provider \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"

# ☁ Cloud — conformance endpoint
curl -f -X POST "$API_SPECTOR_CLOUD_ENDPOINT/api/conformance" \
  -H "Authorization: Bearer $API_SPECTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "provider": "toolshop-api",
        "content": { "interactions": [
          { "description": "list brands", "request": { "method": "GET", "path": "/brands" },
            "response": { "status": 200 } } ] } }'
```

**What it catches:** `product-listing` starts calling `GET /brands?discontinued=true`
— a filter the Toolshop spec never declares. Conformance returns **422** and CI
fails, before anything ships.

---

## 4. Consumer-driven (demo only)

The provider **replays** the consumer's pact against the *running* Toolshop API —
real runtime proof it delivers what the consumer needs. Strongest guarantee, but
it needs known consumers: it applies here **only because you own both sides of the
demo**. For a genuinely public API, use variant 2 or 3.

### Step 1 — Publish the pact

The same pact from section 1 (from the Contract Designer, or `contract publish
--broker`).

### Step 2 — Provider states

The `get brand by id` interaction assumes `brand 01M0NGYMKFAJW322ASNJZSWYYM exists`.
Toolshop's seed data already includes that brand (**ForgeFlex Tools**), so the state
is satisfied read-only. When a state *does* need setup, register a setup request —
run against the provider's own API, never its database:

```bash
# ☁ Cloud — register the provider-state setup for the replay runner
curl -X PUT "$API_SPECTOR_CLOUD_ENDPOINT/api/provider-states/toolshop-api" \
  -H "Authorization: Bearer $API_SPECTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "states": { "brand 01M0NGYMKFAJW322ASNJZSWYYM exists": { "method": "GET", "url": "/brands/01M0NGYMKFAJW322ASNJZSWYYM" } } }'
```

### Step 3 — Replay the pact against the running provider

For each interaction: run the state setup, send the request to the live API, and
check the real response satisfies the pact (Postel: the response must contain *at
least* what the pact expects, types matched).

```bash
# ▢ Free — replay locally against the live Toolshop API
api-spector contract run --workspace ./toolshop.spector --mode provider-live \
  --provider-base-url "https://api.practicesoftwaretesting.com"
# ✓ get all brands   → 200, response contains id, name, slug (types match)
# ✓ get brand by id  → 200, response contains id, name, slug (types match)
```

**☁ Cloud** runs the same replay on a private **verify-runtime** agent inside your
network (register a verify job with `PUT /api/verify-jobs`), so the provider can be
behind a firewall. Results land on the same Matrix and feed `deploy-check`.

**What it catches (that BDCT can't):** a deployed Toolshop build that, despite what
its spec *claims*, actually returns `title` instead of `name`. The replay hits the
running service and fails — `$.name: missing in response` — catching the
**deployed** provider drifting from a real consumer expectation.

---

## In CI — publish, gate, record

Uploading is one command and one token. **Auth, once:** create a token in the
cloud dashboard → *Tokens*, add it to CI as the secret `API_SPECTOR_TOKEN`. No
install step — `npx --yes @testsmith/api-spector` runs the CLI. Every publish is
keyed to the **git SHA** automatically.

```yaml
# .github/workflows/contract.yml — shared env
env:
  API_SPECTOR_TOKEN: ${{ secrets.API_SPECTOR_TOKEN }}
  # API_SPECTOR_CLOUD_ENDPOINT: https://your-host   # only for a self-hosted broker
```

**Provider repo** (`toolshop-api`) — upload the spec on every merge. "Upload" is
`publish-spec --broker`: it fetches the spec and PUTs it to the broker.

```bash
npx --yes @testsmith/api-spector contract publish-spec --broker \
  --provider toolshop-api \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"

# block a provider change that would break a live consumer
npx --yes @testsmith/api-spector contract deploy-check --broker \
  --pacticipant toolshop-api --environment production
```

**Consumer repo** (`product-listing`) — upload the pact, gate, record.

```bash
# 1 · upload the pact (built from the workspace's Contract-tab expectations)
npx --yes @testsmith/api-spector contract publish --broker \
  --workspace ./toolshop.spector \
  --consumer product-listing --provider toolshop-api

# 2 · gate: can product-listing@<sha> go to prod against what's live there?
#      exit 1 (pipeline fails) if the provider no longer offers what you need
npx --yes @testsmith/api-spector contract deploy-check --broker \
  --pacticipant product-listing --environment production

# 3 · after the real deploy succeeds, record it so the next gate compares to reality
npx --yes @testsmith/api-spector contract record-deployment --broker \
  --pacticipant product-listing --environment production
```

On a pull request, swap the opaque 409 for a comment:
`contract preview --pacticipant product-listing --environment production` prints a
markdown summary naming what would break and who it affects.

| Stage | Command | Who runs it |
| --- | --- | --- |
| Upload the spec | `contract publish-spec --broker` | provider CI, on merge |
| Upload the pact | `contract publish --broker` | consumer CI, on merge |
| Gate the deploy | `contract deploy-check --broker` | both, before release (exit 1 = blocked) |
| Record the deploy | `contract record-deployment --broker` | after a successful release |
| PR comment | `contract preview` | on `pull_request` |

**Without the cloud — no upload, just git.** Commit the pact (`pacts/…json`) and
the pinned spec into the repo; CI verifies and gates from the files:

```bash
npx --yes @testsmith/api-spector contract run --workspace ./toolshop.spector --mode bidirectional \
  --spec-url "https://api.practicesoftwaretesting.com/docs?api-docs.json"
npx --yes @testsmith/api-spector contract deploy-check --workspace ./toolshop.spector \
  --pacticipant product-listing --app-version "$(git rev-parse HEAD)" --to production
```

A ready-to-copy GitHub Actions workflow (publish → gate → record, plus the PR
comment) ships in [`docs/ci/contract-testing.yml`](../ci/contract-testing.yml).

## Versioning

Version every publish by **git SHA** (like Pact's "commit number"), not the
OpenAPI version number — one pact and one spec per commit. That gives you the
evolving-contract history across the six Toolshop versions for free, and lets
`deploy-check` reason about exactly which commit is where.

```bash
--version "$(git rev-parse HEAD)"   # the CLI defaults to this (and CI env vars)
```

## Add these tests later — the drop-in

1. **Pin/publish the spec** — `publish-spec --provider toolshop-api --spec-url "…/docs?api-docs.json"`.
2. **Save the consumer pact** from the Contract Designer into `pacts/`.
3. **Verify** — `contract run --mode bidirectional` (free) or publish both to the broker (cloud).
4. **Gate CI** — `deploy-check --pacticipant product-listing --app-version "$(git rev-parse HEAD)" --to production` (local) or `--broker … --environment production` (cloud).
5. **Version by git SHA** — one artifact per commit.

## See also

- [Contract Testing Workflows](contract-testing-workflows.md) — the three variants and the free/cloud split
- [Contract Testing Types](contract-testing-types.md)
- [Pact Compatibility & Matchers](pact-compatibility.md)
- [Contract Testing (GUI)](../gui/contract-testing.md) · [Contract Testing (CLI)](../cli/contract-testing.md)
