# HTTP Files (`.http` / `.rest`)

API Spector imports and exports the `.http` file format shared by the **VSCode REST Client** and **IntelliJ HTTP Client**. This lets you move collections in and out of an editor-native, Git-friendly, plain-text format that many teams already keep alongside their code.

A `.http` file is a flat list of requests separated by `###`:

```http
@baseUrl = https://api.example.com
@token = abc123

### Get a pet
# @name getPet
GET {{baseUrl}}/pets/1
Authorization: Bearer {{token}}
Accept: application/json

### Create a pet
POST {{baseUrl}}/pets
Content-Type: application/json

{
  "name": "Fluffy",
  "id": {{$guid}}
}
```

---

## Import

**Collections → Import → HTTP file**, then pick a `.http` or `.rest` file.

What gets mapped:

| `.http` construct | Becomes |
|-------------------|---------|
| `###` (with optional label) | A request boundary; the label is the request name |
| `# @name foo` | The request name (takes priority over the `###` label) |
| `METHOD URL [HTTP/1.1]` | Method + URL (method defaults to `GET` if omitted) |
| Wrapped `?a=1` / `&b=2` lines | Folded into the request URL |
| `Header: value` lines | Request headers |
| `Authorization: Bearer …` | Lifted into structured **bearer** auth |
| Request body (after the blank line) | Body — `json`, form, or raw by `Content-Type` |
| `@name = value` | Collection variables |
| `{{$guid}}`, `{{$timestamp}}`, … | Mapped to API Spector [dynamic variables](../reference/faker.md) |

Requests import into a flat collection (the format has no folders). IntelliJ pre-request / response-handler script blocks (`< {% … %}`, `> {% … %}`) are stripped on import — script translation isn't supported yet.

---

## Export

**Export to Code → HTTP file** (in the code generation panel). The whole collection is written to a single `.http` file:

- Collection variables and the active environment's non-secret variables are emitted as `@name = value` declarations at the top.
- Each request becomes a `### <name>` block with its method, URL (including enabled query parameters), headers, and body.
- Structured auth is serialised back to a header: **bearer** → `Authorization: Bearer …`, **API key** → its header (or a query parameter), **basic** → `Authorization: Basic …`.
- A `Content-Type` header is added automatically when a body needs one and the request doesn't already set it.
- API Spector dynamic variables are mapped back to REST Client names (e.g. `{{$uuid}}` → `{{$guid}}`).

> **Secrets are never written.** Environment variables marked as secret are omitted from the exported `@` declarations — reference them by name and supply the value in your editor.

---

## Round-tripping

Import → export → import is stable for the common surface (requests, methods, URLs, headers, bearer auth, bodies, and variables). Some things don't survive a round-trip because the format can't express them:

- **Folders** — the format is flat, so nested structure is lost on export.
- **Scripts** — pre-request / post-response scripts aren't serialised.
- **`{{$randomInt min max}}`** — imports as `{{$randomInt}}` (arguments dropped), since API Spector's dynamic variable takes no range.

For a lossless, structured contract format, use [Pact import/export](../reference/pact-compatibility.md) or keep the native `.spector` collection under Git.
