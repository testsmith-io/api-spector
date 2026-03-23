# Running Mock Servers from the CLI

The `api-spector mock` command starts one or more HTTP mock servers defined in a workspace and keeps them running until stopped.

## Basic usage

```bash
api-spector mock --workspace ./my-workspace.spector
```

This starts **all** mock servers defined in the workspace.

## Options

| Option | Description |
|---|---|
| `--workspace <path>` | Path to `.spector` workspace file **(required)** |
| `--name <name>` | Start only the server with this name (can be repeated) |
| `--help` | Show usage |

## Examples

Start all mock servers:

```bash
api-spector mock --workspace ./project.spector
```

Start a specific server:

```bash
api-spector mock --workspace ./project.spector --name "User API Mock"
```

Start multiple specific servers:

```bash
api-spector mock \
  --workspace ./project.spector \
  --name "User API Mock" \
  --name "Orders Mock"
```

## Output

```
  Mock Servers
  Workspace: ./project.spector

  ✓  User API Mock  http://127.0.0.1:3900  (4 routes)
       GET     /users          →  200
       POST    /users          →  201
       GET     /users/:id      →  200
       DELETE  /users/:id      →  204

  Press Ctrl+C to stop all servers.
```

## Stopping

Press `Ctrl+C`. All servers are stopped gracefully.

## Notes

- Mock servers listen on `127.0.0.1` (localhost only) by default
- Each server uses the port defined in its configuration
- If a port is already in use, that server fails to start but others continue
- Routes are matched in order — first match wins
- The `ANY` method matches all HTTP methods
