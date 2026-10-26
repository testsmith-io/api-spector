# Variables: Scopes and Precedence

> Environments may extend other environments (see [Environment inheritance](../gui/environments.md#environment-inheritance)). Inheritance is resolved first, producing one flat set of environment variables; the scope precedence below then applies to that resolved set.

API Spector resolves `{{variables}}` from several scopes. Understanding how they relate lets you share data between requests, across collections, and across sessions.

## The scopes

| Scope | Set from | Stored in | Applies to |
|---|---|---|---|
| **Built-in dynamic** | `{{$timestamp}}`, `{{$guid}}`, … | — | Everywhere (fallback values) |
| **Global** | GUI / script (`sp.globals.set`) | `globals.json` (GUI) · session memory (script) | All collections in the workspace |
| **Environment** | GUI (Environment editor) / script | `.env.json` (GUI) · session memory (script) | All collections using that environment |
| **Collection** | GUI (Collection → Variables) / script | `.spector` file (GUI) · session memory (script) | Every request in that collection |
| **Folder** | GUI (Folder → Variables) / script | `.spector` file (GUI) · session memory (script) | Requests in that folder (an inner folder wins) |
| **Request** | GUI (Request → Variables) | `.spector` collection file | That request and its examples |
| **Example** | GUI (an example's Variables tab) | `.spector` collection file | One saved example (overrides its request, inherits the rest) |
| **CLI `--var`** | `api-spector run --var k=v` | — | That CLI run (also `--env-var` / `--global-var` seed the environment / globals scope) |
| **Data-row** | data table / `--data` file | — | One iteration of a run |
| **Local / runtime** | script (`sp.variables.set`) | memory | One request (threaded across a run/flow) |

> **How script writes behave (session, not saved to disk).** A `sp.*.set()` in a script is a *dynamic* value. Where it lives depends on the scope:
>
> - **Named scopes** — `sp.environment.set`, `sp.collectionVariables.set`, `sp.folder.set`, `sp.globals.set` — are kept **in memory for the running session**. The value is available to the current request and to **later manually-sent requests** (so you can extract a token in one request and use it in the next), and it resolves at that scope's normal precedence. It is **never written back** to the `.env.json`, `.spector`, or `globals.json` files, it does **not** change the GUI Variables screens, and it **clears when you close the workspace or restart the app**.
> - **Local** — `sp.variables.set` — is request-scoped: it exists only for the single send/run it was set in (threaded through that send's hooks and the main request), and is never kept afterwards.
>
> The "Set from" column above lists both authoring paths; the "Stored in" column shows that GUI edits persist to files while script writes stay in session memory. To make a value survive a restart, author it in the GUI editor.

## Resolution order (precedence)

When `{{name}}` is resolved, a higher scope overrides a lower one. Low → high:

```
built-in dynamic  <  global  <  environment  <  collection  <  folder  <  request  <  example  <  CLI --var  <  data-row  <  runtime (script-set)
```

The collection → folder → request → example tree is one chain, **"the closer to the request, the stronger"**: an **example** overrides its **request**, a **request** overrides its **folder**, a **folder** overrides the **collection**. The **environment** is a shared default *below* the collection (above globals) — because a workspace holds many collections, a collection's own value wins for its requests — so a collection, folder, request or example value overrides it. Runtime script-set values — and a **data-row** for the current iteration — override everything, so a script or a data file can always take control.

**A `null`/`undefined` value is treated as UNSET** — it does not shadow a real value from a lower scope (and never renders as the literal `"null"`).

## Compared to Postman and Bruno

Two deliberate differences:

- **The collection outranks the environment here.** Postman and Bruno both rank the environment *above* the collection; API Spector puts the environment below it, as a shared default — a workspace holds many collections, and a collection's own value should win for its requests. A collection imported from those tools may resolve a same-named collection/environment variable differently than it did there.
- **Folder, request and example scopes.** Postman has none of these as static variable scopes (its only transient scope is the script "local"); Bruno has folder and request variables (ordered `request > folder > environment > collection`) but no per-example variables — those are unique to API Spector.

| Boundary | API Spector | Postman | Bruno |
|---|---|---|---|
| environment vs collection | **collection > environment** | environment > collection | environment > collection |
| folder variables | yes | none | yes |
| request variables | yes | none (script "local") | yes |
| example variables | **yes** (example > request) | none | none |
| runtime / script-set | highest | "local" (highest) | runtime (highest) |

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
AUTH_TOKEN  = (secret, encrypted)
```

**Read/write from scripts:**

```js
sp.environment.get('BASE_URL')
sp.environment.set('authToken', 'new-token-value')
sp.environment.clear('tempValue')
sp.environment.has('BASE_URL')         // true / false
sp.environment.toObject()              // { BASE_URL: '...', ... }
```

Changes made in a script (`sp.environment.set`) are **session values**: they apply for the current send and remain available to later manually-sent requests this session, but they are held in memory only — not written back to the `.env.json` file, and cleared on app restart / workspace close. Edit the Environment editor to change a value stored on disk.

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

> This works both inside one flow/runner pass and across two separate manual sends this session: `sp.collectionVariables.set` keeps the value in session memory, so after sending "Create User" you can click "Delete User" and `{{createdUserId}}` resolves. The value is **not** written to the `.spector` file and the Collection Variables screen is unchanged; it clears on app restart / workspace close. For a value that survives a restart, set it in **Collection → Variables**.

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

**Best for:** values that are truly cross-collection: a shared auth token, a feature flag, a counter.

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

Script changes to globals (`sp.globals.set`) are **session values**: they apply for the current send and stay available to later manually-sent requests this session, but they are held in memory only — not written back to `globals.json`, and they do not survive an app restart or workspace close.

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

**Cross-scope read shorthand:** searches all scopes in resolution order:

```js
sp.variables_get('BASE_URL')          // finds it in environment scope
sp.variables_set('key', 'value')      // always writes to local scope
```

---

## Practical examples

### Login and reuse the token

**Request 1: POST /auth/login** (post-response script):

```js
sp.test('login successful', () => {
  sp.expect(sp.response.code).to.equal(200)
})

const body = sp.response.json()
sp.environment.set('authToken', body.token)
```

All subsequent requests use `Authorization: Bearer {{authToken}}` in their headers, or inherit it from the folder Auth tab. The token set by `sp.environment.set` is a session value: after you send the login request, any request you send next this session resolves `{{authToken}}` — whether you run them together in a flow/runner or click them one at a time. It is held in memory only (not written to the `.env.json` file) and clears on app restart / workspace close, so you re-run the login after restarting.

### Create → read → delete

**Request 1: POST /users** (post-response script):

```js
const body = sp.response.json()
sp.collectionVariables.set('userId', String(body.id))
```

**Request 2: GET /users/{{userId}}**

**Request 3: DELETE /users/{{userId}}**

The `userId` set by request 1 is a session value, so it reaches requests 2 and 3 whether you run all three in a flow/runner or send them one at a time. It stays in memory for the session only (not written to the collection file) and clears on app restart / workspace close.

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
// Pre-request script: temporarily use a different base URL for this request only
sp.variables.set('BASE_URL', 'https://api.other-service.com')
```

Because **local wins**, `{{BASE_URL}}` resolves to the local value for this request only. The environment variable is unchanged.

---

## Variable scopes summary

| Scope | Set from GUI | Set from script |
|---|---|---|
| Request | Request → Variables tab | — (script writes go to local) |
| Folder | Folder → Variables tab | `sp.folder.set()` |
| Collection | Collection → Variables tab | `sp.collectionVariables.set()` |
| Environment | Environment editor | `sp.environment.set()` |
| Global | — (script only) | `sp.globals.set()` |
| Local / runtime | — (script only) | `sp.variables.set()` |

(Listed by where they're authored, not by precedence — see [Resolution order](#resolution-order-precedence) above. Folder overrides environment, request overrides folder. Script writes to the named scopes are session values, not saved to disk — see the [script-writes note](#the-scopes).)
