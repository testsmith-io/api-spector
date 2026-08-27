# Docker

The repository ships a `Dockerfile` that packages the **CLI only**: test runner, mock servers, recorder, WSDL tools, and contract testing. Electron is excluded entirely, so the image is small (~195 MB), needs no display, and none of the corporate proxy/antivirus issues that can affect Electron downloads apply.

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

`contract report --html` writes a **static, self-contained** dashboard file — the pacticipant/version matrix from recorded results, plus an Environments table when deployments are recorded — that you can publish as a CI artifact or on any static host.

```bash
docker run --rm -v "$PWD:/workspace" api-spector \
  contract report --workspace /workspace/my.spector --html /workspace/dashboard.html
```

Results come from the committed workspace files, so git stays the single source of truth, in line with the [contract broker philosophy](../reference/contract-testing-types.md#do-you-need-a-contract-broker).

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
