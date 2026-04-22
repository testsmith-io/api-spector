# API Spector Conventions

This project uses API Spector for API testing. Reference docs are in `.aider/docs/`:

- `api-spector-scripting-reference.md` — `sp.*` API (assertions, variables, TOTP, JSONPath)
- `collection-file-format.md` — `.spector` and `.env.json` structure
- `functional-testing-guide.md` — functional test design patterns
- `security-testing-guide.md` — OWASP API Top 10 test patterns

Use `sp.test()` for assertions, `sp.response.json()` for body parsing, `sp.environment.set()` for cross-request variables.
