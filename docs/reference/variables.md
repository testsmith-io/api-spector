# Variables — Scopes & Precedence

api Spector has four variable scopes. Understanding how they relate lets you share data between requests, across collections, and across sessions.

## The four scopes

| Scope | Stored in | Lifetime | Shared across |
|---|---|---|---|
| **Local** | Memory only | Single request | Nothing — request-scoped |
| **Environment** | `.env.json` file | Persists on disk | All collections using that environment |
| **Collection** | `.spector` collection file | Persists on disk | All requests in that collection |
| **Global** | `globals.json` in workspace dir | Persists on disk | All collections in the workspace |

## Resolution order

When `{{variableName}}` is resolved, the lookup order is:

```
Local  →  Environment  →  Collection  →  Global
```

**Local wins** — a variable set in a pre-request script overrides all other scopes for that request. A global with the same name is shadowed but not overwritten.

---

## Using variables in requests

`{{variableName}}` syntax works anywhere in a request:

```
# URL
https://{{host}}/api/{{version}}/users/{{userId}}

# Query param value
filter={{status}}

# Header value
Authorization: Bearer {{authToken}}
X-Request-Id: {{requestId}}

# JSON body
{
  "email": "{{email}}",
  "role":  "{{userRole}}"
}

# Raw / XML body
<user id="{{userId}}">{{userName}}</user>
```

---

## Environment variables

Set via the **Environment Editor** in the GUI. Scoped to one environment file. Switch environments from the top bar dropdown.

**Best for:** base URLs, API versions, account credentials, feature flags that differ per environment.

```
BASE_URL    = https://api.staging.example.com
API_VERSION = v2
AUTH_TOKEN  = (secret — encrypted)
```

**Read/write from scripts:**

```js
sp.environment.get('BASE_URL')
sp.environment.set('authToken', 'new-token-value')
sp.environment.clear('tempValue')
sp.environment.has('BASE_URL')         // true / false
sp.environment.toObject()              // { BASE_URL: '...', ... }
```

Changes made in a post-response script are written back to the active environment and saved to disk.

---

## Collection variables

Stored inside the `.spector` collection file. Shared across all requests in that collection regardless of which environment is active.

**Best for:** IDs created during a run (e.g. a created user's ID used by later requests), collection-level config that is not environment-specific.

```js
// Post-response script on "Create User"
const body = sp.response.json()
sp.collectionVariables.set('createdUserId', body.id)
```

```
# Used in the next request's URL
DELETE {{BASE_URL}}/users/{{createdUserId}}
```

**Read/write from scripts:**

```js
sp.collectionVariables.get('createdUserId')
sp.collectionVariables.set('createdUserId', '42')
sp.collectionVariables.clear('createdUserId')
sp.collectionVariables.toObject()
```

You can also set initial values in the GUI via **Collection → Variables** tab.

---

## Global variables

Stored in `globals.json` in the workspace directory. Shared across all collections and all environments.

**Best for:** values that are truly cross-collection — a shared auth token, a feature flag, a counter.

```js
// Set from any script
sp.globals.set('sharedToken', 'abc123')

// Read from any script in any collection
const token = sp.globals.get('sharedToken')
```

**Read/write from scripts:**

```js
sp.globals.get('key')
sp.globals.set('key', 'value')
sp.globals.clear('key')
sp.globals.has('key')
sp.globals.toObject()
```

Global changes from scripts are persisted to `globals.json` immediately and survive app restarts.

---

## Local variables

Set in a pre-request script and available only for the duration of that single request (URL building, headers, body interpolation, post-response script). Not persisted anywhere.

**Best for:** generated test data (faker values), computed values, one-off overrides.

```js
// Pre-request script
sp.variables.set('requestId', faker.string.uuid())
sp.variables.set('timestamp', dayjs().toISOString())
```

```json
{
  "requestId": "{{requestId}}",
  "timestamp": "{{timestamp}}"
}
```

**Read/write from scripts:**

```js
sp.variables.get('requestId')
sp.variables.set('requestId', faker.string.uuid())
```

**Cross-scope read shorthand** — searches all scopes in resolution order:

```js
sp.variables_get('BASE_URL')          // finds it in environment scope
sp.variables_set('key', 'value')      // always writes to local scope
```

---

## Practical examples

### Login and reuse the token

**Request 1 — POST /auth/login** (post-response script):

```js
sp.test('login successful', () => {
  sp.expect(sp.response.code).to.equal(200)
})

const body = sp.response.json()
sp.environment.set('authToken', body.token)
```

All subsequent requests use `Authorization: Bearer {{authToken}}` in their headers, or inherit it from the folder Auth tab.

### Create → read → delete

**Request 1 — POST /users** (post-response script):

```js
const body = sp.response.json()
sp.collectionVariables.set('userId', String(body.id))
```

**Request 2 — GET /users/{{userId}}**

**Request 3 — DELETE /users/{{userId}}**

### Environment-specific base URL

| Environment | `BASE_URL` |
|---|---|
| dev | `http://localhost:3000` |
| staging | `https://api.staging.example.com` |
| production | `https://api.example.com` |

Every request uses:

```
{{BASE_URL}}/v1/users
```

Switch environments in the top bar to point the whole collection at a different server without changing any requests.

### Override an environment variable for one request

```js
// Pre-request script — temporarily use a different base URL for this request only
sp.variables.set('BASE_URL', 'https://api.other-service.com')
```

Because **local wins**, `{{BASE_URL}}` resolves to the local value for this request only. The environment variable is unchanged.

---

## Variable scopes summary

```
┌────────────┬──────────────────────────────┬──────────────────────────────┐
│ Scope      │ Set from GUI                 │ Set from script              │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ Local      │ Not available                │ sp.variables.set()           │
│ Environment│ Environment editor           │ sp.environment.set()         │
│ Collection │ Collection → Variables tab   │ sp.collectionVariables.set() │
│ Global     │ Not available (script only)  │ sp.globals.set()             │
└────────────┴──────────────────────────────┴──────────────────────────────┘
```
