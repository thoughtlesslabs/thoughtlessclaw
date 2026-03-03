// @ts-nocheck

export interface TickHandler {
  name: string;
  description: string;
  intervalMs: number;
  lastRun: number;
  enabled: boolean;
  run: () => Promise<void>;
}

export interface TaskHealth {
  id: string;
  title: string;
  status: string;
  createdAt: number;
  hoursPending: number;
  severity: "ok" | "warning" | "critical";
}

// Manager decides worker type based on task - this should be LLM-driven when manager is active
// For fallback (tick handler when manager is dead), default to content

let tickHandlerRegistryInstance: TickHandlerRegistry | null = null;
const alertedExpiries = new Set<string>();

export function getTickHandlerRegistry(): TickHandlerRegistry | null {
  return tickHandlerRegistryInstance;
}

export class TickHandlerRegistry {
  private handlers: Map<string, TickHandler> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private vault: unknown = null;
  private patternLearner: unknown = null;
  private priorityBoard: unknown = null;

  private async getVault() {
    if (!this.vault) {
      const mod = await import("../vault/manager.js");
      this.vault = mod.createVaultManager("~/.skynet/vault");
    }
    return this.vault;
  }

  private async getPatternLearner() {
    if (!this.patternLearner) {
      const vault = await this.getVault();
      const mod = await import("../learning/pattern-learner.js");
      this.patternLearner = mod.getPatternLearner(vault);
    }
    return this.patternLearner;
  }

  private async getPriorityBoard() {
    if (!this.priorityBoard) {
      const vault = await this.getVault();
      const mod = await import("../governance/priority-board.js");
      this.priorityBoard = mod.getPriorityBoard(vault);
    }
    return this.priorityBoard;
  }

  async initialize(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    tickHandlerRegistryInstance = this;
    await this.registerDefaultHandlers();
  }

  private async registerDefaultHandlers(): Promise<void> {
    this.handlers.set("dormant-check", {
      name: "dormant-check",
      description: "Check for dormant agents and wake them (true heartbeat)",
      intervalMs: 60000,
      lastRun: 0,
      enabled: true,
      run: async () => {
        await this.runDormantCheck();
      },
    });

    const vault = (await this.getVault()) as import("../vault/manager.js").VaultManager;
    const { createFailoverProbeHandler } = await import("./failover-probe.js");
    this.handlers.set("failover-probe", createFailoverProbeHandler(vault));

    this.handlers.set("provider-health", {
      name: "provider-health",
      description: "Dump active provider auth states to a shared JSON cache for pre-flight checks",
      intervalMs: 30000,
      lastRun: 0,
      enabled: true,
      run: async () => {
        await this.runProviderHealthSync();
      },
    });

    this.handlers.set("task-healer", {
      name: "task-healer",
      description:
        "Periodically sweep the Vault for orphaned or stuck 'in_progress' tasks bound to crashed workers",
      intervalMs: 5 * 60000,
      lastRun: 0,
      enabled: true,
      run: async () => {
        await this.runTaskHealer();
      },
    });

    const { createSurvivalMonitorHandler } = await import("./survival-monitor.js");
    this.handlers.set("survival-monitor", createSurvivalMonitorHandler());
  }

