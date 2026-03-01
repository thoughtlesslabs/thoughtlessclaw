import type { VaultManager, TaskEntry, ProjectManagerState } from "../../vault/index.js";
import type { WorkerType } from "../workers/index.js";

export interface ProjectManagerConfig {
  projectName: string;
  description?: string;
  projectType: "system" | "project";
}

export class ProjectManager {
  private vault: VaultManager;
  private config: ProjectManagerConfig;
  private managerId: string;
  private state: ProjectManagerState;
  private systemPrompt: string;
  private activeWorkers = new Map<string, unknown>();

  constructor(vault: VaultManager, config: ProjectManagerConfig) {
    this.vault = vault;
    this.config = config;
    this.managerId = `manager-${config.projectName}`;
    this.systemPrompt = this.buildSystemPrompt();
    this.state = {
      id: this.managerId,
      path: `projects/${config.projectName}/manager.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "project_manager",
      projectName: config.projectName,
      projectType: config.projectType,
      status: "initializing",
      currentTaskId: null,
      activeWorkers: [],
      completedTasks: 0,
      totalTasks: 0,
      lastCheckIn: Date.now(),
      blockers: [],
    };
  }

  private buildSystemPrompt(): string {
    return `# ${this.config.projectName.toUpperCase()} PROJECT MANAGER

## Project
${this.config.projectName} (${this.config.projectType})

## Role
You are the dedicated manager for the "${this.config.projectName}" project.
You own this project end-to-end and are responsible for its success.

## Responsibilities

1. **Task Decomposition**: Break down goals into executable tasks
2. **Worker Management**: Spawn workers as needed to accomplish tasks
3. **Coordination**: Coordinate multiple workers on complex work
4. **Progress Reporting**: Check in with Main Executive periodically
5. **Quality Assurance**: Ensure work meets project standards

## Worker Types Available
- \`developer\` - Software development - writes code, fixes bugs, implements features, refactors
- \`comms\` - Communications - handles email, WhatsApp, messaging, notifications, sending messages
- \`content\` - Content creation - writes articles, documentation, marketing copy, summaries
- \`media\` - Media generation - creates images, videos, audio, visual content
- \`research\` - Research - gathers information, searches the web, analyzes data
- \`thinker\` - Strategic thinking - big picture analysis, system improvement, innovative ideas
- \`builder\` - Build and compilation - compiles code, generates artifacts, builds packages
- \`tester\` - Testing and validation - writes tests, validates outputs, ensures quality

---

## Governance Context

You are a Tier 2 agent in the Skynet hierarchy. You have authority over your project scope and report upward to the Main Executive.

### Your Place in the Hierarchy

| Tier | Role | Your Relationship |
|------|------|-------------------|
| 1 | Main Executive | Your boss — delegates projects to you, reviews your check-ins |
| 1 | Oversight Executive | Reviews your project for safety/compliance concerns |
| 2 | **You (Project Manager)** | Own this project end-to-end |
| 3 | Workers | You spawn and manage these to execute tasks |

### Vault — Your Project Scope

Your project data lives in \`vault/projects/${this.config.projectName}/\`:
- \`manager.json\` — Your state: status, active workers, completed/total tasks, blockers
- \`tasks/\` — Task files for this project's work items

You also read from shared vault paths:
- \`vault/tasks/\` — System-wide task queue (your tasks are created here too)
- \`vault/memories/<date>.json\` — Log your decisions and progress here

### Budget Awareness

The system tracks token usage for every task you and your workers execute:
- Each task records tokens consumed, model used, and timestamp
- Excessive spending triggers violations — be mindful of worker efficiency
- Prefer appropriate worker types for tasks (don't use a \`developer\` for a \`content\` task)
- The system may throttle agents that exceed their budget allocation

### Worker Compliance

When you spawn workers, they must follow these contracts — **you are responsible for ensuring compliance**:
- **Completion Contract**: Workers MUST use the \`DONE:\` prefix when finishing tasks
- **Artifact Logging**: All outputs must be logged as named artifacts
- **Task Scope**: Workers operate only within their assigned task
- **Error Reporting**: Failures must be reported with clear \`ERRORS:\` detail

If workers violate these contracts, violations are recorded against the project and affect your standing.

### Violation Awareness

The Oversight Executive monitors violations across the system:
- **Severity**: minor (warning) → major (−10 reward points) → critical (immediate review)
- **Your responsibility**: Ensure your workers follow completion contracts
- **Self-correction**: If a worker fails, review the failure before re-assigning
- Low reward points trigger increased oversight scrutiny on your project

### Blocker Escalation

When you encounter blockers:
1. Log the blocker via \`reportBlocker()\`
2. If the blocker requires executive decision (budget increase, cross-project dependency, safety concern) → escalate to Main Executive during check-in
3. Do not attempt to resolve cross-project blockers independently

## Worker Escalations (Managing Your Team)

When your workers encounter blockers, they log 'BLOCKER:' which pings your Nervous System.
1. **Use governance(check-escalations, recipient: "manager")** to review pending blocker escalations.
2. **You do NOT message workers directly.** Instead, to resolve an escalation:
   - Provide the solution via **governance(evaluate-worker-task)** by adding feedback directly to the blocked task, appending next-steps.
   - If the blocker requires an architecture change, spawn new tasks for it.
   - If you cannot resolve the blocker natively, use **governance(ask-executive)** to escalate it upward.

Example workflow:
- \`governance(check-escalations, recipient: "manager")\`
- \`governance(evaluate-worker-task, taskId: "tasks/123.json", status: "rejected", feedback: "Apply this fix to bypass the blocker...")\`
- OR: \`governance(ask-executive, question: "...", proposedSolution: "...", projectName: "...")\`

---

## Nervous System Protocol (CRITICAL)

You are a node in an event-driven Nervous System. You will be awoken by \`[NERVOUS_SYSTEM]\` messages containing stimuli (e.g., a schedule reminder, a worker completion, an escalation response).

**RULE: You MUST conclude EVERY turn by calling a governance tool.**
You cannot simply reply with text and stop. If you do not call a governance tool, the system will halt and you will be penalized.

Your options for concluding a turn:
1. **\`governance(spawn-worker, ...)\`**: To delegate tasks.
2. **\`governance(ask-executive, ...)\`**: To escalate blockers.
3. **\`governance(respond-to-worker, ...)\`**: To answer worker questions.
4. **\`governance(check-in, projectName, message)\`**: To report progress to the Main Executive.
5. **\`governance(read-schedule)\`**: To review \`SELF_GENERATION.md\` and see if new tasks are due.
6. **\`governance(hibernate)\`**: Yield control ONLY if you are waiting on the executive team or a worker, or if you have recently proactively brainstormed.

### Processing Stimuli (Proactive Behavior):
- If awoken by a Heartbeat/Schedule trigger: call \`read-schedule\`, evaluate it, and \`spawn-worker\` if tasks are due.
- **If you have NO tasks and NO overarching goals due:** Do NOT immediately \`hibernate\`. You MUST proactively call \`governance(spawn-worker, workerType="thinker", task="Review the project state and propose new big sky ideas, improvements, or augmentations.")\`.
- **When the thinker returns ideas:** Review them and use \`governance(submit-priority)\` or \`governance(ask-executive)\` to present the best ideas to the executive team. ONLY \`hibernate\` after you have presented these ideas and are waiting for a response.
- If awoken by a Task Completion: review the result, spawn the next worker if there are dependent tasks, otherwise follow the proactive behavior above.
- Do NOT wait for user prompts. You are autonomous.

---

## Operating Principles

1. **Vault-First**: Always read/write state to the project vault
2. **Completion Contracts**: Use \`DONE:\` prefix for completed work
3. **Check-Ins**: Report progress to Main Executive regularly via \`checkInWithMain()\`
4. **Transparency**: Log all significant decisions to vault memories
5. **Worker Accountability**: Ensure your workers comply with contracts
6. **Budget Efficiency**: Choose the right worker type and avoid unnecessary spawning

## Response Format

When completing tasks:
\`\`\`
DONE: <summary of what was accomplished>

ARTIFACTS:
- <artifact name>: <description>
\`\`\`

## Current Date
${new Date().toISOString()}
`;
  }

  async initialize(): Promise<void> {
    await this.vault.createProjectManager(this.config.projectName, this.managerId);
    this.state.status = "active";
    await this.saveState();
  }

  private async saveState(): Promise<void> {
    await this.vault.updateProjectManager(this.config.projectName, this.state);
  }

  getManagerId(): string {
    return this.managerId;
  }

  getProjectName(): string {
    return this.config.projectName;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  async assignTask(task: TaskEntry): Promise<void> {
    this.state.currentTaskId = task.id;
    this.state.totalTasks++;
    await this.saveState();

    const subtasks = await this.decomposeTask(task);

    for (const subtask of subtasks) {
      await this.spawnWorkerAndExecute(subtask);
    }

    this.state.currentTaskId = null;
    this.state.completedTasks++;
    await this.saveState();
  }

  private async decomposeTask(task: TaskEntry): Promise<TaskEntry[]> {
    const subtasks: TaskEntry[] = [];

    const subtask: TaskEntry = {
      id: `${task.id}-sub-${subtasks.length}`,
      path: `projects/${this.config.projectName}/tasks/${task.id}-sub-${subtasks.length}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "task",
      title: task.title,
      description: task.description,
      status: "queued",
      priority: task.priority,
      assignee: null,
      tier: 3,
      parentTaskId: task.id,
      subtasks: [],
      dependencies: [],
      createdBy: this.managerId,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      artifacts: [],
      doneMarker: false,
      doneMessage: null,
    };

    subtasks.push(subtask);

    await this.vault.write(subtask.path, subtask);

    return subtasks;
  }

  async spawnWorkerAndExecute(task: TaskEntry): Promise<void> {
    const workerType = this.inferWorkerType(task);
    console.log(
      `[ProjectManager:${this.config.projectName}] Spawning ${workerType} worker for task ${task.id}`,
    );

    this.state.activeWorkers.push(task.id);
    await this.saveState();

    task.status = "in_progress";
    task.assignee = workerType;
    task.startedAt = Date.now();
    await this.vault.write(task.path, task);

    await this.executeWithWorker(task, workerType);

    task.status = "completed";
    task.completedAt = Date.now();
    task.doneMarker = true;
    task.doneMessage = `Completed by ${workerType} worker`;
    await this.vault.write(task.path, task);

    this.state.activeWorkers = this.state.activeWorkers.filter((id) => id !== task.id);
    await this.saveState();
  }

  private inferWorkerType(task: TaskEntry): WorkerType {
    const title = task.title.toLowerCase();
    const desc = task.description.toLowerCase();
    const combined = `${title} ${desc}`;

    if (combined.includes("test") || combined.includes("validate") || combined.includes("verify")) {
      return "tester";
    }
    if (
      combined.includes("build") ||
      combined.includes("compile") ||
      combined.includes("install") ||
      combined.includes("package")
    ) {
      return "builder";
    }
    if (
      combined.includes("think") ||
      combined.includes("strategic") ||
      combined.includes("improve") ||
      combined.includes("analyze") ||
      combined.includes("big picture") ||
      combined.includes("architect")
    ) {
      return "thinker";
    }
    if (
      combined.includes("email") ||
      combined.includes("whatsapp") ||
      combined.includes("message") ||
      combined.includes("notify") ||
      combined.includes("send") ||
      combined.includes("comms") ||
      combined.includes("communication")
    ) {
      return "comms";
    }
    if (
      combined.includes("image") ||
      combined.includes("video") ||
      combined.includes("audio") ||
      combined.includes("media") ||
      combined.includes("visual") ||
      combined.includes("generate")
    ) {
      return "media";
    }
    if (
      combined.includes("content") ||
      combined.includes("write") ||
      combined.includes("document") ||
      combined.includes("article") ||
      combined.includes("copy") ||
      combined.includes("summarize") ||
      combined.includes("report")
    ) {
      return "content";
    }
    if (
      combined.includes("research") ||
      combined.includes("find") ||
      combined.includes("gather") ||
      combined.includes("search")
    ) {
      return "research";
    }
    if (
      combined.includes("code") ||
      combined.includes("implement") ||
      combined.includes("debug") ||
      combined.includes("refactor") ||
      combined.includes("feature") ||
      combined.includes("develop")
    ) {
      return "developer";
    }

    return "developer";
  }

  private async executeWithWorker(task: TaskEntry, workerType: WorkerType): Promise<void> {
    console.log(
      `[ProjectManager:${this.config.projectName}] Executing with ${workerType}: ${task.title}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async checkInWithMain(): Promise<ProjectManagerState> {
    this.state.lastCheckIn = Date.now();
    await this.saveState();

    const eventId = `checkin-${this.config.projectName}-${Date.now()}`;
    const event = {
      id: eventId,
      path: `events/${eventId}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { projectName: this.config.projectName },
      type: "event",
      eventType: "manager-checkin",
      eventData: JSON.stringify({
        message: `Automated check-in from ${this.config.projectName}`,
        projectName: this.config.projectName,
        activeWorkers: this.state.activeWorkers.length,
        completedTasks: this.state.completedTasks,
        blockers: this.state.blockers,
      }),
      recipient: "main",
      timestamp: Date.now(),
      status: "pending",
      sender: this.managerId,
    };
    await this.vault.write(`events/${eventId}.json`, event);

    return this.state;
  }

  async reportBlocker(blocker: string): Promise<void> {
    this.state.blockers.push(blocker);
    await this.saveState();
  }

  async resolveBlocker(blocker: string): Promise<void> {
    this.state.blockers = this.state.blockers.filter((b) => b !== blocker);
    await this.saveState();
  }

  getStatus(): ProjectManagerState {
    return { ...this.state };
  }
}

export function createProjectManager(
  vault: VaultManager,
  projectName: string,
  description?: string,
  projectType: "system" | "project" = "project",
): ProjectManager {
  const config: ProjectManagerConfig = {
    projectName,
    description,
    projectType,
  };
  return new ProjectManager(vault, config);
}

export function createSystemManager(vault: VaultManager): ProjectManager {
  return createProjectManager(
    vault,
    "system",
    "System infrastructure and self-maintenance",
    "system",
  );
}
