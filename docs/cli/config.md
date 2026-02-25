---
summary: "CLI reference for `skynet config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `skynet config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `skynet configure`).

## Examples

```bash
skynet config get browser.executablePath
skynet config set browser.executablePath "/usr/bin/google-chrome"
skynet config set agents.defaults.heartbeat.every "2h"
skynet config set agents.list[0].tools.exec.node "node-id-or-name"
skynet config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
skynet config get agents.defaults.workspace
skynet config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
skynet config get agents.list
skynet config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--strict-json` to require JSON5 parsing. `--json` remains supported as a legacy alias.

```bash
skynet config set agents.defaults.heartbeat.every "0m"
skynet config set gateway.port 19001 --strict-json
skynet config set channels.whatsapp.groups '["*"]' --strict-json
```

Restart the gateway after edits.
