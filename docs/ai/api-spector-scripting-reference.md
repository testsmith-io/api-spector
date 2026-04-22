# API Spector — Scripting Reference

This document describes the scripting API available in API Spector's pre-request and post-request scripts. Use this as a reference when generating test scripts.

## Script Context

Scripts run in a sandboxed environment. The global `sp` object provides all testing, assertion, and variable functionality.

## Assertions

### sp.test(name, fn)

Wrap assertions in a named test block:

```javascript
sp.test('status is 200', function() {
  sp.expect(sp.response.code).to.equal(200);
});
```

### sp.expect(value)

Returns a chainable asserter. Available matchers:

| Matcher | Example | Description |
|---|---|---|
| `.to.equal(v)` | `sp.expect(json.name).to.equal("Alice")` | Strict equality |
| `.to.eql(v)` | `sp.expect(json).to.eql({id: 1})` | Deep equality |
| `.to.include(v)` | `sp.expect(json.name).to.include("Ali")` | String/array contains |
| `.to.be.a(type)` | `sp.expect(json.age).to.be.a("number")` | Type check |
| `.to.be.above(n)` | `sp.expect(json.count).to.be.above(0)` | Greater than |
| `.to.be.below(n)` | `sp.expect(json.count).to.be.below(100)` | Less than |
| `.to.be.least(n)` | `sp.expect(json.count).to.be.least(1)` | >= |
| `.to.be.most(n)` | `sp.expect(json.count).to.be.most(50)` | <= |
| `.to.have.property(k)` | `sp.expect(json).to.have.property("id")` | Key exists |
| `.to.have.lengthOf(n)` | `sp.expect(json.items).to.have.lengthOf(3)` | Array/string length |
| `.to.match(re)` | `sp.expect(json.email).to.match(/^.+@.+$/)` | Regex match |
| `.to.be.oneOf([...])` | `sp.expect(json.role).to.be.oneOf(["admin","user"])` | Value in list |
| `.to.not.xxx` | `sp.expect(json.id).to.not.be.oneOf([null, undefined])` | Negation |

Chainable words (no-op, for readability): `.to`, `.be`, `.been`, `.have`, `.that`, `.and`, `.is`, `.deep`

Flag assertions (property-style): `.ok`, `.true`, `.false`, `.null`, `.undefined`

## Response Object

Available in post-request scripts when a response has been received:

```javascript
sp.response.code           // HTTP status code (number)
sp.response.status         // "200 OK" (string)
sp.response.statusText     // "OK" (string)
sp.response.responseTime   // Duration in ms
sp.response.responseSize   // Body size in bytes
sp.response.json()         // Parse body as JSON (cached)
sp.response.text()         // Raw body as string
sp.response.xmlText(sel)   // Extract text from XML/HTML using CSS selector
sp.response.headers.get(n) // Get response header by name
sp.response.headers.toObject() // All headers as {key: value}
sp.response.to.have.status(code) // Assert status code
```

## Variables

Four variable scopes, from most-local to most-global:

```javascript
// Local variables (per-request, not persisted)
sp.variables.get("key")
sp.variables.set("key", "value")
sp.variables.has("key")
sp.variables.clear("key")

// Environment variables (persisted to the active environment)
sp.environment.get("key")
sp.environment.set("key", "value")

// Collection variables (persisted to the collection)
sp.collectionVariables.get("key")
sp.collectionVariables.set("key", "value")

// Global variables (persisted across collections)
sp.globals.get("key")
sp.globals.set("key", "value")

// Shorthand: read from all scopes (local wins)
sp.variables_get("key")
```

### Variable interpolation in scripts

Scripts support `{{variable}}` interpolation. Before execution, `{{var}}` tokens are replaced with the variable's value:

```javascript
sp.variables.set("otp", sp.totp("{{secret}}"));
```

## JSONPath

Query JSON data with JSONPath expressions:

```javascript
const matches = sp.jsonPath(sp.response.json(), '$.users[?(@.role=="admin")].name');
sp.expect(matches.length).to.be.above(0);
sp.expect(matches[0]).to.equal("Alice");
```

## TOTP (Time-based One-Time Password)

Generate TOTP codes from a base32 secret:

```javascript
const code = sp.totp("JBSWY3DPEHPK3PXP");
sp.environment.set("otp", code);

// With options:
const code8 = sp.totp("JBSWY3DPEHPK3PXP", { digits: 8, period: 30, algorithm: "sha1" });
```

## Available globals

Scripts have access to: `JSON`, `Math`, `Date`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURIComponent`, `decodeURIComponent`, `btoa`, `atob`, `console` (log/warn/error/info), `dayjs` (date library), `faker` (test data generation), `tv4` (JSON Schema validation), `DOMParser` (XML parsing).

## Hooks

Requests can be designated as lifecycle hooks within their folder:

| Hook type | When it runs |
|---|---|
| `beforeAll` | Once before any request in the folder |
| `before` | Before each request in the folder |
| `after` | After each request in the folder |
| `afterAll` | Once after all requests in the folder |

Hooks from parent folders wrap child folders (outer-to-inner for before, inner-to-outer for after).

Common pattern — login hook:

```javascript
// Post-request script on a beforeAll hook that calls POST /login:
const json = sp.response.json();
sp.environment.set("access_token", json.access_token);
```

Then other requests use `{{access_token}}` in their Bearer token auth field.

## Schema validation

The `request.schema` field (JSON Schema) is automatically validated against every response. Failed validations appear as `[schema]` test results. The schema uses standard JSON Schema draft-07+ syntax.
