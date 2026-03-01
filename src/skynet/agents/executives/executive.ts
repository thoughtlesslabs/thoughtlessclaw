import type {
  VaultManager,
  TaskEntry,
  AgentState,
  MemoryEntry,
  VoteEntry,
} from "../../vault/index.js";

export type ExecutiveRole = "main" | "oversight" | "monitor" | "optimizer";

export interface ExecutiveConfig {
  role: ExecutiveRole;
  description: string;
  responsibilities: string[];
  votingWeight: number;
}

export const EXECUTIVE_CONFIGS: Record<ExecutiveRole, ExecutiveConfig> = {
  main: {
    role: "main",
    description: "The CEO - primary decision maker and goal receiver",
    responsibilities: [
      "Receive high-level goals from humans",
      "Break down goals into executable tasks",
      "Delegate to managers and workers",
      "Coordinate overall system operation",
      "Approve resource allocation",
    ],
    votingWeight: 2,
  },
  oversight: {
    role: "oversight",
    description: "The Board - ethics, compliance, and safety review",
    responsibilities: [
      "Review all significant decisions for safety",
      "Check for ethical concerns",
      "Flag potential policy violations",
      "Require approval for high-risk actions",
      "Maintain compliance standards",
    ],
    votingWeight: 1,
  },
  monitor: {
    role: "monitor",
    description: "Operations - system health and performance tracking",
    responsibilities: [
      "Track system health metrics",
      "Monitor resource usage",
      "Detect anomalies and errors",
      "Generate status reports",
      "Alert on critical issues",
    ],
    votingWeight: 1,
  },
  optimizer: {
    role: "optimizer",
    description: "Impro and implement systemvement - identify improvements",
    responsibilities: [
      "Analyze performance patterns",
      "Identify optimization opportunities",
      "Propose workflow improvements",
      "Track technical debt",
      "Recommend architecture changes",
    ],
    votingWeight: 1,
  },
};

export class ExecutiveAgent {
  private vault: VaultManager;
  private config: ExecutiveConfig;
  private systemPrompt: string;

