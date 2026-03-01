import os from "node:os";
import { resolve } from "node:path";

export async function addAgentToConfig(agentId: string, workspacePath: string): Promise<void> {
  let snapshot: { config?: Record<string, unknown> } = {};
  try {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    snapshot = (await readConfigFileSnapshot()) as { config?: Record<string, unknown> };
  } catch {
    snapshot = { config: {} };
  }

  const config = snapshot.config || {};
  const cfg = config as { agents?: { list?: Array<{ id?: string }> } };
  const agents = cfg.agents?.list || [];

  if (agents.some((a) => a?.id === agentId)) {
    return;
  }

  const resolvedPath = workspacePath.startsWith("~")
    ? resolve(os.homedir(), workspacePath.slice(1))
    : workspacePath;

  const newAgent = {
    id: agentId,
    workspace: resolvedPath,
  };

  const next = {
    ...config,
    agents: {
      ...(cfg.agents || { list: [] }),
      list: [...agents, newAgent],
    },
  };

  const { writeConfigFile } = await import("../config/config.js");
  await writeConfigFile(next as never);
}

export async function ensureAgentInConfig(agentId: string, workspacePath: string): Promise<void> {
  let snapshot: { config?: Record<string, unknown> } = {};
  try {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    snapshot = (await readConfigFileSnapshot()) as { config?: Record<string, unknown> };
  } catch {
    snapshot = { config: {} };
  }

  const config = snapshot.config || {};
  const cfg = config as { agents?: { list?: Array<{ id?: string; workspace?: string }> } };
  const agents = cfg.agents?.list || [];
  const existing = agents.find((a) => a?.id === agentId);

  if (existing) {
    const resolvedPath = workspacePath.startsWith("~")
      ? resolve(os.homedir(), workspacePath.slice(1))
      : workspacePath;

    if (existing.workspace !== resolvedPath) {
      existing.workspace = resolvedPath;
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile(config as never);
    }
    return;
  }

  await addAgentToConfig(agentId, workspacePath);
}

export async function ensureManagerInMainAllowAgents(managerId: string): Promise<void> {
  let snapshot: { config?: Record<string, unknown> } = {};
  try {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    snapshot = (await readConfigFileSnapshot()) as { config?: Record<string, unknown> };
  } catch {
    snapshot = { config: {} };
  }

  const config = snapshot.config || {};
  const cfg = config as {
    agents?: {
      list?: Array<{
        id?: string;
        subagents?: { allowAgents?: string[] };
      }>;
    };
  };

  const agents = cfg.agents?.list || [];
  const mainAgent = agents.find((a) => a?.id === "main");

  if (!mainAgent) {
    return;
  }

  const allowAgents = mainAgent.subagents?.allowAgents || [];

  // Check if manager is already in allowAgents
  if (allowAgents.includes(managerId)) {
    return;
  }

  // Add manager to allowAgents
  const updatedAllowAgents = [...allowAgents, managerId];

  mainAgent.subagents = {
    ...mainAgent.subagents,
    allowAgents: updatedAllowAgents,
  };

  const { writeConfigFile } = await import("../config/config.js");
  await writeConfigFile(config as never);
}

export async function ensureWorkerInMainAllowAgents(workerId: string): Promise<void> {
  let snapshot: { config?: Record<string, unknown> } = {};
  try {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    snapshot = (await readConfigFileSnapshot()) as { config?: Record<string, unknown> };
  } catch {
    snapshot = { config: {} };
  }

  const config = snapshot.config || {};
  const cfg = config as {
    agents?: {
      list?: Array<{
        id?: string;
        subagents?: { allowAgents?: string[] };
      }>;
    };
  };

  const agents = cfg.agents?.list || [];
  const mainAgent = agents.find((a) => a?.id === "main");

  if (!mainAgent) {
    return;
  }

  const allowAgents = mainAgent.subagents?.allowAgents || [];

  if (allowAgents.includes(workerId)) {
    return;
  }

  const updatedAllowAgents = [...allowAgents, workerId];

  mainAgent.subagents = {
    ...mainAgent.subagents,
    allowAgents: updatedAllowAgents,
  };

  const { writeConfigFile } = await import("../config/config.js");
  await writeConfigFile(config as never);
}
