import { resolveUserPath } from "../utils.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

export function resolveSkynetAgentDir(): string {
  const override = process.env.SKYNET_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  // Unify the global default agent directory with the Vault workspace architecture
  return resolveDefaultAgentWorkspaceDir();
}

export function ensureSkynetAgentEnv(): string {
  const dir = resolveSkynetAgentDir();
  if (!process.env.SKYNET_AGENT_DIR) {
    process.env.SKYNET_AGENT_DIR = dir;
  }
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = dir;
  }
  return dir;
}
