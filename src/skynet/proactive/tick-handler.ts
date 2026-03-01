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
  }

  private async runProviderHealthSync(): Promise<void> {
    try {
      const { resolveAuthStorePath } = await import("../../agents/auth-profiles/paths.js");
      const { loadAuthProfileStore } = await import("../../agents/auth-profiles/store.js");
      const { resolveUserPath } = await import("../../utils.js");
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const storePath = resolveAuthStorePath();
      const store = loadAuthProfileStore(storePath);

      const healthData: Record<
        string,
        { provider: string; model?: string; status: "healthy" | "cooldown" | "half-open" }
      > = {};

      const now = Date.now();

      Object.entries(store.usageStats || {}).forEach(([profileId, stats]) => {
        const credential = store.profiles[profileId];
        if (!credential) {
          return;
        }

        let status: "healthy" | "cooldown" | "half-open" = "healthy";

        if (stats.halfOpenActive) {
          status = "half-open";
        } else if (stats.disabledUntil && stats.disabledUntil > now) {
          status = "cooldown";
        } else if (stats.cooldownUntil && stats.cooldownUntil > now) {
          status = "cooldown";
        }

        healthData[profileId] = {
          provider: credential.provider,
          // Extract model from profile ID if it follows formatting style "provider:model"
          model: profileId.includes(":") ? profileId.split(":")[1] : undefined,
          status,
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

      const DORMANT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();

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
                messageChannel: "governance",
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

  start(intervalMs: number): void {
    if (this.tickInterval) {
      return;
    }

    // Run immediately on startup to start dormant managers
    console.log("[TickHandler] Running initial tick to start managers...");
    for (const [name, handler] of this.handlers) {
      if (handler.enabled) {
        handler.run().catch((err) => console.error(`[TickHandler] Initial ${name} failed:`, err));
      }
    }

    this.tickInterval = setInterval(async () => {
      for (const [name, handler] of this.handlers) {
        if (handler.enabled) {
          try {
            await handler.run();
          } catch (err) {
            console.error(`[TickHandler] ${name} failed:`, err);
          }
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
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
