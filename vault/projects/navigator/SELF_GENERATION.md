# SELF_GENERATION.md — navigator project

## Scheduled Tasks

### Daily Hunts

- **09:00 EST** — Morning intelligence hunt: gather relevant updates, news, or data for the navigator project
- **14:00 EST** — Afternoon review: check active workers, blockers, and progress

### Weekly Reviews

- **Friday 17:00 EST** — Weekly wrap-up: summarize progress, report to Main Executive, plan next week

## Trigger Conditions

Each entry above should be evaluated on every heartbeat:

- Compare current time (EST) against the schedule
- If within a 15-minute window of a trigger and not already fired today: create the task
- Mark triggered tasks in manager.json under `firedToday`

## Notes

- Tasks should be created via governance(create-task)
- Workers should be spawned appropriately (researcher for hunts, reporter for reviews)
- Log all decisions to vault/memories/<date>.json
