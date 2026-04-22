---
name: Audit API for Inconsistencies
description: Analyze an OpenAPI spec for design inconsistencies, naming violations, missing fields, and best-practice deviations
---

# Audit API for Inconsistencies

Analyze an OpenAPI spec and produce a detailed audit report of design inconsistencies, naming violations, missing documentation, and deviations from REST best practices. This is a read-only analysis — no tests or collections are generated.

## Execution steps — follow in order

1. Ask the user for an OpenAPI spec URL or file path
2. Fetch/read the spec
3. Run every check listed below
4. **Call the Write tool to create `api-audit-report.md` in the project directory.** Do NOT just print results in chat — write the full report to disk as a file.
5. After writing, tell the user: "Audit report written to api-audit-report.md" and show a brief summary (total errors/warnings/info count) in chat.
6. Rate each finding as: **error** (breaks clients), **warning** (inconsistent/confusing), or **info** (suggestion)

## Checks to perform

### 1. Naming consistency

- **Path casing**: are paths consistently kebab-case (`/user-profiles`), snake_case (`/user_profiles`), or camelCase (`/userProfiles`)? Flag any that deviate from the majority.
- **Path pluralization**: are collection endpoints plural (`/users`) and singleton endpoints singular (`/user/{id}`)? Flag inconsistent pluralization like `/user` for a list and `/products` for another list.
- **Parameter naming**: are path/query params consistently camelCase, snake_case, or kebab-case? Flag mixed conventions (e.g. `userId` in one endpoint, `brand_id` in another).
- **Schema property naming**: same casing check across all request/response schemas. Flag if some schemas use `firstName` and others use `first_name`.
- **Operation IDs**: are they present? Are they consistently formatted (camelCase, snake_case)?

### 2. HTTP method usage

- **GET with request body**: GET endpoints should not have a request body. Flag any that do.
- **POST for retrieval**: POST endpoints that only return data (no creation) — might be better as GET with query params.
- **DELETE returning body**: flag DELETE endpoints that return 200 with a body (should typically be 204 No Content).
- **PATCH vs PUT confusion**: flag PUT endpoints that accept partial updates (should be PATCH) or PATCH endpoints that require all fields (should be PUT).

### 3. Response consistency

- **Status codes**: do similar operations return the same codes? E.g. all successful creates return 201, all deletes return 204. Flag inconsistencies (one POST returns 200, another returns 201).
- **Error schema**: do all error responses use the same shape? Flag if some return `{ "message": "..." }` and others return `{ "error": "..." }` or `{ "errors": [...] }`.
- **Pagination**: do all list endpoints use the same pagination structure? Flag if some use `page/per_page`, others use `offset/limit`, and others have no pagination.
- **Envelope consistency**: do some endpoints wrap data in `{ "data": [...] }` while others return bare arrays? Flag the inconsistency.

### 4. Missing documentation

- **Endpoints without descriptions**: list them.
- **Parameters without descriptions**: list the count per endpoint.
- **Schemas without property descriptions**: flag schemas where >50% of properties lack descriptions.
- **Missing examples**: flag request/response schemas without examples (makes the spec harder to use).
- **Missing operationId**: flag endpoints without operationId (breaks code generators).

### 5. Schema issues

- **Identical schemas with different names**: detect schemas that have the same properties/types but different names (copy-paste duplication).
- **Overly permissive types**: flag `type: string` without `format`, `minLength`, `maxLength`, or `pattern` for fields that should be constrained (email, phone, URL, date).
- **Missing required fields**: flag schemas that define properties like `id`, `email`, `name` but don't list them in `required`.
- **Inconsistent ID types**: flag if some schemas use `type: integer` for IDs and others use `type: string`.
- **Nullable vs optional confusion**: flag fields that are nullable but not marked as such, or optional fields that should be required.

### 6. Security

- **Endpoints without security**: flag endpoints that don't reference any security scheme (and aren't public-by-design like login/register).
- **Inconsistent auth**: flag if some endpoints use Bearer tokens and others use API keys without clear reason.
- **Sensitive data in query params**: flag endpoints that pass tokens, passwords, or keys as query parameters (should be headers or body).
- **Missing security schemes**: flag if the spec references security schemes that aren't defined.

### 7. Versioning & deprecation

- **Mixed versioning**: flag if some paths use `/v1/...` and others use `/v2/...` or no version.
- **Deprecated endpoints without replacement**: flag endpoints marked deprecated that don't document what to use instead.
- **Deprecated endpoints without timeline**: flag deprecated endpoints that don't specify when they'll be removed.

### 8. REST best practices

- **Nested resources too deep**: flag paths with more than 3 levels of nesting (e.g. `/users/{id}/orders/{orderId}/items/{itemId}/details`).
- **Verbs in paths**: flag paths that contain action verbs (e.g. `/getUser`, `/createOrder`, `/deleteProduct`) — the HTTP method should convey the action.
- **Inconsistent trailing slashes**: flag if some paths end with `/` and others don't.
- **Missing CORS headers in spec**: flag if no security headers or CORS configuration is documented.

## Output format

```markdown
# API Audit Report: <API Name>

**Spec**: <URL or file>
**Version**: <spec version>
**Endpoints analyzed**: <count>
**Schemas analyzed**: <count>

## Summary

| Category | Errors | Warnings | Info |
|---|---|---|---|
| Naming consistency | 0 | 3 | 1 |
| HTTP method usage | 1 | 0 | 0 |
| Response consistency | 0 | 2 | 0 |
| ... | ... | ... | ... |
| **Total** | **1** | **5** | **1** |

## Findings

### Naming Consistency

#### ⚠️ WARNING: Mixed parameter naming convention
- `GET /users/{userId}` uses camelCase
- `GET /brands/{brand_id}` uses snake_case
- `GET /categories/{categoryId}` uses camelCase
**Recommendation**: Standardize on one convention (snake_case is most common in REST APIs).

#### ℹ️ INFO: Consider adding operationId to all endpoints
- 12 out of 45 endpoints lack operationId
**Recommendation**: Add operationId for better code generation support.

### HTTP Method Usage

#### 🔴 ERROR: GET endpoint has request body
- `GET /reports/custom` defines a request body
**Recommendation**: Use query parameters or POST for complex filters.

...
```

## Important rules

- This is **analysis only** — don't generate tests, collections, or code
- Be specific: list the exact endpoints/schemas that have issues, don't just say "some endpoints"
- Provide concrete recommendations for each finding
- Don't flag things that are valid design choices (e.g. using UUIDs vs integers for IDs is a choice, not an inconsistency — unless both are used)
- Group related findings (e.g. all naming issues together)
- Count the total findings per severity in the summary table

## Token efficiency

- Don't reproduce the full spec in the output
- Cite endpoints by method + path only
- If 20+ endpoints have the same issue, show 3 examples and say "and N more"
