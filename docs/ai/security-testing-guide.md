# API Spector — Security API Testing Guide (OWASP API Top 10)

Use this guide to generate security test cases based on the OWASP API Security Top 10 (2023). Each test case should use the API Spector `sp.*` scripting API.

## Prerequisites

Security tests typically require multiple user identities:
- **User A** (attacker) — a regular user trying to access resources they shouldn't
- **User B** (victim) — the owner of the resources being targeted
- **Admin** — for testing admin-only endpoints with regular credentials

Store tokens in environment variables: `{{user_a_token}}`, `{{user_b_token}}`, `{{admin_token}}`

## API1:2023 — Broken Object-Level Authorization (BOLA)

**What to test**: Can User A access User B's resources by changing the ID?

```javascript
// Request: GET /users/{{user_b_id}} with User A's token
sp.test('[BOLA] cannot access other user profile', function() {
  sp.expect(sp.response.code).to.be.oneOf([403, 404]);
});

// Request: PUT /users/{{user_b_id}} with User A's token
sp.test('[BOLA] cannot modify other user profile', function() {
  sp.expect(sp.response.code).to.be.oneOf([403, 404]);
});

// Request: DELETE /orders/{{user_b_order_id}} with User A's token
sp.test('[BOLA] cannot delete other user order', function() {
  sp.expect(sp.response.code).to.be.oneOf([403, 404]);
});
```

**For each endpoint with an ID parameter**: create a request where User A tries to access User B's resource.

## API2:2023 — Broken Authentication

**What to test**: Authentication bypass, weak tokens, missing validation.

```javascript
// Request with no Authorization header
sp.test('[AUTH] missing token returns 401', function() {
  sp.expect(sp.response.code).to.equal(401);
});

// Request with an invalid/garbage token
sp.test('[AUTH] invalid token returns 401', function() {
  sp.expect(sp.response.code).to.equal(401);
});

// Request with expired token
sp.test('[AUTH] expired token returns 401', function() {
  sp.expect(sp.response.code).to.equal(401);
});
```

## API3:2023 — Broken Object Property-Level Authorization

**What to test**: Mass assignment — can a user set fields they shouldn't?

```javascript
// Request: PUT /users/{{user_a_id}} with body including role: "admin"
sp.test('[MASS-ASSIGN] cannot escalate own role', function() {
  sp.expect(sp.response.code).to.be.oneOf([200, 422]);
  // If 200, verify the role wasn't actually changed
  const json = sp.response.json();
  if (sp.response.code === 200) {
    sp.expect(json.role).to.not.equal("admin");
  }
});

// Request: POST /users with is_admin: true
sp.test('[MASS-ASSIGN] cannot create admin user', function() {
  const json = sp.response.json();
  if (json.is_admin !== undefined) {
    sp.expect(json.is_admin).to.equal(false);
  }
});
```

**For each write endpoint**: include fields that shouldn't be user-settable (role, is_admin, balance, permissions).

## API4:2023 — Unrestricted Resource Consumption

**What to test**: Rate limits, pagination abuse, large payloads.

```javascript
// Request: GET /users?limit=999999
sp.test('[RESOURCE] excessive limit is capped or rejected', function() {
  sp.expect(sp.response.code).to.be.oneOf([200, 400, 422]);
  if (sp.response.code === 200) {
    const json = sp.response.json();
    const items = Array.isArray(json) ? json : json.data ?? [];
    sp.expect(items.length).to.be.most(100);
  }
});

// Request: POST /upload with an extremely large body
sp.test('[RESOURCE] rejects oversized payload', function() {
  sp.expect(sp.response.code).to.be.oneOf([413, 400, 422]);
});
```

## API5:2023 — Broken Function-Level Authorization

**What to test**: Admin endpoints accessible by regular users.

```javascript
// Request: GET /admin/users with regular user token
sp.test('[FUNC-AUTH] admin endpoint rejects regular user', function() {
  sp.expect(sp.response.code).to.be.oneOf([403, 404]);
});

// Request: DELETE /users/{{user_b_id}} with regular user token
sp.test('[FUNC-AUTH] user cannot delete other users', function() {
  sp.expect(sp.response.code).to.be.oneOf([403, 404]);
});
```

**For each endpoint**: determine the expected minimum role and test with a lower-privilege token.

## API6:2023 — Unrestricted Access to Sensitive Business Flows

**What to test**: Business logic abuse.

