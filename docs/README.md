# API Spector

> Local-first API testing tool to inspect, test and mock APIs. Secrets stay on your machine.

<p align="center">
  <img src="_icon.svg" width="96" height="96" alt="API Spector">
</p>

## Features

- **GUI:** Electron desktop app with a multi-tab request builder, response viewer, and environment editor
- **CLI:** run test collections and start mock servers from the terminal or CI/CD pipelines
- **Encrypted secrets:** AES-256-GCM encryption with a master password, never stored in plain text
- **Mock servers:** define and run HTTP mock servers with per-route delay and status control
- **Code generation:** export collections as Robot Framework or Playwright test suites
- **Variable interpolation:** `{{variable}}` syntax across URLs, headers, bodies, and scripts
- **Scripting:** pre-request and post-response JavaScript with `pm`-compatible API

## Install

```bash
npm install -g @testsmith/api-spector
```

## Quick Start

```bash
# Launch the UI
api-spector ui

# Run a test collection
api-spector run --workspace ./my-workspace.spector --env production

# Start mock servers
api-spector mock --workspace ./my-workspace.spector
```

## How It Works

A **workspace** (`.spector` file) ties everything together. It references your collections, environments, and mock servers. Commit it to Git. Secrets are encrypted and never stored in plain text.

```
my-project/
├── my-workspace.spector
├── collections/
│   └── my-api.spector
└── environments/
    ├── dev.env.json
    └── prod.env.json
```
