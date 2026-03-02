import { VaultManager } from "../vault/index.js";
import { resolveStateDir } from "../../config/paths.js";
import path from "node:path";
import { type HeartbeatEntry } from "../vault/types.js";
import { compactEmbeddedPiSessionDirect } from "../../agents/pi-embedded-runner/compact.js";

export async function checkBloodPressure() {
  console.log(`[Skynet] Checking context blood pressure...`);

  const vaultPath = path.join(resolveStateDir(), "vault");
  const vault = new VaultManager(vaultPath);

  try {
    const heartbeatFiles = await vault.list("heartbeats", "\\.json$");

    for (const file of heartbeatFiles) {
      const heartbeat = await vault.read<HeartbeatEntry>(`heartbeats/${file}`);
      if (!heartbeat) continue;

      const currentContextUsage = heartbeat.metrics.contextUsagePercent;

      if (currentContextUsage > 75) {
        console.log(`[Skynet] Agent ${heartbeat.agentId} context at ${currentContextUsage}%. Triggering compaction to avoid hallucinations.`);
        await triggerCompaction(heartbeat.agentId);
      } else {
        console.log(`[Skynet] Agent ${heartbeat.agentId} context at ${currentContextUsage}%. Within safe limits.`);
      }
    }
  } catch (error) {
    console.error("[Skynet] Failed to check context blood pressure:", error);
  }
}

async function triggerCompaction(agentId: string) {
  console.log(`[Skynet] Compacting memory for ${agentId} and saving to long-term storage...`);
  try {
    // Determine the session file for the agent based on its ID
    const { resolveStateDir } = await import("../../config/paths.js");
    const path = await import("node:path");

    // Most autonomous agents store their sessions in the workspace/sessions directory
    // using their agentId as the session key
    const workspaceDir = path.join(resolveStateDir(), "workspace");
    const sessionFile = path.join(workspaceDir, "sessions", `${agentId}.jsonl`);

    const result = await compactEmbeddedPiSessionDirect({
      sessionId: agentId,
      sessionKey: agentId,
      sessionFile,
      workspaceDir,
      trigger: "overflow",
      reasoningLevel: "off" // Use default fast level for compactions
    });

    if (result.ok) {
      console.log(`[Skynet] Compaction successful for ${agentId}. Saved ${result.result?.tokensBefore} -> ${result.result?.tokensAfter} tokens.`);
    } else {
      console.warn(`[Skynet] Compaction failed for ${agentId}:`, result.reason);
    }
  } catch (error) {
    console.error(`[Skynet] Error triggering compaction for ${agentId}:`, error);
  }
}
