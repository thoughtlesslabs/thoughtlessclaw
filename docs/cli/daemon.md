---
summary: "CLI reference for `skynet daemon` (legacy alias for gateway service management)"
read_when:
  - You still use `skynet daemon ...` in scripts
  - You need service lifecycle commands (install/start/stop/restart/status)
title: "daemon"
---

# `skynet daemon`

Legacy alias for Gateway service management commands.

`skynet daemon ...` maps to the same service control surface as `skynet gateway ...` service commands.

## Usage

```bash
skynet daemon status
skynet daemon install
skynet daemon start
skynet daemon stop
skynet daemon restart
skynet daemon uninstall
```

## Subcommands

- `status`: show service install state and probe Gateway health
- `install`: install service (`launchd`/`systemd`/`schtasks`)
- `uninstall`: remove service
- `start`: start service
- `stop`: stop service
- `restart`: restart service

## Common options

- `status`: `--url`, `--token`, `--password`, `--timeout`, `--no-probe`, `--deep`, `--json`
- `install`: `--port`, `--runtime <node|bun>`, `--token`, `--force`, `--json`
- lifecycle (`uninstall|start|stop|restart`): `--json`

## Prefer

Use [`skynet gateway`](/cli/gateway) for current docs and examples.
