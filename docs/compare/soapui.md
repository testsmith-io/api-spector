# API Spector vs SoapUI

**Short version:** SoapUI is a long-established, powerful tool for functional,
security, and load testing of SOAP and REST APIs, with deep XML and Groovy
scripting. API Spector is a modern, local-first client that adds mock servers,
contract testing, and export to real test code. SoapUI goes deeper on SOAP and on
load/security testing; API Spector is lighter, covers contract testing, and fits
a code-and-Git workflow.

## What SoapUI is

SoapUI (by SmartBear) is an open-source, Java desktop application known for
thorough SOAP support (WSDL-driven), REST testing, assertions, Groovy scripting,
and data-driven tests. It has been a standard in enterprise API testing for years.
Its strengths are depth and its testing breadth; the trade-offs are a heavier,
XML-centric, somewhat dated experience. The commercial [ReadyAPI](readyapi.md)
builds on it with a modern UI and more features.

## Side by side

| | API Spector | SoapUI |
|---|---|---|
| SOAP / WSDL | Yes (WSDL-driven editor) | Yes, a core strength |
| REST / HTTP | Yes | Yes |
| GraphQL / WebSocket | Yes | Limited |
| gRPC | Yes (unary + server streaming) | No |
| Functional testing | Yes | Yes |
| Load testing | No | Yes |
| Security testing | No | Yes (more in ReadyAPI) |
| Contract testing | Built in, Pact-compatible | No |
| Mock servers | Yes | Yes (SOAP/REST mocks) |
| Export to test code | Robot Framework, Playwright, Karate, REST Assured, supertest | Groovy scripts |
| Footprint / UI | Lightweight, modern | Heavier, Java desktop |
| Secrets | AES-256-GCM local + external managers | Properties / project files |

## Where API Spector fits

- **Modern and light.** A fast desktop client instead of a heavy Java suite, while
  still handling SOAP via a WSDL-driven editor.
- **Contract testing built in.** Pact-compatible consumer and provider
  verification, which SoapUI does not offer.
- **Export to standard frameworks.** Generate Robot Framework, Playwright, Karate,
  REST Assured, or supertest, rather than maintaining Groovy scripts.
- **Local-first with real secret management.** Encrypted locally, or referenced
  from Vault, AWS, Azure, or 1Password.

## Choose SoapUI if

- You need load testing or security testing alongside functional tests.
- Your work is heavily SOAP/XML and you rely on Groovy scripting.

## Choose API Spector if

- You want a modern, local-first client with contract testing and code export.
- You test REST, GraphQL, and SOAP and want mocking in the same tool.
- You prefer collections as files you can review in Git.

> Note: API Spector does not do load or security testing. For those, SoapUI or
> ReadyAPI is the better fit.
