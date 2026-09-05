# API Diff & Impact Analysis

`api-spector compare` diffs two OpenAPI 3.x specs, classifies each change as
**breaking** or not from a consumer's point of view, and — pointed at a
workspace — tells you **which tests a breaking change hits** and whether it's safe
to ship.

A plain OpenAPI diff tells you *what* changed. This goes one step further:
**change -> impact -> affected tests -> deploy verdict.**

```bash
api-spector compare ./openapi.yaml ./openapi.new.yaml
```

```
  BREAKING CHANGES
  ✗ Operation DELETE /products/{id} was removed
  ✗ GET /products/{id}: response field "price" type number -> string

  NON-BREAKING
  ✓ Operation GET /brands was added
```

## What counts as breaking

| Change | Breaking? |
|---|---|
| Operation removed | Yes |
| New **required** request field | Yes |
| Request/response field **type changed** | Yes |
| **Response** field removed | Yes (consumers rely on it) |
| Parameter becomes **required** | Yes |
| Success response code removed | Yes |
| Operation added | No |
| Optional field added | No |

Specs can use `$ref`; they're dereferenced before diffing, and nested object and
array (`[]`) properties are compared by path.

## Impact analysis and deploy verdict

Add `--workspace` and API Spector maps each breaking change to the requests/tests
that exercise that operation (the same path matching [coverage](coverage.md) uses),
then gives a verdict:

```bash
api-spector compare ./old.yaml ./new.yaml --workspace ./ws.spector
```

```
  IMPACT
  GET /products/{id}: response field "price" type number -> string
      - Product API / Get product

  BLOCK DEPLOYMENT: 2 breaking change(s) affect 1 test(s).
```

If there are breaking changes but **no test** covers the affected operations, that
itself is the signal: you're about to change something nobody tests. The tool says
so and recommends adding tests first (a natural hand-off to
[test generation](test-generation.md)).

## In the app

Click **Compare** in a collection header. Give it two spec versions (file path,
URL, or paste) — the candidate defaults to the workspace's coverage spec — and it
shows the same breaking / non-breaking split, the affected tests, and the deploy
verdict, computed against the collections you have open.

## Gate a pipeline

```yaml
# Fail the build on any breaking change against the deployed spec
- run: api-spector compare ./deployed-openapi.yaml ./openapi.yaml --fail-on-breaking
```

`--fail-on-breaking` exits `1` when there are breaking changes. Add `--json` to
capture the full diff + impact as a CI artifact.

## From client to deploy decision

Compare is the last link in the chain the rest of API Spector builds:

```
requests -> tests -> OpenAPI -> coverage -> diff -> impact -> can I deploy?
```

The **local** tool answers "which of *my* tests break?" Sharing consumer contracts
across teams — "which *other services* break?" — is what
[API Spector Cloud](https://api-spector.dev) adds on top with a hosted broker.

## First-pass scope

- Diffs JSON request/response schemas and parameters; heuristics favour catching
  real breakages over exhaustive spec-rule coverage.
- Impact maps to workspace tests. Cross-service consumer-contract impact is a
  Cloud feature.
