import fs from "node:fs";
import path from "node:path";
import type { SkynetConfig } from "../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../config/model-input.js";
import { withFileLock } from "../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import { resolveUserPath } from "../utils.js";
import {
  ensureAuthProfileStore,
  getSoonestCooldownExpiry,
  tryCheckoutProfile,
  resolveProfilesUnavailableReason,
  resolveAuthProfileOrder,
} from "./auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import {
  coerceToFailoverError,
  describeFailoverError,
  isFailoverError,
  isTimeoutError,
} from "./failover-error.js";
import {
  buildConfiguredAllowlistKeys,
  buildModelAliasIndex,
  modelKey,
  normalizeModelRef,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "./model-selection.js";
import type { FailoverReason } from "./pi-embedded-helpers.js";
import { isLikelyContextOverflowError } from "./pi-embedded-helpers.js";

type ModelCandidate = {
  provider: string;
  model: string;
};

type FallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
};

/**
 * Fallback abort check. Only treats explicit AbortError names as user aborts.
 * Message-based checks (e.g., "aborted") can mask timeouts and skip fallback.
 */
function isFallbackAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  if (isFailoverError(err)) {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError";
}

function shouldRethrowAbort(err: unknown): boolean {
  return isFallbackAbortError(err) && !isTimeoutError(err);
}

function createModelCandidateCollector(allowlist: Set<string> | null | undefined): {
  candidates: ModelCandidate[];
  addCandidate: (candidate: ModelCandidate, enforceAllowlist: boolean) => void;
} {
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) {
      return;
    }
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) {
      return;
    }
    if (enforceAllowlist && allowlist && !allowlist.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  return { candidates, addCandidate };
}

type ModelFallbackErrorHandler = (attempt: {
  provider: string;
  model: string;
  error: unknown;
  attempt: number;
  total: number;
}) => void | Promise<void>;

type ModelFallbackRunResult<T> = {
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
};

function sameModelCandidate(a: ModelCandidate, b: ModelCandidate): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function throwFallbackFailureSummary(params: {
  attempts: FallbackAttempt[];
  candidates: ModelCandidate[];
  lastError: unknown;
  label: string;
  formatAttempt: (attempt: FallbackAttempt) => string;
}): never {
  if (params.attempts.length <= 1 && params.lastError) {
    throw params.lastError;
  }
  const summary =
    params.attempts.length > 0 ? params.attempts.map(params.formatAttempt).join(" | ") : "unknown";
  throw new Error(
    `All ${params.label} failed (${params.attempts.length || params.candidates.length}): ${summary}`,
    {
      cause: params.lastError instanceof Error ? params.lastError : undefined,
    },
  );
}

function resolveImageFallbackCandidates(params: {
  cfg: SkynetConfig | undefined;
  defaultProvider: string;
  modelOverride?: string;
}): ModelCandidate[] {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider: params.defaultProvider,
  });
  const allowlist = buildConfiguredAllowlistKeys({
    cfg: params.cfg,
    defaultProvider: params.defaultProvider,
  });
  const { candidates, addCandidate } = createModelCandidateCollector(allowlist);

  const addRaw = (raw: string, enforceAllowlist: boolean) => {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider: params.defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      return;
    }
    addCandidate(resolved.ref, enforceAllowlist);
  };

  if (params.modelOverride?.trim()) {
    addRaw(params.modelOverride, false);
  } else {
    const primary = resolveAgentModelPrimaryValue(params.cfg?.agents?.defaults?.imageModel);
    if (primary?.trim()) {
      addRaw(primary, false);
    }
  }

  const imageFallbacks = resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.imageModel);

  for (const raw of imageFallbacks) {
    addRaw(raw, true);
  }

  return candidates;
}

export const _learnedFallbackPrefs: Record<string, { provider: string; model: string }> = {};

