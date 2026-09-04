# API Spector vs Kreya

**Short version:** Kreya is an API client with especially deep gRPC support. API
Spector now speaks gRPC too (unary and server-streaming, from a `.proto`), on top
of REST/HTTP, GraphQL, SOAP, and WebSockets, and adds mock servers, contract
testing, and test-code export. Kreya still goes deeper on gRPC (client and
bidirectional streaming, server reflection); API Spector covers the common cases
inside a broader workflow.

## What Kreya is

Kreya is a desktop API client known for first-class gRPC (including server
reflection and streaming), alongside REST and OpenAPI support. It uses a
freemium model and appeals to teams whose APIs are largely gRPC.

## Side by side

| | API Spector | Kreya |
|---|---|---|
| gRPC | Yes (unary + server streaming) | Yes, deeper (client/bidi streaming, reflection) |
| HTTP/REST | Yes | Yes |
| GraphQL | Yes | Limited |
| SOAP / WebSocket | Yes | Partial |
| Local-first / offline | Yes | Yes |
| Secrets | AES-256-GCM local + external managers | Environment variables |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Not a focus |
| Mock servers | Yes | No |
| Contract testing | Built in, Pact-compatible | No |

## Where API Spector fits

- **Breadth across HTTP-style APIs.** REST, GraphQL, SOAP, and WebSockets, plus
  mocking and contract testing in one place.
- **Runnable test output.** Export to Robot Framework, Playwright, Karate, REST
  Assured, or supertest.
- **Local-first with real secret management.** Encrypted locally, or referenced
  from Vault, AWS, Azure, or 1Password.

## Choose Kreya if

- gRPC is central to your APIs and you need client-streaming, bidirectional
  streaming, or server reflection today.

## Choose API Spector if

- You use gRPC for unary and server-streaming calls and want it alongside REST,
  GraphQL, and SOAP in one client.
- You want contract testing, mock servers, and test-code export alongside the
  client.

> Note: API Spector's gRPC support is a first pass: unary and server-streaming
> calls from a pasted or on-disk `.proto`, with call metadata and TLS/plaintext.
> Client-streaming, bidirectional streaming, and server reflection are on the
> roadmap; if you need them, tell us so we can prioritise.
