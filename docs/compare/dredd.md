# API Spector vs Dredd

**Short version:** Dredd checks that a running API matches its OpenAPI (or API
Blueprint) description. API Spector does that kind of provider verification too,
and adds consumer-driven contracts, mocking, a request client, and test-code
export. Dredd is a focused CLI; API Spector is a broader workflow.

## What Dredd is

Dredd is an open-source, language-agnostic CLI that validates an API
implementation against its API description. It reads your OpenAPI or API Blueprint
spec, sends the described requests to your backend, and checks the responses,
with hooks for setup and teardown. It is a solid tool for one job: spec-to-backend
conformance in CI.

## Side by side

| | API Spector | Dredd |
|---|---|---|
| Spec-to-backend conformance | Yes (provider verification) | Yes, its core purpose |
| Consumer-driven contracts | Yes | No |
| Bi-directional contracts | Yes | No |
| Pact-compatible | Yes | No |
| Provider states | Yes | Via hooks |
| Request client (GUI) | Yes | No, CLI only |
| Mock servers | Yes | No |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | No |
| Reports | HTML / JUnit | CLI / reporters |

## Where API Spector fits

- **More than conformance.** Alongside checking a provider against a spec, API
  Spector supports consumer-driven and bi-directional contracts, so both sides of
  an integration are covered.
- **Author interactively, run in CI.** Build and explore requests in the app, then
  run verification and the `deploy-check` gate from the CLI.
- **Mocks and code export included.** Stand up a mock from a contract, and generate
  runnable tests for your framework.

## Choose Dredd if

- You only need to verify a backend against an OpenAPI or API Blueprint spec from
  the CLI, and want a small, single-purpose tool.

## Choose API Spector if

- You want consumer-driven and bi-directional contracts, not just spec
  conformance.
- You want a request client, mocking, and test-code export in the same tool.
