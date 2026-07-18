# Pact Compatibility & Matchers

API Spector interoperates with the [Pact](https://docs.pact.io/) ecosystem: it imports and exports standard Pact files and supports Pact-style matchers. This page documents the matcher format and how it maps to and from Pact `matchingRules`.

> **Is Pact open or commercial?** The Pact *specification*, the consumer/provider libraries, the standalone CLI tools, and the self-hostable Pact Broker are **open source (MIT)**. Only the hosted **PactFlow** broker is commercial. Importing/exporting pact files depends only on the open format. The two features PactFlow charges for (bi-directional contract testing and `can-i-deploy`) have local equivalents built in; see the full [PactFlow comparison](contract-testing-types.md#how-this-compares-to-pactflow).

---

## Body matchers

A **body matcher** is an *example* JSON document in which any node may be wrapped in a matcher marker. It is stored on a request's contract (`bodyMatcher`) and compiled to a draft-07 JSON Schema for validation, so it produces the same `SCHEMA VIOLATION` results as a hand-written schema.

The default is **exact match** (Pact semantics): a plain value must appear verbatim. Wrap a value in a matcher to relax it.

A matcher node is an object carrying a `__match` key:

```json
{ "__match": "type", "value": "Fluffy" }
```

### Supported matchers

| `__match` | Extra fields | Compiles to | Meaning |
|-----------|-------------|-------------|---------|
| `type` | `value` | type of the example (recursive) | Same type as the example; values are free |
| `eachLike` | `value`, `min` | `array` of `type(value)`, `minItems: min` | Array whose every item matches the example type |
| `regex` | `regex`, `value` | `{ type: string, pattern }` | String matching the regular expression |
| `integer` | `value` | `{ type: integer }` | Whole number |
| `decimal` / `number` | `value` | `{ type: number }` | Any number |
| `boolean` | `value` | `{ type: boolean }` | Boolean |
| `string` | `value` | `{ type: string }` | Any string |
| `datetime` / `timestamp` | `value`, `format` | `{ type: string, format: date-time }` | ISO date-time string |
| `date` | `value` | `{ type: string, format: date }` | Date string |
| `time` | `value` | `{ type: string, format: time }` | Time string |

### Example

This matcher example…

```json
{
  "id":   { "__match": "integer", "value": 1 },
  "name": { "__match": "type", "value": "Fluffy" },
  "tags": { "__match": "eachLike", "value": "cute", "min": 1 }
}
```

…accepts `{ "id": 99, "name": "Rex", "tags": ["a", "b"] }` but rejects a non-integer `id`, a numeric `name`, or an empty `tags` array. Extra fields the provider returns are always allowed.

> A `bodyMatcher` and a hand-written `bodySchema` can both be set on the same contract; both are validated.

---

## `matchingRules` mapping

When importing/exporting pact files, matchers are translated to and from Pact's `matchingRules.body` map, which is keyed by JSONPath.

| Pact matcher | API Spector matcher |
|--------------|---------------------|
| `{ "match": "type" }` | `type` (`eachLike` when the node is an array, carrying `min`) |
| `{ "match": "regex", "regex": … }` | `regex` |
| `{ "match": "integer" }` | `integer` |
| `{ "match": "number" }` / `decimal` | `decimal` |
| `{ "match": "boolean" }` | `boolean` |
| `{ "match": "null" }` | `null` |
| `{ "match": "datetime", "format": … }` | `datetime` |
| `{ "match": "date" }` / `time` | `date` / `time` |
| `{ "match": "equality" }` / unsupported | exact match (no matcher) |

Supported JSONPath forms: `$`, `$.a.b`, `$.a[0].b`, and the `$.a[*].b` wildcard.

Round-trip notes: `string` matchers export as `{ "match": "type" }` (semantically equivalent for a string example, so they re-import as `type`); `number` and `decimal` both export as `decimal`. Everything else round-trips to the same matcher kind.

---

## Import / export

| Direction | Command | Notes |
|-----------|---------|-------|
| Pact → collection | `api-spector contract pact-import --file <pact.json> --out <collection.json>` | v2/v3/v4 in, runnable requests + contracts out |
| Collection → Pact | `api-spector contract pact-export --workspace <path> --out <pact.json>` | Pact v3 out |

### What import maps

- **Request:** method, path (URL becomes `{{baseUrl}}<path>`), query (object or `a=1&b=2` form), headers.
- **Response → contract:** status code, required headers, provider states (v3 `providerStates[].name` or v2 `providerState`), and a body matcher built from the response body + `matchingRules`.
- Only HTTP interactions are imported from v4 files (message pacts are skipped).

### Verifying an imported pact

```bash
api-spector contract pact-import --file web-pets.json --out collection.json
# add collection.json to a workspace, set the baseUrl variable, then:
api-spector contract run --workspace . --mode provider-live --provider-base-url http://localhost:3000
```

See **[Contract Testing (CLI)](../cli/contract-testing.md)** for the full command reference.
