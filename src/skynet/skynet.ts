import type { ModelRef } from "../agents/model-selection.js";
import { createExecutiveAgent, ExecutiveAgent } from "./agents/executives/index.js";
import type { ExecutiveRole } from "./agents/executives/index.js";
import {
  createSystemManager,
  createProjectManager,
  ProjectManager,
} from "./agents/managers/index.js";
import { createBudgetManager, BudgetManager } from "./budget/index.js";
import { SkynetDaemon, DEFAULT_SKYNET_CONFIG } from "./daemon/index.js";
import type { SkynetConfig } from "./daemon/types.js";
import { createTaskExecutor, TaskExecutor } from "./execution/index.js";
import { createContextPressureMonitor, ContextPressureMonitor } from "./monitoring/index.js";
import { createFailoverManager, ProviderFailoverManager } from "./providers/index.js";
import { VaultManager, createVaultManager } from "./vault/index.js";
import type { TaskEntry } from "./vault/index.js";
import { createViolationTracker, ViolationTracker } from "./violations/index.js";

export class Skynet {
  private vault: VaultManager;
  private daemon: SkynetDaemon;
  private budgetManager: BudgetManager;
  private violationTracker: ViolationTracker;
  private failoverManager: ProviderFailoverManager;
  private contextMonitor: ContextPressureMonitor;
  private taskExecutor: TaskExecutor;
  private executives = new Map<ExecutiveRole, ExecutiveAgent>();
  private systemManager!: ProjectManager;
  private projectManagers = new Map<string, ProjectManager>();
  private config: SkynetConfig;

  constructor(config?: Partial<SkynetConfig>) {
    this.config = { ...DEFAULT_SKYNET_CONFIG, ...config };
    this.vault = createVaultManager(this.config.vaultPath, {
      vaultPath: this.config.vaultPath,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      idleSleepThresholdMs: this.config.idleSleepThresholdMs,
      contextThresholdPercent: this.config.contextThresholdPercent,
      defaultTokenBudget: this.config.defaultTokenBudget,
      violationPenalty: this.config.violationPenalty,
      rewardStartingPoints: this.config.rewardStartingPoints,
      triadThreshold: this.config.triadThreshold,
    });
    this.daemon = new SkynetDaemon(this.vault, this.config);
    this.budgetManager = createBudgetManager(this.vault);
    this.violationTracker = createViolationTracker(this.vault.getBasePath());
    this.failoverManager = createFailoverManager();
    this.contextMonitor = createContextPressureMonitor(this.vault);
    this.taskExecutor = createTaskExecutor();
  }

  async initialize(): Promise<void> {
    await this.vault.initialize();
    await this.violationTracker.initialize();

    this.setupDefaultProviderChains();

    const roles: ExecutiveRole[] = ["main", "oversight", "monitor", "optimizer"];
    for (const role of roles) {
      this.executives.set(role, createExecutiveAgent(this.vault, role));
    }

    this.systemManager = createSystemManager(this.vault);
    await this.systemManager.initialize();

    this.daemon.setExecutor(async (agentId, task) => {
      await this.executeTask(agentId, task);
    });

    // Save manager sessions before shutdown
    process.on("beforeExit", async () => {
      await this.saveManagerSessions();
    });

    console.log("[Skynet] Initialized with System Manager");
  }

  async saveManagerSessions(): Promise<void> {
    console.log("[Skynet] Saving manager sessions...");

    try {
      const projectDirs = await this.vault.listProjects();
      const sessionsToSave: Array<{ projectName: string; sessionKey: string }> = [];

      for (const projectName of projectDirs) {
        const managerPath = `projects/${projectName}/manager.json`;
        const rawManager = (await this.vault.read(managerPath)) as unknown as Record<
          string,
          unknown
        > | null;

        if (!rawManager) {
          continue;
        }

        const isActive = rawManager.status === "active";
        if (!isActive) {
          continue;
        }

        const hasSession =
          rawManager.agentSessionId &&
          typeof rawManager.agentSessionId === "string" &&
          rawManager.agentSessionId.length > 0;

        if (hasSession) {
          sessionsToSave.push({
            projectName,
            sessionKey: `agent:manager-${projectName}:main`,
          });
          console.log(`[Skynet] Saving session for manager "${projectName}"`);
        }
      }

      await this.vault.write("system/manager-sessions.json", {
        sessions: sessionsToSave,
        savedAt: Date.now(),
      } as unknown as {
        id: string;
        path: string;
        createdAt: number;
        updatedAt: number;
        metadata: Record<string, unknown>;
      });

      console.log(`[Skynet] ✅ Saved ${sessionsToSave.length} manager sessions`);
    } catch (err) {
      console.error("[Skynet] Error saving manager sessions:", err);
    }
  }

  private setupDefaultProviderChains(): void {
    this.failoverManager.setFailoverChain("default", {
      primary: { provider: "anthropic", model: "claude-sonnet-4-6" },
      fallbacks: [
        { provider: "openai", model: "gpt-4o" },
        { provider: "google", model: "gemini-2-flash" },
      ],
    });

    this.failoverManager.setFailoverChain("reasoning", {
      primary: { provider: "openai", model: "o1-mini" },
      fallbacks: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
    });

    this.failoverManager.setFailoverChain("fast", {
      primary: { provider: "anthropic", model: "claude-3-haiku" },
      fallbacks: [
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "google", model: "gemini-2-flash-lite" },
      ],
    });

