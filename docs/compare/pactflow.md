# API Spector vs PactFlow

**Short version:** PactFlow is a hosted, enterprise contract-testing platform built
around the Pact ecosystem. API Spector is a local-first tool where you author and
run Pact-compatible contract tests next to your requests and mocks, with an
optional cloud broker. For large Pact deployments PactFlow is the mature choice;
for teams that want contract testing integrated with their client and without a
required SaaS, API Spector fits.

## What PactFlow is

PactFlow (by SmartBear) is a commercial, hosted Pact Broker plus bi-directional
contract testing. It stores and shares contracts and verification results,
provides `can-i-deploy`, integrates with CI, and adds enterprise features on top
of open-source Pact. It is a platform teams adopt when they run consumer-driven
contract testing at scale.

## Side by side

| | API Spector | PactFlow |
|---|---|---|
| Pact-compatible | Yes (import/export Pact files, matchers) | Yes (built on Pact) |
| Where you author contracts | In the app, alongside requests | In your Pact test code |
| Consumer / provider verification | Yes | Yes |
| Live provider verification with states | Yes | Yes (via Pact) |
| Bi-directional contracts | Yes | Yes |
| Deploy gate | Local `deploy-check` | `can-i-deploy` against the hosted broker |
| Broker | Optional (API Spector Cloud) | Hosted broker is the core product |
| Hosting model | Local-first; optional SaaS | SaaS (or self-managed broker) |
| Also a request client / mocks | Yes | No |

## Where API Spector fits

- **Author and run contracts where you already work.** Design-first contracts sit
  next to the requests and mocks in the same app; no separate authoring step.
- **Local by default.** Run consumer and provider verification and the
  `deploy-check` gate locally, with no SaaS required to get started.
- **Broker when you need one.** [API Spector Cloud](https://api-spector.dev)
  provides a hosted broker to share contracts and verification results across
  teams.
- **Pact-compatible.** Import and export Pact files and use Pact-style matchers,
  so you can interoperate with an existing Pact setup.

## Choose PactFlow if

- You already run Pact at scale and want the mature, dedicated broker with its
  enterprise features and integrations.
- A hosted broker as the center of your workflow is exactly what you want.

## Choose API Spector if

- You want contract testing integrated with your request client and mocks.
- You prefer to start locally, with an optional broker rather than a required one.
- You want design-first authoring in addition to code-driven Pact tests.
