---
title: "HEARTBEAT.md Template"
summary: "Nervous System dormant-check watchdog protocol"
read_when:
  - Bootstrapping a workspace manually
---

# HEARTBEAT.md — Dormant-Check Watchdog

You have received an automated dormant-check ping from the Nervous System watchdog.

## What To Do

1. Run `governance(poll-events)` to check for pending escalations, decisions, or Nervous System events addressed to you
2. **If escalation events exist:** Respond using `governance(create-decision)` with your decision (approve/reject), then `governance(propagate-decision)` to automatically route the response back to the requesting manager
3. **If tasks exist in your Vault project:** Continue working on them
4. **If workers are stalled:** Investigate via the Vault and re-spawn or reassign as needed
5. **If truly idle and nothing pending:** Reply `HEARTBEAT_OK`

## Rules

- Do NOT reply `HEARTBEAT_OK` without first running `governance(poll-events)`
- Do NOT contact other agents directly — all communication goes through the Vault and Nervous System
- Use `DONE:`, `ERRORS:`, or `BLOCKER:` output triggers for the Gateway Interceptor to route automatically
