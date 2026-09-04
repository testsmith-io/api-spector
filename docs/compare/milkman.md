# API Spector vs Milkman

**Short version:** Milkman is an open-source, plugin-based API client built for
extensibility and Git-friendly storage. API Spector shares the local-first, files
in-Git approach but ships a broader, more polished workflow out of the box:
mocking, contract testing, and test-code export.

## What Milkman is

Milkman is an open-source, extensible API client (built on the JVM) whose features
come largely from plugins. It stores requests as text you can keep in Git and
appeals to developers who want a hackable, keyboard-driven tool they can extend.
It is community-driven, and capabilities depend on which plugins you add.

## Side by side

| | API Spector | Milkman |
|---|---|---|
| Local-first / offline | Yes | Yes |
| Account required | No | No |
| Storage | Files (Git-friendly) | Files (Git-friendly) |
| Out-of-the-box features | Client, mocks, contracts, code export | Core client; rest via plugins |
| Secrets | AES-256-GCM local + Vault/AWS/Azure/1Password | Plugin-dependent |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Plugin-dependent |
| Mock servers | Yes | Plugin-dependent |
| Contract testing | Built in, Pact-compatible | No |
| Protocols | HTTP/REST, GraphQL, WebSocket, SOAP, gRPC (unary + server streaming) | HTTP/REST, GraphQL (plugins) |

## Where API Spector fits

- **Batteries included.** Mocking, contract testing, and code export work without
  assembling plugins.
- **Consistent, polished UI.** A single integrated experience rather than a core
  plus community add-ons.
- **Secret management built in.** Encrypted locally or referenced from an external
  manager.

## Choose Milkman if

- You want a hackable, plugin-driven client and enjoy extending your own tooling.

## Choose API Spector if

- You want the local-first, Git-friendly model with mocking, contract testing, and
  code export ready out of the box.
