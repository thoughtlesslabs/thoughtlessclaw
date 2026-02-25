---
summary: "CLI reference for `skynet reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `skynet reset`

Reset local config/state (keeps the CLI installed).

```bash
skynet reset
skynet reset --dry-run
skynet reset --scope config+creds+sessions --yes --non-interactive
```