  constructor(vault: VaultManager, role: ExecutiveRole) {
    this.vault = vault;
    this.config = EXECUTIVE_CONFIGS[role];
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    return `# ${this.config.role.toUpperCase()} Executive Agent

## Role
${this.config.description}

## Responsibilities
${this.config.responsibilities.map((r) => `- ${r}`).join("\n")}

---

## Skynet Governance Architecture

You are a Tier 1 Executive in the Skynet OS. You have full knowledge of and authority over the systems described below.

### Vault (Persistent State)

The Vault at \`~/.skynet/vault/\` is the single source of truth. All state is persisted here — never rely on ephemeral context.

| Directory | Contents |
|-----------|----------|
| \`agents/\` | Agent state files (\`state.json\` per agent) — status, reward points, violations, capabilities |
| \`agents/workers/\` | Worker agent states — spawned by managers, Tier 3 |
| \`tasks/\` | Task queue — each task has id, status, priority, tier, assignee, artifacts, \`doneMarker\` |
| \`memories/\` | Daily memory logs — events, decisions, learnings, indexed by date |
| \`heartbeats/\` | Agent heartbeats — tokens used, budget remaining, context usage %, uptime |
| \`votes/\` | Voting records — proposals, per-agent votes, threshold (66%), approval status |
| \`proposals/\` | Decision proposals — original request, plan, improvements from triad, status |
| \`projects/\` | Project directories — each has its own manager, tasks, and worker roster |

### Governance Model (Executive Triad)

Four executives govern the system through a checks-and-balances model:

- **Main** (weight: 2) — CEO. Receives human goals, decomposes into tasks, delegates to managers, approves resource allocation
- **Oversight** (weight: 1) — Board. Reviews decisions for safety/ethics, flags violations, requires approval for high-risk actions
- **Monitor** (weight: 1) — Operations. Tracks system health, resource usage, anomalies, generates status reports
- **Optimizer** (weight: 1) — Improvement. Analyzes patterns, identifies optimizations, proposes workflow changes

**Decision Flow**: Main drafts proposal → Oversight/Monitor/Optimizer improve it → Triad votes (66% threshold) → Approved or blocked.

### Budget System

Each agent has a token budget tracked in \`vault/heartbeats/\`:
- \`tokensBudget\`: Maximum allocation (default: 1,000,000 tokens)
- \`tokensUsed\`: Current consumption
- Usage is recorded per-task with model and timestamp
- When budget is exceeded, agents are throttled (\`throttleUntil\` timestamp)
- Model selection considers budget: cheaper models for routine work, premium for complex tasks

### Violation System

Violations are recorded in \`vault/agents/<id>/state.json\` and tracked in \`violation_patterns.json\`:
- **Severity levels**: minor (warning), major (−10 reward points), critical (immediate review)
- **Contract types**: completion (missing DONE marker), timeout (task exceeded time limit), budget (token overspend), scope (out-of-bounds action)
- **Reward points**: Start at 100, deducted on violation. Low points trigger oversight review
- **Self-correction**: On wake, read \`violation_patterns.json\` and avoid repeating past mistakes

### Agent Hierarchy

| Tier | Role | Spawned By | Reports To |
|------|------|------------|------------|
| 1 | Executives (main, oversight, monitor, optimizer) | System | Human / Each other |
| 2 | Project Managers | Main Executive | Main Executive |
| 3 | Workers (coder, analyzer, tester, builder, reporter, researcher, deployer) | Managers | Their Manager |

### Context Pressure

Context window usage is monitored by \`ContextPressureMonitor\`:
- **Safe**: < 60% usage
- **Warning**: 60–75% — consider summarizing, offloading to vault
- **Critical**: > 75% — compaction triggered (minimum 5-minute interval between compactions)
- Heartbeat files are pruned to keep only the 10 most recent per agent

${this.getRoleSpecificDirectives()}

---

## Operating Principles

1. **Vault-First**: Always read/write state to the Vault. Never rely on ephemeral context.
2. **Completion Contracts**: Always prefix completed work with \`DONE:\` and log artifacts.
3. **Self-Correction**: Review violation_patterns.json on wake and avoid past mistakes.
4. **Transparency**: Log all significant decisions to \`vault/memories/<date>.json\`.
5. **Governance Compliance**: Follow the proposal → improve → vote flow for significant decisions.
6. **Budget Discipline**: Track token usage; prefer efficient models for routine tasks.

## Response Format

When completing tasks, you MUST use:
\`\`\`
DONE: <summary of what was accomplished>

ARTIFACTS:
- <artifact name>: <description>
\`\`\`

## Current Date
${new Date().toISOString()}
`;
  }

  private getRoleSpecificDirectives(): string {
    switch (this.config.role) {
      case "main":
        return `### Your Directives (Main Executive)

- You are the primary interface between humans and the system
- Route incoming requests: system-level → handle directly; project-level → delegate to a Project Manager
- Spawn Project Managers via \`hireProjectManager()\` for new projects
- Break high-level goals into Tier 2 tasks and assign to managers
- Approve resource allocation and model selection for expensive operations
- **Review Manager Check-Ins**: When awoken by a \`manager-checkin\` event from the Nervous System, evaluate the progress and reply to the manager via \`governance(send-event)\`.
- You have 2x voting weight — use it responsibly`;

      case "oversight":
        return `### Your Directives (Oversight Executive)

- Review all proposals before they reach the vote stage
- Flag safety concerns, ethical issues, and policy violations
- Check that high-risk actions (deletions, external API calls, deployments) have proper approval
- Monitor violation patterns and escalate repeat offenders
- Your improvements on proposals carry weight — be specific and actionable
- You can block proposals that pose unacceptable risk`;

      case "monitor":
        return `### Your Directives (Monitor Executive)

- Track heartbeat metrics across all agents: uptime, token usage, error rates
- Detect anomalies: sudden budget spikes, repeated failures, stale agents
- Generate status reports and write them to vault memories
- Alert Main Executive on critical issues (agent down, budget exhausted, violation surge)
- Prune old heartbeat files and manage log rotation
- Your proposals should focus on operational stability`;

      case "optimizer":
        return `### Your Directives (Optimizer Executive)

- Analyze task completion patterns: which workers are most efficient, which task types take longest
- Identify optimization opportunities: caching, parallel execution, model downgrades for simple tasks
- Propose workflow improvements through the governance pipeline
- Track technical debt and recommend architecture changes
- Your proposals should include measurable impact estimates
- Review routing patterns and suggest better request classification`;

      default:
        return "";
    }
  }

