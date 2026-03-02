import type { VaultManager, TaskEntry, AgentState, MemoryEntry } from "../../vault/index.js";

export type ManagerRole = "coordinator" | "planner" | "scheduler" | "resource";

export interface ManagerConfig {
  role: ManagerRole;
  description: string;
  specializations: string[];
}

export const MANAGER_CONFIGS: Record<ManagerRole, ManagerConfig> = {
  coordinator: {
    role: "coordinator",
    description: "Coordinates multiple workers on complex tasks",
    specializations: ["task decomposition", "worker allocation", "dependency management"],
  },
  planner: {
    role: "planner",
    description: "Strategic planning and goal breakdown",
    specializations: ["roadmapping", "prioritization", "risk assessment"],
  },
  scheduler: {
    role: "scheduler",
    description: "Manages timing and scheduling of tasks",
    specializations: ["cron scheduling", "dependency ordering", "deadline tracking"],
  },
  resource: {
    role: "resource",
    description: "Manages resource allocation and budgets",
    specializations: ["token budgeting", "worker availability", "priority queue"],
  },
};

export class ManagerAgent {
  private vault: VaultManager;
  private config: ManagerConfig;
  private managerId: string;
  private systemPrompt: string;

  constructor(vault: VaultManager, role: ManagerRole, managerId?: string) {
    this.vault = vault;
    this.config = MANAGER_CONFIGS[role];
    this.managerId = managerId || `manager-${role}-${Date.now()}`;
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    return `# ${this.config.role.toUpperCase()} Manager Agent

## Role
${this.config.description}

## Specializations
${this.config.specializations.map((s) => `- ${s}`).join("\n")}

## Responsibilities

1. **Task Decomposition**: Break down complex tasks into smaller, assignable units
2. **Worker Allocation**: Assign tasks to appropriate Tier 3 workers
3. **Dependency Management**: Track and manage task dependencies
4. **Progress Tracking**: Monitor task completion and report to executives

---

## Governance Context

You are a Tier 2 agent in the Skynet hierarchy. You coordinate workers and report to the executive tier.

### Your Place in the Hierarchy

| Tier | Role | Your Relationship |
|------|------|-------------------|
| 1 | Executive Triad (Main, Oversight, Monitor, Optimizer) | Your superiors — receive directives and report progress |
| 2 | **You (${this.config.role} Manager)** | Coordinate and manage worker execution |
| 3 | Workers (coder, analyzer, tester, builder, reporter, researcher, deployer) | Execute individual tasks under your coordination |

### Vault Operations

Always read/write through the Vault — never rely on ephemeral context:
- \`vault/tasks/\` — Read task queue, write worker assignments, update task statuses
- \`vault/tasks/<id>.json\` — Individual task state: status, assignee, artifacts, doneMarker
- \`vault/memories/<date>.json\` — Log your management decisions and progress events
- \`vault/agents/workers/\` — Worker agent states (status, current task, reward points)

### Budget Awareness

Token usage is tracked system-wide:
- Every task execution records tokens consumed, model used, and timestamp
- Excessive spending triggers violations — allocate workers efficiently
- Match worker types to task requirements (analyzers for analysis, coders for code, etc.)
- The system may throttle agents that exceed their budget allocation

### Worker Compliance

Workers you assign must follow strict contracts:
- **Completion Contract**: \`DONE:\` prefix is mandatory on all completed work
- **Artifact Logging**: All outputs must be logged as named artifacts
- **Task Scope**: Workers operate only within their assigned task boundaries
- **Error Reporting**: Failures must include clear \`ERRORS:\` detail

Violations from workers affect the overall system standing and are tracked by the Oversight Executive.

### Violation Awareness

The system enforces contracts at every level:
- **Severity**: minor (warning) → major (−10 reward points) → critical (immediate review)
- **Your responsibility**: Ensure workers follow contracts; review failures before re-assigning
- **Self-correction**: Check for past violation patterns and avoid repeating them

---

## Completion Contract

When completing management tasks:
\`\`\`
DONE: <summary>

TASKS_CREATED: <count>
WORKERS_ASSIGNED: <count>
\`\`\`

## Current Date
${new Date().toISOString()}
`;
  }

  getManagerId(): string {
    return this.managerId;
  }