function resolveFallbackCandidates(params: {
  cfg: SkynetConfig | undefined;
  provider: string;
  model: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
}): ModelCandidate[] {
  const primary = params.cfg
    ? resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      })
    : null;
  const defaultProvider = primary?.provider ?? DEFAULT_PROVIDER;
  const defaultModel = primary?.model ?? DEFAULT_MODEL;
  const providerRaw = String(params.provider ?? "").trim() || defaultProvider;
  const modelRaw = String(params.model ?? "").trim() || defaultModel;
  const normalizedPrimary = normalizeModelRef(providerRaw, modelRaw);
  const configuredPrimary = normalizeModelRef(defaultProvider, defaultModel);
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider,
  });
  const allowlist = buildConfiguredAllowlistKeys({
    cfg: params.cfg,
    defaultProvider,
  });
  const { candidates, addCandidate } = createModelCandidateCollector(allowlist);

  addCandidate(normalizedPrimary, false);

  const primaryKey = `${normalizedPrimary.provider}::${normalizedPrimary.model}`;
  let learnedFallbackPref = _learnedFallbackPrefs[primaryKey];
  try {
    const limits = loadJsonFile(resolveRateLimitsPath()) as GlobalRateLimits;
    if (limits?.learnedFallbackPrefs?.[primaryKey] !== undefined) {
      learnedFallbackPref = limits.learnedFallbackPrefs[primaryKey];
    }
  } catch {
    // Ignore read errors
  }

  if (learnedFallbackPref) {
    addCandidate(learnedFallbackPref, true);
  }

  const modelFallbacks = (() => {
    if (params.fallbacksOverride !== undefined) {
      return params.fallbacksOverride;
    }
    // Skip configured fallback chain when the user runs a non-default override.
    // In that case, retry should return directly to configured primary.
    if (!sameModelCandidate(normalizedPrimary, configuredPrimary)) {
      return []; // Override model failed → go straight to configured default
    }
    return resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.model);
  })();

  for (const raw of modelFallbacks) {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider,
      aliasIndex,
    });
    if (!resolved) {
      continue;
    }
    addCandidate(resolved.ref, true);
  }

  if (params.fallbacksOverride === undefined && primary?.provider && primary.model) {
    addCandidate({ provider: primary.provider, model: primary.model }, false);
  }

  return candidates;
}

const RATE_LIMITS_LOCK_OPTIONS = {
  wait: 15_000,
  stale: 60_000,
  retries: {
    retries: 50,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 1000,
  },
};

const MIN_PROBE_INTERVAL_MS = 30_000; // 30 seconds between probes per key
const PROBE_MARGIN_MS = 2 * 60 * 1000;

function resolveProbeThrottleKey(provider: string): string {
  return provider;
}

function resolveRateLimitsPath(): string {
  return resolveUserPath("~/.skynet/vault/projects/shared/rate-limits.json");
}

type GlobalRateLimits = {
  activeModelCalls: Record<string, number>;
  lastProbeAttempt: Record<string, number>;
  learnedFallbackPrefs?: Record<string, { provider: string; model: string }>;
};

function ensureRateLimitsFile(pathname: string) {
  if (fs.existsSync(pathname)) {
    return;
  }
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  saveJsonFile(pathname, { activeModelCalls: {}, lastProbeAttempt: {} });
}

async function updateRateLimitsWithLock<T>(updater: (limits: GlobalRateLimits) => T): Promise<T> {
  const limitsPath = resolveRateLimitsPath();
  ensureRateLimitsFile(limitsPath);
  return await withFileLock(limitsPath, RATE_LIMITS_LOCK_OPTIONS, async () => {
    const data = (loadJsonFile(limitsPath) ?? {
      activeModelCalls: {},
      lastProbeAttempt: {},
    }) as GlobalRateLimits;
    if (!data.activeModelCalls) {
      data.activeModelCalls = {};
    }
    if (!data.lastProbeAttempt) {
      data.lastProbeAttempt = {};
    }
    const result = updater(data);
    saveJsonFile(limitsPath, data);
    return result;
  });
}

async function shouldProbePrimaryDuringCooldown(params: {
  isPrimary: boolean;
  hasFallbackCandidates: boolean;
  now: number;
  throttleKey: string;
  authStore: ReturnType<typeof ensureAuthProfileStore>;
  profileIds: string[];
}): Promise<boolean> {
  if (!params.isPrimary || !params.hasFallbackCandidates) {
    return false;
  }

  const soonest = getSoonestCooldownExpiry(params.authStore, params.profileIds);
  if (soonest === null || !Number.isFinite(soonest)) {
    return true;
  }

  if (params.now < soonest - PROBE_MARGIN_MS) {
    return false;
  }

  return await updateRateLimitsWithLock((limits) => {
    const lastProbe = limits.lastProbeAttempt[params.throttleKey] ?? 0;
    if (params.now - lastProbe < MIN_PROBE_INTERVAL_MS) {
      return false;
    }
    limits.lastProbeAttempt[params.throttleKey] = params.now;
    return true;
  });
}

/** @internal – exposed for unit tests only */
export const _probeThrottleInternals = {
  MIN_PROBE_INTERVAL_MS,
  PROBE_MARGIN_MS,
  resolveProbeThrottleKey,
  resolveRateLimitsPath,
} as const;

