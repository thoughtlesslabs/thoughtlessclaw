---
summary: "CLI reference for `skynet logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `skynet logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
skynet logs
skynet logs --follow
skynet logs --json
skynet logs --limit 500
skynet logs --local-time
skynet logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
