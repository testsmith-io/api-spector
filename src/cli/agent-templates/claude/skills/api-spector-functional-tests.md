---
name: Generate Functional Tests from OpenAPI
description: Fetch an OpenAPI spec and generate an API Spector collection with functional test scripts
---

# Generate Functional Tests from OpenAPI

## Execution steps — follow in order

### 1. Get the spec

Ask the user for an OpenAPI spec URL or file path. Fetch/read it.

### 2. Create the workspace + collection + environment

#### If workspace.json already exists

Read it. Add the new collection/environment to existing arrays.

#### If no workspace exists

Create:
```
{project}/
├── workspace.json
├── collections/{name}.spector
└── environments/{name}.env.json
```

Environment must include `baseUrl` from the spec + credential placeholders.

### 3. Tell the user

After creating everything, tell the user:
- "Workspace created with collection and environment"
- "Open the workspace in API Spector, fill in environment variables, and run"

## URL and path parameters — CRITICAL

NEVER use `:param` or `{param}`. Always use `{{variable}}`:
- WRONG: `{{baseUrl}}/brands/:id`
- RIGHT: `{{baseUrl}}/brands/{{brand_id}}`

Every `{{var}}` in a URL must be set by a prior request via `sp.environment.set("var", ...)`.

## Variable naming — CRITICAL

Use simple snake_case. The name in `sp.environment.set("x", ...)` MUST exactly match every `{{x}}` reference.

Before outputting, build a dependency chain and verify every `{{var}}` has a matching setter that runs first.

## Collection structure

- One folder per API tag
- `beforeAll` login hook that extracts `{{access_token}}`
- ONE request per test scenario
- `postRequestScript` with `sp.test()` assertions
- Path params as `paramType: "path"` in params array AND `{{var}}` in URL
- Use `{{baseUrl}}` prefix
- Order: list/create before get/update/delete (so IDs are extracted first)

## References

- `.claude/docs/api-spector-scripting-reference.md` — `sp.*` API
- `.claude/docs/functional-testing-guide.md` — test patterns
- `.claude/docs/collection-file-format.md` — JSON format

## Token efficiency

- Extract only paths, methods, required fields from spec
- Ask which tags to cover, generate one at a time
- Skip boilerplate headers (Accept/Content-Type are defaults)
- Use compact JSON