// --- HIERARCHICAL CONCURRENCY LIMITS ---
// Prevents "thundering herd" on fallback models by distributing load across the fallback chain

async function getActiveModelCalls(provider: string, model: string): Promise<number> {
  return await updateRateLimitsWithLock((limits) => {
    return limits.activeModelCalls[`${provider}::${model}`] ?? 0;
  });
}

async function incrementActiveModelCalls(provider: string, model: string): Promise<void> {
  const key = `${provider}::${model}`;
  await updateRateLimitsWithLock((limits) => {
    limits.activeModelCalls[key] = (limits.activeModelCalls[key] ?? 0) + 1;
  });
}

async function decrementActiveModelCalls(provider: string, model: string): Promise<void> {
  const key = `${provider}::${model}`;
  await updateRateLimitsWithLock((limits) => {
    const current = limits.activeModelCalls[key] ?? 0;
    if (current <= 1) {
      delete limits.activeModelCalls[key];
    } else {
      limits.activeModelCalls[key] = current - 1;
    }
  });
}

function resolveAgentTier(agentDir?: string, tierOverride?: number): number {
  if (tierOverride !== undefined) {
    return tierOverride;
  }
  if (!agentDir) {
    return 3; // Default to Tier 3 (worker-level) if unknown
  }
  // Tier 1: Main, Oversight, Monitor, Optimizer
  if (
    agentDir.includes("/agents/main") ||
    agentDir.includes("/agents/oversight") ||
    agentDir.includes("/agents/monitor") ||
    agentDir.includes("/agents/optimizer")
  ) {
    return 1;
  }
  // Tier 2: Project Managers
  if (agentDir.includes("/agents/manager-")) {
    return 2;
  }
  // Tier 3: Workers / Everything Else
  return 3;
}

async function isModelSaturated(
  provider: string,
  model: string,
  agentDir?: string,
  tierOverride?: number,
): Promise<boolean> {
  const active = await getActiveModelCalls(provider, model);
  const tier = resolveAgentTier(agentDir, tierOverride);

  if (tier === 0) {
    // Tier 0 is exempt from concurrency limits (e.g. human interactive Telegram)
    return false;
  }

  if (tier === 1) {
    // Executives share generously (>= 3 concurrent)
    return active >= 3;
  }

  // Managers and Workers are strictly 1-at-a-time per model.
  // If ANYONE else is using this model, consider it saturated so we gracefully try the next fallback.
  return active >= 1;
}

