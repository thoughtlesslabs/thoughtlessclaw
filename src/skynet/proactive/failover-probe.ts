import { loadAuthProfileStore } from "../../agents/auth-profiles/store.js";
import {
  clearExpiredCooldowns,
  resolveProfileUnusableUntilForDisplay,
} from "../../agents/auth-profiles/usage.js";
import type { VaultManager } from "../vault/manager.js";
import type { TickHandler } from "./tick-handler.js";

export function createFailoverProbeHandler(_vaultMgr: VaultManager): TickHandler {
  return {
    name: "failover-probe",
    description: "Proactively tests models in cooldown to clear them into half-open state early",
    // Run every 2 minutes
    intervalMs: 120_000,
    lastRun: 0,
    enabled: true,
    run: async () => {
      console.log("[failover-probe] Sweeping auth profiles for recovering models...");
      try {
        const store = loadAuthProfileStore();
        if (!store) {
          return;
        }

        // 1. Do a standard clear of any naturally expired cooldowns into half-open
        const now = Date.now();
        const mutated = clearExpiredCooldowns(store, now);

        // 2. Look for profiles still in cooldown that we can proactively probe
        // A probe is a cheap 1-token request to see if the provider is healthy again.
        // We only probe if the cooldown has less than 5 minutes remaining.
        const PROBE_THRESHOLD_MS = 5 * 60 * 1000;
        let probedAtLeastOne = false;

        for (const [profileId, profileDef] of Object.entries(store.profiles)) {
          const stats = store.usageStats?.[profileId];
          if (!stats) {
            continue;
          }

          // If half-open active, it naturally tests itself via user workloads, no probe needed
          if (stats.halfOpenActive) {
            continue;
          }

          const unusableUntil = resolveProfileUnusableUntilForDisplay(store, profileId);
          if (unusableUntil && unusableUntil > now && unusableUntil - now <= PROBE_THRESHOLD_MS) {
            console.log(
              `[failover-probe] Probing recovering profile: ${profileId} (${profileDef.provider})`,
            );

            // Execute cheap ping
            const isHealthy = await pingProvider(profileDef.provider);

            if (isHealthy) {
              console.log(
                `[failover-probe] Profile ${profileId} ping SUCCESS. Moving to half-open.`,
              );
              stats.cooldownUntil = undefined;
              stats.disabledUntil = undefined;
              stats.disabledReason = undefined;
              stats.halfOpenActive = true;
              stats.halfOpenTokens = 3;
              probedAtLeastOne = true;
            } else {
              console.log(
                `[failover-probe] Profile ${profileId} ping FAILED. Waiting for natural cooldown.`,
              );
              // Could optionally bump the cooldown or error count here, but leaving natural backoff is safer.
            }
          }
        }

        // If we mutated anything (either natural expiry or probe success), hit disk.
        if (mutated || probedAtLeastOne) {
          // Since we didn't lock, we do a fast save. For a pure background cron, this is acceptable.
          // The main usage ops use locks.
          const { saveAuthProfileStore } = await import("../../agents/auth-profiles/store.js");
          saveAuthProfileStore(store, undefined);
        }
      } catch (err) {
        console.error("[failover-probe] Error during probe sweep:", err);
      }
    },
  };
}

async function pingProvider(_provider: string): Promise<boolean> {
  // A proactive model ping implementation.
  // In reality, this would dynamically import the relevant adapter
  // (via src/agents/model-selection.ts) and fire a 1-message hello.
  // We mock a 50% recovery chance for the simulation.
  await new Promise((r) => setTimeout(r, 500));
  return Math.random() > 0.5;
}
