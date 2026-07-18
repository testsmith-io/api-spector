# Docker

The repository ships a `Dockerfile` that packages the **CLI only**: test runner, mock servers, recorder, WSDL tools, and contract testing including the dashboard server. Electron is excluded entirely, so the image is small (~195 MB), needs no display, and none of the corporate proxy/antivirus issues that can affect Electron downloads apply.

Published images are on Docker Hub as `testsmith/api-spector`, tagged per release plus a rolling `latest`:

```bash
docker pull testsmith/api-spector:latest
# or build locally
docker build -t api-spector .
```

The examples below use the short name `api-spector`; substitute `testsmith/api-spector:latest` to run the published image directly.

## Running CLI commands

Mount your project at `/workspace` (the image's working directory) and use paths relative to it:

```bash
# Run tests
docker run --rm -v "$PWD:/workspace" api-spector run --workspace /workspace

# Static contract check against a pinned spec
docker run --rm -v "$PWD:/workspace" api-spector \
  contract run --workspace /workspace --mode provider --snapshot orders-v4

# Start mock servers (publish the mock's port)
docker run --rm -p 3005:3005 -v "$PWD:/workspace" api-spector \
  mock --workspace /workspace
```

Exit codes pass through, so CI jobs fail correctly on test failures.

## The contract dashboard

`contract report --serve` starts a **read-only** HTTP server that renders the contract dashboard in the API Spector color scheme: the pacticipant/version matrix from recorded results, with each cell linking to the full run report.

```bash
docker run --rm -p 8080:8080 -v "$PWD:/workspace" api-spector \
  contract report --workspace /workspace/my.spector --serve --port 8080
```

Then open `http://localhost:8080`. Routes:

| Route | Content |
|---|---|
| `/` | Dashboard matrix (pacticipant x version, pass/fail badges) |
| `/run/<pacticipant>/<version>` | Full HTML report for that recorded run |
| `/healthz` | Liveness probe for orchestrators |

When deployments are recorded (`contract record-deployment`), the dashboard also shows an Environments table: which version runs where, with a badge linking to that version's verification run.

Results are re-read from disk on **every request**: record a new result with `contract run --record --app-version <ver>`, with the **Record** button in the app's contract results panel, or by `git pull`ing a commit containing one - then refresh the page. The server never accepts writes; results only arrive through the filesystem. That keeps git as the single source of truth, in line with the [contract broker philosophy](../reference/contract-testing-types.md#do-you-need-a-contract-broker).

If the workspace has `contracts/webhooks.json`, the serving container also fires outbound webhooks when new results or deployments appear. Pass secret tokens as container environment variables (`docker run -e CI_TOKEN=...`); `$CI_TOKEN` style references in the config are resolved at fire time.

A typical team setup: one long-running container pointed at a checkout of the workspace repo, refreshed by a `git pull` cron or CI job. Everyone gets a URL; nobody runs a database.

Tip: put that URL in the app's Workspace Settings (Contracts tab, "Dashboard URL") and the contract results panel shows an **Open dashboard** shortcut.

## CI examples

**GitLab CI:**

```yaml
api-tests:
  image: testsmith/api-spector:latest
  script:
    - api-spector run --workspace . --output results.xml --format junit
  artifacts:
    reports:
      junit: results.xml
```

Note: the image's entrypoint is the `api-spector` binary; in GitLab, override it if you need a shell (`entrypoint: [""]`) and call `node /app/bin/cli.js`.

**GitHub Actions:**

```yaml
- name: Contract verification
  run: |
    docker run --rm -v "$PWD:/workspace" api-spector \
      contract run --workspace /workspace --mode provider \
      --snapshot pinned-api --junit contract-results.xml
```

## Publishing the image

Publishing is automated. The `docker` job in `.github/workflows/release.yml` builds and pushes `testsmith/api-spector` to Docker Hub whenever a GitHub Release is published. Each release is tagged with its exact version and a `major.minor` rolling tag, and non-prereleases also update `latest`. It needs two repo secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token for the testsmith org).

To build and push by hand, use the script (same image name and tagging as the release job):

```bash
scripts/docker-build.sh --tag v1.2.0   # builds and pushes :v1.2.0 and :latest
scripts/docker-build.sh --skip-push    # build only
scripts/docker-build.sh --dry-run      # print the commands without running them
```
