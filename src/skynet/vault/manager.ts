import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  VaultEntry,
  AgentState,
  VaultConfig,
  VaultPath,
  ProjectEntry,
  ProjectManagerState,
  ProposalEntry,
  LearningEntry,
  RoutingPattern,
} from "./types.js";
import { DEFAULT_VAULT_CONFIG } from "./types.js";

export class VaultManager {
  private basePath: string;
  private config: VaultConfig;
  private writeBuffer = new Map<string, NodeJS.Timeout>();
  // Mutex Lock for Vault Write Race Conditions
  private writeLocks = new Map<string, Promise<void>>();
  private debounceMs = 100;

  constructor(basePath?: string, config?: Partial<VaultConfig>) {
    this.config = { ...DEFAULT_VAULT_CONFIG, ...config };
    this.basePath = path.resolve(this.config.vaultPath.replace("~", process.env.HOME || ""));
  }

  async initialize(): Promise<void> {
    const dirs = [
      "agents/main",
      "agents/oversight",
      "agents/monitor",
      "agents/optimizer",
      "projects/system/tasks",
      "projects/system/memories",
      "projects/system/workers",
      "inbox",
      "memories",
      "heartbeats",
      "tasks",
      "contracts",
      "votes",
      "budget",
      "proposals",
      "decisions",
      "learning",
      "patterns/approved",
      "patterns/history",
      "priorities/active",
      "priorities/history",
      "priorities/votes",
      "events",
    ];

    for (const dir of dirs) {
      const fullPath = path.join(this.basePath, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }

    await this.initializeAgentStates();
    await this.initializeSystemProject();
    await this.migrateExistingManagers();
  }

  private async migrateExistingManagers(): Promise<void> {
    const projectDirs = await this.listDirs("projects/");
    for (const dir of projectDirs) {
      const managerAgentPath = path.join(this.basePath, `agents/manager-${dir}`);
      const identityPath = path.join(managerAgentPath, "IDENTITY.md");

      if (!fsSync.existsSync(identityPath)) {
        await fs.mkdir(managerAgentPath, { recursive: true });

        const identity = `# MANAGER: ${dir.toUpperCase()}\n\n## Project\n${dir}\n\n## Role\nProject Manager responsible for delivering project outcomes.\n\n## Responsibilities\n- Break down goals into executable tasks\n- Spawn and coordinate workers\n- Report progress to Main Executive\n- Ensure quality and timely delivery\n`;
        await fs.writeFile(identityPath, identity);

        const soul = `# Project Manager Soul\n\n## Core Traits\n- Ownership: I own this project end-to-end\n- Accountability: I ensure deliverables meet standards\n- Urgency: I act quickly on blockers\n- Communication: I keep stakeholders informed\n`;
        await fs.writeFile(path.join(managerAgentPath, "SOUL.md"), soul);

        const agents = `# Agents for ${dir} Manager\n\nThis manager oversees project: ${dir}\n\n## Hierarchy\n- Main Executive → This Manager → Workers\n\n## Communication\n- Report to: Main Executive\n- Spawn: Worker agents\n- Escalate to: Executive team when blocked\n`;
        await fs.writeFile(path.join(managerAgentPath, "AGENTS.md"), agents);

        const tools = `# Tools Available to ${dir} Manager\n\n## Governance\n- governance(ask-executive) - Escalate to executive team\n- governance(create-task) - Create new tasks\n- governance(complete-task) - Mark tasks complete\n- governance(spawn-worker) - Spawn worker agents\n\n## Project Management\n- governance(list-workers) - List active workers\n- governance(worker-status) - Check worker progress\n`;
        await fs.writeFile(path.join(managerAgentPath, "TOOLS.md"), tools);

        const security = `# Security Protocol for ${dir} Manager\n\n## Access Control\n- Only spawn workers within this project\n- Don't access other projects' data\n- Report any suspicious activity\n\n## Compliance\n- Follow completion contracts\n- Log all artifacts\n- Report violations immediately\n`;
        await fs.writeFile(path.join(managerAgentPath, "SECURITY_PROTOCOL.md"), security);

        const user = `# User Context\n\nThis manager manages project: ${dir}\n\n## Deliverables\n- Project-specific goals and milestones\n- Quality standards defined per project\n- Timeline requirements\n`;
        await fs.writeFile(path.join(managerAgentPath, "USER.md"), user);

        const stateJson = JSON.stringify(
          {
            tier: 2,
            role: "manager",
            project: dir,
            createdAt: Date.now(),
            rewardPoints: 1000,
            violations: [],
          },
          null,
          2,
        );
        await fs.writeFile(path.join(managerAgentPath, "state.json"), stateJson);

        console.log(`[Vault] Migrated manager agent folder for: ${dir}`);
      }
    }
  }

  private async initializeSystemProject(): Promise<void> {
    const systemProjectPath = "projects/system/project.json";
    const existing = await this.read<ProjectEntry>(systemProjectPath);

    if (!existing) {
      const project: ProjectEntry = {
        id: randomUUID(),
        path: systemProjectPath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "project",
        name: "system",
        projectType: "system",
        description: "System infrastructure and self-maintenance",
        status: "active",
        createdBy: "skynet-init",
        managerId: null,
        tasks: [],
        workers: [],
      };
      await this.write(systemProjectPath, project);

      const managerState: ProjectManagerState = {
        id: randomUUID(),
        path: "projects/system/manager.json",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        type: "project_manager",
        projectName: "system",
        projectType: "system",
        status: "active",
        currentTaskId: null,
        activeWorkers: [],
        completedTasks: 0,
        totalTasks: 0,
        lastCheckIn: Date.now(),
        blockers: [],
      };
      await this.write("projects/system/manager.json", managerState);
    }
  }

  private async initializeAgentStates(): Promise<void> {
    const executives = ["main", "oversight", "monitor", "optimizer"];
    for (const agentId of executives) {
      const statePath = path.join(this.basePath, "agents", agentId, "state.json");
      try {
        await fs.access(statePath);
      } catch {
        const state: AgentState = {
          id: randomUUID(),
          path: `agents/${agentId}/state.json`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: {},
          type: "agent_state",
          agentId,
          role: "executive",
          tier: 1,
          status: "sleeping",
          lastWake: 0,
          lastSleep: 0,
          currentTaskId: null,
          rewardPoints: this.config.rewardStartingPoints,
          violations: [],
          capabilities: [],
        };
        await this.write(`agents/${agentId}/state.json`, state);
      }
    }
  }

  async read<T extends VaultEntry>(vaultPath: VaultPath): Promise<T | null> {
    const fullPath = path.join(this.basePath, vaultPath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      return JSON.parse(content) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async write(vaultPath: VaultPath, entry: VaultEntry): Promise<void> {
    const fullPath = path.join(this.basePath, vaultPath);

    // Acquire Write Lock (Mutex)
    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const existingLock = this.writeLocks.get(vaultPath);
    if (existingLock) {
      await existingLock;
    }
    this.writeLocks.set(vaultPath, lockPromise);

    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      entry.updatedAt = Date.now();
      await fs.writeFile(fullPath, JSON.stringify(entry, null, 2), "utf-8");

      // --- AUTO-GOVERNANCE NERVOUS SYSTEM HOOKS ---
      try {
        // 1. Artifact Auto-Logging
        // When purely writing a new data file to the artifacts directory, auto-attach it to the worker's active task
        if (vaultPath.includes("/artifacts/") && !vaultPath.includes("tasks/")) {
          const parts = vaultPath.split("/");
          const projectIndex = parts.indexOf("projects");
          if (projectIndex >= 0 && parts.length > projectIndex + 1) {
            const projectName = parts[projectIndex + 1];
            // Find the active worker in this project
            const workers = await this.list(`projects/${projectName}/workers/`);
            for (const wf of workers) {
              if (wf.endsWith(".json")) {
                const workerInfo = (await this.read(
                  `projects/${projectName}/workers/${wf}`,
                )) as Record<string, unknown> | null;
                if (
                  workerInfo &&
                  workerInfo.status === "running" &&
                  typeof workerInfo.currentTaskId === "string"
                ) {
                  const currentTaskIdString = workerInfo.currentTaskId;
                  // Get that active task and append the artifact
                  const activeTask = (await this.read(
                    `tasks/${currentTaskIdString}.json`,
                  )) as Record<string, unknown> | null;
                  if (activeTask && Array.isArray(activeTask.artifacts)) {
                    const artifactName = path.basename(vaultPath);
                    const alreadyLogged = activeTask.artifacts.some(
                      (a: Record<string, unknown>) => a.name === artifactName,
                    );
                    if (!alreadyLogged) {
                      activeTask.artifacts.push({
                        name: artifactName,
                        path: vaultPath,
                        addedAt: Date.now(),
                      });
                      await fs.writeFile(
                        path.join(this.basePath, `tasks/${currentTaskIdString}.json`),
                        JSON.stringify(activeTask, null, 2),
                        "utf-8",
                      );
                      console.log(
                        `[NERVOUS_SYSTEM] Auto-logged artifact ${artifactName} to task ${currentTaskIdString}`,
                      );
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("[NERVOUS_SYSTEM] Auto-governance hook failed:", err);
      }
      // --------------------------------------------
    } finally {
      this.writeLocks.delete(vaultPath);
      releaseLock();
    }
  }

  async writeDebounced(vaultPath: VaultPath, entry: VaultEntry): Promise<void> {
    const key = vaultPath;
    const existing = this.writeBuffer.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      await this.write(vaultPath, entry);
      this.writeBuffer.delete(key);
    }, this.debounceMs);

    this.writeBuffer.set(key, timeout);
  }

  async list(vaultPath: VaultPath, pattern?: string): Promise<string[]> {
    const fullPath = path.join(this.basePath, vaultPath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      let files = entries.filter((e) => e.isFile()).map((e) => e.name);

      if (pattern) {
        const regex = new RegExp(pattern);
        files = files.filter((f) => regex.test(f));
      }

      return files;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async listDirs(vaultPath: VaultPath): Promise<string[]> {
    const fullPath = path.join(this.basePath, vaultPath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async exists(vaultPath: VaultPath): Promise<boolean> {
    const fullPath = path.join(this.basePath, vaultPath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(vaultPath: VaultPath): Promise<void> {
    const fullPath = path.join(this.basePath, vaultPath);
    await fs.rm(fullPath, { force: true });
  }

  getBasePath(): string {
    return this.basePath;
  }

  async createProject(
    name: string,
    options: {
      type: "system" | "project";
      description: string;
      createdBy: string;
    },
  ): Promise<ProjectEntry> {
    const projectPath = `projects/${name}/project.json`;

    const project: ProjectEntry = {
      id: randomUUID(),
      path: projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "project",
      name,
      projectType: options.type,
      description: options.description,
      status: "active",
      createdBy: options.createdBy,
      managerId: null,
      tasks: [],
      workers: [],
    };

    await this.write(projectPath, project);

    await fs.mkdir(path.join(this.basePath, "projects", name, "tasks"), { recursive: true });
    await fs.mkdir(path.join(this.basePath, "projects", name, "memories"), { recursive: true });
    await fs.mkdir(path.join(this.basePath, "projects", name, "workers"), { recursive: true });

    return project;
  }

  async getProject(name: string): Promise<ProjectEntry | null> {
    return this.read<ProjectEntry>(`projects/${name}/project.json`);
  }

  async listProjects(): Promise<string[]> {
    return this.listDirs("projects");
  }

  async updateProject(name: string, updates: Partial<ProjectEntry>): Promise<void> {
    const project = await this.getProject(name);
    if (project) {
      await this.write(`projects/${name}/project.json`, { ...project, ...updates });
    }
  }

  async createProjectManager(projectName: string, managerId: string): Promise<ProjectManagerState> {
    const managerAgentPath = path.join(this.basePath, `agents/manager-${projectName}`);
    await fs.mkdir(managerAgentPath, { recursive: true });

    const identity = `# MANAGER: ${projectName.toUpperCase()}\n\n## Project\n${projectName}\n\n## Role\nProject Manager responsible for delivering project outcomes.\n\n## Responsibilities\n- Break down goals into executable tasks in the Vault\n- Spawn workers via the Nervous System\n- Evaluate worker completion via Vault updates\n- Ensure quality and timely delivery\n`;
    await fs.writeFile(path.join(managerAgentPath, "IDENTITY.md"), identity);

    const soul = `# Project Manager Soul\n\n## Core Traits\n- Ownership: I own this project end-to-end\n- Accountability: I ensure deliverables meet standards\n- Urgency: I act quickly on blockers\n- Communication: I document all progress in the project Vault\n`;
    await fs.writeFile(path.join(managerAgentPath, "SOUL.md"), soul);

    const agents = `# Agents for ${projectName} Manager\n\nThis manager oversees project: ${projectName}\n\n## Hierarchy\n- Main Executive → This Manager → Workers\n\n## Communication Rule\n- ALL communication flows through the Vault.\n- Spawn workers via \`governance(spawn-worker)\`.\n- Review worker progress by reading the Vault state.\n- Escalate blockers via \`governance(ask-executive)\`.\n`;
    await fs.writeFile(path.join(managerAgentPath, "AGENTS.md"), agents);

    const workloop = `# Manager Work Loop for ${projectName}

## Your Job
You are an ALWAYS-ON manager. Your role is to continuously manage your project by mutating state in your Project Vault:
1. Check for pending tasks: vault.list('tasks/')
2. Spawn workers via governance(spawn-worker) for pending tasks  
3. Evaluate worker completion via governance(evaluate-worker-task)
4. Mark tasks complete in the vault

## Physical Interceptor Events
Workers do NOT send you messages. Instead, the Gateway Interceptor triggers when workers output:
- \`DONE:\` — Interceptor auto-runs complete-task and sends you a Nervous System notification
- \`ERRORS:\` — Interceptor auto-escalates the issue to you
- \`BLOCKER:\` — Interceptor auto-escalates the blocker to you

When you receive an interceptor event: Read the worker artifact from the Vault and run \`governance(evaluate-worker-task)\`.

## Dormant-Check Watchdog
The Nervous System watchdog sends you a dormant-check if you go idle. On receipt:
1. Run governance(poll-events) to check for pending events addressed to you
2. Check the Vault for pending tasks and continue work
3. If truly idle: reply HEARTBEAT_OK

## Escalation
If blocked: use \`governance(ask-executive)\` — this writes to the Vault and all three executives (oversight, monitor, optimizer) are immediately woken to respond.
`;
    await fs.writeFile(path.join(managerAgentPath, "WORKLOOP.md"), workloop);

    const tools = `# Tools Available to ${projectName} Manager\n\n## Governance\n- governance(ask-executive) - Escalate via Vault task\n- governance(create-task) - Create new tasks\n- governance(evaluate-worker-task) - Review completed worker output\n- governance(spawn-worker) - Spawn worker agents via Nervous System\n`;
    await fs.writeFile(path.join(managerAgentPath, "TOOLS.md"), tools);

    const security = `# Security Protocol for ${projectName} Manager\n\n## Access Control\n- Only spawn workers within this project\n- Don't access other projects' data\n- Report any suspicious activity\n\n## Compliance\n- Follow completion contracts\n- Log all artifacts\n- Report violations immediately\n`;
    await fs.writeFile(path.join(managerAgentPath, "SECURITY_PROTOCOL.md"), security);

    const user = `# User Context\n\nThis manager manages project: ${projectName}\n\n## Deliverables\n- Project-specific goals and milestones\n- Quality standards defined per project\n- Timeline requirements\n`;
    await fs.writeFile(path.join(managerAgentPath, "USER.md"), user);

    const stateJson = JSON.stringify(
      {
        tier: 2,
        role: "manager",
        project: projectName,
        createdAt: Date.now(),
        rewardPoints: 1000,
        violations: [],
      },
      null,
      2,
    );
    await fs.writeFile(path.join(managerAgentPath, "state.json"), stateJson);

    const state = {
      id: managerId,
      path: `projects/${projectName}/manager.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "project_manager" as const,
      projectName,
      projectType: "project" as const,
      status: "active" as const,
      currentTaskId: null,
      activeWorkers: [],
      completedTasks: 0,
      totalTasks: 0,
      lastCheckIn: Date.now(),
      blockers: [],
    };

    await this.write(`projects/${projectName}/manager.json`, state);
    await this.updateProject(projectName, { managerId });

    return state;
  }

  async getProjectManager(projectName: string): Promise<ProjectManagerState | null> {
    return this.read<ProjectManagerState>(`projects/${projectName}/manager.json`);
  }

  async updateProjectManager(
    projectName: string,
    updates: Partial<ProjectManagerState>,
  ): Promise<void> {
    const manager = await this.getProjectManager(projectName);
    if (manager) {
      await this.write(`projects/${projectName}/manager.json`, { ...manager, ...updates });
    }
  }

  async createProposal(
    originalRequest: string,
    mainPlan: string,
    _createdBy: string,
    _projectName: string | null = null,
  ): Promise<ProposalEntry> {
    const proposal: ProposalEntry = {
      id: randomUUID(),
      path: `proposals/proposal-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "proposal",
      status: "pending",
      requester: "main" as const,
      request: originalRequest,
      plan: mainPlan,
      improvements: [],
      votes: { main: undefined, oversight: undefined, monitor: undefined, optimizer: undefined },
      approvedAt: null,
      rejectedAt: null,
    };

    await this.write(`proposals/${proposal.id}.json`, proposal);
    return proposal;
  }

  async getProposal(proposalId: string): Promise<ProposalEntry | null> {
    return this.read<ProposalEntry>(`proposals/${proposalId}.json`);
  }

  async updateProposal(proposalId: string, updates: Partial<ProposalEntry>): Promise<void> {
    const proposal = await this.getProposal(proposalId);
    if (proposal) {
      await this.write(`proposals/${proposalId}.json`, { ...proposal, ...updates });
    }
  }

  async addImprovement(
    proposalId: string,
    improvement: {
      by: "oversight" | "monitor" | "optimizer";
      suggestion: string;
    },
  ): Promise<void> {
    const proposal = await this.getProposal(proposalId);
    if (proposal) {
      proposal.improvements.push(`[${improvement.by}] ${improvement.suggestion}`);
      await this.write(`proposals/${proposalId}.json`, proposal);
    }
  }

  async listProposals(): Promise<string[]> {
    return this.list("proposals", "\\.json$");
  }

  async getRoutingPatterns(): Promise<RoutingPattern[]> {
    const entry = await this.read<LearningEntry>("learning/routing.json");
    return entry?.patterns || [];
  }

  async addRoutingPattern(
    pattern: Omit<RoutingPattern, "matchCount" | "lastMatched">,
  ): Promise<void> {
    const patterns = await this.getRoutingPatterns();
    const existing = patterns.findIndex((p) => p.requestPattern === pattern.requestPattern);

    if (existing >= 0) {
      patterns[existing].matchCount++;
      patterns[existing].lastMatched = Date.now();
      if (pattern.triadsCorrection) {
        patterns[existing].triadsCorrection = true;
      }
    } else {
      patterns.push({
        ...pattern,
        matchCount: 1,
        lastMatched: Date.now(),
      });
    }

    const entry: LearningEntry = {
      id: "routing-learning",
      path: "learning/routing.json",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "learning",
      patterns,
      lastUpdated: Date.now(),
    };

    await this.write("learning/routing.json", entry);
  }

  getConfig(): VaultConfig {
    return { ...this.config };
  }

  async flush(): Promise<void> {
    for (const [key, timeout] of this.writeBuffer) {
      clearTimeout(timeout);
      this.writeBuffer.delete(key);
    }
  }
}

export function createVaultManager(basePath?: string, config?: Partial<VaultConfig>): VaultManager {
  return new VaultManager(basePath, config);
}
