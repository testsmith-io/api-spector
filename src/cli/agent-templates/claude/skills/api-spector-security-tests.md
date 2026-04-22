---
name: Generate Security Tests from OpenAPI (OWASP API Top 10)
description: Generate OWASP API Top 10 security test cases with attack payloads for API Spector
---

# Generate Security Tests from OpenAPI (OWASP API Top 10)

## Execution steps — follow in order

### 1. Get the spec

Ask the user for an OpenAPI spec URL or file path. Fetch/read it.

### 2. Analyze auth

Check the spec for `securityDefinitions`, `security`, `securitySchemes`, or login endpoints.

- **No auth found** → skip BOLA, Broken Auth, Function-Level Auth. Only generate: Injection, Security Config, Resource Consumption, SSRF. Do NOT ask for credentials.
- **Auth found** → ask for credential variable names (`{{user_a_token}}`, `{{user_b_token}}`, `{{admin_token}}`, `{{user_b_id}}`).

### 3. Create the workspace + collection + environment

#### If workspace.json already exists

Read it. Add the new security collection/environment to existing arrays.

#### If no workspace exists

Create:
```
{project}/
├── workspace.json
├── collections/{name}-security.spector
└── environments/{name}.env.json
```

Environment must include `baseUrl` from the spec + credential placeholders (if auth exists).

### 4. Tell the user

After creating everything, tell the user:
- "Workspace created with security collection and environment"
- "Open the workspace in API Spector, fill in environment variables, and run"

## Applicability rules

| Condition | BOLA | Auth | Mass Assign | Func Auth | Injection | SSRF | Config | Resources |
|---|---|---|---|---|---|---|---|---|
| Has auth + user IDs in paths | YES | YES | YES | YES | YES | maybe | YES | YES |
| Has auth, no user IDs | no | YES | YES | maybe | YES | maybe | YES | YES |
| No auth at all | no | no | maybe | no | YES | maybe | YES | YES |

## URL syntax — CRITICAL

NEVER use `:param` or `{param}`. Always use `{{variable}}`:
- WRONG: `{{baseUrl}}/users/:id`
- RIGHT: `{{baseUrl}}/users/{{user_b_id}}`

## Variable naming — CRITICAL

Use consistent snake_case. `sp.environment.set("x", ...)` must match `{{x}}` everywhere.

## References

- `.claude/docs/api-spector-scripting-reference.md` — `sp.*` API
- `.claude/docs/security-testing-guide.md` — OWASP patterns
- `.claude/docs/collection-file-format.md` — JSON format

## Token efficiency

- Ask which OWASP categories to focus on before generating all
- Skip categories that don't apply
- Generate in batches if 20+ endpoints
