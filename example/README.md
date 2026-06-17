# API Spector — example workspace

A self-contained workspace that demonstrates the core features of API Spector
against the **built-in mock server**. No internet, no third-party services.

## Layout

```
example.spector                       ← open this in the GUI
collections/basics.json               ← GET, POST, PUT, PATCH, DELETE, query params, custom headers
collections/data-extraction.json      ← capture a value and reuse it in later requests
collections/auth-mechanisms.json      ← every supported auth type
mocks/example-mock.mock.json          ← one mock server (port 19200) backing all of the above
```

## Run it

**GUI**

1. Open `example.spector`.
2. In **Mocks**, start *Example API mock* (port **19200**).
3. In **Collections**, run any collection (or a single request). Everything is
   wired to `http://127.0.0.1:19200`.

**CLI**

```bash
# terminal 1 — start the mock
npx -y @testsmith/api-spector mock --workspace ./example.spector

# terminal 2 — run the collections
npx -y @testsmith/api-spector run --workspace ./example.spector
```

## What's inside

### `basics` — everyday requests
| Request | Shows |
|---|---|
| GET a resource | path parameter + asserting on JSON fields |
| GET with query parameters | params defined in the Params tab |
| POST — create a resource | sending a JSON body, asserting `201` + echoed fields |
| PUT — replace a resource | full update |
| PATCH — update fields | partial update |
| DELETE a resource | `204 No Content` |
| Set a custom request header | adds `X-Request-Id: {{$uuid}}`; the mock echoes it back |

### `data-extraction` — chaining requests
| Request | Shows |
|---|---|
| Login (extract token) | post-request script stores the token via `sp.collectionVariables.set('authToken', …)` |
| Use the extracted token | sends `Authorization: Bearer {{authToken}}` captured by the previous request |
| Pre-request script sets a value | a pre-request script computes a value the request then sends as a header |

Run the whole `data-extraction` folder top-to-bottom — values captured by one
request flow into the next.

### `auth-mechanisms` — authentication
One request per supported auth type: none, bearer, basic, API key (header &
query), digest, NTLM, and OAuth2 (client credentials). Each asserts a `200` and
that the server reported the request as authenticated.

> Notes: the mock validates digest/basic/NTLM by shape (the script sandbox has
> no `crypto`/`Buffer`), so those exercise the *flow* rather than re-verifying
> the cryptographic proof. NTLM is not supported through a proxy.

## Templating cheat-sheet

The mock response bodies use `{{…}}` tokens, e.g.:

- `{{request.params.id}}`, `{{request.query.q}}`, `{{request.body.field}}`
- `{{request.headers.authorization}}`, `{{request.bodyRaw}}`
- `{{faker.string.uuid()}}`, `{{dayjs().toISOString()}}`

Requests use the same tokens plus built-ins like `{{$uuid}}` and `{{$timestamp}}`,
and any variable you set in a script (`{{authToken}}`, `{{traceId}}`, …).
