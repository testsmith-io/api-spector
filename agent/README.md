# @testsmith/api-spector-agent

The **API Spector private runner**. It monitors your local and internal APIs -
things API Spector Cloud can never reach (`localhost`, `10.x`, staging behind a
VPN, a service mesh) - **without opening a single inbound port**.

It runs inside your own network, polls API Spector Cloud over HTTPS, runs each
due check with the real api-spector engine (the same one the desktop app and CLI
use: setup chains, pre/post scripts, assertions, faker data), and posts the
result back. All traffic is **outbound** - the cloud never connects to you.

## Run it

```bash
APP_URL=https://your-cloud-host \
AGENT_TOKEN=<your token> \
npx @testsmith/api-spector-agent
```

Generate the token under **Private runner** in the cloud (owner menu). Then tick
**Run on my private runner** on any monitor and it runs here instead of on the
cloud runner.

Prefer a container? The same runner ships as a Docker image:

```bash
docker run -d --name api-spector-agent --restart unless-stopped \
  -e APP_URL=https://your-cloud-host \
  -e AGENT_TOKEN=<your token> \
  testsmith/api-spector-agent:latest
```

## Keep it running

`npx` is ideal for a CI step or a quick check. For an always-on host, install it
and supervise it with your process manager:

```bash
npm i -g @testsmith/api-spector-agent
# then run `api-spector-agent` under systemd / pm2 with the env vars set
```

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `APP_URL` | yes | - | Base URL of your API Spector Cloud |
| `AGENT_TOKEN` | yes | - | Org API token with the `agent` ability |
| `POLL_INTERVAL_MS` | no | `5000` | Poll cadence in milliseconds |

## Security

- **Outbound only.** No inbound port, tunnel, or firewall rule.
- **Scoped token.** The `agent` ability can only read your org's due feed and
  post its results - nothing else. Revoke it any time to stop the agent.
- **Node 18+.** No install-time dependencies; the engine is bundled in.

See the full guide: **Private runner** in the API Spector Cloud docs.
