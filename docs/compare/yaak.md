# API Spector vs Yaak

**Short version:** Yaak is a modern, local-first API client with a polished
interface and broad protocol support. API Spector shares the local-first stance
and adds contract testing and export to real test code.

## What Yaak is

Yaak is an open-source desktop API client, created by a developer with roots in
the Insomnia project. It is offline-first, supports REST, GraphQL, gRPC,
WebSockets, and Server-Sent Events, offers Git sync, and has a plugin system. It
is a sleek, focused client that has grown quickly.

## Side by side

| | API Spector | Yaak |
|---|---|---|
| Local-first / offline | Yes | Yes |
| Account required | No | No |
| Storage | Files (Git-friendly) | Local, with Git sync |
| Secrets | AES-256-GCM local + Vault/AWS/Azure/1Password | Environment variables |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Not a focus |
| Mock servers | Yes (local and cloud) | No |
| Contract testing | Built in, Pact-compatible | No |
| Protocols | HTTP/REST, GraphQL, WebSocket, SOAP, gRPC (unary + server streaming) | HTTP/REST, GraphQL, gRPC, WebSocket, SSE |
| Extensibility | Code export + CLI + Cloud | Plugin system |

## Where API Spector fits

- **Beyond the request client.** If your work extends to mocking, contract
  testing, or generating runnable tests, API Spector includes those.
- **Standard test output.** Export to Robot Framework, Playwright, Karate, REST
  Assured, or supertest and run in existing CI.
- **Contract testing in the box.** Pact-compatible consumer and provider
  verification.

## Choose Yaak if

- You want a modern, lightweight client and need SSE, or gRPC client/bidi
  streaming, today.
- You prefer its plugin-based extensibility and are not looking for contract
  testing or mocking.

## Choose API Spector if

- You want local-first with contract testing, mock servers, and code export in one
  tool.
- You want tests exported to a standard framework rather than kept in the client.
