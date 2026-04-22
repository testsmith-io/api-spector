# API Spector — Functional API Testing Guide

Use this guide to generate comprehensive functional test cases for REST APIs. Each endpoint should be tested across multiple categories.

## Test categories per endpoint

### 1. Happy path (positive)
- Send valid data, assert correct status code and response structure
- Verify all required response fields are present and correctly typed

```javascript
sp.test('returns 200 with user data', function() {
  const json = sp.response.json();
  sp.expect(sp.response.code).to.equal(200);
  sp.expect(json.id).to.not.be.oneOf([null, undefined]);
  sp.expect(json.name).to.be.a("string");
  sp.expect(json.email).to.match(/^.+@.+\..+$/);
});
```

### 2. Missing required fields (negative)
- Omit each required field one at a time
- Expect 422 or 400 with a descriptive error

```javascript
sp.test('returns 422 when email is missing', function() {
  sp.expect(sp.response.code).to.equal(422);
  const json = sp.response.json();
  sp.expect(JSON.stringify(json)).to.include("email");
});
```

### 3. Wrong types (negative)
- Send a string where a number is expected, an object where a string is expected, etc.
- Expect 422 or 400

### 4. Boundary values
- Empty strings for string fields
- 0, -1, MAX_INT for numeric fields
- Very long strings (1000+ chars)
- Special characters: `<script>alert(1)</script>`, `'; DROP TABLE--`, unicode

### 5. Authentication
- Missing auth header → 401
- Invalid/expired token → 401
- Valid token, wrong role → 403

### 6. Resource not found
- Request a non-existent ID → 404
- Request with a malformed ID format → 400 or 404

### 7. List/pagination endpoints
- Default pagination returns reasonable count
- `page` and `limit` params work correctly
- Out-of-range page returns empty list (not error)
- Sorting works if supported

### 8. Idempotency
- PUT with same data twice → same result
- DELETE then DELETE again → 404 on second call

## Test naming convention

Use descriptive names that include the endpoint and expected behavior:

```javascript
sp.test('POST /users — valid data returns 201', function() { ... });
sp.test('POST /users — missing email returns 422', function() { ... });
sp.test('GET /users/:id — non-existent ID returns 404', function() { ... });
sp.test('GET /users — unauthorized returns 401', function() { ... });
```

## Variable extraction pattern

When a test creates a resource, extract its ID for subsequent tests:

```javascript
// Post-request script on POST /users
const json = sp.response.json();
sp.environment.set("userId", String(json.id));

// Then GET /users/{{userId}} in a subsequent request uses the created ID
```

## Hook pattern for auth

Create a `beforeAll` hook that logs in and stores the token:

```javascript
// Post-request script on the login hook (POST /auth/login)
const json = sp.response.json();
sp.environment.set("access_token", json.access_token);
```

Then configure the folder/collection auth as Bearer with token `{{access_token}}`.

## Test plan structure

When generating a test plan, organize by endpoint and include:

1. **Endpoint**: method + path
2. **Test cases**: list of scenarios with:
   - Name (descriptive)
   - Category (positive/negative/boundary/auth/edge)
   - Request body (if applicable)
   - Expected status code
   - Assertions to make
3. **Dependencies**: which tests depend on data from earlier tests
4. **Hooks needed**: login, setup data, cleanup

## Example test plan output

```
## POST /users

### Positive
- [x] Valid user creation → 201, response has id, name, email
- [x] Create user with all optional fields → 201

### Negative
- [x] Missing name → 422, error mentions "name"
- [x] Missing email → 422, error mentions "email"
- [x] Invalid email format → 422
- [x] Duplicate email → 409

### Boundary
- [x] Name with 255 characters → 201 (or 422 if max exceeded)
- [x] Empty name → 422
- [x] Price = 0 → 201 or 422 depending on business rule
- [x] Price = -1 → 422

### Auth
- [x] No token → 401
- [x] Expired token → 401

## GET /users

### Positive
- [x] List users → 200, returns array
- [x] Filter by name → 200, filtered results

### Pagination
- [x] ?page=1&limit=10 → 200, max 10 results
- [x] ?page=9999 → 200, empty array
```
