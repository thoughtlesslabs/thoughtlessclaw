import type { VaultManager, TaskEntry, AgentState } from "../../vault/index.js";

export type WorkerType =
  | "developer"
  | "comms"
  | "content"
  | "media"
  | "research"
  | "thinker"
  | "builder"
  | "tester";

export interface WorkerConfig {
  type: WorkerType;
  description: string;
  capabilities: string[];
  defaultModelPreference?: string;
}

export const WORKER_CONFIGS: Record<WorkerType, WorkerConfig> = {
  developer: {
    type: "developer",
    description: "Software development - writes code, fixes bugs, implements features, refactors",
    capabilities: [
      "code generation",
      "bug fixing",
      "refactoring",
      "code review",
      "debugging",
      "implementation",
    ],
    defaultModelPreference: "claude-sonnet-4-6",
  },
  comms: {
    type: "comms",
    description:
      "Communications - handles email, WhatsApp, messaging, notifications, sending messages",
    capabilities: [
      "email sending",
      "whatsapp messaging",
      "notification dispatch",
      "message composition",
      "routing",
    ],
    defaultModelPreference: "claude-3-haiku",
  },
  content: {
    type: "content",
    description: "Content creation - writes articles, documentation, marketing copy, summaries",
    capabilities: [
      "writing",
      "documentation",
      "marketing copy",
      "summarization",
      "editing",
      "formatting",
    ],
    defaultModelPreference: "claude-sonnet-4-6",
  },
  media: {
    type: "media",
    description: "Media generation - creates images, videos, audio, visual content",
    capabilities: [
      "image generation",
      "video generation",
      "audio generation",
      "visual composition",
      "asset creation",
    ],
    defaultModelPreference: "claude-3-opus",
  },
  research: {
    type: "research",
    description: "Research - gathers information, searches the web, analyzes data",
    capabilities: [
      "web search",
      "information gathering",
      "data analysis",
      "documentation review",
      "synthesis",
    ],
    defaultModelPreference: "claude-sonnet-4-6",
  },
  thinker: {
    type: "thinker",
    description: "Strategic thinking - big picture analysis, system improvement, innovative ideas",
    capabilities: [
      "strategic analysis",
      "system thinking",
      "improvement proposals",
      "trend analysis",
      "innovation",
    ],
    defaultModelPreference: "claude-3-opus",
  },
  builder: {
    type: "builder",
    description: "Build and compilation - compiles code, generates artifacts, builds packages",
    capabilities: [
      "compilation",
      "bundling",
      "artifact generation",
      "package building",
      "deployment prep",
    ],
    defaultModelPreference: "claude-3-haiku",
  },
  tester: {
    type: "tester",
    description: "Testing and validation - writes tests, validates outputs, ensures quality",
    capabilities: [
      "unit testing",
      "integration testing",
      "validation",
      "quality assurance",
      "verification",
    ],
    defaultModelPreference: "claude-sonnet-4-6",
  },
};

export class WorkerAgent {
  private vault: VaultManager;
  private config: WorkerConfig;
  private workerId: string;
  private projectName: string;
  private systemPrompt: string;

  constructor(vault: VaultManager, type: WorkerType, workerId?: string, projectName?: string) {
    this.vault = vault;
    this.config = WORKER_CONFIGS[type];
    this.workerId = workerId || `skynet-${type}`;
    this.projectName = projectName || "default";
    this.systemPrompt = this.buildSystemPrompt();
  }

