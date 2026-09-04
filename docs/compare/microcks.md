# API Spector vs Microcks

**Short version:** Microcks is a server-side, Kubernetes-native platform for API
mocking and conformance testing across many API styles. API Spector is a
local-first desktop tool (with an optional cloud) for authoring requests, mocks,
and Pact-compatible contract tests. They overlap on mocking and contract testing
but target different deployment models.

## What Microcks is

Microcks is an open-source (CNCF) platform that turns API artifacts (OpenAPI,
AsyncAPI, Postman collections, SoapUI, gRPC, GraphQL) into running mocks and uses
them for contract and conformance testing. It runs as a server, is
Kubernetes-native, and has strong support for event-driven and asynchronous APIs.
It is designed to be shared infrastructure for an organisation.

## Side by side

| | API Spector | Microcks |
|---|---|---|
| Deployment | Desktop app; optional cloud | Server / Kubernetes |
| Local-first authoring | Yes (GUI) | Import artifacts into the server |
| Mock servers | Yes (local and cloud) | Yes, from many artifact types |
| Async / event-driven APIs | No | Yes (AsyncAPI, Kafka, etc.) |
| Contract testing | Pact-compatible (consumer/provider/bi-directional) | Conformance against artifacts |
| Request client (GUI) | Yes | No |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | No |
| Best for | Individuals and teams authoring locally | Shared org-wide mocking infrastructure |

## Where API Spector fits

- **Author locally, no server to run.** Build requests, mocks, and contracts on
  your machine; deploy the cloud only if you want shared, hosted mocks.
- **Pact-compatible contract testing.** Consumer, provider, live verification, and
  bi-directional, with import/export of Pact files.
- **Export to real test code.** Generate Robot Framework, Playwright, Karate, REST
  Assured, or supertest tests.

## Choose Microcks if

- You want shared, server-side mocking and conformance infrastructure, especially
  for event-driven or asynchronous APIs, running in Kubernetes.

## Choose API Spector if

- You want to author and run mocks and contract tests locally, without operating a
  server.
- You want a request client and test-code export alongside mocking and contracts.

> Note: API Spector focuses on synchronous HTTP-style APIs. For AsyncAPI and
> event-driven mocking, Microcks is the better fit.
