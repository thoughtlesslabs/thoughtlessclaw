import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { SkynetConfig } from "../../config/config.js";
import { withFileLock } from "../../infra/file-lock.js";
import type { FileLockOptions } from "../../infra/file-lock.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";

const LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 10,
    factor: 1.5,
    minTimeout: 100,
    maxTimeout: 1000,
    randomize: true,
  },
  stale: 5000,
};

const MemoryUpsertSchema = Type.Object({
  namespace: Type.String(),
  key: Type.String(),
  value: Type.String(),
});

const MemoryGetEntitySchema = Type.Object({
  entity: Type.String(),
});

function resolveMemoryToolContext(options: { config?: SkynetConfig; agentSessionKey?: string }) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

async function readJsonSafely(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeJsonSafely(filePath: string, data: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function createMemoryUpsertTool(options: {
  config?: SkynetConfig;
  agentSessionKey?: string;
  workspaceDir?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  return {
    label: "Memory Upsert",
    name: "memory_upsert",
    description: "Upsert a fact into the JSON key-value memory store.",
    parameters: MemoryUpsertSchema,
    execute: async (_toolCallId, params) => {
      const namespace = readStringParam(params, "namespace", { required: true });
      const key = readStringParam(params, "key", { required: true });
      const value = readStringParam(params, "value", { required: true });

      const vaultDir = options.workspaceDir || process.cwd();
      const factsPath = path.join(vaultDir, "memory", "facts.json");

      try {
        await withFileLock(factsPath, LOCK_OPTIONS, async () => {
          const data = await readJsonSafely(factsPath);
          const fullKey = `${namespace}.${key}`;
          data[fullKey] = value;
          await writeJsonSafely(factsPath, data);
        });
        return jsonResult({ success: true, namespace, key, val: value });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ success: false, error: message });
      }
    },
  };
}

export function createMemoryGetEntityTool(options: {
  config?: SkynetConfig;
  agentSessionKey?: string;
  workspaceDir?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  return {
    label: "Memory Get Entity",
    name: "memory_get_entity",
    description: "Read a structured JSON entity file from the memory store.",
    parameters: MemoryGetEntitySchema,
    execute: async (_toolCallId, params) => {
      const entity = readStringParam(params, "entity", { required: true });
      // sanitize entity name to prevent directory traversal
      const safeEntity = entity.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
      if (!safeEntity) {
        throw new ToolInputError("Invalid entity name.");
      }

      const vaultDir = options.workspaceDir || process.cwd();
      const entityPath = path.join(vaultDir, "memory", "entities", `${safeEntity}.json`);

      try {
        const data = await readJsonSafely(entityPath);
        return jsonResult({ entity: safeEntity, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ entity: safeEntity, error: message });
      }
    },
  };
}
