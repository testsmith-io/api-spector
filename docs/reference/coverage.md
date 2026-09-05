# OpenAPI Test Coverage

Coverage answers the question a request client can't: **is my API actually tested
according to its contract?** Point API Spector at an OpenAPI 3.x spec and it maps
every operation to the requests in your workspace, then reports what's tested,
what's asserted, and what's missing.

It works both in the desktop app (the **Coverage** button) and from the CLI
(`api-spector coverage`), so the same numbers you see while building are the ones
your pipeline can gate on.

## What it measures

| Metric | Meaning |
|---|---|
| **Operations tested** | Operations (path + method) with a matching request, or seen in a run. |
| **Response codes covered** | Declared codes that a request asserts *or* a run returned. |
| **Response shape seen** | Success-response-schema properties that appeared in an observed run body. |
| **Never tested** | Operations with no matching request at all. |
| **No negative test** | Tested operations where nothing asserts (or observed) a 4xx/5xx. |

Example report:

```
  Shop API v2.1 — test coverage

  ██████████░░░░░░░░░░  50% operations tested  (2/4)
  2/6 declared response codes covered  (33.3%)
  2 operations never tested, 2 without a negative test

  ✓ GET    /products        [1/1 codes]  no negative test
  ✗ POST   /products        [0/2 codes]
  ✓ GET    /products/{id}   [1/2 codes]  no negative test
  ✗ DELETE /products/{id}   [0/1 codes]
```

## How matching works

- **Operation** = a path + method in the spec (e.g. `GET /products/{id}`).
- A request **covers** an operation when its method matches and its URL path
  matches the operation's template. Matching is **base-path tolerant**: the
  template matches the tail of the request path, so `{{baseUrl}}/products/15`,
  `https://api.example.com/v1/products/15`, and `/products/15` all match
  `/products/{id}`. A `{param}` segment matches any one value.
- **Response-code coverage** and **negative tests** come from each request's
  **contract** expected status (`Contract` tab → status code). A request with no
  contract still marks the operation as tested, but contributes no specific code.
  So a low status-coverage number is a real signal: you are sending requests but
  not asserting the responses.

## In the app

1. Open a collection and click **Coverage** in the header.
2. Give it your OpenAPI spec: a **file path**, a **URL**, or **paste** the spec.
   The path is remembered with the workspace, so next time it's one click.
3. Read the report. Tick **Show only gaps** to see just the untested operations
   and the ones missing a negative test.

## From the CLI

```bash
api-spector coverage --workspace ./ws.spector --spec ./openapi.yaml
```

Options:

| Flag | Purpose |
|---|---|
| `--spec <file\|url>` | The OpenAPI document. Defaults to `settings.coverageSpec` if set. |
| `--collection <name>` | Only count requests from one collection. |
| `--json` | Print the full report as JSON. |
| `--output <path>` | Write the report to a file (`.json` or `.html` by extension). |
| `--fail-under <pct>` | Exit `1` if operation coverage is below this percentage. |
| `--runs <report.json>` | An `api-spector run --output` report; credits response codes and response-schema properties actually seen. |

### Gate a pipeline

`--fail-under` turns coverage into a build gate:

```yaml
# GitHub Actions
- run: api-spector coverage --workspace . --spec ./openapi.yaml --fail-under 80
```

The step fails when operation coverage drops below 80%, so a new endpoint added
to the spec without a test breaks the build. Add `--output coverage.html` to
publish a readable report as a CI artifact.

## Static vs run-aware

By default coverage is a **static** analysis of the workspace against the spec, so
it runs anywhere (no server needed) and is deterministic in CI: operations tested,
declared codes asserted, negative tests.

Feed it **run data** and two more metrics light up:

- **Response codes seen** — a run that returned `404` credits that code even if no
  contract declared it.
- **Response shape** — which success-response-schema properties actually appeared
  in a response body. A field the spec declares but your tests never receive shows
  as a gap (e.g. `price` above).

In the app this uses the current session's request history automatically. From the
CLI, pass `--runs` an `api-spector run --output report.json` file. Run coverage
after your test run to get the full picture.

Coverage also feeds **test generation**: the **Generate tests for N gaps** button
in the report (or [`api-spector generate-tests --untested-only`](test-generation.md))
creates tests for exactly the operations that aren't covered.
