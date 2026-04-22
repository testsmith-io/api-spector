# Scripting API

Each request has two JavaScript script hooks:

- **Pre-request script:** runs before the request is sent. Use it to set variables, generate dynamic values, or modify the request.
- **Post-response script:** runs after the response is received. Use it for tests, assertions, and extracting values from the response.

Scripts run in a sandboxed Node.js VM context with a 5-second timeout.

## The `sp` object

The scripting API is available as `sp` (API **Sp**ector).

### Variable scopes

```js
// Environment variables
sp.environment.get('key')
sp.environment.set('key', 'value')
sp.environment.clear('key')
sp.environment.has('key')
sp.environment.toObject()

// Collection variables
sp.collectionVariables.get('key')
sp.collectionVariables.set('key', 'value')

// Global variables
sp.globals.get('key')
sp.globals.set('key', 'value')

// Local variables (request-scoped, not persisted)
sp.variables.get('key')
sp.variables.set('key', 'value')

// Read across all scopes (local wins)
sp.variables_get('key')
sp.variables_set('key', 'value')
```

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

### Extract a token from the response and store it

```js
// Post-response script
const body = sp.response.json()
sp.environment.set('authToken', body.token)
```

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
