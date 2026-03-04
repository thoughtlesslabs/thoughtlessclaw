import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

export async function ensureAgentConfigFromMain(agentId: string): Promise<void> {
  const mainAgentDir = resolveDefaultAgentWorkspaceDir();
  // Normalize agentId: replace colons with hyphens for filesystem paths
  // e.g., "manager:opportunity" → "manager-opportunity"
  const normalizedAgentId = agentId.replace(/:/g, "-");
  const targetAgentDir = path.join(path.dirname(mainAgentDir), normalizedAgentId);

  // Check if main's config exists
  try {
    await fs.access(mainAgentDir);
  } catch {
    console.warn(`[config-provision] Main agent config not found at ${mainAgentDir}, skipping`);
    return;
  }

  // Create target directory if needed
  await fs.mkdir(targetAgentDir, { recursive: true });

  // Copy config files from main
  const configFiles = ["auth.json", "auth-profiles.json", "models.json"];

  for (const file of configFiles) {
    const src = path.join(mainAgentDir, file);
    const dest = path.join(targetAgentDir, file);
    try {
      await fs.copyFile(src, dest);
      console.log(`[config-provision] Copied ${file} for ${agentId}`);
    } catch (err) {
      console.warn(`[config-provision] Failed to copy ${file} for ${agentId}:`, err);
    }
  }
}

export async function ensureWorkerConfigFromMain(workerId: string): Promise<void> {
  await ensureAgentConfigFromMain(workerId);
}
