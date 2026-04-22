# AI Agents

API Spector ships with built-in support for AI-powered test generation. The `agents` CLI command scaffolds instruction files for popular AI coding tools, enabling them to generate functional test plans and OWASP security tests directly from your OpenAPI spec.

## Quick start

```bash
# Initialize for your AI tool of choice
api-spector agents init claude      # Claude Code
api-spector agents init copilot     # GitHub Copilot
api-spector agents init cursor      # Cursor
api-spector agents init windsurf    # Windsurf
api-spector agents init aider       # Aider
api-spector agents init all         # All tools at once

# List available agents
api-spector agents list
```

## What gets created

Every `agents init` command copies two things into your project:

### 1. Tool-specific instruction files

These tell your AI coding tool where to find the API Spector knowledge base and how to use it.

| Agent | Files created | How the tool reads them |
|---|---|---|
| **Claude Code** | `.claude/skills/api-spector-functional-tests/SKILL.md`<br>`.claude/skills/api-spector-security-tests/SKILL.md` | Discovered via `/skills` command, invoked with `/api-spector-functional-tests` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Auto-loaded in Copilot Chat for every conversation |
| **Cursor** | `.cursor/rules/api-spector.mdc` | Auto-loaded as a rule when editing `.spector` or `.env.json` files |
| **Windsurf** | `.windsurfrules` | Auto-loaded for all conversations in the project |
| **Aider** | `conventions.md` | Read by Aider as project conventions |

### 2. Shared documentation (tool-agnostic)

These are the actual knowledge files that any AI tool reads. They live in `docs/ai/` and contain everything the AI needs to generate correct API Spector scripts:

| File | Content |
|---|---|
| `docs/ai/api-spector-scripting-reference.md` | Full `sp.*` API reference: assertions, response access, variables, TOTP, JSONPath, hooks, schema validation |
| `docs/ai/collection-file-format.md` | `.spector` collection file JSON structure, request/folder/environment/workspace format |
| `docs/ai/functional-testing-guide.md` | Test design patterns: happy path, negative, boundary, auth, pagination, idempotency |
| `docs/ai/security-testing-guide.md` | OWASP API Security Top 10 test patterns with attack payloads and assertion scripts |

## Using with Claude Code

### Setup

```bash
cd /path/to/your/project
api-spector agents init claude
```

This creates two skills:
- `.claude/skills/api-spector-functional-tests/SKILL.md`
- `.claude/skills/api-spector-security-tests/SKILL.md`

### Verify

In Claude Code, type `/skills` to confirm they appear:

```
❯ /skills

Skills:
  api-spector-functional-tests  — Generate functional tests from OpenAPI
  api-spector-security-tests    — Generate OWASP API Top 10 security tests
```

### Generate functional tests

```
/api-spector-functional-tests

Generate functional tests from https://api.example.com/docs/api-docs.json.
Write a .spector collection with tests for all endpoints.
Use {{admin_email}} and {{admin_password}} for the login hook.
```

Claude Code will:
1. Fetch the OpenAPI spec
2. Read the `docs/ai/` reference docs to understand the `sp.*` scripting API
3. Create a `.spector` collection file with:
   - A folder per API tag (Users, Products, Orders, etc.)
   - A login `beforeAll` hook that extracts `{{access_token}}`
   - Multiple requests per endpoint: happy path, missing fields, wrong types, boundary values, auth tests
   - `postRequestScript` on each request with `sp.test()` assertions
   - `request.schema` set from the spec's response schemas
4. Create an environment file with `baseUrl` and credential placeholders
5. Write the files to disk

### Generate security tests

```
/api-spector-security-tests

Analyze https://api.example.com/docs/api-docs.json for OWASP API Top 10 vulnerabilities.
Use {{user_a_token}} as attacker, {{user_b_token}} as victim, {{admin_token}} for admin.
```

Claude Code will generate a security test collection organized by OWASP category:
- **BOLA** — User A accessing User B's resources
- **Broken Auth** — missing/invalid/expired tokens
- **Mass Assignment** — injecting forbidden fields (role, is_admin)
- **Injection** — SQL, XSS, NoSQL payloads in input fields
- **Function-Level Auth** — admin endpoints with regular tokens
- **Security Config** — security headers, error verbosity, CORS