```javascript
// Request: POST /orders (repeat the same order)
sp.test('[BIZ-FLOW] duplicate order is rejected', function() {
  // Second call with same data should not create a duplicate
  sp.expect(sp.response.code).to.be.oneOf([409, 422, 429]);
});
```

## API7:2023 — Server-Side Request Forgery (SSRF)

**What to test**: URL parameters that the server fetches.

```javascript
// Request with URL field pointing to internal metadata
// e.g. POST /import with { "url": "http://169.254.169.254/latest/meta-data/" }
sp.test('[SSRF] internal URL is blocked', function() {
  sp.expect(sp.response.code).to.be.oneOf([400, 403, 422]);
});

// Same with http://localhost, http://127.0.0.1, http://[::1]
```

**For each endpoint that accepts a URL parameter**: test with internal addresses.

## API8:2023 — Security Misconfiguration

**What to test**: Headers, error verbosity, CORS.

```javascript
// Any endpoint — check security headers
sp.test('[CONFIG] has security headers', function() {
  sp.expect(sp.response.headers.get('x-content-type-options')).to.equal('nosniff');
  // Optional: check for other headers
  // sp.expect(sp.response.headers.get('x-frame-options')).to.not.equal(null);
  // sp.expect(sp.response.headers.get('strict-transport-security')).to.not.equal(null);
});

// Invalid endpoint — check that error doesn't leak stack traces
sp.test('[CONFIG] error response does not expose stack trace', function() {
  const body = sp.response.text();
  sp.expect(body).to.not.include("at Object.");
  sp.expect(body).to.not.include("node_modules");
  sp.expect(body).to.not.include("Exception in thread");
});

// OPTIONS request — check CORS
sp.test('[CONFIG] CORS does not allow *', function() {
  const allow = sp.response.headers.get('access-control-allow-origin');
  if (allow) {
    sp.expect(allow).to.not.equal('*');
  }
});
```

## API9:2023 — Improper Inventory Management

**What to test**: Deprecated or undocumented endpoints still accessible.

This is best tested by comparing the spec against actual behavior:
- Hit known deprecated endpoints → should return 404 or 410
- Hit versioned paths (v1 when v2 is current) → should be blocked or redirected

## API10:2023 — Unsafe Consumption of APIs

**What to test**: Injection through fields that the API passes downstream.

```javascript
// SQL injection in search/filter parameters
// Request: GET /users?search=' OR '1'='1
sp.test('[INJECTION] SQL injection in search returns 400 or safe results', function() {
  sp.expect(sp.response.code).to.be.oneOf([200, 400, 422]);
  if (sp.response.code === 200) {
    const json = sp.response.json();
    const items = Array.isArray(json) ? json : json.data ?? [];
    sp.expect(items.length).to.be.below(50); // should not dump entire table
  }
});

// XSS payload in input fields
// Request: POST /users with name: "<script>alert(1)</script>"
sp.test('[INJECTION] XSS payload is sanitized or rejected', function() {
  sp.expect(sp.response.code).to.be.oneOf([201, 200, 400, 422]);
  if (sp.response.code <= 201) {
    const json = sp.response.json();
    sp.expect(json.name).to.not.include("<script>");
  }
});

// NoSQL injection
// Request: POST /login with { "email": {"$gt": ""}, "password": {"$gt": ""} }
sp.test('[INJECTION] NoSQL injection is rejected', function() {
  sp.expect(sp.response.code).to.be.oneOf([400, 401, 422]);
});
```

## Test plan structure

When generating security tests, organize by OWASP category:

```
Security/
├── BOLA/
│   ├── [BOLA] GET /users/:id — access other user
│   ├── [BOLA] PUT /orders/:id — modify other user order
│   └── ...
├── Auth/
│   ├── [AUTH] No token
│   ├── [AUTH] Invalid token
│   └── [AUTH] Expired token
├── Mass Assignment/
│   ├── [MASS-ASSIGN] Escalate role via PUT /users
│   └── ...
├── Injection/
│   ├── [INJECTION] SQL in search param
│   ├── [INJECTION] XSS in name field
│   └── ...
└── Config/
    ├── [CONFIG] Security headers
    ├── [CONFIG] Error verbosity
    └── [CONFIG] CORS policy
```

Each request should:
1. Have a descriptive name prefixed with the OWASP category
2. Be pre-filled with the attack payload in the body/params/headers
3. Have a post-request script that asserts the expected safe behavior
4. Use the attacker's token (User A) unless testing missing-auth scenarios
