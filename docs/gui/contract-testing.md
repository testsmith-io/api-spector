# Contract Testing

Contract testing verifies that a consumer (your API collection) and a provider (the real API) agree on a shared contract: the expected status codes, response headers, and response body shapes. API Spector supports five modes: **Consumer**, **Provider**, **Provider (live)**, **Bi-directional**, and **Fuzz**.

Think of it as **who owns the definition of "correct"**. For how these modes map to the industry terms (consumer-driven, provider-driven, and bi-directional contract testing) and how to choose between them, see **[Contract Testing Types](../reference/contract-testing-types.md)**.

> **New in this release:** live provider verification with provider states, Pact-style flexible matchers, Pact file import/export, HTML reports, and a local `can-i-deploy` gate. The CLI side of all of this is covered in **[Contract Testing (CLI)](../cli/contract-testing.md)**.

---

## The Modes

### Consumer mode

You define what you need. On each request you write down: "I expect a `200`, a `content-type: application/json` header, and a body that has `id` (integer) and `name` (string)." The tool sends each request live and checks whether the real API delivers exactly that.

You do not need a spec file. You are the source of truth.

**When to use:** Catching breaking changes after a deployment. Run it against two versions of the same API and see if anything you rely on has changed shape.

**Workflow:**
1. Send a request and click **⚡ Infer from response** in the Contract tab to capture the current response shape as a schema.
2. Set the expected status code and any required headers.
3. Open the Contracts panel, select **Consumer**, and click **Run**.
4. Expand any failing row to see exactly which field or header violated your contract.
5. Point your environment at a different API version and run again to compare.

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

### Provider (live) mode

This is the real **Pact-style provider verification**. Instead of static analysis, it takes the contracts you defined on your requests and **replays them against a really-running provider**, asserting that the live responses satisfy each contract. It is the answer to "does this build of the provider actually honour the consumer's expectations?"

Two things make it different from Consumer mode:

