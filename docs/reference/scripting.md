# Scripting API

Each request has two JavaScript script hooks:

- **Pre-request script:** runs before the request is sent. Use it to set variables, generate dynamic values, or modify the request.
- **Post-response script:** runs after the response is received. Use it for tests, assertions, and extracting values from the response.

Scripts run in a sandboxed Node.js VM context with a 5-second timeout. They are written in TypeScript: types are stripped before the script runs, so plain JavaScript works unchanged and type annotations are allowed.

## The `sp` object

The scripting API is available as `sp` (API **Sp**ector).

### Variable scopes

```js
// Environment variables (session value: kept in memory, not saved to .env.json)
sp.environment.get('key')
sp.environment.set('key', 'value')
sp.environment.clear('key')
sp.environment.has('key')
sp.environment.toObject()

// Collection variables (session value: kept in memory, not saved to disk)
sp.collectionVariables.get('key')
sp.collectionVariables.set('key', 'value')

// Folder variables (innermost folder; session value, not saved to disk)
sp.folder.get('key')
sp.folder.set('key', 'value')

// Request variables (run-only dynamic values, this send only)
sp.request.get('key')
sp.request.set('key', 'value')

// Global variables (session value: kept in memory, not saved to globals.json)
sp.globals.get('key')
sp.globals.set('key', 'value')

// Local variables (request-scoped, not persisted)
sp.variables.get('key')
sp.variables.set('key', 'value')

// Read across all scopes (local wins)
sp.variables_get('key')
sp.variables_set('key', 'value')
```

> **Script writes are session values, not saved to disk.** A write to a *named* scope — `sp.environment`, `sp.collectionVariables`, `sp.folder`, or `sp.globals` — is kept in memory for the running session: it is available to the current request and to **later manually-sent requests** (so you can extract a token in one request and use it in the next), resolving at that scope's normal precedence. It is never written back to the collection, environment, or globals files, it does not change the GUI Variables screens, and it clears on app restart / workspace close. `sp.variables` (local) and `sp.request` are request-scoped — they live only for the single send/run they were set in. To make a value survive a restart, author it in the GUI editors. See [Variables: Scopes and Precedence](./variables.md#the-scopes).

### Response object (post-response only)

```js
sp.response.code           // HTTP status code, e.g. 200
sp.response.status         // e.g. "200 OK"
sp.response.statusText     // e.g. "OK"
sp.response.responseTime   // duration in ms
sp.response.responseSize   // body size in bytes

sp.response.headers.get('content-type')
sp.response.headers.toObject()

sp.response.json()         // parsed JSON body
sp.response.text()         // raw body string
```

### Tests

```js
sp.test('response is 200', () => {
  sp.expect(sp.response.code).to.equal(200)
})

sp.test('body has id field', () => {
  const body = sp.response.json()
  sp.expect(body).to.have.property('id')
})
```

### Assertions (`sp.expect`)

```js
sp.expect(value).to.equal(200)
sp.expect(value).to.eql({ id: 1 })           // deep equal
sp.expect(value).to.include('substring')
sp.expect(value).to.have.property('key')
sp.expect(value).to.have.property('key', 'val')
sp.expect(value).to.be.a('string')           // 'string' | 'number' | 'boolean' | 'object' | 'array'
sp.expect(value).to.be.ok                    // truthy
sp.expect(value).to.be.true
sp.expect(value).to.be.false
sp.expect(value).to.be.null
sp.expect(value).to.be.above(5)
sp.expect(value).to.be.below(100)
sp.expect(value).to.be.least(1)             // >=
sp.expect(value).to.be.most(99)             // <=

// Negation
sp.expect(value).to.not.equal(0)
sp.expect(value).to.not.have.property('error')
```

Quick status shorthand:

```js
sp.response.to.have.status(201)
```

## Send a request (`sp.sendRequest`)

A script can send its own HTTP request, for example to fetch a token before the main request runs or to verify a side effect afterwards. `sp.sendRequest` is asynchronous: `await` it, or pass a Node-style callback.

```js
// Pre-request script: log in, then stash the token for the main request
const res = await sp.sendRequest({
  url: 'https://api.example.com/login',
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: JSON.stringify({ user: 'demo', pass: 'secret' }) },
})
sp.environment.set('token', res.json().access_token)
```

A bare URL string does a GET:

```js
const res = await sp.sendRequest('https://api.example.com/health')
sp.test('health ok', () => {
  sp.expect(res.code).to.equal(200)
})
```

Callback style also works:

```js
sp.sendRequest('https://api.example.com/health', (err, res) => {
  if (err) throw err
  sp.expect(res.code).to.equal(200)
})
```

The response object mirrors `sp.response`: `res.code`, `res.status`, `res.responseTime`, `res.headers.get(name)`, `res.headers.toObject()`, `res.json()`, and `res.text()`.