    this.failoverManager.setFailoverChain("large-context", {
      primary: { provider: "anthropic", model: "claude-3-opus" },
      fallbacks: [{ provider: "openai", model: "gpt-4-turbo" }],
    });
  }

  async start(): Promise<void> {
    await this.daemon.start();
    console.log("[Skynet] Started");
  }

  async stop(): Promise<void> {
    await this.daemon.stop();
    console.log("[Skynet] Stopped");
  }

  async executeTask(agentId: string, task: TaskEntry): Promise<void> {
    const estimatedTokens = task.description.length * 2;
    const modelRef = await this.failoverManager.selectProvider("default", estimatedTokens);

    const executive = this.executives.get(agentId as ExecutiveRole);
    if (executive) {
      await executive.logDecision("Executing task", `${task.id}: ${task.title}`);
    }

    const result = await this.taskExecutor.executeTask(task, modelRef || undefined);

    await this.budgetManager.recordUsage(
      agentId,
      result.tokensUsed,
      modelRef?.model || "unknown",
      task.id,
    );

    if (!result.success) {
      await this.violationTracker.recordViolation(
        agentId,
        "timeout",
        `Task ${task.id} failed: ${result.error}`,
        "major",
      );
    }

    if (result.success) {
      console.log(`[Skynet] Task ${task.id} completed in ${result.latencyMs}ms`);
    } else {
      console.error(`[Skynet] Task ${task.id} failed: ${result.error}`);
    }
  }

  getVault(): VaultManager {
    return this.vault;
  }

  getDaemon(): SkynetDaemon {
    return this.daemon;
  }

  getBudgetManager(): BudgetManager {
    return this.budgetManager;
  }

  getViolationTracker(): ViolationTracker {
    return this.violationTracker;
  }

  getFailoverManager(): ProviderFailoverManager {
    return this.failoverManager;
  }

  getContextMonitor(): ContextPressureMonitor {
    return this.contextMonitor;
  }

  getTaskExecutor(): TaskExecutor {
    return this.taskExecutor;
  }

  getExecutive(role: ExecutiveRole): ExecutiveAgent | undefined {
    return this.executives.get(role);
  }

  getAllExecutives(): ExecutiveAgent[] {
    return Array.from(this.executives.values());
  }

  getSystemManager(): ProjectManager {
    return this.systemManager;
  }

  getProjectManager(projectName: string): ProjectManager | undefined {
    return this.projectManagers.get(projectName);
  }

  getAllProjectManagers(): ProjectManager[] {
    return Array.from(this.projectManagers.values());
  }

  async hireProjectManager(projectName: string, description?: string): Promise<ProjectManager> {
    if (this.projectManagers.has(projectName)) {
      throw new Error(`Project manager for "${projectName}" already exists`);
    }

    const manager = createProjectManager(this.vault, projectName, description, "project");
    await manager.initialize();
    this.projectManagers.set(projectName, manager);

    console.log(`[Skynet] Hired project manager for: ${projectName}`);

    return manager;
  }

  async routeRequest(
    request: string,
  ): Promise<{ type: "system" | "project"; projectName?: string }> {
    const requestLower = request.toLowerCase();

    const systemKeywords = [
      "gateway",
      "config",
      "channel",
      "agent",
      "model",
      "provider",
      "health",
      "status",
      "restart",
      "stop",
      "start",
      "update",
      "install",
      "deploy",
      "setup",
      "credentials",
    ];

    for (const keyword of systemKeywords) {
      if (requestLower.includes(keyword)) {
        return { type: "system" };
      }
    }

    const projectMatch = request.match(/(?:project|create|build|make)\s+(\w+)/i);
    if (projectMatch) {
      return { type: "project", projectName: projectMatch[1].toLowerCase() };
    }

    return { type: "system" };
  }

  async listProjects(): Promise<string[]> {
    return this.vault.listProjects();
  }

  getConfig(): SkynetConfig {
    return { ...this.config };
  }

  async addInboxItem(
    request: string,
    context: string,
    from: string,
    priority: "critical" | "high" | "normal" | "low" = "normal",
    source: "human" | "channel" | "scheduler" | "webhook" | "agent" = "human",
  ): Promise<string> {
    const inboxEntry = {
      id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path: `inbox/inbox-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "inbox" as const,
      source,
      priority,
      status: "pending" as const,
      request,
      context,
      from,
      requiresApproval: false,
      approvedBy: [],
    };

    await this.vault.write(`inbox/${inboxEntry.id}.json`, inboxEntry);
    return inboxEntry.id;
  }

  async selectModelForTask(taskType: string, estimatedTokens: number): Promise<ModelRef | null> {
    return this.failoverManager.selectProvider(taskType, estimatedTokens);
  }

  recordSuccess(provider: string, model: string, latencyMs: number): void {
    this.failoverManager.recordSuccess(provider, model, latencyMs);
  }

  recordFailure(provider: string, model: string, error: string): void {
    this.failoverManager.recordFailure(provider, model, error);
  }
}

export function createSkynet(config?: Partial<SkynetConfig>): Skynet {
  return new Skynet(config);
}
