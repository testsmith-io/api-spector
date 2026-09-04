# API Spector vs Insomnia

**Short version:** Insomnia is a well-designed API client, now maintained by Kong,
that has moved toward accounts and cloud sync. API Spector is local-first, adds
contract testing and test-code export, and never requires an account.

## What Insomnia is

Insomnia is a desktop API client known for a clean interface and support for REST,
GraphQL, gRPC, and WebSockets, plus a design view for OpenAPI specs and a plugin
ecosystem. Since Kong's stewardship it has leaned toward sign-in and cloud
features, which prompted some users to look for offline-first alternatives.

## Side by side

| | API Spector | Insomnia |
|---|---|---|
| Local-first / offline | Yes | Supported, but account and cloud are emphasised |
| Account required | No | Prompted; some features gated |
| Secrets | AES-256-GCM local + external managers | Environment variables, plugins |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Snippets; Inso CLI for its own runner |
| Contract testing | Built in, Pact-compatible | Not built in |
| Mock servers | Local and cloud | Cloud mocks |
| Protocols | HTTP/REST, GraphQL, WebSocket, SOAP, gRPC (unary + server streaming) | HTTP/REST, GraphQL, gRPC, WebSocket |
| Storage | Files (Git-friendly) | Local DB, with cloud/Git sync options |

## Where API Spector fits

- **No account, no nudging.** The app is fully usable offline with nothing to sign
  in to.
- **From request to test code.** Export a collection to Robot Framework,
  Playwright, Karate, REST Assured, or supertest and run it in your stack.
- **Contract testing included.** Pact-compatible consumer/provider verification is
  part of the tool, not a separate product.

## Choose Insomnia if

- You need deeper gRPC (client/bidi streaming, reflection), or you are invested in
  its plugin ecosystem and OpenAPI design view.
- You are happy with its account and cloud-sync model.

## Choose API Spector if

- You want a strictly local-first client with secrets that never leave your
  machine.
- You want contract testing and code export in the same tool.
- You prefer collections stored as files you can review in Git.
