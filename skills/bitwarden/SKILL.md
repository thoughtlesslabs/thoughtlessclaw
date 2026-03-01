---
name: bitwarden
description: "Secure credential retrieval via Bitwarden CLI (bw). Use when: (1) accessing secrets, API keys, or passwords stored in Bitwarden vault, (2) workers need credentials to perform tasks, (3) setting up secure credential access for automation. NOT for: creating new vault entries (ask user), changing master password, or any operation requiring interactive prompts in non-interactive contexts."
---

# Bitwarden CLI Integration

Retrieve secrets from Bitwarden vault using `bw` CLI. Requires vault to be unlocked.

## Prerequisites

- Bitwarden CLI installed: `bw --version`
- Vault unlocked: `bw unlock` (requires master password)

## Session Management

The vault must be unlocked before retrieving secrets. The session key is stored in `BW_SESSION` environment variable.

### Check Status

```bash
bw status
```

Returns JSON with `status` field: `locked`, `unlocked`, or `unauthenticated`.

### Unlock Vault

```bash
bw unlock --raw
```

Returns session key. Set as environment variable:

```bash
export BW_SESSION=$(bw unlock --raw)
```

For non-interactive use, password can be provided via stdin or password file.

## Retrieving Secrets

### Get Password by Name

```bash
bw get password "gog-keyring"
```

### Get Full Item (JSON)

```bash
bw get item "gog-keyring"
```

### Get Specific Field

```bash
bw get username "gmail-api"
bw get password "gmail-api"
bw get totp "gmail-2fa"
```

### Search Items

```bash
bw list items --search "gmail"
```

Returns JSON array of matching items.

### Get Item by ID

```bash
bw get item <item-id>
```

## Common Patterns

### Retrieve and Use in Script

```bash
#!/bin/bash
API_KEY=$(bw get password "my-api-key")
curl -H "Authorization: Bearer $API_KEY" https://api.example.com
```

### JSON Output for Parsing

```bash
bw get item "gmail-api" --json | jq '.login.username'
```

### Sync Vault

```bash
bw sync
```

Pulls latest data from server. Run if secrets were recently updated via web/app.

## Non-Interactive Usage

For workers and automation:

1. **Session-based**: Unlock once, store `BW_SESSION` in environment or secure file
2. **Password file**: Store master password securely, pipe to unlock:
   ```bash
   cat /secure/path/master-password | bw unlock --raw
   ```

## Security Notes

- Session keys expire when vault is locked or CLI exits
- Never log or echo session keys or retrieved secrets
- Clear environment variables after use if possible:
  ```bash
  unset BW_SESSION
  ```
- For long-running workers, consider re-authenticating periodically

## Troubleshooting

**"Vault is locked"** - Run `bw unlock` first

**"Session not found"** - `BW_SESSION` expired or not set, unlock again

**"Item not found"** - Check exact name with `bw list items --search "term"`

**Rate limiting** - Bitwarden may rate limit rapid requests. Add delays if bulk retrieving.
