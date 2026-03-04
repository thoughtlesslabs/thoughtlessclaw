import type { VaultManager } from "../vault/manager.js";
import type { VaultEntry } from "../vault/types.js";
import type { TickHandler } from "./tick-handler.js";

interface ManagerTickState extends VaultEntry {
  status: string;
  agentSessionId?: string;
  lastActivity?: number;
  lastCheckIn?: number;
}

interface WorkerTickState extends VaultEntry {
  status: string;
}

interface TaskTickState extends VaultEntry {
  status: string;
  assignee?: string;
}

// Global round-robin tracker to stagger LLM calls globally
let lastWokenManagerIndex = 0;

export function createManagerTickHandler(vault: VaultManager): TickHandler {
  return {
    name: "manager-loop",
    description:
      "Scan the Vault for pending project tasks and evaluate autonomous managers natively to prevent thundering-herd API exhaustion",
    intervalMs: 60000,
    lastRun: 0,
    enabled: true,
    run: async () => {
      // Allow the actual tick loop logic to run safely and consistently
      await executeManagerTick(vault);
    },
  };
}

async function executeManagerTick(vault: VaultManager): Promise<void> {
  const MAX_ACTIVE_WORKERS_PER_PROJECT = 2; // Safety cap to avoid runaway spawns
  const PROJECT_DORMANT_TIMEOUT_MS = 60000 * 5; // 5 minutes without activity triggers a wake

  try {
    const projects = await vault.listProjects();
    const activeManagersToWake: { projectName: string; agentSessionId: string }[] = [];
    const now = Date.now();

    // 1. SCAN THE GLOBE for actionable managers
    for (const projectName of projects) {
      const managerPath = `projects/${projectName}/manager.json`;
      const manager = await vault.read<ManagerTickState>(managerPath);

      // Does the manager exist and is it functionally active?
      if (!manager || manager.status !== "active" || !manager.agentSessionId) {
        continue;
      }

      // 2. CHECK PROJECT CONCURRENCY
      let runningWorkerCount = 0;
      const workerFiles = await vault.list(`projects/${projectName}/workers/`);
      for (const wf of workerFiles) {
        if (wf.endsWith(".json")) {
          const worker = await vault.read<WorkerTickState>(`projects/${projectName}/workers/${wf}`);
          if (worker && worker.status === "running") {
            runningWorkerCount++;
          }
        }
      }

      if (runningWorkerCount >= MAX_ACTIVE_WORKERS_PER_PROJECT) {
        // Already at the limit, do not bombard the LLM to spawn more workers
        continue;
      }

      // 3. CHECK PENDING QUEUES
      // Are there orphan tasks in the global queue? Unlikely, but fallback check
      const globalTasks = await vault.list("tasks/");
      let hasPendingTasks = false;

      for (const tf of globalTasks) {
        if (tf.endsWith(".json")) {
          const t = await vault.read<TaskTickState>(`tasks/${tf}`);
          if (t && t.status === "pending" && (t.assignee === manager.id || !t.assignee)) {
            hasPendingTasks = true;
            break;
          }
        }
      }

      const timeSinceLastActivity =
        now - Math.max(manager.lastActivity || 0, manager.lastCheckIn || 0);

      if (hasPendingTasks && timeSinceLastActivity > PROJECT_DORMANT_TIMEOUT_MS) {
        activeManagersToWake.push({
          projectName,
          agentSessionId: manager.agentSessionId,
        });
      }
    }

    if (activeManagersToWake.length === 0) {
      return; // Global system is healthy and fully caught up
    }

    // --- RATE LIMIT THUNDERING HERD PROTECTION ---
    // Only wake ONE manager per tick interval universally

    // Cycle the round-robin index safely
    if (lastWokenManagerIndex >= activeManagersToWake.length) {
      lastWokenManagerIndex = 0;
    }

    const selectedManager = activeManagersToWake[lastWokenManagerIndex];
    lastWokenManagerIndex++; // Increment for the subsequent tick

    console.log(
      `[manager-loop] Detected pending task(s) for ${activeManagersToWake.length} managers. Stagger-waking manager: ${selectedManager.projectName} to respect rate limits.`,
    );

    try {
      const { callGateway } = await import("../../gateway/call.js");

      await callGateway({
        method: "agent",
        params: {
          sessionKey: selectedManager.agentSessionId,
          message: `[SYSTEM] MANAGER_LOOP: You have pending tasks in your Project Vault! 1. Evaluate 'vault.list('tasks/')' 2. Spawn workers using 'governance(spawn-worker)' to execute the tasks. 3. Monitor 'governance(worker-status)'. Output DONE: or BLOCKER: as required.`,
          idempotencyKey: `manager-loop-${selectedManager.projectName}-${now}`,
          label: `Manager: ${selectedManager.projectName}`,
        },
        timeoutMs: 30000,
      });

      // Mutate the vault file directly via write to timestamp the wakeup
      const managerObject = await vault.read<ManagerTickState>(
        `projects/${selectedManager.projectName}/manager.json`,
      );
      if (managerObject) {
        managerObject.lastActivity = now;
        managerObject.lastCheckIn = now;
        await vault.write(`projects/${selectedManager.projectName}/manager.json`, managerObject);
      }
    } catch (err) {
      console.error(`[manager-loop] Failed to wake manager ${selectedManager.projectName}:`, err);
    }
  } catch (err) {
    console.error("[manager-loop] Fatal execution error:", err);
  }
}
