import fs from "node:fs/promises";
import path from "node:path";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { resolveUserPath } from "../../utils.js";
import type { TickHandler } from "./tick-handler.js";

export type SystemHealthState = "NORMAL" | "CONSERVE" | "SURVIVAL";

export function createSurvivalMonitorHandler(): TickHandler {
  return {
    name: "survival-monitor",
    description: "Monitors core LLM proxy health to engage Nervous System Survival Mode",
    intervalMs: 30000,
    lastRun: 0,
    enabled: true,
    run: async () => {
      try {
        const skynetDir = resolveUserPath("~/.skynet");
        const healthPath = path.join(skynetDir, "provider-health.json");
        const statePath = path.join(skynetDir, "system-state.json");

        let previousState: SystemHealthState = "NORMAL";
        try {
          const prevStateRaw = await fs.readFile(statePath, "utf-8");
          const parsed = JSON.parse(prevStateRaw);
          if (parsed.state) {
            previousState = parsed.state as SystemHealthState;
          }
        } catch {
          // Defaults to NORMAL
        }

        let hasHealthFile = false;
        try {
          await fs.stat(healthPath);
          hasHealthFile = true;
        } catch {
          hasHealthFile = false;
        }

        if (!hasHealthFile) {
          // If no health file yet, we can't reliably engage survival, assume NORMAL
          if (previousState !== "NORMAL") {
            await setSystemState(statePath, "NORMAL", previousState);
          }
          return;
        }

        const rawHealth = await fs.readFile(healthPath, "utf-8");
        const healthData = JSON.parse(rawHealth) as Record<string, { status: string }>;

        const activeProviders = Object.keys(healthData).length;
        if (activeProviders === 0) {
          // No API keys configured yet, assume NORMAL to let config tools work
          if (previousState !== "NORMAL") {
            await setSystemState(statePath, "NORMAL", previousState);
          }
          return;
        }

        const healthyCount = Object.values(healthData).filter(
          (p) => p.status === "healthy" || p.status === "half-open",
        ).length;

        let newState: SystemHealthState = "NORMAL";
        if (healthyCount === 0) {
          // Critical outage. No functioning API channels.
          newState = "SURVIVAL";
        } else if (healthyCount <= Math.max(1, activeProviders * 0.25)) {
          // 25% or fewer APIs remaining. Conserve mode.
          newState = "CONSERVE";
        } else {
          newState = "NORMAL";
        }

        if (newState !== previousState) {
          await setSystemState(statePath, newState, previousState);

          if (newState === "SURVIVAL") {
            console.warn(
              "[survival-monitor] CRITICAL: System entering SURVIVAL MODE. Suppressing lower autonomous functions.",
            );
            enqueueSystemEvent(
              `[NERVOUS_SYSTEM] CRITICAL RESOURCE LIMIT REACHED. The system has entered SURVIVAL MODE. All available LLM proxy routes are currently rate-limited, cooling down, or expired. Autonomous Manager and Worker spawning has been forcefully halted. The Core loop (Miles & Executives) remains active but will conserve API calls until limits recover.`,
              { sessionKey: "global", contextKey: "SURVIVAL-MODE-ENGAGED" },
            );
          } else if (newState === "NORMAL" && previousState === "SURVIVAL") {
            console.log("[survival-monitor] RECOVERY: System returning to NORMAL from SURVIVAL.");
            enqueueSystemEvent(
              `[NERVOUS_SYSTEM] Resource capacities have recovered. SURVIVAL MODE deactivated. System returning to NORMAL operations. Managers will begin reclaiming pending tasks.`,
              { sessionKey: "global", contextKey: "SURVIVAL-MODE-RECOVERY" },
            );
            try {
              console.log("[survival-monitor] Waking Executive Triad to resume operations...");
              const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");
              requestHeartbeatNow({ reason: "survival-recovery", agentId: "main" });
              requestHeartbeatNow({ reason: "survival-recovery", agentId: "monitor" });
            } catch (err) {
              console.error(
                "[survival-monitor] Failed to broadcast recovery wake to Executives:",
                err,
              );
            }
          }
        }
      } catch (err) {
        console.error("[survival-monitor] Failed to check system survival state:", err);
      }
    },
  };
}

async function setSystemState(
  statePath: string,
  state: SystemHealthState,
  previousState: SystemHealthState,
) {
  const payload = {
    state,
    previousState,
    transitionedAt: Date.now(),
  };
  await fs.writeFile(statePath, JSON.stringify(payload, null, 2));
}
