# Contract Testing

Contract testing verifies that a consumer (your API collection) and a provider (the real API) agree on a shared contract: the expected status codes, response headers, and response body shapes. api Spector supports three modes: **Consumer**, **Provider**, and **Bi-directional**.

Think of it as **who owns the definition of "correct"**.

---

## The Three Modes

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

> **Note:** Provider mode validates your *requests* against the spec — not the responses. It answers "am I calling the API correctly?" not "is the API returning what I expect?"

---

### Bi-directional mode

This combines both sides in a single run.

**Step 1 — Static schema compatibility check.** The response body schema you defined in the Contract tab is compared against the response schema documented in the provider's OpenAPI spec. Every field you *require* must exist in the provider schema with a compatible type. Extra provider fields are always allowed. No HTTP call needed for this step.

**Step 2 — Live consumer verification.** The real request is sent and validated exactly as in Consumer mode.

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

**Step 1 — Build your collection against v3.**
Send requests and use **⚡ Infer from response** to capture expected response shapes as contracts.

**Step 2 — Run Provider mode with the v4 spec.**
This immediately shows which of your requests use paths or parameters that no longer exist in v4, without making a single HTTP call. Any `UNKNOWN PATH` result means that endpoint moved or was removed.

**Step 3 — Switch your environment URL to v4 and run Consumer mode.**
This shows which responses changed shape between versions. A `SCHEMA VIOLATION` means a field was removed, renamed, or changed type.

**Step 4 — Run Bi-dir for the requests you care about most.**
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

---

## Violation reference

| Type | Meaning | Modes |
|------|---------|-------|
| `STATUS MISMATCH` | Response status did not match expected | Consumer, Bi-dir |
| `SCHEMA VIOLATION` | Response body failed JSON Schema validation | Consumer, Bi-dir |
| `MISSING HEADER` | Required header absent or wrong value | Consumer, Bi-dir |
| `REQUEST BODY INVALID` | Request body violates spec schema, or required query param missing | Provider, Bi-dir |
| `UNKNOWN PATH` | No matching operation in spec for this method and URL | Provider, Bi-dir |
| `SCHEMA INCOMPATIBLE` | Consumer's expected response schema conflicts with provider spec | Bi-dir |

---

## Tips

- **Start with Consumer mode** before you have a spec. It requires no setup beyond sending a request once.
- **Provider mode needs no live server.** Run it in CI to detect spec drift before deployment.
- **Bi-dir without a body schema** skips the static compatibility check and runs only live verification.
- **Environment variables** are substituted before validation in all three modes, so `{{BASE_URL}}` in URLs and request bodies is resolved automatically.
- **`UNKNOWN PATH` in Provider mode** often means the request URL points at a different host than what the spec documents. The path itself (`/status`) is what matters, not the hostname.