  private async runTaskHealer(): Promise<void> {
    try {
      const vault = await this.getVault();
      const vaultMgr = vault as import("../vault/manager.js").VaultManager;
      const tasksFiles = await vaultMgr.list(`tasks/`);
      const now = Date.now();
      const STUCK_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

      let resetCount = 0;
      let healedCount = 0;

      for (const tf of tasksFiles) {
        if (!tf.endsWith(".json")) {
          continue;
        }
        const taskPath = `tasks/${tf}`;
        const task = await vaultMgr.read(taskPath);

        if (!task || typeof task !== "object") {
          continue;
        }

        let changed = false;

        // Auto-heal tasks that are stuck "in_progress" for more than 2 hours
        // (This catches Negative Runtime crashed workers)
        if (task.status === "in_progress") {
          const lastActivity = task.updatedAt || task.createdAt || 0;
          if (now - lastActivity > STUCK_TIMEOUT_MS) {
            console.log(
              `[task-healer] Found stuck task ${task.id} (inactive > 2hrs). Resetting to pending.`,
            );
            task.status = "pending";
            task.updatedAt = now;
            changed = true;
            resetCount++;
          }
        }

        // Auto-heal "pending" tasks lacking proper assignee bindings
        if (task.status === "pending" && (!task.assignee || task.assignee === "")) {
          const projectName = task.metadata?.projectName as string | undefined;
          if (projectName) {
            console.log(
              `[task-healer] Found orphaned task ${task.id}. Rebinding to ${projectName} manager.`,
            );
            task.assignee = `manager-${projectName}`;
            task.updatedAt = now;
            changed = true;
            healedCount++;
          }
        }

        if (changed) {
          await vaultMgr.write(taskPath, task);
        }
      }

      if (resetCount > 0 || healedCount > 0) {
        console.log(
          `[task-healer] Sweep complete. Reset ${resetCount} stuck tasks, bound ${healedCount} unassigned tasks.`,
        );
      }
    } catch (err) {
      console.error("[task-healer] Failed to sweep stuck tasks:", err);
    }
  }

  private async runProviderHealthSync(): Promise<void> {
    try {
      const { resolveAuthStorePath } = await import("../../agents/auth-profiles/paths.js");
      const { loadAuthProfileStore } = await import("../../agents/auth-profiles/store.js");
      const { resolveUserPath } = await import("../../utils.js");
      const { enqueueSystemEvent } = await import("../../infra/system-events.js");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const storePath = resolveAuthStorePath();
      const store = loadAuthProfileStore(storePath);

      const healthData: Record<
        string,
        {
          provider: string;
          model?: string;
          status: "healthy" | "cooldown" | "half-open" | "expired";
          cooldownEndsAt?: number;
        }
      > = {};

      const now = Date.now();

      Object.entries(store.usageStats || {}).forEach(([profileId, stats]) => {
        const credential = store.profiles[profileId];
        if (!credential) {
          return;
        }

        let status: "healthy" | "cooldown" | "half-open" | "expired" = "healthy";

        if (credential.type === "oauth" && typeof credential.expires === "number") {
          if (now >= credential.expires) {
            status = "expired";
          } else if (credential.expires - now < 3 * 24 * 60 * 60 * 1000) {
            if (!alertedExpiries.has(profileId)) {
              alertedExpiries.add(profileId);
              enqueueSystemEvent(
                `[System Warning] OAuth Token for ${profileId} (${credential.provider}) is expiring soon (in less than 3 days). Please re-authenticate to prevent disruption.`,
                { contextKey: "OAuth Expiry" },
              ).catch(() => {});
            }
          }
        }

        let cooldownEndsAt: number | undefined = undefined;

        if (status !== "expired") {
          if (stats.halfOpenActive) {
            status = "half-open";
          } else if (stats.disabledUntil && stats.disabledUntil > now) {
            status = "cooldown";
            cooldownEndsAt = stats.disabledUntil;
          } else if (stats.cooldownUntil && stats.cooldownUntil > now) {
            status = "cooldown";
            cooldownEndsAt = stats.cooldownUntil;
          }
        }

        healthData[profileId] = {
          provider: credential.provider,
          // Extract model from profile ID if it follows formatting style "provider:model"
          model: profileId.includes(":") ? profileId.split(":")[1] : undefined,
          status,
          cooldownEndsAt,
        };
      });

      const skynetDir = resolveUserPath("~/.skynet");
      const outPath = path.join(skynetDir, "provider-health.json");

      await fs.writeFile(outPath, JSON.stringify(healthData, null, 2));
    } catch (e) {
      console.error("[provider-health] Failed to sync provider health stats:", e);
    }
  }

