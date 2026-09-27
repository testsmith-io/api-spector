# Contract Testing

Contract testing verifies that a consumer (your API collection) and a provider (the real API) agree on a shared contract: the expected status codes, response headers, and response body shapes. The Contracts panel has three tabs: **Consumer**, **Provider**, and **Bi-directional**.

Think of it as **who owns the definition of "correct"**. For how these modes map to the industry terms (consumer-driven, provider-driven, and bi-directional contract testing) and how to choose between them, see **[Contract Testing Types](../reference/contract-testing-types.md)**.

> **New in this release:** design-first consumer contracts (author them without an endpoint), live provider verification with provider states, Pact-style flexible matchers, Pact file import/export, HTML reports, and a local `deploy-check` gate. The CLI side of all of this is covered in **[Contract Testing (CLI)](../cli/contract-testing.md)**.

> **Looking for fuzzing?** It is no longer a contract mode. To fuzz an endpoint, use the per-request **fuzz** button next to Send; for a whole-suite sweep in CI, see **[Contract Testing (CLI) -> Fuzzing](../cli/contract-testing.md#fuzzing)**.

---

## The Modes

### Consumer mode

You define what you need. In a consumer contract you write down: "when I `GET /brands/{id}`, I need a `200`, a `content-type: application/json` header, and a body that has `id` (integer) and `name` (string)." You author these contracts design-first (see [Authoring a contract](#authoring-a-contract)); you do not need a spec file, and you are the source of truth. Consumer mode sends each interaction and checks whether the API delivers exactly what the contract requires.

**When to use:** Catching breaking changes after a deployment. Run it against two versions of the same API and see if anything you rely on has changed shape.

**Workflow:**
1. Author your consumer contracts with the Contract Designer (see [Authoring a contract](#authoring-a-contract)).
2. Open the Contracts panel, select **Consumer**, and click **Run**.
3. Expand any failing row to see exactly which field or header violated your contract.
4. Point your environment at a different API version and run again to compare.

#### Verifying against a running provider

Consumer mode is also where you do real **Pact-style provider verification**: instead of trusting the request URLs alone, you replay your contracts against a really-running provider and assert that its live responses satisfy each one. It answers "does this build of the provider actually honour the consumer's expectations?" Two optional fields turn it on:

1. **Provider base URL.** Enter an origin (e.g. `http://localhost:3000`) and every interaction is rebased onto it, keeping its path and query. This lets the same contracts verify any environment (local, staging, a PR preview) without editing them, and it is what supplies the host for host-less design-first contracts (a contract for `/brands` is sent to `http://localhost:3000/brands`).
2. **State handler URL.** When your contracts declare provider states (Pact's `given(...)`), point the run at a state handler endpoint. Before each interaction the tool POSTs `{ state, action: "setup" }` to that URL; afterwards it POSTs `{ state, action: "teardown" }`. A `PROVIDER STATE FAILED` violation means a required state could not be seeded (handler missing, unreachable, or non-2xx), and the interaction is not replayed.

**When to use:** Provider-side CI. The provider team runs this against a freshly built service to confirm it still satisfies every consumer contract before shipping.

> **Tip:** The state handler is a small endpoint you add to your provider (often only in test builds) that puts the database/fixtures into the named state. It mirrors Pact's "state change URL" exactly, so an existing Pact provider-states endpoint works as-is.

---

### Provider mode

The API publishes an OpenAPI spec. Provider mode reads that spec and checks whether your requests are well-formed: correct paths, correct body shapes, required query parameters present. No HTTP calls are made. It is purely static analysis.

You need the spec URL. You do not need to define any contract on your requests.

**When to use:** Validating your collection against a new API version before you even run anything. Point it at a v4 spec and find out immediately which of your requests would be rejected, without touching the network.

**Workflow:**
1. Open the Contracts panel, select **Provider**, and paste the OpenAPI spec URL (e.g. `https://api-v4.example.com/docs?api-docs.json`).
2. Click **Run**.
3. `UNKNOWN PATH` violations mean that path and method combination does not exist in the spec. Either the endpoint was removed, renamed, or your request URL points at the wrong server.
4. `REQUEST BODY INVALID` violations mean the request body does not match the spec's `requestBody` schema. Update the request to fix it.
5. No HTTP call is made, so you can run this without a live server.

> **Note:** Provider mode validates your *requests* against the spec, not the responses. It answers "am I calling the API correctly?" not "is the API returning what I expect?"

---

### Bi-directional mode

This combines both sides in a single run.

**Step 1: Static schema compatibility check.** The response body schema in your consumer contract is compared against the response schema documented in the provider's OpenAPI spec. If the contract uses body matchers instead of a schema, the matcher example is compiled to a type-level schema and compared the same way. Every field you *require* must exist in the provider schema with a compatible type. Extra provider fields are always allowed. No HTTP call needed for this step.

**Step 2: Live consumer verification.** The real request is sent and validated exactly as in Consumer mode.

Violations from both steps appear together in the results.

**When to use:** You have both a response contract and a provider spec, and you want a single run that confirms the two sides agree on paper *and* the live API actually delivers.

**Workflow:**
1. Author a consumer contract with a response body schema or matchers for each relevant interaction (see [Authoring a contract](#authoring-a-contract)).
2. Open the Contracts panel, select **Bi-dir**, and paste the spec URL.
3. Click **Run**.
4. `SCHEMA INCOMPATIBLE` violations mean the provider spec documents a different shape than what your contract expects. The schemas need to be reconciled.
5. `SCHEMA VIOLATION` violations mean the live response failed your schema. The API may not match its own spec.

---

## Applied example: comparing two API versions

You have two versions of the same API:

| Version | Base URL | Spec |
|---------|----------|------|
| v3 | `https://api.practicesoftwaretesting.com/` | `https://api.practicesoftwaretesting.com/docs?api-docs.json` |
| v4 | `https://api-v4.practicesoftwaretesting.com/` | `https://api-v4.practicesoftwaretesting.com/docs?api-docs.json` |

**Step 1: Author your consumer contracts against v3.**
Send requests against v3, then use **Send to contract designer** on each one to seed a design interaction pre-filled from its response, and relax the expectations to just the shapes you rely on.

**Step 2: Run Provider mode with the v4 spec.**
This immediately shows which of your requests use paths or parameters that no longer exist in v4, without making a single HTTP call. Any `UNKNOWN PATH` result means that endpoint moved or was removed.

**Step 3: Switch your environment URL to v4 and run Consumer mode.**
This shows which responses changed shape between versions. A `SCHEMA VIOLATION` means a field was removed, renamed, or changed type.

**Step 4: Run Bi-dir for the requests you care about most.**
This gives the full picture: schema compatibility between your expectations and the v4 spec, plus live verification that the API delivers what the spec promises.

---

## Authoring a contract

Consumer contracts are authored **design-first**, no endpoint required. Click **Design a contract (no endpoint needed)** at the top of the Contracts panel to open the **Contract Designer**.

In the Designer you build a `ConsumerContract`: you describe the requests a consumer will make and the responses it needs. Requests use path templates (`/brands/{id}`, no host needed), and responses are matched **by type** by default, which is the CDCT best practice: you pin the *shape* you depend on, not the exact values. The Designer compiles what you author to a Pact v3 document (publishable to the cloud and verifiable by the provider) and to a mock, and these design contracts feed the verification modes directly.

This is the way to author consumer contracts. (Legacy `request.contract` values in existing `.spector` files are still honoured when a run gathers interactions, but there is no longer a UI for authoring them on a request.)

### Seeding from an existing request

You do not have to start from a blank interaction. From any request (or from its response) choose **Send to contract designer** to pre-fill a new interaction with that request's method, path, and an inferred response shape. It is the quick way to turn something you just sent into a contract: send it, hand it to the Designer, then relax or adjust the expectations.

### Expected status code

Give each interaction the HTTP status code you expect (e.g. `200`, `201`, `404`). If the real response returns a different code, verification fails.

### Required response headers

List one or more headers the response must include.

| Column | Purpose |
|--------|---------|
| **Key** | Header name (case-insensitive) |
| **Value** | Expected value; leave blank to only check presence |
| **Required** | Toggle off to make the header optional (on by default) |

Header value comparison ignores parameters after `;`, so `application/json` matches `application/json;charset=UTF-8`.

### Body schema

An interaction's response expectation can carry a JSON Schema (draft-07) the response body must satisfy. When you seed from an existing response, an inferred schema is filled in as a starting point; tighten types or remove optional fields as needed.

### Body matchers (Pact-style)

A plain JSON Schema can be brittle: it either pins exact values or you hand-write `type` constraints everywhere. As an alternative you can supply a **body matcher**: an *example* document where any node can be relaxed with a matcher. This mirrors Pact's `like` / `eachLike` / `term` matchers and is what Pact files import into.

The default is **exact match**; wrap a value in a matcher to loosen it:

| Matcher | Meaning |
|---------|---------|
| `like(x)` | Value must be the same **type** as `x` (recurses into objects/arrays) |
| `eachLike(x, min)` | An **array** whose every item matches `like(x)`, with at least `min` items |
| `regex(re, eg)` | A **string** matching the regular expression `re` |
| `integer()` / `decimal()` | Numeric type matching |
| `boolean()` / `string()` | Boolean / any-string type matching |
| `datetime()` / `date()` / `time()` | A string in the corresponding format |

Matchers compile to JSON Schema under the hood, so they validate through the same engine as a hand-written schema and produce the same `SCHEMA VIOLATION` results. A body matcher and a body schema can both be set; both are checked. See **[Pact Compatibility & Matchers](../reference/pact-compatibility.md)** for the on-disk format and full matcher list.

---

## Reading the results

After clicking **Run**, a summary bar appears at the top of the center panel:

```
✓ All passed   12/12 passed   Consumer   342ms
```
```
✗ 2 failed   10/12 passed   Provider   289ms
```

Failed requests appear first. Each card is expandable and shows:

| Field | Description |
|-------|-------------|
| **PASS / FAIL** | Overall result for this request |
| **Method** | HTTP method, colour-coded |
| **Request name** | As named in the collection |
| **URL** | The resolved URL that was used |
| **Status** | Actual HTTP status code received |
| **Duration** | Round-trip time in milliseconds |
| **Issues** | Number of violations |

Expanding a card shows each violation with its type, path, message, and expected/actual values.

### Record a run for the dashboard

**Record** in the results bar saves the run under `contracts/results/<pacticipant>/<version>.json` in the workspace, exactly like the CLI's `contract run --record`. Give it a pacticipant name (defaults to the active collection) and a version. Recorded runs power two things:

- the [contract dashboard](../cli/contract-testing.md#html-dashboard) (`contract report --html`, a static file you can publish as a CI artifact) - the new cell appears the next time you export it
- the [`deploy-check` gate](../cli/contract-testing.md#deploy-check-the-deployment-gate)

Commit the results folder to git to share them with the team.

### Export an HTML report

Click **Export HTML** in the results bar to save a **self-contained HTML report** (inline styles, no external assets). It opens straight from disk and works well as a CI artifact or to share with teammates. It is the same report the CLI produces with `--html`. See **[Contract Testing (CLI) → Reports](../cli/contract-testing.md#reports)**.

---

## Violation reference

| Type | Meaning | Modes |
|------|---------|-------|
| `STATUS MISMATCH` | Response status did not match expected | Consumer, Bi-dir |
| `SCHEMA VIOLATION` | Response body failed JSON Schema / matcher validation | Consumer, Bi-dir |
| `MISSING HEADER` | Required header absent or wrong value | Consumer, Bi-dir |
| `REQUEST BODY INVALID` | Request body violates spec schema, or required query param missing | Provider, Bi-dir |
| `UNKNOWN PATH` | No matching operation in spec for this method and URL | Provider, Bi-dir |
| `SCHEMA INCOMPATIBLE` | Consumer's expected response schema conflicts with provider spec | Bi-dir |
| `PROVIDER STATE FAILED` | A required provider state could not be seeded before replay | Consumer (against a live provider) |

---

## Tips

- **Start with Consumer mode** before you have a spec. Design a contract and run it; no spec file required.
- **Provider mode needs no live server.** Run it in CI to detect spec drift before deployment.
- **Consumer mode with a Provider base URL is for the provider's CI.** Point it at a freshly built service to prove it still satisfies every consumer contract before shipping, and add a State handler URL when your contracts declare provider states.
- **Use matchers instead of exact bodies** when only the *shape* matters; they survive changing IDs, timestamps, and counts.
- **Bi-dir without a body schema** skips the static compatibility check and runs only live verification.
- **Environment variables** are substituted before validation in every mode, so `{{BASE_URL}}` in URLs and request bodies is resolved automatically.
- **`UNKNOWN PATH` in Provider mode** often means the request URL points at a different host than what the spec documents. The path itself (`/status`) is what matters, not the hostname.
- **Everything here runs headless too.** See **[Contract Testing (CLI)](../cli/contract-testing.md)** for CI gating, Pact import/export, and reports.
