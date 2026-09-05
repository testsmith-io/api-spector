# Test Generation

Generate real tests from an OpenAPI 3.x spec: a valid happy-path call for every
operation, plus negative and boundary tests derived from the schema. Each
generated request carries a **contract** (expected status, and the response
schema for happy-path tests), so it is a test you can run and gate on, not just a
request.

It pairs with [coverage](coverage.md): measure what's tested, then generate tests
for exactly the operations that aren't.

## What it generates

For each operation:

| Category | How it's built | Asserts |
|---|---|---|
| **Happy path** | A valid request from the schema (params + body), using formats, enums, defaults, examples, and constraints. | The primary 2xx code, plus the response body schema. |
| **Negative** | The valid body with a required field removed, or a field set to the wrong type. | A 4xx (the declared one, else 400). |
| **Boundary** | A numeric field set just below `minimum` / above `maximum`, or a string past `maxLength`. | A 4xx. |

Sample values are schema-aware: `format: email` becomes `user@example.com`,
`minimum: 18` becomes `18`, an `enum` uses its first value, and an `example` or
`default` in the spec is used as-is. Negatives and boundaries are capped per
operation so a large spec doesn't explode into thousands of tests.

Generated tests are a **strong starting point, not a final suite** — review them,
especially the negatives (an API may legitimately coerce types or default missing
fields rather than return 4xx).

## The coverage -> generate workflow

1. Open **Coverage** and measure against your spec.
2. Click **Generate tests for N gaps**. API Spector generates happy-path,
   negative, and boundary tests for the untested operations and adds them as a
   new collection in the workspace.
3. **Re-measure** — coverage rises. Fill in auth, tweak assertions, and run them.

## From the CLI

```bash
# Generate a full suite from a spec
api-spector generate-tests --spec ./openapi.yaml --output ./generated.json

# Only for operations the workspace doesn't test yet
api-spector generate-tests --spec ./openapi.yaml --output ./gaps.json \
    --workspace ./ws.spector --untested-only
```

Options:

| Flag | Purpose |
|---|---|
| `--spec <file\|url>` | The OpenAPI document (required). |
| `--output <path>` | Collection JSON to write (required). |
| `--workspace <path>` | With `--untested-only`, the workspace to measure against. |
| `--untested-only` | Only generate for operations with no test yet. |
| `--name <label>` | Collection name (default: from the spec title). |
| `--no-negative` | Skip negative tests. |
| `--no-boundary` | Skip boundary tests. |

The output is a normal collection file: drop it into a workspace directory and
add it to the `.spector` file, or open the app and import it.

## First-pass scope

- JSON request bodies (`application/json`); one happy-path call per operation.
- Negatives/boundaries come from the request schema; capped per operation.
- No auth-flow or security tests yet, and no multi-example expansion. These are
  on the roadmap.