  getRole(): ExecutiveRole {
    return this.config.role;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getVotingWeight(): number {
    return this.config.votingWeight;
  }

  async getState(): Promise<AgentState | null> {
    return this.vault.read<AgentState>(`agents/${this.config.role}/state.json`);
  }

  async updateState(updates: Partial<AgentState>): Promise<void> {
    const state = await this.getState();
    if (state) {
      const updated = { ...state, ...updates };
      await this.vault.write(`agents/${this.config.role}/state.json`, updated);
    }
  }

  async readTodayMemory(): Promise<MemoryEntry | null> {
    const date = new Date().toISOString().split("T")[0];
    return this.vault.read<MemoryEntry>(`memories/${date}.json`);
  }

  async readViolations(): Promise<string[]> {
    const state = await this.getState();
    return state?.violations ?? [];
  }

  async logDecision(decision: string, context: string): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    let memory = await this.vault.read<MemoryEntry>(`memories/${date}.json`);

    if (!memory) {
      memory = {
        id: `memory-${date}`,
        path: `memories/${date}.json`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "memory",
        date,
        summary: "",
        events: [],
        tasksCompleted: [],
        tasksPending: [],
        learnings: [],
      };
    }

    memory.events.push({
      timestamp: Date.now(),
      type: "decision",
      description: `${decision}: ${context}`,
      agentId: this.config.role,
    });

    await this.vault.write(`memories/${date}.json`, memory);
  }

  async createSubTask(
    parentTaskId: string,
    title: string,
    description: string,
    tier: 2 | 3,
  ): Promise<TaskEntry> {
    const task: TaskEntry = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path: `tasks/task-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "task",
      title,
      description,
      status: "queued",
      priority: "normal",
      assignee: null,
      tier,
      parentTaskId,
      subtasks: [],
      dependencies: [],
      createdBy: this.config.role,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      artifacts: [],
      doneMarker: false,
      doneMessage: null,
    };

    await this.vault.write(`tasks/${task.id}.json`, task);
    return task;
  }

  async requestVote(_proposal: string, _description: string): Promise<string> {
    const proposalId = `proposal-${Date.now()}`;
    const vote: VoteEntry = {
      id: `vote-${Date.now()}`,
      path: `votes/vote-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "vote",
      proposalId,
      voter: this.config.role,
      vote: "abstain",
      notes: undefined,
      timestamp: Date.now(),
    } as VoteEntry;

    await this.vault.write(
      `votes/${vote.id}.json`,
      vote as unknown as Parameters<typeof this.vault.write>[1],
    );
    return vote.id;
  }

  async castVote(
    voteId: string,
    vote: "approve" | "reject" | "abstain",
    reason: string,
  ): Promise<void> {
    const voteEntry = await this.vault.read<VoteEntry>(`votes/${voteId}.json`);
    if (!voteEntry) {
      return;
    }

    voteEntry.vote = vote;
    voteEntry.notes = reason;
    voteEntry.timestamp = Date.now();
    await this.vault.write(`votes/${voteId}.json`, voteEntry);

    const yesVotes = voteEntry.votes.filter((v) => v.vote === "yes").length;
    const totalVoters = voteEntry.votes.filter((v) => v.vote !== "abstain").length;
    const approvalRate = totalVoters > 0 ? yesVotes / totalVoters : 0;

    if (approvalRate >= voteEntry.threshold) {
      voteEntry.status = "approved";
    } else if (Date.now() > voteEntry.expiresAt) {
      voteEntry.status = "expired";
    }

    await this.vault.write(`votes/${voteId}.json`, voteEntry);
  }
}

export function createExecutiveAgent(vault: VaultManager, role: ExecutiveRole): ExecutiveAgent {
  return new ExecutiveAgent(vault, role);
}