  getRole(): ManagerRole {
    return this.config.role;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  private inferWorkerType(task: TaskEntry): string {
    const combined = `${task.title} ${task.description}`.toLowerCase();
    if (combined.includes("test") || combined.includes("validate")) return "tester";
    if (combined.includes("build") || combined.includes("compile")) return "builder";
    if (combined.includes("report") || combined.includes("write") || combined.includes("document")) return "reporter";
    if (combined.includes("analyze") || combined.includes("research") || combined.includes("find")) return "analyzer";
    return "coder";
  }

  async spawn(subtask: TaskEntry): Promise<ManagerAgent | null> {
    if (subtask.tier !== 3) {
      return null;
    }

    const workerType = this.inferWorkerType(subtask);
    const workerId = `skynet-${workerType}-${Date.now()}`;

    const workerState: AgentState = {
      id: workerId,
      path: `agents/workers/${workerId}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "agent_state",
      agentId: workerId,
      role: "worker",
      tier: 3,
      status: "working",
      lastWake: Date.now(),
      lastSleep: 0,
      currentTaskId: subtask.id,
      rewardPoints: 100,
      violations: [],
      capabilities: [workerType],
    };

    await this.vault.write(`agents/workers/${workerId}.json`, workerState);

    // Actually spawn the worker process via gateway tool
    console.log(`[Manager:${this.managerId}] Spawning real worker ${workerId} for subtask: ${subtask.id}`);
    try {
      const { callGatewayTool } = await import("../../../agents/tools/gateway.js");
      const { ensureSkynetModelsJson } = await import("../../../agents/models-config.js");
      const { resolveSkynetAgentDir } = await import("../../../agents/agent-paths.js");

      const config = (globalThis as any).__skynet_config; // Assumes config is available via DI or global 
      await ensureSkynetModelsJson(config, resolveSkynetAgentDir());

      const prompt = `You are a specialist Tier 3 Skynet Worker (${workerType}).
      
SUBTASK ASSIGNMENT:
ID: ${subtask.id}
TITLE: ${subtask.title}
DESCRIPTION: ${subtask.description}

Review your directives and get to work making progress on this task. When finished, use the DONE: prefix and list ARTIFACTS: logging out your work.`;

      const spawnResult = await callGatewayTool("agent", {}, {
        sessionKey: `worker:${workerId}`,
        sessionId: workerId,
        sessionFile: workerId,
        messageChannel: "governance",
        messageProvider: "governance",
        message: prompt,
        config,
        metadata: {
          taskId: subtask.id,
          workerType: workerType,
          spawnedBy: this.managerId,
          execute: true
        }
      });

      console.log(`[Manager:${this.managerId}] Worker ${workerId} spawn result:`, spawnResult);
    } catch (err) {
      console.error(`[Manager:${this.managerId}] Failed to spawn worker ${workerId}:`, err);
      workerState.status = "waiting";
      await this.vault.write(`agents/workers/${workerId}.json`, workerState);
    }

    return this;
  }

  async getAssignedTasks(): Promise<TaskEntry[]> {
    const files = await this.vault.list("tasks", "\\.json$");
    const tasks: TaskEntry[] = [];

    for (const file of files) {
      const task = await this.vault.read<TaskEntry>(`tasks/${file}`);
      if (task && task.assignee === this.managerId && task.status === "in_progress") {
        tasks.push(task);
      }
    }

    return tasks;
  }

  async getAvailableWorkers(): Promise<string[]> {
    const files = await this.vault.list("agents/workers", "\\.json$");
    const workers: string[] = [];

    for (const file of files) {
      const state = await this.vault.read<AgentState>(`agents/workers/${file}`);
      if (state && state.status === "sleeping") {
        workers.push(state.agentId);
      }
    }

    return workers;
  }

  async assignTask(taskId: string, workerId: string): Promise<void> {
    const task = await this.vault.read<TaskEntry>(`tasks/${taskId}`);
    if (!task) {
      return;
    }

    task.assignee = workerId;
    task.status = "assigned";
    task.assignedAt = Date.now();

    await this.vault.write(`tasks/${taskId}.json`, task);
  }

  async decomposeTask(parentTask: TaskEntry): Promise<TaskEntry[]> {
    const subtasks: TaskEntry[] = [];
    const subtaskCount = Math.max(2, Math.min(5, Math.ceil(parentTask.description.length / 200)));

    for (let i = 0; i < subtaskCount; i++) {
      const subtask: TaskEntry = {
        id: `subtask-${Date.now()}-${i}`,
        path: `tasks/subtask-${Date.now()}-${i}.json`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "task",
        title: `${parentTask.title} (Part ${i + 1})`,
        description: `Subtask ${i + 1} of: ${parentTask.description}`,
        status: "queued",
        priority: parentTask.priority,
        assignee: null,
        tier: 3,
        parentTaskId: parentTask.id,
        subtasks: [],
        dependencies: i > 0 ? [`subtask-${Date.now()}-${i - 1}`] : [],
        createdBy: this.managerId,
        assignedAt: null,
        startedAt: null,
        completedAt: null,
        artifacts: [],
        doneMarker: false,
        doneMessage: null,
      };

      await this.vault.write(`tasks/${subtask.id}.json`, subtask);
      subtasks.push(subtask);
    }

    return subtasks;
  }

  async logProgress(taskId: string, progress: string): Promise<void> {
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
      type: "task",
      description: `[${this.managerId}] ${progress}`,
      agentId: this.managerId,
    });

    await this.vault.write(`memories/${date}.json`, memory);
  }
}

export function createManagerAgent(vault: VaultManager, role: ManagerRole): ManagerAgent {
  return new ManagerAgent(vault, role);
}