Each test request comes pre-filled with the attack payload and a post-request script that asserts the API blocks the attack.

### Example output

After running the functional test skill, you get a collection like:

```
Auth / Login/
├── [beforeAll] Login as admin     — POST /users/login → extracts {{access_token}}
├── [beforeAll] Login as customer  — POST /users/login → extracts {{customer_token}}

Users/
├── POST /users/register — valid data           → expects 201, validates response fields
├── POST /users/register — missing email         → expects 422, checks error message
├── POST /users/register — invalid email format  → expects 422
├── POST /users/register — weak password         → expects 422
├── POST /users/login — valid credentials        → expects 200, validates access_token
├── POST /users/login — invalid credentials      → expects 401
├── GET /users/me — authenticated                → expects 200, extracts user ID
├── GET /users/me — no auth                      → expects 401
├── GET /users — admin lists users               → expects 200, validates array
├── GET /users — no auth                         → expects 401
└── ...

Products/
├── GET /products — list                         → expects 200, extracts product_id
├── GET /products — paginated                    → expects 200, validates page size
├── POST /products — valid data                  → expects 201
├── POST /products — missing name                → expects 422
└── ...
```

Open this in API Spector, load the workspace, fill in the environment variables, and run the collection.

## Using with GitHub Copilot

### Setup

```bash
api-spector agents init copilot
```

### Usage

Copilot reads `.github/copilot-instructions.md` automatically. In Copilot Chat, just ask:

```
Generate functional test scripts for the Users endpoints in my collection.
Cover happy path, negative, and auth tests. Use sp.test() with sp.expect().
```

Copilot will reference the instructions file and the `docs/ai/` docs to generate correct `sp.*` scripts.

## Using with Cursor

### Setup

```bash
api-spector agents init cursor
```

### Usage

Cursor reads `.cursor/rules/api-spector.mdc` automatically when you're working with `.spector` files. In Cursor's Composer, ask:

```
Add negative test cases for all POST endpoints in this collection.
For each required field, generate a request that omits it and asserts 422.
```

## Using with Windsurf

### Setup

```bash
api-spector agents init windsurf
```

### Usage

Windsurf reads `.windsurfrules` automatically. In Windsurf's chat:

```
Generate OWASP security tests for this API collection.
Focus on BOLA and injection attacks.
```

## Using with any other LLM

If your AI tool isn't listed, you can still use the knowledge base. Copy the content of `docs/ai/api-spector-scripting-reference.md` and `docs/ai/functional-testing-guide.md` into your LLM conversation as context, then ask it to generate tests.

For ChatGPT, Claude.ai, or any web-based LLM:

1. Paste the content of `docs/ai/api-spector-scripting-reference.md`
2. Paste your OpenAPI spec (or the relevant endpoints)
3. Ask: "Generate API Spector test scripts for each endpoint"

The scripting reference teaches the LLM the `sp.*` API, assertion chains, variable scopes, and hook patterns — everything it needs to produce correct scripts.

## Re-running is safe

Running `agents init` again on the same project is safe:
- Files that haven't changed show `(unchanged)`
- Files with updated content show `(updated)`
- No data is lost, no duplicates created

```bash
$ api-spector agents init claude

  Claude Code
    = .claude/skills/api-spector-functional-tests/SKILL.md (unchanged)
    = .claude/skills/api-spector-security-tests/SKILL.md (unchanged)

  Shared documentation
    = docs/ai/api-spector-scripting-reference.md (unchanged)
    = docs/ai/collection-file-format.md (unchanged)
    = docs/ai/functional-testing-guide.md (unchanged)
    = docs/ai/security-testing-guide.md (unchanged)

  Done. Your AI agent can now generate API Spector tests.
```

## Customizing the skills

The skill files and documentation are plain markdown — you can edit them after initialization. Common customizations:

- **Add your API's business rules** to the functional testing guide so the AI generates domain-specific tests
- **Add your auth flow** to the security testing guide so the AI uses the correct login endpoints
- **Add custom assertion patterns** to the scripting reference if your team has conventions

Your edits will show as `(updated)` on the next `agents init` run, and you'll be asked whether to keep your version or update.
