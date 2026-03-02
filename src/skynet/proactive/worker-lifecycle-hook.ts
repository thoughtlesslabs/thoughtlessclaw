import { parseAgentSessionKey } from "../../gateway/server-methods/session-utils.js";
import type { PluginRegistryContext, ExecutableHookPlugin } from "../../plugins/types.js";

/**
 * A global hook that listens to the `subagent_ended` lifecycle event.
 * If a subagent ending is a worker and it crashed due to an API error (e.g. Rate Limits),
 * this hook explicitly marks the worker's status as "fault" and automatically
 * resets its assigned task from "in_progress" back to "pending" so the manager
 * can retry assigning it when API capacity returns.
 */
export const workerLifecycleHook: ExecutableHookPlugin<"subagent_ended"> = {
  hookName: "subagent_ended",
  handler: async (event, _ctx: PluginRegistryContext) => {
    // We only care about subagents that failed
    if (event.outcome !== "error") {
      return;
    }

    try {
      const vaultMod = await import("../../skynet/vault/manager.js");
      const vault = vaultMod.createVaultManager("~/.skynet/vault");

      // Check if the agent ID corresponds to a worker
      const parsedKey = parseAgentSessionKey(event.targetSessionKey);
      const agentId = parsedKey?.agentId || "";

      if (!agentId.startsWith("worker-")) {
        return;
      }

      const workerId = agentId;

      // Find the worker by scanning the projects
      const projectName = await findProjectForWorker(vault, workerId);
      if (!projectName) {
        console.log(
          `[worker-lifecycle] Worker ${workerId} ended with error, but couldn't locate its project.`,
        );
        return;
      }

      const workerPath = `projects/${projectName}/workers/${workerId}.json`;
      const workerState = (await vault.read(workerPath)) as Record<string, unknown> | null;

      if (!workerState) {
        return;
      }
      const taskIdRaw = workerState.currentTaskId;
      const taskIdDisplay = typeof taskIdRaw === "string" ? taskIdRaw : String(taskIdRaw);
      console.log(
        `[worker-lifecycle] Healing rate-limited worker ${workerId} for task ${taskIdDisplay}`,
      );

      // 1. Mark the worker as a fault so it doesn't linger
      workerState.status = "fault";
      workerState.violations = Array.isArray(workerState.violations) ? workerState.violations : [];
      const errorMessage = event.error || event.reason || "Unknown API/Lifecycle error";
      (workerState.violations as string[]).push(`Subagent crashed: ${errorMessage}`);
      await vault.write(workerPath, workerState);

      // 2. Heal the associated task, switching it back to pending
      const taskId = workerState.currentTaskId;
      if (taskId && typeof taskId === "string") {
        const taskPath = `tasks/${taskId}.json`;
        const task = (await vault.read(taskPath)) as Record<string, unknown> | null;
        if (task && task.status === "in_progress") {
          task.status = "pending";
          task.updatedAt = Date.now();
          await vault.write(taskPath, task);
          console.log(
            `[worker-lifecycle] Successfully recycled task ${taskId} from in_progress -> pending`,
          );
        }
      }
    } catch (err) {
      console.error("[worker-lifecycle] Error managing crashed worker lifecycle fallback:", err);
    }
  },
};

// Helper to quickly find which project a worker belongs to
async function findProjectForWorker(vault: unknown, workerId: string): Promise<string | null> {
  const v = vault as {
    list: (p: string) => Promise<string[]>;
    read: (p: string) => Promise<unknown>;
  };
  const projects = await v.list("projects/");
  for (const p of projects) {
    // skip files
    if (p.endsWith(".json") || p.endsWith(".md")) {
      continue;
    }

    const workerPath = `projects/${p}/workers/${workerId}.json`;
    try {
      const exists = await vault.read(workerPath);
      if (exists) {
        return p;
      }
    } catch {
      continue;
    }
  }
  return null;
}
