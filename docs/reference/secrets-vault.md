# Secret Managers

API Spector can pull secrets from an external secret manager at run time instead
of storing them. You put a **reference** in a variable or an auth field; API
Spector resolves it to the real value the moment a request is sent, uses it in
memory, and never writes it to the workspace, the results file, or the console.

> This complements the built-in [encrypted secrets](../gui/environments.md).
> Encrypted secrets keep the value (AES-256-GCM) in the workspace; a reference
> keeps **no value at all** — only a pointer. Both work; use whichever you like,
> even in the same environment.

## Built-in providers

| Provider | Reference | Config (environment) |
|---|---|---|
| **HashiCorp Vault** | `vault:<path>#<key>` | `VAULT_ADDR` + token / AppRole / OIDC |
| **AWS Secrets Manager** | `aws:<secretId>#<key>` (or `aws:<secretId>`) | `AWS_REGION` + `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` |
| **Azure Key Vault** | `azure:<vault>/<secret>` | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` |
| **1Password** | `op://<vault>/<item>/<field>` | `OP_CONNECT_HOST` / `OP_CONNECT_TOKEN` (1Password Connect) |

The system is pluggable, so more backends drop in as providers without changing
how you author or run tests — see [Adding another backend](#adding-another-backend).

The rest of this page covers HashiCorp Vault in depth; the other providers follow
the same pattern (reference in a variable/auth field, credentials from the
environment, resolved at send-time and redacted from output).

## The Vault reference format

```
vault:<path>#<key>
```

- `<path>` is the exact Vault API path of the secret
  (`secret/data/app` for KV v2, `kv/app` for KV v1).
- `<key>` is the field within that secret.

Example: `vault:secret/data/payments-api#api_key`.

Use a reference in three ways:

- **Environment variable** — set its *Secret reference* to `vault:secret/data/app#token`.
  In the workspace file that is `"secretRef": "vault:secret/data/app#token"`.
- **Request auth** — Bearer token / Basic password / API key fields accept a
  reference in their `*SecretRef` field (`tokenSecretRef`, `passwordSecretRef`,
  `apiKeySecretRef`, `oauth2ClientSecretRef`).
- **Inline, anywhere** — wrap a reference in `{{ }}` and drop it straight into a
  URL, header, query param, request body, or a pre/post-request script, exactly
  like a variable:

  ```
  {{vault:secret/data/app#token}}
  ```

  These are resolved once, up front, on each send (the same async lookup as the
  other two), then substituted by the normal `{{ }}` interpolation.

> **Redaction note:** values resolved through an **environment variable** or an
> **auth field** are masked from run reports and console output. A value dropped
> **inline** into a body is *not* auto-redacted from what's shown — so for
> sensitive values prefer an env-variable `secretRef` and reference `{{THAT_VAR}}`
> inline, which gives you both the convenience and the masking.

Resolved values are cached in memory for the run (one Vault round-trip per secret
path, honouring the lease TTL) and are automatically **redacted** from run
reports and console output.

## How authentication works

API Spector never stores a Vault token. It acquires one from the ambient context,
trying these in order (the same across the app, the CLI, and CI — only the source
differs):

1. **Explicit token** — `VAULT_TOKEN`
2. **`vault login` token** — `~/.vault-token`
3. **AppRole** — `VAULT_ROLE_ID` + `VAULT_SECRET_ID`
4. **JWT / OIDC** (workload identity, e.g. CI) — `VAULT_JWT` or `VAULT_JWT_PATH`, plus a role

The address and other non-secret bits come from the environment (below) or the
workspace's `settings.secrets.vault` block. **Environment variables always win.**

### Environment variables

| Variable | Purpose |
|---|---|
| `VAULT_ADDR` | Vault base URL (required) |
| `VAULT_NAMESPACE` | Vault Enterprise namespace |
| `VAULT_TOKEN` | Explicit token |
| `VAULT_ROLE_ID` / `VAULT_SECRET_ID` | AppRole login |
| `VAULT_JWT` / `VAULT_JWT_PATH` | JWT for OIDC/JWT login (value or file path) |
| `VAULT_JWT_ROLE` | Role name for JWT/OIDC login |
| `VAULT_AUTH_METHOD` | Force `token` \| `approle` \| `jwt` (otherwise inferred) |
| `VAULT_KV_VERSION` | `auto` (default) \| `1` \| `2` |
| `VAULT_CACERT` | Path to a CA bundle for a private Vault |
| `VAULT_SKIP_VERIFY` | `true` to skip TLS verification (dev only) |

Each also accepts an `API_SPECTOR_VAULT_*` alias (e.g. `API_SPECTOR_VAULT_ADDR`).

### Non-secret config in the workspace (optional)

Commit the address and role so teammates don't have to set them, while the token
still comes from each person's environment:

```jsonc
// my-workspace.spector  ->  settings.secrets.vault
{
  "settings": {
    "secrets": {
      "vault": {
        "address": "https://vault.acme.internal:8200",
        "namespace": "team-payments",
        "authMethod": "approle",
        "roleId": "…",          // the secret id still comes from the environment
        "kvVersion": "2"
      }
    }
  }
}
```

## Per context

The same resolver runs everywhere — the desktop app, `api-spector run`, and cloud
monitors all use one engine, so a reference authored once behaves identically no
matter what executes it. What differs per context is **where the token comes
from** and **where resolution physically happens**.

| Context | Where it runs | Where the token comes from | Where the secret is resolved |
|---|---|---|---|
| **UI** | Your desktop | OIDC browser sign-in, or the shell that launched the app | On your machine, on send |
| **CLI / CI** | Your machine / CI runner | `~/.vault-token`, `VAULT_TOKEN`, AppRole, or OIDC/JWT | On that machine, on run |
| **Monitor** | The private agent, in your network | The agent container's environment | Inside your network, on each scheduled check |

In every case the value is fetched into memory, used for that one execution, and
never written to the workspace, the results file, the console, or (for monitors)
our database.

### UI

The end-to-end flow in the desktop app:

1. **Author a reference.** Put it wherever the secret would go:
   - an environment variable's *Secret reference* field,
   - a request auth field (Bearer / Basic / API key / OAuth2 client secret), or
   - inline as `{{vault:secret/data/app#token}}` in a URL, header, body, or script.

   The workspace file stores only the reference string — never a value.

2. **Configure the connection.** Open **Workspace Settings → Secrets** and fill in
   the provider's non-secret details: Vault address, namespace, auth method, role
   and mount (for OIDC/AppRole), and KV version. These are saved into
   `settings.secrets` in the workspace file so teammates inherit them; **no token
   is ever saved there.**

3. **Get a token.** Either:
   - click **Sign in with OIDC** — the app starts a loopback redirect, opens your
     browser, you authenticate with your IdP, and Vault returns a short-lived
     token that the app holds **in memory** for the session; or
   - launch the app from a shell that already has `VAULT_TOKEN`, a `vault login`
     token at `~/.vault-token`, or AppRole env vars set. The app inherits that
     ambient context.

4. **Send.** On each send the resolver reads the reference's scheme, dispatches to
   the matching provider, fetches the value with the session token, caches it in
   memory keyed by secret path (one round-trip per path per run), substitutes it,
   and sends the request. Values behind an env-variable or auth-field reference
   are **redacted** from the response view and console; an inline value in a body
   is not auto-masked (see the redaction note above).

When the token expires, re-run the OIDC sign-in — nothing is persisted, so there
is nothing to clear.

### CLI / CI

`api-spector run` uses the **exact same references in the exact same workspace
file** — authored in the UI or by hand. There is no interactive sign-in; the
runner takes its token from the ambient environment, trying `VAULT_TOKEN` →
`~/.vault-token` → AppRole → OIDC/JWT in order. Non-secret config (address, role,
KV version) comes from `settings.secrets` in the workspace or from the
environment, and **environment variables always win.**

**Local / a shell you control:**

```bash
vault login -method=oidc               # your normal flow, once
api-spector run --workspace ./ws.spector --env prod
```

**CI — workload identity, nothing stored.** The pipeline exchanges its OIDC token
for a short-lived Vault token, exports it, and the runner picks it up:

```yaml
# GitHub Actions — OIDC -> Vault, no long-lived secret in the repo
- uses: hashicorp/vault-action
  with:
    url: ${{ secrets.VAULT_ADDR }}
    method: jwt
    role: apispector-ci
    exportToken: true            # sets VAULT_TOKEN for later steps
- run: api-spector run --workspace ./ws.spector --env prod
```

AppRole works too — set `VAULT_ROLE_ID` / `VAULT_SECRET_ID` from CI secrets. Or
let API Spector do the JWT login itself with `VAULT_JWT` / `VAULT_JWT_PATH` +
`VAULT_JWT_ROLE`. Resolution and redaction are identical to the UI: per-run,
in-memory, and scrubbed from the JSON / JUnit report.

> **Generated pipeline:** the **Git** panel's "Generate CI" writes this file for
> you (GitHub Actions, GitLab CI, or Azure Pipelines). It detects the secret
> managers a run uses — from environment-variable references **and** from inline
> `{{vault:...}}` anywhere in a request (URL, headers, params, body, auth, or the
> pre/post-request scripts) — and includes the right plumbing automatically. For
> Vault on GitHub that is the
> `hashicorp/vault-action` OIDC step, the `id-token: write` permission, and
> `VAULT_ADDR`; GitLab/Azure get AppRole variables instead. It adds
> `API_SPECTOR_MASTER_KEY` only when the environment actually has at-rest
> encrypted secrets, since a reference has no stored value to decrypt.

### Monitor (API Spector Cloud)

Monitors are **scheduled** and executed by a runner, not by your machine, so the
question is which runner holds the credentials. There are two, and only one can
see your secret manager:

- **Cloud runner (shared).** Runs in API Spector's own infrastructure and serves
  every organization. It has **no access to your private secret manager** and we
  never hold your Vault/AWS/Azure/1Password credentials — so a monitor that
  resolves a private reference **must not** use the cloud runner.
- **Private agent (`runner: agent`, Team plan).** You run the agent container
  **inside your own network**, configured with your secret-manager credentials in
  its environment (`VAULT_ADDR` + token/AppRole, or `AWS_*` / `AZURE_*` / `OP_*`).
  This is the secret-aware runner.

End-to-end flow for a monitor that authenticates:

1. **Author** the request in the desktop app with a reference (an auth
   `*SecretRef` or an inline `{{vault:...}}`), exactly as for any request.
2. **Push it as a monitor** (or paste the reference into the monitor form). The
   cloud stores the request and setup **encrypted at rest** — and because it is a
   reference, there is no secret in there to begin with, only a pointer.
3. **The agent claims the check.** When the monitor is due, the agent pulls the
   definition from the due feed (references intact, no values), because that
   monitor is marked `runner: agent`.
4. **The agent resolves locally.** It runs the same engine as the app, so it takes
   its token from **its own container environment** and fetches the value from
   **your** Vault, over **your** network. The value exists only in the agent's
   memory for that one check.
5. **Only the result comes back.** The agent posts up/down, latency, and captured
   request/response data to the cloud — with secret headers (`Authorization`,
   `Cookie`, `X-Api-Key`, anything matching `token|secret|password|api-key`)
   **redacted** before they leave. The secret itself never reaches us.

```
desktop app ──push──▶ Cloud (stores the reference, encrypted)
                         │  due feed (reference, no value)
                         ▼
                    Private agent  ──resolve──▶ your Vault  (inside your network)
                         │  executes the check
                         ▼
                    post result (up/down, latency, redacted headers) ──▶ Cloud
```

The net effect: **the cloud stores references, never secrets, and never needs a
path to your secret manager.** Rotation, leases, and audit stay entirely in your
Vault. Agent setup (running the container, the environment it needs) is covered
in the API Spector Cloud private-runner docs.

### In a script (any context)

To read a secret in a pre-request (setup) script, reference it from an environment
variable and read that variable through the scripting API — the same in the UI,
the CLI, and a monitor:

```js
// pre-request script — API_TOKEN is `vault:secret/data/app#token`
const token = sp.environment.get('API_TOKEN')   // resolved from the provider
sp.request.headers['Authorization'] = `Bearer ${token}`
```

The value is scoped to that one execution and scrubbed from captured output.

## Adding another backend

Providers are registered by reference scheme (Vault, AWS, Azure and 1Password
ship built in). To add e.g. GCP Secret Manager:

```ts
// src/main/secrets/providers/gcp.ts
import type { SecretProvider } from '../types'
export const gcpProvider: SecretProvider = {
  scheme: 'gcp',
  async resolve(refBody) { /* refBody = "projects/p/secrets/s/versions/latest" */ return /* value */ }
}

// src/main/secrets/index.ts
registerSecretProvider(gcpProvider)   // enables `gcp:...`
```

Nothing in the run or interpolation pipeline changes — `getSecret()` and
`buildEnvVars()` dispatch by scheme automatically.

## Failure behaviour

- A misconfigured or failed lookup for an **environment variable** leaves that
  variable unset and prints a `[secrets]` warning, so only the requests that use
  it fail — the rest of the run continues.
- A failed lookup for a **request auth** field fails that request with the Vault
  error message, so you see exactly what went wrong.
