# System Monitoring & Telemetry Guide

As an operator, you can probe and evaluate the Skynet autonomous system's health, stability, and intelligence patterns without interfering with the live workflow.

## 1. Real-Time Proactive Health Dashboard

To understand the macro-state of the entire workforce immediately from any client, ask the Main executive:

> "Please run a `governance(health-summary)` check and report the system state back to me."

This command intercepts the raw Vault state and returns:

1. **Model Infrastructure:** The rate-limit status of every configured API provider (`healthy`, `half-open`, `cooldown`).
2. **Capacity:** Total active worker count and task backlog.
3. **Global Blockers:** Immediate high-level blocking issues escalated by the Project Managers.

## 2. Low-Level Telemetry Files

If you want to bypass the LLM entirely and probe the physical runtime storage, you can `tail` or `cat` the following files directly on disk:

- **Provider Health Cache:** `cat ~/.skynet/provider-health.json`
  - _What it tells you:_ Shows you precisely which models the internal routing mesh evaluates as available vs rate-limited.
- **Active Auth Profiles:** `cat ~/.skynet/vault/auth.json`
  - _What it tells you:_ Reveals the raw failure streaks, exact timestamps for cooldown unlocking, and exponential backoff parameters for the circuit-breaker logic.
- **System Event Bus:** `ls -lt ~/.skynet/vault/events/`
  - _What it tells you:_ The literal nervous system. Watching this directory populate in real-time allows you to trace system decisions as they happen (e.g., `manager-checkin`, `escalation:worker→manager`, `complete-task`).

## 3. Investigating Protocol Breaches (RL)

If worker agents are behaving poorly, hallucinating tool calls, or ignoring the `[DONE:]` prompt contracts, the Gateway Interceptor will automatically penalize them and write to the Violation Tracker.

To view these tracking patterns (which the Triad uses for RL reinforcement):

- `cat ~/.skynet/vault/contracts/violation_patterns.json`

This file highlights the most common structural mistakes made by your models, providing a tight feedback loop to adjust your global System Prompts (`skynet.json`) if a model consistently fails a specific protocol.