1. **Provider base URL.** Every request is rebased onto the origin you supply (e.g. `http://localhost:3000`), keeping its path and query. This lets the same contracts verify any environment (local, staging, a PR preview) without editing request URLs.
2. **Provider states.** Before each interaction, the tool can seed the provider into a known state (Pact's `given(...)`). You list the required states on the request's contract, and point the run at a **state handler URL**. Before each interaction the tool POSTs `{ state, action: "setup" }` to that URL; afterwards it POSTs `{ state, action: "teardown" }`.

**When to use:** Provider-side CI. The provider team runs this against a freshly built service to confirm it still satisfies every consumer contract before shipping.

**Workflow:**
1. Define contracts on your requests (status, headers, body schema or matchers).
2. (Optional) On each request's Contract tab, list the provider states it depends on.
3. Open the Contracts panel, select **Live**, and enter the **Provider base URL**.
4. (Optional) Enter a **State handler URL** if any contract declares provider states.
5. Click **Run**. A `PROVIDER STATE FAILED` violation means a required state could not be seeded (handler missing, unreachable, or non-2xx).

> **Tip:** The state handler is a small endpoint you add to your provider (often only in test builds) that puts the database/fixtures into the named state. It mirrors Pact's "state change URL" exactly, so an existing Pact provider-states endpoint works as-is.

---

### Fuzz mode

Fuzz mode generates malformed variants of your request bodies and query parameters (from a pinned spec or the request's own values), sends them to a provider base URL, and lists responses that crash (5xx) or accept invalid input. Set the provider base URL, optionally pick a spec or snapshot, choose how many cases per operation and a seed (runs are deterministic), and toggle "Include write methods" to fuzz POST/PUT/PATCH/DELETE. Each finding shows the single field it mutated and a request you can copy and replay. See [Fuzzing](../cli/contract-testing.md#fuzzing) for the full option reference.

There are two ways to fuzz:

- **Per request:** the **fuzz** button next to Send fuzzes just that one request, using its own URL, auth, and environment. This is the quick way to hammer an endpoint you are building. Pick a pinned spec in the dialog for richer inputs, or fuzz the request body as it stands. Because it targets the request's own URL, point the request at a staging environment or a mock before fuzzing write methods.
- **Whole workspace:** Fuzz mode in the Contracts panel sweeps every request against a provider base URL and produces a report suitable for CI. This is the batch form of the same engine.

Both share the seeded, single-fault engine, so a finding always names one mutated field and reproduces from its seed.

Turn on **Record all cases** in either dialog to see every request the fuzzer sent, not just the findings: a table of each mutated body with its field, mutation, and HTTP status. It is on by default for a per-request run (you are inspecting one endpoint) and off for the workspace sweep (where it can be large).

### Bi-directional mode

This combines both sides in a single run.

**Step 1: Static schema compatibility check.** The response body schema you defined in the Contract tab is compared against the response schema documented in the provider's OpenAPI spec. If the contract uses body matchers instead of a schema, the matcher example is compiled to a type-level schema and compared the same way. Every field you *require* must exist in the provider schema with a compatible type. Extra provider fields are always allowed. No HTTP call needed for this step.

**Step 2: Live consumer verification.** The real request is sent and validated exactly as in Consumer mode.

Violations from both steps appear together in the results.

**When to use:** You have both a response contract and a provider spec, and you want a single run that confirms the two sides agree on paper *and* the live API actually delivers.

**Workflow:**
1. Define a body schema on each relevant request via the Contract tab (use **⚡ Infer from response** as a starting point).
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

**Step 1: Build your collection against v3.**
Send requests and use **⚡ Infer from response** to capture expected response shapes as contracts.

**Step 2: Run Provider mode with the v4 spec.**
This immediately shows which of your requests use paths or parameters that no longer exist in v4, without making a single HTTP call. Any `UNKNOWN PATH` result means that endpoint moved or was removed.

**Step 3: Switch your environment URL to v4 and run Consumer mode.**
This shows which responses changed shape between versions. A `SCHEMA VIOLATION` means a field was removed, renamed, or changed type.

**Step 4: Run Bi-dir for the requests you care about most.**
This gives the full picture: schema compatibility between your expectations and the v4 spec, plus live verification that the API delivers what the spec promises.

---

## Defining a contract on a request

Open any request in the collection and click the **Contract** tab.

### Expected status code

Enter the HTTP status code you expect (e.g. `200`, `201`, `404`). If the real response returns a different code, the test fails.

### Required response headers

Add one or more headers the response must include.

| Column | Purpose |
|--------|---------|
| **Key** | Header name (case-insensitive) |
| **Value** | Expected value; leave blank to only check presence |
| **Required** | Toggle off to make the header optional (on by default) |

Header value comparison ignores parameters after `;`, so `application/json` matches `application/json;charset=UTF-8`.

### Body schema

Paste a JSON Schema (draft-07) the response body must satisfy.

**⚡ Infer from response** generates a schema automatically from the last received response body. Use it as a starting point, then tighten types or remove optional fields as needed.

**↓ Contract** in the response viewer captures status, `content-type`, and an inferred body schema all at once and jumps straight to the Contract tab.

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

- the [contract dashboard](../cli/contract-testing.md#serving-the-dashboard) (`contract report --serve`, also available as a [docker container](../cli/docker.md#the-contract-dashboard)) - refresh the page after recording and the new cell appears
- the [`can-i-deploy` gate](../cli/contract-testing.md#can-i-deploy-the-deployment-gate)

Commit the results folder to git to share them with the team.

If you set a **Dashboard URL** in Workspace Settings (Contracts tab), an **Open dashboard** button appears in the results bar linking straight to your served dashboard. The URL is view-only: recorded results reach the dashboard through the workspace files, never through that URL.

### Export an HTML report

Click **Export HTML** in the results bar to save a **self-contained HTML report** (inline styles, no external assets). It opens straight from disk and works well as a CI artifact or to share with teammates. It is the same report the CLI produces with `--html`. See **[Contract Testing (CLI) → Reports](../cli/contract-testing.md#reports)**.

---

## Violation reference

| Type | Meaning | Modes |
|------|---------|-------|
| `STATUS MISMATCH` | Response status did not match expected | Consumer, Provider (live), Bi-dir |
| `SCHEMA VIOLATION` | Response body failed JSON Schema / matcher validation | Consumer, Provider (live), Bi-dir |
| `MISSING HEADER` | Required header absent or wrong value | Consumer, Provider (live), Bi-dir |
| `REQUEST BODY INVALID` | Request body violates spec schema, or required query param missing | Provider, Bi-dir |
| `UNKNOWN PATH` | No matching operation in spec for this method and URL | Provider, Bi-dir |
| `SCHEMA INCOMPATIBLE` | Consumer's expected response schema conflicts with provider spec | Bi-dir |
| `PROVIDER STATE FAILED` | A required provider state could not be seeded before replay | Provider (live) |

---

## Tips

- **Start with Consumer mode** before you have a spec. It requires no setup beyond sending a request once.
- **Provider mode needs no live server.** Run it in CI to detect spec drift before deployment.
- **Provider (live) mode is for the provider's CI.** Point it at a freshly built service to prove it still satisfies every consumer contract before shipping.
- **Use matchers instead of exact bodies** when only the *shape* matters; they survive changing IDs, timestamps, and counts.
- **Bi-dir without a body schema** skips the static compatibility check and runs only live verification.
- **Environment variables** are substituted before validation in every mode, so `{{BASE_URL}}` in URLs and request bodies is resolved automatically.
- **`UNKNOWN PATH` in Provider mode** often means the request URL points at a different host than what the spec documents. The path itself (`/status`) is what matters, not the hostname.
- **Everything here runs headless too.** See **[Contract Testing (CLI)](../cli/contract-testing.md)** for CI gating, Pact import/export, and reports.