export async function runWithModelFallback<T>(params: {
  cfg: SkynetConfig | undefined;
  provider: string;
  model: string;
  agentDir?: string;
  tierOverride?: number;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
  run: (provider: string, model: string) => Promise<T>;
  onError?: ModelFallbackErrorHandler;
}): Promise<ModelFallbackRunResult<T>> {
  const candidates = resolveFallbackCandidates({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    fallbacksOverride: params.fallbacksOverride,
  });
  const authStore = params.cfg
    ? ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false })
    : null;
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  const hasFallbackCandidates = candidates.length > 1;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (authStore) {
      const profileIds = resolveAuthProfileOrder({
        cfg: params.cfg,
        store: authStore,
        provider: candidate.provider,
      });

      // Instead of just checking if ANY profile is available, we now try to
      // securely check out a profile, respecting strict half-open concurrency limits.
      let isAnyProfileAvailable = false;
      for (const id of profileIds) {
        // Enforce time-based cooldown and half-open token limits
        const allowed = await tryCheckoutProfile({
          store: authStore,
          profileId: id,
        });
        if (allowed) {
          isAnyProfileAvailable = true;
          break; // We found at least one viable profile we can use
        }
      }

      if (profileIds.length > 0 && !isAnyProfileAvailable) {
        // All profiles for this provider are in cooldown.
        // For the primary model (i === 0), probe it if the soonest cooldown
        // expiry is close or already past. This avoids staying on a fallback
        // model long after the real rate-limit window clears.
        const now = Date.now();
        const probeThrottleKey = resolveProbeThrottleKey(candidate.provider);
        const shouldProbe = await shouldProbePrimaryDuringCooldown({
          isPrimary: i === 0,
          hasFallbackCandidates,
          now,
          throttleKey: probeThrottleKey,
          authStore,
          profileIds,
        });
        if (!shouldProbe) {
          const inferredReason =
            resolveProfilesUnavailableReason({
              store: authStore,
              profileIds,
              now,
            }) ?? "rate_limit";
          // Skip without attempting
          attempts.push({
            provider: candidate.provider,
            model: candidate.model,
            error: `Provider ${candidate.provider} is in cooldown (all profiles unavailable)`,
            reason: inferredReason,
          });
          continue;
        }
        // Primary model probe: attempt it despite cooldown to detect recovery.
        // If it fails, the error is caught below and we fall through to the
        // next candidate as usual.
        await updateRateLimitsWithLock((limits) => {
          limits.lastProbeAttempt[probeThrottleKey] = now;
        });
      }
    }

    if (hasFallbackCandidates) {
      if (
        await isModelSaturated(
          candidate.provider,
          candidate.model,
          params.agentDir,
          params.tierOverride,
        )
      ) {
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          error: `Concurrency limit reached for Tier ${resolveAgentTier(params.agentDir)}.`,
          reason: "rate_limit",
        });
        continue;
      }
    }

    try {
      await incrementActiveModelCalls(candidate.provider, candidate.model);
      const result = await params.run(candidate.provider, candidate.model);
      const primaryKey = `${params.provider}::${params.model}`;
      if (i > 0) {
        // Record successful fallback to accelerate future failovers
        _learnedFallbackPrefs[primaryKey] = {
          provider: candidate.provider,
          model: candidate.model,
        };
        updateRateLimitsWithLock((limits) => {
          if (!limits.learnedFallbackPrefs) {
            limits.learnedFallbackPrefs = {};
          }
          limits.learnedFallbackPrefs[primaryKey] = _learnedFallbackPrefs[primaryKey];
        }).catch(() => {});
      } else if (i === 0) {
        // Clear learned preference once primary model recovers
        delete _learnedFallbackPrefs[primaryKey];
        updateRateLimitsWithLock((limits) => {
          if (limits.learnedFallbackPrefs) {
            delete limits.learnedFallbackPrefs[primaryKey];
          }
        }).catch(() => {});
      }
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (shouldRethrowAbort(err)) {
        throw err;
      }
      // Context overflow errors should be handled by the inner runner's
      // compaction/retry logic, not by model fallback.  If one escapes as a
      // throw, rethrow it immediately rather than trying a different model
      // that may have a smaller context window and fail worse.
      const errMessage = err instanceof Error ? err.message : String(err);
      if (isLikelyContextOverflowError(errMessage)) {
        throw err;
      }
      const normalized =
        coerceToFailoverError(err, {
          provider: candidate.provider,
          model: candidate.model,
        }) ?? err;
      if (!isFailoverError(normalized)) {
        throw err;
      }

      lastError = normalized;
      const described = describeFailoverError(normalized);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        status: described.status,
        code: described.code,
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: normalized,
        attempt: i + 1,
        total: candidates.length,
      });
    } finally {
      await decrementActiveModelCalls(candidate.provider, candidate.model);
    }
  }

  throwFallbackFailureSummary({
    attempts,
    candidates,
    lastError,
    label: "models",
    formatAttempt: (attempt) =>
      `${attempt.provider}/${attempt.model}: ${attempt.error}${
        attempt.reason ? ` (${attempt.reason})` : ""
      }`,
  });
}

export async function runWithImageModelFallback<T>(params: {
  cfg: SkynetConfig | undefined;
  modelOverride?: string;
  run: (provider: string, model: string) => Promise<T>;
  onError?: ModelFallbackErrorHandler;
}): Promise<ModelFallbackRunResult<T>> {
  const candidates = resolveImageFallbackCandidates({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    modelOverride: params.modelOverride,
  });
  if (candidates.length === 0) {
    throw new Error(
      "No image model configured. Set agents.defaults.imageModel.primary or agents.defaults.imageModel.fallbacks.",
    );
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    if (candidates.length > 1) {
      if (await isModelSaturated(candidate.provider, candidate.model, undefined)) {
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          error: `Concurrency limit reached for image fallback.`,
          reason: "rate_limit",
        });
        continue;
      }
    }

    try {
      await incrementActiveModelCalls(candidate.provider, candidate.model);
      const result = await params.run(candidate.provider, candidate.model);
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (shouldRethrowAbort(err)) {
        throw err;
      }
      lastError = err;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: err instanceof Error ? err.message : String(err),
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: err,
        attempt: i + 1,
        total: candidates.length,
      });
    } finally {
      await decrementActiveModelCalls(candidate.provider, candidate.model);
    }
  }

  throwFallbackFailureSummary({
    attempts,
    candidates,
    lastError,
    label: "image models",
    formatAttempt: (attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`,
  });
}
