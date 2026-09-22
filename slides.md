<!--
API Spector — 45-minute talk
Format: Markdown with `---` slide separators (Marp / reveal.js / Slidev /
Deckset). Demo steps in italics, speaker notes as HTML comments.

Time budget (~45 min):
  Story + about me            8 min   (1–4)
  Tool overview UI vs CLI     3 min   (5)
  Main demo (integrated)     22 min   (6–8)
  Side demos                 10 min   (9–13)
  Wrap-up + Q&A               2 min   (14–15)

Plus ~10 min buffer for improvisation / questions during demos.
-->

# API Spector
## Local, secure, predictable API testing

*Roy de Kleijn — Testsmith*

<!-- Open on presentation-animated.svg as background. Brief intro, name,
let the room settle. -->

---

## Why another API testing tool?

Today's (cloud) tools slow you down and surprise you:

- 💸 Unpredictable pricing and license limits
- 🐢 Throttling and outages
- 🔓 Sensitive test data leaving your network

**Result** — less control over cost, lead time, and compliance.

<!-- Pause here, optionally ask: "Who in the room has hit one of these in
the last year?" — let hands go up, breaks the ice. -->

---

## It can be different

Tests **local**, secure inside your network, integrated into **your own**
pipeline.

> Predictable — repeatable — explainable
> Without vendor lock-in.

That's **API Spector** — an **EU-built**, open, local API testing tool.

One environment for:

- Exploratory testing
- Automated test runs
- Passing variables and tokens between requests
- Contract testing
- Code generation into your stack
- CLI in CI/CD with the same logic
- Built-in mock server

In a moment I'll show you all of this live. Time to take back control over
cost, data location, and secrets.

---

## Who am I

**Roy de Kleijn** — independent under **Testsmith**

- 🎓 Almost full-time delivering training
- ⚡ Remaining time at **Enexis** (Dutch grid operator, Den Bosch)
- 🧪 Maker of **practicesoftwaretesting.com** — a platform to learn software
  testing and try out new automation tools
- 🛠️ And occasionally a tool or library to make testing a bit more pleasant

<!-- Keep this short — 30 seconds. Nobody came for your CV. -->

---

## API Spector — UI and CLI

**User Interface (Electron app)**

- Build REST · SOAP · GraphQL requests
- Run tests with response viewer, history, mock control
- Embedded git client (status, diff, branches, commit, push)

**Command-Line Interface (`api-spector …`)**

- Run tests in CI/CD — same engine as the UI
- Start a mock server without opening the app
- Initialize AI agents (Claude / Cursor / Copilot rules)

> One workspace — two surfaces — no sync.

---

## 🎬 Main demo

> **Step by step through a typical workday**

1. Initialize a new **git project**
2. Build an **API request**
3. Add verifications:
   - via the **response tree view**
   - via **snippets** in Quick Inserts
   - as a **contract** (status / schema / headers)
4. Work with **variables** between requests
5. **Sensitive info** — secrets in the OS keychain
6. Generate **random data** with faker
7. The built-in **diff** for responses
8. **SOAP** request — fetch the WSDL, pick an operation
9. **GraphQL** request — schema introspection
10. **Commit** the tests to the repo — everything plain JSON
11. **GitHub Action** result + generated report

*Time — about 22 minutes total. Step away from the slides — show the work.*

<!-- Backup strategy — if a demo step is sticky, skip and come back later.
Never get stuck on one problem. -->

---

## What we just saw

✅ One workspace, one `.gitignore`, one commit history
✅ No accounts — no tokens to third parties — no telemetry
✅ Verifications on three levels (response level, post-script, contract)
✅ Variables on four scopes (global · collection · environment · session)
✅ Secrets live in the **OS keychain**, not in JSON
✅ SOAP and GraphQL with the same tool, the same flow
✅ CI reports in JUnit XML — readable by GitHub Actions out of the box

---

## And there's more

Aside from the main demo, four things worth showing separately:

1. Importing from **Postman / Bruno**
2. Importing from **OpenAPI** (whole or part)
3. **Code generation** from tests (Playwright · SuperTest · Robot Framework · REST Assured)
4. **Mock server** — from a response, or by recording live traffic

---

## 🎬 Importing existing collections

Migrating from another tool? No crowbar needed.

**Postman** — read `postman_collection.json` directly

**Bruno** — `.bru` files from a Bruno folder

API Spector converts them to its own JSON format. Scripts and assertions are
translated where possible; anything that doesn't map 1-to-1 gets flagged in
the description.

> *Live — import a Postman collection with scripts, run it immediately.*

---

## 🎬 Importing an OpenAPI spec

> *Live demo*

- Upload or paste the URL of an OpenAPI / Swagger spec
- Select **all** endpoints, or just **part** of them
- API Spector generates a POST/GET/PUT/… request per endpoint
- Schemas are automatically attached as a **contract** on the request
- Headers, parameters, security — all pre-filled

**Practical** — useful for smoke-testing a staging environment in minutes.

---

## 🎬 Generating code from your tests

One click — real test code in your stack:

| Framework | Audience |
|---|---|
| **Playwright** (TS / JS) | Front-end teams already using it |
| **SuperTest** (TS / JS) | Node integration suites |
| **Robot Framework** | Keyword-driven QA |
| **REST Assured** (Java) | JVM teams |

The generated code is **yours**. Commit it, run it in your existing CI,
throw API Spector away if you want — no one is stopping you.

> *Live — take a request with scripts → generate Robot → run with `robot`.*

---

## 🎬 Mock server — variant 1 — From Response

> *Live demo*

1. Run a real request
2. **Save as Mock** from the response viewer
3. The mock server takes over the response — status, headers, body, timing
4. Tweak whatever you want — body, content-type, status code
5. Start the mock on `localhost:3900`
6. Front-end or test continues as if a real backend is running

Works for REST, SOAP envelopes, and JSON GraphQL responses.

---

## 🎬 Mock server — variant 2 — Recording live traffic

Backend available but not reliable or fast enough?

```bash
api-spector record \
  --upstream https://api.example.com \
  --port 4001
```

- Send your test traffic through `localhost:4001`
- Every request/response pair is captured
- Stop, import as mock — replay without the backend

> *Live — point at a real API, capture five requests, replay them offline.*

---

## What you take away

✅ **Local-first** — tests on your machine, secrets in your keychain
✅ **Plain-text workspace** — git-diff friendly, PR-able
✅ **One engine** — same behavior in UI and CI
✅ **Contract testing** built-in — consumer and provider
✅ **Code generation** to Playwright / SuperTest / Robot Framework / REST Assured
✅ **Mock server** with recording / WSDL import
✅ **Open**, GPL, no vendor lock-in

---

## Get started

```bash
npm install -g @testsmith/api-spector
api-spector ui
```

- 🌐 **Repo** — github.com/testsmith-io/api-spector
- 📚 **Docs** — in the repo + practicesoftwaretesting.com
- 🐛 **Issues / PRs welcome** — it's GPL

---

## Questions?

*Roy de Kleijn — Testsmith*
*roy@testsmith.io · @yourhandle*

<!-- 5 minutes for Q&A. If the room is silent, throw a question yourself —
"Who currently has test data sitting in the cloud? What would need to happen
to bring it on-prem?" — almost always pulls 1–2 responses. -->