  private buildSystemPrompt(): string {
    return `# ${this.workerId.toUpperCase()} Worker Agent

## Role
${this.config.description}

## Capabilities
${this.config.capabilities.map((c) => `- ${c}`).join("\n")}

---

## Compliance Rules

You are a Tier 3 Worker in the Skynet OS. Your work is monitored and must comply with the following contracts. Non-compliance results in violations that are recorded permanently.

### Completion Contract (MANDATORY)

Every completed task MUST use this exact format — **no exceptions**:

\`\`\`
DONE: <summary of what was accomplished>

ARTIFACTS:
- <artifact name>: <description>
- <artifact name>: <description>

ERRORS: (if any)
- <error description>
\`\`\`

**Violations triggered by non-compliance:**
- Missing \`DONE:\` prefix → \`completion\` violation (major, −10 reward points)
- Unlogged artifacts → \`completion\` violation (minor, warning)
- Missing error details on failure → \`completion\` violation (minor, warning)

### Task Scope

- You operate **only** within your assigned task
- Do not modify vault state outside your task scope
- Do not create tasks or spawn other agents — that is your manager's job
- Do not attempt to access other projects' data

**Violation:** Operating outside task scope → \`scope\` violation (major, −10 reward points)

### Resource Limits

- Token usage is tracked for every task you execute
- Excessive token consumption triggers \`budget\` violations
- Work efficiently: solve the task, report results, stop
- If a task exceeds timeout → \`timeout\` violation (major, −10 reward points)

### Reporting Chain

- Your output is reviewed by your Project Manager
- Results are written to \`vault/tasks/<taskId>.json\`
- You do not communicate directly with executives — escalation goes through your manager

## Escalation (When Blocked)

If you encounter a blocker you cannot resolve:

1. **Propose a solution**: Never just ask "what do I do?" — always propose what you think should happen
2. **Use governance(ask-manager)** with:
   - question: What you need help with
   - proposedSolution: Your suggested approach
   - taskId: Your current task ID
3. **Use governance(check-responses)** to get answers to your questions

Example:
- governance(ask-manager, question: "How to handle X?", proposedSolution: "I think we should do Y because...", taskId: "task-xxx")
- governance(check-responses, sender: "worker")

If your manager can't resolve it, they will escalate to the executive team. If it needs user input, it will flow back to you.

---

## Task Execution Flow

1. Read task from \`vault/tasks/<taskId>.json\`
2. Execute the assigned work using your capabilities
3. Write completion with \`DONE:\` prefix (mandatory)
4. Log all artifacts created to THIS PROJECT'S folder
5. Report any errors encountered

## Memory Isolation (IMPORTANT)

You are SILOED to project "${this.projectName}". This is critical:

- **Your memories go to**: \`vault/projects/${this.projectName}/memories/\`
- **NOT to your own folder** - you don't have one
- **Don't read/write other projects' data**
- This prevents cross-contamination between projects

When you learn something useful, write it to:
\`vault/projects/${this.projectName}/memories/worker-${Date.now()}.md\`

## Current Date
${new Date().toISOString()}
`;
  }

  getWorkerId(): string {
    return this.workerId;
  }

  getProjectName(): string {
    return this.projectName;
  }

  getType(): WorkerType {
    return this.config.type;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  async getAssignedTask(): Promise<TaskEntry | null> {
    const state = await this.getState();
    if (!state || !state.currentTaskId) {
      return null;
    }
    return this.vault.read<TaskEntry>(`tasks/${state.currentTaskId}.json`);
  }

  async getState(): Promise<AgentState | null> {
    return this.vault.read<AgentState>(`agents/workers/${this.workerId}.json`);
  }

  async updateStatus(status: AgentState["status"]): Promise<void> {
    const state = await this.getState();
    if (!state) {
      return;
    }

    state.status = status;
    if (status === "awake") {
      state.lastWake = Date.now();
    } else if (status === "sleeping") {
      state.lastSleep = Date.now();
    }

    await this.vault.write(`agents/workers/${this.workerId}.json`, state);
  }

  async completeTask(
    taskId: string,
    summary: string,
    artifacts: { name: string; description: string; path: string }[],
  ): Promise<void> {
    const task = await this.vault.read<TaskEntry>(`tasks/${taskId}`);
    if (!task) {
      return;
    }

    task.status = "completed";
    task.completedAt = Date.now();
    task.doneMarker = true;
    task.doneMessage = summary;
    task.artifacts = artifacts.map((a, i) => ({
      id: `artifact-${Date.now()}-${i}`,
      type: "file" as const,
      name: a.name,
      path: a.path,
      description: a.description,
      createdAt: Date.now(),
    }));

    await this.vault.write(`tasks/${taskId}.json`, task);

    await this.updateStatus("sleeping");
  }

  async failTask(taskId: string, error: string): Promise<void> {
    const task = await this.vault.read<TaskEntry>(`tasks/${taskId}`);
    if (!task) {
      return;
    }

    task.status = "failed";
    task.doneMarker = false;
    task.doneMessage = `FAILED: ${error}`;

    await this.vault.write(`tasks/${taskId}.json`, task);

    await this.updateStatus("sleeping");
  }

  static getAvailableTypes(): WorkerType[] {
    return Object.keys(WORKER_CONFIGS) as WorkerType[];
  }
}

export function createWorkerAgent(vault: VaultManager, type: WorkerType): WorkerAgent {
  return new WorkerAgent(vault, type);
}
