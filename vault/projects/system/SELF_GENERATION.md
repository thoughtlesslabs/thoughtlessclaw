# SELF_GENERATION Schedule — system project

## Scheduled Tasks

### Daily Hunts

- **Trigger**: Every day at 9:00 AM EST and 2:00 PM EST
- **Task type**: research
- **Description**: Hunt for new opportunities, system health anomalies, or pending items in the vault task queue
- **Worker type**: researcher
- **Priority**: normal

### Weekly Review

- **Trigger**: Every Friday at 5:00 PM EST
- **Task type**: report
- **Description**: Review all completed tasks, active workers, blockers, and project health for the week; report to Main Executive
- **Worker type**: reporter
- **Priority**: high

### Daily System Health Check

- **Trigger**: Every day at 7:00 AM EST
- **Task type**: analyze
- **Description**: Check system-status, list active workers, scan for escalations, log findings to vault/memories
- **Worker type**: analyzer
- **Priority**: normal

## Notes

- Created: 2026-02-28
- Manager: system
