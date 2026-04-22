# GitHub Copilot Instructions — API Spector

This project uses **API Spector**, a local-first API testing tool. When working with test scripts, collections, or test generation, refer to the documentation in `.github/docs/`.

## Key references

- **Scripting API**: See `.github/docs/api-spector-scripting-reference.md` for the full `sp.*` API (assertions, response access, variables, TOTP, JSONPath)
- **Collection format**: See `.github/docs/collection-file-format.md` for `.spector` file structure
- **Functional testing**: See `.github/docs/functional-testing-guide.md` for test design patterns
- **Security testing**: See `.github/docs/security-testing-guide.md` for OWASP API Top 10 patterns

## Quick reference

Scripts use the `sp` global:

```javascript
// Test assertion
sp.test('name', function() {
  const json = sp.response.json();
  sp.expect(json.field).to.equal("value");
});

// Variable extraction
sp.environment.set("token", String(sp.response.json().access_token));

// Status check
sp.expect(sp.response.code).to.equal(200);
```

Variables use `{{name}}` interpolation in URLs, headers, body, and scripts.

## When asked to generate tests

1. Read the relevant `.github/docs/` guide
2. Use `sp.test()` blocks with descriptive names
3. Parse JSON once: `const json = sp.response.json();`
4. Cover: happy path, missing fields, wrong types, auth, edge cases
5. Use `sp.environment.set()` for cross-request data flow
