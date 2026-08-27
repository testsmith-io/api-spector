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

### App (UI)
Open **Workspace Settings → Secrets** and fill in the Vault address (and role /
mount for OIDC). Then either:

- click **Sign in with OIDC** — the app opens your browser, you authenticate with
  your IdP, and the short-lived token is used for that session; or
- start the app from a shell where you've run `vault login` / set `VAULT_TOKEN`.

The connection config you enter (address, namespace, role, mount, KV version) is
saved in the workspace file (non-secret); tokens are never stored there.
References resolve on send.

### CLI
`api-spector run` picks up `~/.vault-token` / `VAULT_TOKEN` automatically:

```bash
vault login -method=oidc               # your normal flow, once
api-spector run --workspace ./ws.spector --env prod
```

### CI
Use workload identity (no stored token). Either let the pipeline auth and export
`VAULT_TOKEN`, or point API Spector at the role:

```yaml
# GitHub Actions — OIDC -> Vault, nothing stored
- uses: hashicorp/vault-action
  with:
    url: ${{ secrets.VAULT_ADDR }}
    method: jwt
    role: apispector-ci
    exportToken: true            # sets VAULT_TOKEN for later steps
- run: api-spector run --workspace ./ws.spector --env prod
```

AppRole works too — set `VAULT_ROLE_ID` / `VAULT_SECRET_ID` from CI secrets.

## Using a secret inside a script

Reference the secret from an environment variable, then read that variable in a
pre-request (setup) script through the scripting API:

```js
// pre-request script — API_TOKEN is `vault:secret/data/app#token`
const token = sp.environment.get('API_TOKEN')   // resolved from Vault
sp.request.headers['Authorization'] = `Bearer ${token}`
```

The value is scoped to the run and scrubbed from captured output.

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
