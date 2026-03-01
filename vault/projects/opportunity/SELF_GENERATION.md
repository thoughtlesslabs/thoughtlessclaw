# SELF_GENERATION.md — Opportunity Project Manager

## Scheduled Tasks

### Daily Job Hunts

- **Trigger**: Every day at 9:00 AM EST and 2:00 PM EST
- **Task type**: researcher
- **Description**: Search for new remote job opportunities matching user's profile (skills, preferences, location)
- **Deliverables**: List of 5–10 new opportunities with role, company, link, match score
- **Artifact**: `daily-hunt-<date>-<am|pm>.md`

### Weekly Review

- **Trigger**: Every Friday at 5:00 PM EST
- **Task type**: reporter
- **Description**: Summarize the week's hunts, applications, responses, and pipeline status
- **Deliverables**: Weekly summary report with stats and recommended next actions
- **Artifact**: `weekly-review-<YYYY-WW>.md`

## Notes

- Workers should log all findings to `vault/projects/opportunity/tasks/`
- Researcher workers should use web_search and web_fetch tools
- Daily hunts check the most recent hunt artifact to avoid duplicate listings
