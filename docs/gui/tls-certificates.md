# TLS & Certificates

api Spector supports custom CA certificates, mutual TLS (client certificates), and disabling certificate verification. TLS settings can be configured at two levels:

| Level | Scope | Where |
|---|---|---|
| **Workspace** | All requests in the workspace | Toolbar → Settings → TLS / Certificates |
| **Collection** | All requests in a specific collection | Collection tree → ⚙ icon → TLS settings |

Collection-level settings take priority over workspace-level settings. Individual fields are merged, so you can override only the CA certificate at collection level while still inheriting the client certificate from the workspace.

## Workspace TLS settings

1. Click the **Settings** icon in the toolbar
2. Select the **TLS / Certificates** tab

Settings are saved per workspace and apply to every request sent from that workspace unless a collection overrides them.

## Collection TLS settings

1. Hover over a collection in the sidebar
2. Click the **⚙** (gear) icon
3. Fill in any TLS fields you want to override for this collection
4. Click **Save**

Leave all paths empty to inherit everything from the workspace. Settings are stored inside the collection's `.spector` file.

## CA Certificate

Use this when your API server uses a certificate signed by a private or internal Certificate Authority that is not in the system trust store.

**CA Certificate path**: absolute path to the CA certificate file (PEM format).

```
/path/to/ca.crt
```

The file is read from disk at send time. If the file cannot be read, the setting is silently ignored and the default system trust store is used.

## Client Certificate (Mutual TLS)

Mutual TLS (mTLS) requires the client to present its own certificate to the server. Set both fields:

**Client certificate path**: absolute path to the client certificate (PEM format).

```
/path/to/client.crt
```

**Client key path**: absolute path to the private key for the client certificate (PEM format).

```
/path/to/client.key
```

Both fields must be set for mutual TLS to work. If either is missing the client certificate is not sent.

## Reject unauthorized certificates

The **Reject unauthorized / self-signed certificates** checkbox controls whether connections to servers with invalid or self-signed certificates are allowed.

| State | Behaviour |
|---|---|
| Checked (default) | Connection fails if the server certificate cannot be verified |
| Unchecked | Certificate errors are ignored (equivalent to `--insecure` in curl) |

> **Warning:** Unchecking this option disables certificate validation entirely. Only use it in controlled environments (e.g. local development with a self-signed cert). Never disable it against production APIs.

## Pipeline / CLI

In headless runs (`api-spector run`), TLS settings are read directly from the workspace and collection files on disk. No GUI interaction is required.

### How settings are resolved

```
effective TLS = { ...workspace.settings.tls, ...collection.tls }
```

Collection-level values override workspace values field by field, identical to the GUI behaviour.

### Supplying certificate files in CI

Certificate files are referenced by absolute path, stored inside the workspace or collection file. In a pipeline the files must be present at exactly that path on the runner.

**Option 1: commit the certificates to the repo** (suitable for internal, non-secret CA certs only)

```
certs/
  ca.crt          ← internal CA, not secret
  client.crt
  client.key      ← keep out of git; inject at runtime instead
```

Store only the CA bundle in git. Keep the client key out.

**Option 2: inject certificate content from CI secrets at runtime**

Write the certificate content to a temp file before running the tests:

```yaml
# GitHub Actions
- name: Write certificates
  run: |
    echo "$CA_CERT"     > /tmp/ca.crt
    echo "$CLIENT_CERT" > /tmp/client.crt
    echo "$CLIENT_KEY"  > /tmp/client.key
  env:
    CA_CERT:     ${{ secrets.CA_CERT }}
    CLIENT_CERT: ${{ secrets.CLIENT_CERT }}
    CLIENT_KEY:  ${{ secrets.CLIENT_KEY }}

- name: Run API tests
  run: api-spector run --workspace ./project.spector --env staging --output results.xml
  env:
    API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}
```

Then configure the workspace or collection TLS paths to `/tmp/ca.crt`, `/tmp/client.crt`, and `/tmp/client.key` in the GUI before committing.

```yaml
# GitLab CI
before_script:
  - echo "$CA_CERT"     > /tmp/ca.crt
  - echo "$CLIENT_CERT" > /tmp/client.crt
  - echo "$CLIENT_KEY"  > /tmp/client.key
script:
  - api-spector run --workspace ./project.spector --env staging --output results.xml
variables:
  API_SPECTOR_MASTER_KEY: $API_SPECTOR_MASTER_KEY
  CA_CERT:                $CA_CERT
  CLIENT_CERT:            $CLIENT_CERT
  CLIENT_KEY:             $CLIENT_KEY
```

### Disabling certificate verification in CI

If your staging server uses a self-signed certificate and you have no CA bundle, uncheck **Reject unauthorized** in the workspace settings. The setting persists in `project.spector` and takes effect in CI automatically with no extra pipeline steps needed.

> Only do this for internal staging environments. Never disable verification against production.

## Precedence

When both levels are set, collection values override workspace values field by field:

```
effective TLS = { ...workspaceTls, ...collectionTls }
```

For example, if the workspace sets a CA certificate and a collection sets a client certificate, the effective configuration has both.

## Common scenarios

### Internal API with a corporate CA

1. Export the corporate root CA certificate to a `.crt` file
2. Set **CA Certificate path** to that file
3. Leave **Reject unauthorized** checked

### Local development with a self-signed certificate

Option A: add the self-signed cert as the CA certificate by setting **CA Certificate path** to the self-signed `.crt`.

Option B: uncheck **Reject unauthorized / self-signed certificates** to skip verification entirely (quicker, but less safe).

### API that requires a client certificate

1. Set **Client certificate path** to your `.crt` file
2. Set **Client key path** to your `.key` file
3. Optionally set **CA Certificate path** if the server CA is also private
