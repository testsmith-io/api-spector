# Pipeline Integration

api Spector runs headlessly via the CLI — no display or GUI needed for `run` and `mock` commands. This makes it straightforward to drop into any CI/CD pipeline.

## How it works in a pipeline

1. Install `@testsmith/api-spector` globally (or via `npx`)
2. Provide `API_SPECTOR_MASTER_KEY` as a pipeline secret if your environments use encrypted variables
3. Run `api-spector run` against your workspace
4. Consume the JUnit or JSON report

Exit code `0` = all tests passed. Exit code `1` = failures. Your pipeline fails automatically on non-zero exit.

---

## GitHub Actions

### Basic — run on every push and PR

```yaml
name: API Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'

      - name: Install api-spector
        run: npm install -g @testsmith/api-spector

      - name: Run API tests
        run: |
          api-spector run \
            --workspace ./project.spector \
            --env staging \
            --output results.xml
        env:
          API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: api-test-results
          path: results.xml
```

### Advanced — smoke on PR, full suite on schedule

```yaml
name: API Tests

on:
  pull_request:
  schedule:
    - cron: '0 6 * * *'   # daily at 06:00 UTC

jobs:
  smoke:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
      - run: npm install -g @testsmith/api-spector
      - name: Smoke tests
        run: api-spector run --workspace ./project.spector --env staging --tags smoke --bail
        env:
          API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}

  full-suite:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
      - run: npm install -g @testsmith/api-spector
      - name: Full test suite
        run: |
          api-spector run \
            --workspace ./project.spector \
            --env production \
            --output results.xml \
            --verbose
        env:
          API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: api-test-results
          path: results.xml
```

### Multi-environment matrix

```yaml
strategy:
  matrix:
    env: [staging, production]
steps:
  - run: api-spector run --workspace ./project.spector --env ${{ matrix.env }} --output results-${{ matrix.env }}.xml
    env:
      API_SPECTOR_MASTER_KEY: ${{ secrets.API_SPECTOR_MASTER_KEY }}
```

---

## GitLab CI

```yaml
api-tests:
  image: node:20
  stage: test
  script:
    - npm install -g @testsmith/api-spector
    - api-spector run --workspace ./project.spector --env staging --output results.xml
  variables:
    API_SPECTOR_MASTER_KEY: $API_SPECTOR_MASTER_KEY   # set in CI/CD → Variables
  artifacts:
    when: always
    reports:
      junit: results.xml
    paths:
      - results.xml
    expire_in: 7 days
```

Smoke gate on merge requests only:

```yaml
api-smoke:
  image: node:20
  stage: test
  only:
    - merge_requests
  script:
    - npm install -g @testsmith/api-spector
    - api-spector run --workspace ./project.spector --env staging --tags smoke --bail
  variables:
    API_SPECTOR_MASTER_KEY: $API_SPECTOR_MASTER_KEY
```

---

## Azure DevOps

```yaml
trigger:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g @testsmith/api-spector
    displayName: Install api-spector

  - script: |
      api-spector run \
        --workspace ./project.spector \
        --env staging \
        --output results.xml
    displayName: Run API tests
    env:
      API_SPECTOR_MASTER_KEY: $(API_SPECTOR_MASTER_KEY)

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: results.xml
      testRunTitle: API Tests
```

Store `API_SPECTOR_MASTER_KEY` under **Pipelines → Library → Variable Groups** as a secret variable.

---

## Jenkins

```groovy
pipeline {
  agent { docker { image 'node:20' } }

  environment {
    API_SPECTOR_MASTER_KEY = credentials('api-spector-master-key')
  }

  stages {
    stage('Install') {
      steps {
        sh 'npm install -g @testsmith/api-spector'
      }
    }
    stage('API Tests') {
      steps {
        sh '''
          api-spector run \
            --workspace ./project.spector \
            --env staging \
            --output results.xml
        '''
      }
      post {
        always {
          junit 'results.xml'
        }
      }
    }
  }
}
```

Store the master key in Jenkins **Credentials** as a **Secret text** with ID `api-spector-master-key`.

---

## Docker

The CLI commands (`run`, `mock`) work without a display. Only `api-spector ui` requires Electron and a desktop.

```dockerfile
FROM node:20-slim
RUN npm install -g @testsmith/api-spector
WORKDIR /workspace
COPY . .
CMD ["api-spector", "run", "--workspace", "project.spector", "--env", "staging"]
```

Run with the secret injected at runtime — never bake it into the image:

```bash
docker run --rm \
  -e API_SPECTOR_MASTER_KEY="your-password" \
  -v $(pwd):/workspace \
  my-api-tests
```

---

## Report formats

### JUnit XML

Use `--output results.xml`. Consumed natively by GitHub Actions, GitLab CI, Azure DevOps, and Jenkins for test dashboards and trend tracking.

### JSON

Use `--output results.json` for custom processing or downstream tooling.

```json
{
  "meta": {
    "workspace": "./project.spector",
    "environment": "staging",
    "timestamp": "2025-01-15T10:00:00.000Z"
  },
  "summary": { "total": 12, "passed": 11, "failed": 1, "errors": 0, "durationMs": 843 },
  "results": [...]
}
```

---

## Tag strategy

Use tags on requests in the GUI to control what runs where:

| Tag | When to run |
|---|---|
| `smoke` | Every push / PR — fast gate, critical paths only |
| `regression` | Nightly or pre-release — full suite |
| `slow` | Exclude from PR gates with `--tags smoke,regression` |

```bash
# PR gate — fast
api-spector run --workspace ./project.spector --tags smoke --bail

# Nightly — full
api-spector run --workspace ./project.spector --tags regression,smoke
```

---

## Best practices

- Store `API_SPECTOR_MASTER_KEY` as a CI secret — never commit it to the repo
- Pin the `@testsmith/api-spector` version in CI: `npm install -g @testsmith/api-spector@1.2.3`
- Always pass `--output results.xml` so failures are visible in the CI dashboard even when the job passes overall
- Use `--bail` in pre-merge pipelines to fail fast and save runner minutes
- Keep your workspace and collection files committed to Git — they are safe to version-control (secrets are encrypted)