  private async runDormantCheck(): Promise<void> {
    console.log("[dormant-check] Running...");
    try {
      const vault = await this.getVault();
      const vaultMgr = vault as import("../vault/manager.js").VaultManager;

      // Option C: Governance-Light Mode
      // Only wake dormant executives/managers once per hour to save LLM calls.
      const DORMANT_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
      const now = Date.now();

      // --- Option C: Smart Dormant Check ---
      // Instead of universally waking every dormant agent and consuming LLM calls
      // constantly, scan the global event & task state first.

      // --- NERVOUS SYSTEM SURVIVAL MODE ---
      let isSurvival = false;
      try {
        const { resolveUserPath } = await import("../../utils.js");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const statePath = path.join(resolveUserPath("~/.skynet"), "system-state.json");
        const stateRaw = await fs.readFile(statePath, "utf-8");
        const stateData = JSON.parse(stateRaw);
        if (stateData.state === "SURVIVAL") {
          isSurvival = true;
        }
      } catch {
        // Assume NORMAL if file missing
      }

      // --- Option C: Smart Dormant Check ---
      // Instead of universally waking every dormant agent and consuming LLM calls
      // constantly, scan the global event & task state first.
      const eventFiles = await vaultMgr.list(`events/`);
      const taskFiles = await vaultMgr.list(`tasks/`);
      let hasPendingWork = false;

      for (const ef of eventFiles) {
        if (!ef.endsWith(".json")) {
          continue;
        }
        const ev = await vaultMgr.read(`events/${ef}`);
        if (ev && ev.status === "pending") {
          hasPendingWork = true;
          break;
        }
      }

      if (!hasPendingWork) {
        for (const tf of taskFiles) {
          if (!tf.endsWith(".json")) {
            continue;
          }
          const tsk = await vaultMgr.read(`tasks/${tf}`);
          if (tsk && tsk.status === "pending") {
            hasPendingWork = true;
            break;
          }
        }
      }

      if (!hasPendingWork) {
        console.log(
          "[dormant-check] All events and tasks are cleared. Skipping dormant wakes to save LLM calls.",
        );
        return;
      }

      // Check executives
      const executives = ["main", "oversight", "monitor", "optimizer"];
      for (const exec of executives) {
        const statePath = `agents/${exec}/state.json`;
        const state = await vaultMgr.read(statePath);
        if (!state) {
          continue;
        }

        const lastActivity = state.lastWake || state.updatedAt || 0;
        if (now - lastActivity > DORMANT_TIMEOUT_MS) {
          console.log(`[dormant-check] Waking dormant executive: ${exec}`);
          try {
            const { callGateway } = await import("../../gateway/call.js");
            // The governance tool ensures `messages` context is pulled for them correctly.
            // We ping them on the explicitly labeled governance channel, avoiding the default 'heartbeat' label.
            await callGateway({
              method: "agent",
              params: {
                sessionKey: exec,
                message: `DORMANT-CHECK: You have received an automated watchdog ping from the Nervous System. 1. Run governance(poll-events) to check for pending escalations, decisions, or Nervous System events addressed to you. 2. If escalation events exist: respond using governance(create-decision) with your decision, then governance(propagate-decision) to route it back. 3. If tasks exist in your Vault project: continue working and output DONE:, ERRORS:, or BLOCKER: when appropriate. 4. If nothing is pending: reply HEARTBEAT_OK.`,
                idempotencyKey: `wake-executive-${exec}-${Date.now()}`,
                label: `Executive: ${exec}`,
              },
              timeoutMs: 30000,
            });
            state.lastWake = now;
            await vaultMgr.write(statePath, state);
          } catch (err) {
            console.error(`[dormant-check] Failed to wake executive ${exec}:`, err);
          }
        }
      }

      if (isSurvival) {
        console.warn(
          "[dormant-check] NERVOUS SYSTEM SURVIVAL MODE ENGAGED. Bypassing all manager and worker dormant wakes to conserve critical LLM proxy resources.",
        );
        return;
      }

      // Check managers
      const projectNames = await vaultMgr.listProjects();
      for (const projectName of projectNames) {
        const managerPath = `projects/${projectName}/manager.json`;
        const manager = await vaultMgr.read(managerPath);
        if (!manager || manager.status !== "active") {
          continue;
        }

        const lastActivity = manager.lastActivity || manager.lastCheckIn || 0;
        if (now - lastActivity > DORMANT_TIMEOUT_MS && manager.agentSessionId) {
          console.log(`[dormant-check] Waking dormant manager: ${projectName}`);
          try {
            const { callGateway } = await import("../../gateway/call.js");
            await callGateway({
              method: "agent",
              params: {
                sessionKey: manager.agentSessionId,
                message: `[SYSTEM] WAKE: Protocol timeout. You have been dormant. You MUST invoke a governance tool to continue your WORKLOOP.`,
                idempotencyKey: `wake-manager-${projectName}-${Date.now()}`,
                label: `Manager: ${projectName}`,
              },
              timeoutMs: 30000,
            });
            manager.lastActivity = now;
            manager.lastCheckIn = now;
            await vaultMgr.write(managerPath, manager);
          } catch (err) {
            console.error(`[dormant-check] Failed to wake manager ${projectName}:`, err);
          }
        }

        // Check workers for this project
        const workerFiles = await vaultMgr.list(`projects/${projectName}/workers/`);
        for (const wf of workerFiles) {
          if (!wf.endsWith(".json")) {
            continue;
          }
          const workerPath = `projects/${projectName}/workers/${wf}`;
          const worker = await vaultMgr.read(workerPath);
          if (!worker || worker.status !== "running" || !worker.sessionId) {
            continue;
          }

          const wLastActivity = worker.lastActivity || worker.updatedAt || 0;
          if (now - wLastActivity > DORMANT_TIMEOUT_MS) {
            console.log(`[dormant-check] Waking dormant worker: ${worker.id}`);
            try {
              const { callGateway } = await import("../../gateway/call.js");
              await callGateway({
                method: "agent",
                params: {
                  sessionKey: worker.sessionId,
                  message: `[SYSTEM] WAKE: Protocol timeout. You have been dormant. You MUST invoke governance(complete-task) or another tool to proceed.`,
                  idempotencyKey: `wake-worker-${worker.id}-${Date.now()}`,
                  label: `Worker: ${worker.id}`,
                },
                timeoutMs: 30000,
              });
              worker.lastActivity = now;
              await vaultMgr.write(workerPath, worker);
            } catch (err) {
              console.error(`[dormant-check] Failed to wake worker ${worker.id}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error("[dormant-check] Error:", err);
    }
  }

  private activeTimers: Map<string, NodeJS.Timeout> = new Map();

  start(intervalMs: number): void {
    if (this.tickInterval) {
      return;
    }
    // We set this to true just to act as a flag that it is started
    this.tickInterval = setTimeout(() => {}, 0);

    // Run immediately on startup to start dormant managers
    console.log("[TickHandler] Running initial tick to start managers...");

    const scheduleNext = (name: string, handler: TickHandler, overrideInterval?: number) => {
      const wait = overrideInterval ?? handler.intervalMs ?? intervalMs;
      const timer = setTimeout(async () => {
        if (!handler.enabled) {
          scheduleNext(name, handler);
          return;
        }
        try {
          await handler.run();
        } catch (err) {
          console.error(`[TickHandler] ${name} failed:`, err);
        } finally {
          scheduleNext(name, handler);
        }
      }, wait);
      this.activeTimers.set(name, timer);
    };

    for (const [name, handler] of this.handlers) {
      if (handler.enabled) {
        handler
          .run()
          .catch((err) => console.error(`[TickHandler] Initial ${name} failed:`, err))
          .finally(() => scheduleNext(name, handler));
      } else {
        scheduleNext(name, handler);
      }
    }
  }

  stop(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    if (this.tickInterval) {
      clearTimeout(this.tickInterval);
      this.tickInterval = null;
    }
  }

  register(name: string, handler: TickHandler): void {
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  listHandlers(): TickHandler[] {
    return Array.from(this.handlers.values());
  }
}

let _instance: TickHandlerRegistry | null = null;

export function getTickHandler(_vault?: unknown): TickHandlerRegistry {
  if (!_instance) {
    _instance = new TickHandlerRegistry();
  }
  return _instance;
}

export async function registerEscalationCheckHandler(): Promise<void> {
  console.log("[TickHandler] Escalation check handler registered");
}

export async function syncAllManagersOnStartup(): Promise<void> {
  console.log("[TickHandler] Syncing managers on startup");
}
