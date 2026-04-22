# API Spector — Collection File Format

Collections are stored as `.spector` JSON files. This document describes the format so AI tools can read and modify collections programmatically.

## File structure

```json
{
  "version": "1.0",
  "id": "uuid",
  "name": "My API",
  "description": "Optional description",
  "rootFolder": { ... },
  "requests": { "request-id": { ... }, ... },
  "collectionVariables": { "key": "value" },
  "auth": { "type": "bearer", "token": "{{access_token}}" },
  "headers": [{ "key": "Accept", "value": "application/json", "enabled": true }]
}
```

## Request object

```json
{
  "id": "unique-id",
  "name": "Get Users",
  "method": "GET",
  "url": "{{baseUrl}}/users",
  "headers": [
    { "key": "Accept", "value": "application/json", "enabled": true }
  ],
  "params": [
    { "key": "page", "value": "1", "enabled": true, "paramType": "query" },
    { "key": "id", "value": "42", "enabled": true, "paramType": "path" }
  ],
  "auth": { "type": "bearer", "token": "{{access_token}}" },
  "body": {
    "mode": "json",
    "json": "{ \"name\": \"Alice\" }"
  },
  "preRequestScript": "sp.environment.set('otp', sp.totp('{{secret}}'));",
  "postRequestScript": "sp.test('status', function() { ... });",
  "schema": "{ \"type\": \"object\", ... }",
  "hookType": "beforeAll",
  "disabled": false
}
```

### Auth types

```json
{ "type": "none" }
{ "type": "bearer", "token": "{{access_token}}" }
{ "type": "basic", "username": "admin", "password": "secret" }
{ "type": "apikey", "apiKeyName": "X-API-Key", "apiKeyValue": "{{key}}", "apiKeyIn": "header" }
```

### Body modes

- `"none"` — no body
- `"json"` — `body.json` contains the JSON string
- `"form"` — `body.form` is an array of `{ key, value, enabled }` pairs
- `"raw"` — `body.raw` contains raw text, `body.rawContentType` is the MIME type
- `"graphql"` — `body.graphql` has `{ query, variables, operationName }`

## Folder structure

```json
{
  "id": "folder-id",
  "name": "Users",
  "description": "",
  "folders": [ ... ],
  "requestIds": ["req-1", "req-2"],
  "auth": { "type": "bearer", "token": "{{admin_token}}" },
  "headers": [{ "key": "X-Tenant", "value": "{{tenant}}", "enabled": true }],
  "tags": ["smoke"]
}
```

Folders can nest. Each folder can define auth and headers that are inherited by all requests within it (overridable at the request level). The root folder is synthetic (name "root") — its subfolders are the visible top-level groups.

## Environment files

Stored as `.env.json`:

```json
{
  "version": "1.0",
  "id": "uuid",
  "name": "Staging",
  "variables": [
    { "key": "baseUrl", "value": "https://staging.api.com", "enabled": true },
    { "key": "admin_password", "value": "", "enabled": true, "secret": true }
  ]
}
```

## Workspace file

`workspace.json` ties collections and environments together:

```json
{
  "version": "1.0",
  "collections": ["collections/users.spector", "collections/orders.spector"],
  "environments": ["environments/staging.env.json"],
  "activeEnvironmentId": "env-uuid"
}
```