The request object accepts a `url`, an optional `method` (defaults to GET), a `header` map (or a `[{ key, value }]` list), and a `body`. Body shapes: a plain string, `{ mode: 'raw', raw }`, `{ mode: 'urlencoded', urlencoded: [{ key, value }] }`, `{ mode: 'formdata', formdata: [...] }`, or `{ mode: 'graphql', graphql: { query, variables } }`. The call reuses the request's proxy and TLS settings. It is a lightweight side request: it does not run its own auth handshakes or stream the response, and it has a 60 second ceiling.

`sp.sendRequest` is available in pre-request and post-response scripts. It is not available in flow logic blocks or realtime (WebSocket/MQTT) test scripts.

## Reusable libraries (`sp.require`)

Common helper code (signing, formatting, test data builders) can live in reusable TypeScript library files instead of being copied into every script. A script loads one with `sp.require`:

```ts
// Post-response script
const { parseToken } = sp.require('auth')
sp.environment.set('token', parseToken(sp.response.json()))
```

A library is authored in TypeScript and exports whatever a script needs:

```ts
// auth.ts
export function parseToken(body: { access_token: string }): string {
  return body.access_token
}
```

Both `export` syntax and `module.exports` are supported. Libraries can load other libraries with `import` or `sp.require`. Each library is evaluated once per run, and has the same globals a script has (`dayjs`, `faker`, `tv4`, `console`, and `sp` itself).

### Scopes

A library is scoped by where it lives, and a script sees the libraries from its own scope outward:

- **Workspace:** available to every collection.
- **Collection:** available to that collection only.
- **Folder:** available to that folder and the requests under it.

When two scopes define a library with the same name, the innermost one wins (folder over collection over workspace), the same precedence variables use.

### Creating and editing

In the sidebar, each scope has a **Libraries** group: at the top of the tree for the workspace, inside a collection, and inside a folder. Use the group's **+**, or the collection/folder right-click menu **New library**, to add one. A library opens as a tab in the center, where it autosaves as you type. Rename and delete are on the file's row menu.

Script editors autocomplete library names inside `sp.require('...')`, and the exported members of a library after `sp.require('name').` or off a variable assigned from it.

### On disk

Libraries are plain `.ts` files under `lib/` in the workspace, so they are versioned and reviewed like the rest of the workspace:

```
lib/<name>.ts                      workspace scope
lib/collections/<collectionId>/    collection scope
lib/folders/<folderId>/            folder scope
```

You can edit these files in an external editor; reopen the workspace to pick up changes made outside the app.

### External npm packages

`sp.require` also loads CommonJS packages installed in the workspace's own `node_modules`. Install the package in the workspace directory, then require it by name:

```bash
cd my-workspace        # the folder that holds the .spector file
npm install ean-generator
```

```ts
// Pre-request script
const { eanGenerator } = sp.require('ean-generator')
sp.variables.set('barcode', eanGenerator('978037429279'))
```

Resolution order is workspace library first, then the package, so a workspace library named like a package takes priority. Only package names are accepted, not file paths.

Because the sandbox is synchronous, only CommonJS packages can be loaded this way. A package that ships as ES modules only cannot be required; copy the function you need into a library file instead, or use a build of the package that provides a CommonJS entry point.

Workspace libraries and npm packages both work the same way from the CLI (`api-spector run`), so a test that passes in the app passes in a pipeline.

## Available globals

| Name | Description |
|---|---|
| `faker` | [@faker-js/faker](https://fakerjs.dev/) for generating test data |
| `dayjs` | [Day.js](https://day.js.org/) for date manipulation |
| `tv4` | JSON Schema v4 validator |
| `console.log()` | Output appears in the **Console** tab |
| `console.warn()` | Prefixed with `[warn]` |
| `console.error()` | Prefixed with `[error]` |
| `JSON` | Standard JSON object |
| `Math` | Standard Math object |
| `Date` | Standard Date constructor |
| `btoa` / `atob` | Base64 encode/decode |
| `encodeURIComponent` / `decodeURIComponent` | URL encoding |

## Examples

### Extract a token from the response and reuse it

```js
// Post-response script
const body = sp.response.json()
sp.environment.set('authToken', body.token)
```

The token is available to later requests this session — both within one flow/runner run and across separate manual sends. It is a session value held in memory, not saved to the environment file, and clears on app restart.

### Generate a unique request ID before sending

```js
// Pre-request script
sp.variables.set('requestId', faker.string.uuid())
```

Use it in the request body:

```json
{ "requestId": "{{requestId}}" }
```

### Validate response structure

```js
// Post-response script
const schema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id:   { type: 'integer' },
    name: { type: 'string' }
  }
}

sp.test('response matches schema', () => {
  const result = tv4.validateResult(sp.response.json(), schema)
  sp.expect(result.valid).to.be.true
})
```

### Date manipulation

```js
// Pre-request script
sp.variables.set('tomorrow', dayjs().add(1, 'day').format('YYYY-MM-DD'))
```

### Log for debugging

```js
// Post-response script
console.log('status:', sp.response.code)
console.log('body:', sp.response.text())
```
