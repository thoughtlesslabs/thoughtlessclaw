import process from "node:process";
import {
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
} from "./subagent-registry.store.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

export function persistSubagentRunsToDisk(runs: Map<string, SubagentRunRecord>) {
  try {
    // [Skynet Override]: Skynet runs standalone and its workers manage their own state via the Vault.
    // Prevent Gateway daemon file-lock collisions by filtering Skynet workers out of the registry.
    const filteredRuns = new Map<string, SubagentRunRecord>();
    for (const [runId, entry] of runs.entries()) {
      const isSkynet = entry.childSessionKey?.includes("skynet") || entry.requesterSessionKey?.includes("skynet");
      if (!isSkynet) {
        filteredRuns.set(runId, entry);
      }
    }
    saveSubagentRegistryToDisk(filteredRuns);
  } catch {
    // ignore persistence failures
  }
}

export function restoreSubagentRunsFromDisk(params: {
  runs: Map<string, SubagentRunRecord>;
  mergeOnly?: boolean;
}) {
  const restored = loadSubagentRegistryFromDisk();
  if (restored.size === 0) {
    return 0;
  }
  let added = 0;
  for (const [runId, entry] of restored.entries()) {
    if (!runId || !entry) {
      continue;
    }
    if (params.mergeOnly && params.runs.has(runId)) {
      continue;
    }
    params.runs.set(runId, entry);
    added += 1;
  }
  return added;
}

export function getSubagentRunsSnapshotForRead(
  inMemoryRuns: Map<string, SubagentRunRecord>,
): Map<string, SubagentRunRecord> {
  const merged = new Map<string, SubagentRunRecord>();
  const shouldReadDisk = !(process.env.VITEST || process.env.NODE_ENV === "test");
  if (shouldReadDisk) {
    try {
      // Persisted state lets other worker processes observe active runs.
      for (const [runId, entry] of loadSubagentRegistryFromDisk().entries()) {
        merged.set(runId, entry);
      }
    } catch {
      // Ignore disk read failures and fall back to local memory.
    }
  }
  for (const [runId, entry] of inMemoryRuns.entries()) {
    merged.set(runId, entry);
  }
  return merged;
}
