---
summary: "CLI reference for `skynet doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
title: "doctor"
---

# `skynet doctor`

Health checks + quick fixes for the gateway and channels.

Related:

- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
skynet doctor
skynet doctor --repair
skynet doctor --deep
```

Notes:

- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.skynet/skynet.json.bak` and drops unknown config keys, listing each removal.
- State integrity checks now detect orphan transcript files in the sessions directory and can archive them as `.deleted.<timestamp>` to reclaim space safely.

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv SKYNET_GATEWAY_TOKEN ...` (or `...PASSWORD`), that value overrides your config file and can cause persistent “unauthorized” errors.

```bash
launchctl getenv SKYNET_GATEWAY_TOKEN
launchctl getenv SKYNET_GATEWAY_PASSWORD

launchctl unsetenv SKYNET_GATEWAY_TOKEN
launchctl unsetenv SKYNET_GATEWAY_PASSWORD
```
