# API Spector vs Bruno

**Short version:** Bruno and API Spector share a philosophy: local-first, offline,
Git-friendly, no mandatory account. Bruno is a focused, lightweight API client.
API Spector covers the same ground and adds mock servers, contract testing, and
export to real test code.

## What Bruno is

Bruno is an open-source, offline-first API client that stores each request as a
plain-text file (its `.bru` markup) in a folder you keep in Git. It rejected the
cloud-account model on principle and is popular with developers who want a fast,
simple client whose collections live in the repo. Its scope is intentionally
narrow: it is a very good request client.

## Side by side

| | API Spector | Bruno |
|---|---|---|
| Local-first / offline | Yes | Yes |
| Account required | No | No |
| Storage | Files (Git-friendly) | Files, `.bru` markup (Git-friendly) |
| Secret managers | Vault, AWS, Azure, 1Password (+ AES-256-GCM local) | Env files, `.env`, secret vars |
| GraphQL query builder | Yes, introspection-driven | Yes |
| SOAP + WSDL loader | Yes, load a WSDL and generate the envelope | No |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Not a focus |
| Mock servers | Yes (local and cloud) | No |
| Contract testing | Built in, Pact-compatible | No |
| OpenAPI test coverage | Yes, with a CI gate | No |
| Protocols | HTTP/REST, GraphQL, WebSocket, SOAP, gRPC (unary + server streaming) | HTTP/REST, GraphQL, gRPC |
| Scope | Client + mocks + contracts + code export | Focused request client |

## Where API Spector fits

Bruno and API Spector agree on the fundamentals, so the choice is about scope.

- **Author faster.** An introspection-driven GraphQL query builder, a SOAP WSDL loader that fills in the envelope, and Vault / AWS / Azure / 1Password secret references, all built in - no plugins.
- **More of the workflow in one place.** If you also need mock servers, contract
  testing, or to generate runnable tests, API Spector covers those without adding
  another tool.
- **Export to standard frameworks.** Turn a collection into Robot Framework,
  Playwright, Karate, REST Assured, or supertest.
- **Optional cloud when you want it.** Hosted mocks, monitors, and a contract
  broker are available but never required.

## Choose Bruno if

- You want the leanest possible local client and nothing more.
- You specifically prefer its `.bru` text format, or you already use gRPC in it.

## Choose API Spector if

- You want the same local-first, Git-friendly approach but also need mocking,
  contract testing, or test-code generation.
- You want a single tool for the request-to-contract-to-CI workflow.
