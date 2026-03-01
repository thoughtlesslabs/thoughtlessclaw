import type { SkynetConfig } from "../../config/config.js";
import { isSubagentSessionKey, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import {
  listSpawnedSessionKeys,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-resolution.js";

export type SessionToolsVisibility = "self" | "tree" | "agent" | "all";

export type AgentToAgentPolicy = {
  enabled: boolean;
  matchesAllow: (agentId: string) => boolean;
  isAllowed: (requesterAgentId: string, targetAgentId: string) => boolean;
};

export type SessionAccessAction = "history" | "send" | "list";

export type SessionAccessResult =
  | { allowed: true }
  | { allowed: false; error: string; status: "forbidden" };

export function resolveSessionToolsVisibility(cfg: SkynetConfig): SessionToolsVisibility {
  const raw = (cfg.tools as { sessions?: { visibility?: unknown } } | undefined)?.sessions
    ?.visibility;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "self" || value === "tree" || value === "agent" || value === "all") {
    return value;
  }
  return "tree";
}

export function resolveEffectiveSessionToolsVisibility(params: {
  cfg: SkynetConfig;
  sandboxed: boolean;
}): SessionToolsVisibility {
  const visibility = resolveSessionToolsVisibility(params.cfg);
  if (!params.sandboxed) {
    return visibility;
  }
  const sandboxClamp = params.cfg.agents?.defaults?.sandbox?.sessionToolsVisibility ?? "spawned";
  if (sandboxClamp === "spawned" && visibility !== "tree") {
    return "tree";
  }
  return visibility;
}

export function resolveSandboxSessionToolsVisibility(cfg: SkynetConfig): "spawned" | "all" {
  return cfg.agents?.defaults?.sandbox?.sessionToolsVisibility ?? "spawned";
}

export function resolveSandboxedSessionToolContext(params: {
  cfg: SkynetConfig;
  agentSessionKey?: string;
  sandboxed?: boolean;
}): {
  mainKey: string;
  alias: string;
  visibility: "spawned" | "all";
  requesterInternalKey: string | undefined;
  effectiveRequesterKey: string;
  restrictToSpawned: boolean;
} {
  const { mainKey, alias } = resolveMainSessionAlias(params.cfg);
  const visibility = resolveSandboxSessionToolsVisibility(params.cfg);
  const requesterInternalKey =
    typeof params.agentSessionKey === "string" && params.agentSessionKey.trim()
      ? resolveInternalSessionKey({
          key: params.agentSessionKey,
          alias,
          mainKey,
        })
      : undefined;
  const effectiveRequesterKey = requesterInternalKey ?? alias;
  const restrictToSpawned =
    params.sandboxed === true &&
    visibility === "spawned" &&
    !!requesterInternalKey &&
    !isSubagentSessionKey(requesterInternalKey);
  return {
    mainKey,
    alias,
    visibility,
    requesterInternalKey,
    effectiveRequesterKey,
    restrictToSpawned,
  };
}

export function createAgentToAgentPolicy(_cfg: SkynetConfig): AgentToAgentPolicy {
  return {
    enabled: false,
    matchesAllow: () => false,
    isAllowed: (requesterAgentId: string, targetAgentId: string) =>
      requesterAgentId === targetAgentId,
  };
}

function actionPrefix(action: SessionAccessAction): string {
  if (action === "history") {
    return "Session history";
  }
  if (action === "send") {
    return "Session send";
  }
  return "Session list";
}

function a2aDisabledMessage(action: SessionAccessAction): string {
  return `Agent-to-agent ${action} is disabled system-wide. Route requests through the Nervous System/Vault using governance tools.`;
}

function a2aDeniedMessage(action: SessionAccessAction): string {
  return a2aDisabledMessage(action);
}

function crossVisibilityMessage(action: SessionAccessAction): string {
  if (action === "history") {
    return "Session history visibility is restricted. Set tools.sessions.visibility=all to allow cross-agent access.";
  }
  if (action === "send") {
    return "Session send visibility is restricted. Set tools.sessions.visibility=all to allow cross-agent access.";
  }
  return "Session list visibility is restricted. Set tools.sessions.visibility=all to allow cross-agent access.";
}

function selfVisibilityMessage(action: SessionAccessAction): string {
  return `${actionPrefix(action)} visibility is restricted to the current session (tools.sessions.visibility=self).`;
}

function treeVisibilityMessage(action: SessionAccessAction): string {
  return `${actionPrefix(action)} visibility is restricted to the current session tree (tools.sessions.visibility=tree).`;
}

export async function createSessionVisibilityGuard(params: {
  action: SessionAccessAction;
  requesterSessionKey: string;
  visibility: SessionToolsVisibility;
  a2aPolicy: AgentToAgentPolicy;
}): Promise<{
  check: (targetSessionKey: string) => SessionAccessResult;
}> {
  const requesterAgentId = resolveAgentIdFromSessionKey(params.requesterSessionKey);
  const spawnedKeys =
    params.visibility === "tree"
      ? await listSpawnedSessionKeys({ requesterSessionKey: params.requesterSessionKey })
      : null;

  const check = (targetSessionKey: string): SessionAccessResult => {
    const targetAgentId = resolveAgentIdFromSessionKey(targetSessionKey);
    const isCrossAgent = targetAgentId !== requesterAgentId;
    if (isCrossAgent) {
      if (params.visibility !== "all") {
        return {
          allowed: false,
          status: "forbidden",
          error: crossVisibilityMessage(params.action),
        };
      }
      if (!params.a2aPolicy.enabled) {
        return {
          allowed: false,
          status: "forbidden",
          error: a2aDisabledMessage(params.action),
        };
      }
      if (!params.a2aPolicy.isAllowed(requesterAgentId, targetAgentId)) {
        return {
          allowed: false,
          status: "forbidden",
          error: a2aDeniedMessage(params.action),
        };
      }
      return { allowed: true };
    }

    if (params.visibility === "self" && targetSessionKey !== params.requesterSessionKey) {
      return {
        allowed: false,
        status: "forbidden",
        error: selfVisibilityMessage(params.action),
      };
    }

    if (
      params.visibility === "tree" &&
      targetSessionKey !== params.requesterSessionKey &&
      !spawnedKeys?.has(targetSessionKey)
    ) {
      return {
        allowed: false,
        status: "forbidden",
        error: treeVisibilityMessage(params.action),
      };
    }

    return { allowed: true };
  };

  return { check };
}
