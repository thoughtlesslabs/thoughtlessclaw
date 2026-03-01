import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createSkynet } from "../skynet/index.js";

type AgentsListOptions = {
  vault?: string;
  json?: boolean;
};

/**
 * `skynet agents list` — Lists all executives and project managers from the Vault.
 *
 * Replaces the legacy config-based agent listing. Now reads directly from
 * the Vault hierarchy to show:
 *   - Executive agents (main, oversight, monitor, optimizer)
 *   - Project managers with task counts and statuses
 */
export async function agentsListCommand(
  opts: AgentsListOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const vaultPath = opts.vault?.trim() || "~/.skynet/vault";

  const skynetSys = createSkynet({ vaultPath });
  await skynetSys.initialize();

  const vault = skynetSys.getVault();

  // Gather executives
  const executives = skynetSys.getAllExecutives();
  const executiveData: Array<{
    role: string;
    status: string;
    tier: number;
  }> = [];

  for (const exec of executives) {
    const state = await exec.getState();
    executiveData.push({
      role: exec.getRole(),
      status: state?.status || "unknown",
      tier: state?.tier ?? 1,
    });
  }

  // Gather projects
  const projectNames = await vault.listProjects();
  const projectData: Array<{
    name: string;
    type: string;
    status: string;
    managerId: string | null;
    completedTasks: number;
    totalTasks: number;
  }> = [];

  for (const name of projectNames) {
    const project = await vault.getProject(name);
    const manager = await vault.getProjectManager(name);
    projectData.push({
      name,
      type: project?.projectType || "unknown",
      status: project?.status || "unknown",
      managerId: manager?.id || null,
      completedTasks: manager?.completedTasks ?? 0,
      totalTasks: manager?.totalTasks ?? 0,
    });
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ executives: executiveData, projects: projectData }, null, 2));
    return;
  }

  // Human-readable output
  runtime.log("\n=== Skynet Agents ===\n");

  runtime.log("Executives (Tier 1):");
  for (const exec of executiveData) {
    const icon = exec.status === "sleeping" ? "💤" : exec.status === "active" ? "🟢" : "⚪";
    runtime.log(`  ${icon} ${exec.role} — ${exec.status}`);
  }

  runtime.log("\nProjects:");
  if (projectData.length === 0) {
    runtime.log("  (none)");
  } else {
    for (const proj of projectData) {
      const taskInfo =
        proj.totalTasks > 0 ? ` (${proj.completedTasks}/${proj.totalTasks} tasks)` : "";
      const typeTag = proj.type === "system" ? " [system]" : "";
      const managerTag = proj.managerId ? ` mgr:${proj.managerId.slice(0, 8)}` : " (no manager)";
      runtime.log(`  - ${proj.name}${typeTag}: ${proj.status}${taskInfo}${managerTag}`);
    }
  }

  runtime.log("");
}
