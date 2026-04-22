---
name: Generate Mock Server from OpenAPI
description: Create an API Spector mock server with dynamic responses from an OpenAPI spec
---

# Generate Mock Server from OpenAPI

## What to do

1. Ask the user for an OpenAPI spec URL or file path
2. Ask which endpoints/tags to mock (or all)
3. Ask what port to use (default: 3900)
4. Generate a `.mock.json` file with routes for each endpoint

## Mock server file format

```json
{
  "version": "1.0",
  "id": "uuid",
  "name": "My API Mock",
  "port": 3900,
  "routes": [
    {
      "id": "uuid",
      "method": "GET",
      "path": "/users/:id",
      "statusCode": 200,
      "headers": { "Content-Type": "application/json" },
      "body": "{ ... }",
      "description": "Get user by ID",
      "script": "// optional JS to make response dynamic"
    }
  ]
}
```

### Route fields
- `method`: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or ANY
- `path`: Express-style with `:param` for path params (e.g. `/users/:id`)
- `statusCode`: default HTTP status
- `headers`: response headers (Content-Type defaults to application/json)
- `body`: static JSON string response body
- `script`: JavaScript that runs before sending. Has access to `request`, `response`, `faker`, `dayjs`
- `delay`: optional ms delay before responding

### Path params

Use Express-style `:param` syntax, NOT OpenAPI `{param}`:
- OpenAPI: `/users/{userId}` → Mock: `/users/:userId`

### Script context

```javascript
// Available in route scripts:
request.method     // "GET"
request.path       // "/users/42"
request.params     // { id: "42" }
request.query      // { page: "1" }
request.body       // parsed JSON body (or null)
request.headers    // { authorization: "Bearer ...", ... }

response.statusCode  // mutable — change to e.g. 404
response.body        // mutable — replace the response body
response.headers     // mutable — add/change headers

faker                // @faker-js/faker — generate dynamic data
dayjs                // dayjs — date/time helpers
```

## Making responses dynamic

Use `script` on routes to generate realistic data with faker:

### List endpoint with faker data
```json
{
  "method": "GET",
  "path": "/users",
  "statusCode": 200,
  "body": "[]",
  "script": "const users = Array.from({length: 10}, (_, i) => ({ id: i + 1, name: faker.person.fullName(), email: faker.internet.email(), role: faker.helpers.arrayElement(['admin', 'user']), created_at: faker.date.recent().toISOString() })); response.body = JSON.stringify(users);"
}
```

### Single resource using path param
```json
{
  "method": "GET",
  "path": "/users/:id",
  "statusCode": 200,
  "body": "{}",
  "script": "response.body = JSON.stringify({ id: request.params.id, name: faker.person.fullName(), email: faker.internet.email(), created_at: faker.date.recent().toISOString() });"
}
```

### POST that echoes back with generated ID
```json
{
  "method": "POST",
  "path": "/users",
  "statusCode": 201,
  "body": "{}",
  "script": "const body = request.body || {}; response.body = JSON.stringify({ id: faker.string.uuid(), ...body, created_at: dayjs().toISOString() });"
}
```

### Conditional responses (not found, validation)
```json
{
  "method": "GET",
  "path": "/users/:id",
  "statusCode": 200,
  "body": "{}",
  "script": "if (request.params.id === '0' || request.params.id === 'notfound') { response.statusCode = 404; response.body = JSON.stringify({ message: 'User not found' }); } else { response.body = JSON.stringify({ id: request.params.id, name: faker.person.fullName() }); }"
}
```

### Auth validation mock
```json
{
  "method": "GET",
  "path": "/users/me",
  "statusCode": 200,
  "body": "{}",
  "script": "if (!request.headers.authorization) { response.statusCode = 401; response.body = JSON.stringify({ message: 'Unauthorized' }); } else { response.body = JSON.stringify({ id: 1, name: faker.person.fullName(), email: faker.internet.email() }); }"
}
```

## What to generate per endpoint type

| OpenAPI pattern | Mock behavior |
|---|---|
| `GET /resources` (list) | faker array of 5-10 items with realistic field values |
| `GET /resources/:id` | faker single item using `request.params.id` |
| `POST /resources` | 201 + echo body with generated `id` and `created_at` |
| `PUT /resources/:id` | 200 + echo body merged with `request.params.id` |
| `PATCH /resources/:id` | 200 + echo body merged with `request.params.id` |
| `DELETE /resources/:id` | 204 + empty body |
| Auth endpoint (`POST /login`) | Return `{ access_token: faker.string.uuid() }` |

## When to use static vs dynamic

- **IDs, timestamps, emails, names**: always dynamic (faker)
- **Enum fields** (status, role, type): use `faker.helpers.arrayElement([...])`
- **Booleans**: use `faker.datatype.boolean()`
- **Prices/amounts**: use `faker.number.float({ min: 1, max: 999, fractionDigits: 2 })`
- **Fixed structure fields** (pagination meta, error shapes): static in `body`
- **Path-param-dependent data**: use `request.params.x` in scripts

## Token efficiency

- Extract only paths, methods, and response schemas from the spec — skip descriptions
- Ask which tags to mock before generating all
- Generate compact JSON
- One script per route, no comments in scripts (they're in `description` field)

## File output — create or update workspace

### If no workspace.json exists, create the full workspace:

```
<project>/
├── workspace.json
└── mocks/
    └── <api-name>.mock.json
```

`workspace.json`:
```json
{
  "version": "1.0",
  "collections": [],
  "environments": [],
  "mocks": ["mocks/<api-name>.mock.json"],
  "activeEnvironmentId": null
}
```

### If workspace.json already exists:

Add the mock file path to the existing `mocks` array (create the array if it doesn't exist). Don't overwrite collections or environments.
