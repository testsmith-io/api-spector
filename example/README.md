# API Spector example workspace

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
# terminal 1 - start the mock
npx -y @testsmith/api-spector mock --workspace ./example.spector

# terminal 2 - run the collections
npx -y @testsmith/api-spector run --workspace ./example.spector
```

## What's inside

### `basics`: everyday requests
| Request | Shows |
|---|---|
| GET a resource | path parameter + asserting on JSON fields |
| GET with query parameters | params defined in the Params tab |
| POST a new resource | sending a JSON body, asserting `201` + echoed fields |
| PUT to replace a resource | full update |
| PATCH to update fields | partial update |
| DELETE a resource | `204 No Content` |
| Set a custom request header | adds `X-Request-Id: {{$uuid}}`; the mock echoes it back |

### `data-extraction`: chaining requests
| Request | Shows |
|---|---|
| Login (extract token) | post-request script stores the token via `sp.collectionVariables.set('authToken', …)` |
| Use the extracted token | sends `Authorization: Bearer {{authToken}}` captured by the previous request |
| Pre-request script sets a value | a pre-request script computes a value the request then sends as a header |

Run the whole `data-extraction` folder top-to-bottom; values captured by one
request flow into the next.

### `auth-mechanisms`: authentication
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

## Contract testing (Toolshop API)

The `Contract testing (Toolshop API)` collection runs against the public
[Toolshop demo API](https://api.practicesoftwaretesting.com) and shows all
three contract styles on real endpoints:

- **List brands**: Pact-style body matcher (`string` matchers + a `regex` slug)
- **List products**: hand-written JSON Schema for the pagination envelope
- **Category tree**: matcher example with a `null` matcher and a nested array

A snapshot of the Toolshop OpenAPI spec is pinned under `contracts/`, and three
verification results are pre-recorded under `contracts/results/` so the
dashboard has data out of the box:

```bash
# View the dashboard (or use the docker image, see docs/cli/docker.md)
npx api-spector contract report --workspace example/example.spector --serve --port 8080

# Re-run and re-record each mode yourself
npx api-spector contract run --workspace example/example.spector \
  --mode consumer      --collection "Contract testing (Toolshop API)" \
  --record --pacticipant toolshop-web --app-version 1.0.0

npx api-spector contract run --workspace example/example.spector \
  --mode provider      --collection "Contract testing (Toolshop API)" \
  --snapshot "toolshop-api 5.0.0" --record --pacticipant toolshop-web --app-version 1.1.0

npx api-spector contract run --workspace example/example.spector \
  --mode bidirectional --collection "Contract testing (Toolshop API)" \
  --snapshot "toolshop-api 5.0.0" --record --pacticipant toolshop-web --app-version 1.2.0

# Deployment gate
npx api-spector contract can-i-deploy --workspace example/example.spector \
  --pacticipant toolshop-web --app-version 1.2.0
```

The example also records two deployments: prod runs the passing 1.2.0, and
staging runs the failing 2.0.0 (recorded with a skipped gate, which prints a
warning). The dashboard shows both in its Environments table:

```bash
npx api-spector contract environments --workspace example/example.spector

npx api-spector contract can-i-deploy --workspace example/example.spector \
  --pacticipant toolshop-web --app-version 1.1.0 --to prod
```

The workspace also carries a `contracts/webhooks.json` pointing at
`127.0.0.1:18094` as a harmless demo: start `contract report --serve`, run any
`record-deployment`, and watch the serve log report the delivery attempt.

## Fuzzing

The pinned Toolshop spec also drives fuzzing. Point it at a provider and it
sends malformed variants of each request body, flagging any that crash the
server (5xx) or get accepted despite violating the spec:

```bash
npx api-spector contract fuzz --workspace example/example.spector \
  --snapshot "toolshop-api 5.0.0" \
  --provider-base-url https://api.practicesoftwaretesting.com \
  --include-writes --html fuzz-report.html
```

The Toolshop endpoints in this collection are read-only GETs, so a default run
(without `--include-writes`) reports them as skipped. Fuzzing is most useful
against write endpoints on a staging environment or a local mock.

See [Contract Testing Types](../docs/reference/contract-testing-types.md) for
what the modes mean and when to use each.

### Detecting a breaking API version (v5 vs v4)

The example also pins the **v4** Toolshop spec (`toolshop-api-v4 4.0.0`), which
documents a genuinely different `/products` shape: product `id` is an integer
(v5: string ULID) and `in_stock` does not exist yet. Running the same consumer
contracts against the v4 spec flags every difference statically, without any
HTTP call:

```bash
npx api-spector contract run --workspace example/example.spector \
  --mode bidirectional --collection "Contract testing (Toolshop API)" \
  --snapshot "toolshop-api-v4 4.0.0" \
  --record --pacticipant toolshop-web --app-version 2.0.0
```

Output:

```
  ✗ 3/3 failed (0 passed)

    GET List products (paginated)
      · schema_incompatible: Consumer requires field "data[].in_stock" which is not defined in provider schema
      · schema_incompatible: Type mismatch at "data[].id": consumer expects "string", provider offers "integer"
```

That failing run is pre-recorded as `toolshop-web@2.0.0`, so the dashboard
shows a red cell next to the three green ones, and the deployment gate blocks
it (exit code 1):

```bash
npx api-spector contract can-i-deploy --workspace example/example.spector \
  --pacticipant toolshop-web --app-version 2.0.0
# ✗ Computer says no.
```

To see the same break at runtime instead of on paper, point the collection
variable `TOOLSHOP_URL` at `https://api-v4.practicesoftwaretesting.com` and run
`--mode consumer`: the live v4 responses fail the same contracts.
