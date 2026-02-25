---
summary: "CLI reference for `skynet voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `skynet voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
skynet voicecall status --call-id <id>
skynet voicecall call --to "+15555550123" --message "Hello" --mode notify
skynet voicecall continue --call-id <id> --message "Any questions?"
skynet voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
skynet voicecall expose --mode serve
skynet voicecall expose --mode funnel
skynet voicecall expose --mode off
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
