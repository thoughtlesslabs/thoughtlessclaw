import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createSkynet } from "../skynet/index.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";

type AgentsDeleteOptions = {
  id: string;
  vault?: string;
  force?: boolean;
  json?: boolean;
};

/**
 * `skynet agents delete <id>` — Removes a project and its manager from the Vault.
 *
 * Replaces the legacy config-based agent deletion. Instead of pruning
 * skynet.json entries, this deletes the project directory from the Vault:
 *
 *   ~/.skynet/vault/projects/<name>/  (removed entirely)
 */
export async function agentsDeleteCommand(
  opts: AgentsDeleteOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const vaultPath = opts.vault?.trim() || "~/.skynet/vault";
  const input = opts.id?.trim();

  if (!input) {
    runtime.error("Project name is required. Usage: skynet agents delete <name>");
    runtime.exit(1);
    return;
  }

  const projectName = input.toLowerCase();

  if (projectName === "system") {
    runtime.error('The "system" project cannot be deleted.');
    runtime.exit(1);
    return;
  }

  const skynetSys = createSkynet({ vaultPath });
  await skynetSys.initialize();

  const vault = skynetSys.getVault();
  const existing = await vault.getProject(projectName);

  if (!existing) {
    runtime.error(`Project "${projectName}" not found.`);
    runtime.exit(1);
    return;
  }

  if (!opts.force) {
    if (!process.stdin.isTTY) {
      runtime.error("Non-interactive session. Re-run with --force.");
      runtime.exit(1);
      return;
    }
    const prompter = createClackPrompter();
    const confirmed = await prompter.confirm({
      message: `Delete project "${projectName}" and its manager? This cannot be undone.`,
      initialValue: false,
    });
    if (!confirmed) {
      runtime.log("Cancelled.");
      return;
    }
  }

  // Remove the entire project directory from the vault
  const projectDir = path.join(
    vaultPath.replace("~", process.env.HOME || ""),
    "projects",
    projectName,
  );

  try {
    await fs.rm(projectDir, { recursive: true, force: true });
  } catch (err) {
    runtime.error(`Failed to remove project directory: ${(err as Error).message}`);
    runtime.exit(1);
    return;
  }

  const payload = {
    projectName,
    projectDir,
    deleted: true,
  };

  if (opts.json) {
    runtime.log(JSON.stringify(payload, null, 2));
  } else {
    runtime.log(`✅ Deleted project: ${projectName}`);
    runtime.log(`   Removed: ${projectDir}`);
  }
}
