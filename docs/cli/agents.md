---
summary: "CLI reference for `skynet agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `skynet agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
skynet agents list
skynet agents add work --workspace ~/.skynet/workspace-work
skynet agents set-identity --workspace ~/.skynet/workspace --from-identity
skynet agents set-identity --agent main --avatar avatars/skynet.png
skynet agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.skynet/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
skynet agents set-identity --workspace ~/.skynet/workspace --from-identity
```

Override fields explicitly:

```bash
skynet agents set-identity --agent main --name "Skynet" --emoji "🦞" --avatar avatars/skynet.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Skynet",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/skynet.png",
        },
      },
    ],
  },
}
```
