import fs from "node:fs";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import {
  resolveAgentIdFromSessionKey,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
  type SessionEntry,
  updateSessionStore,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import type { TypingMode } from "../../config/types.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { generateSecureUuid } from "../../infra/secure-random.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { defaultRuntime } from "../../runtime.js";
import { estimateUsageCost, resolveModelCostConfig } from "../../utils/usage-format.js";
import {
  buildFallbackClearedNotice,
  buildFallbackNotice,
  resolveFallbackTransition,
} from "../fallback-state.js";
import type { OriginatingChannelType, TemplateContext } from "../templating.js";
import { resolveResponseUsageMode, type VerboseLevel } from "../thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { runAgentTurnWithFallback } from "./agent-runner-execution.js";
import {
  createShouldEmitToolOutput,
  createShouldEmitToolResult,
  finalizeWithFollowup,
  isAudioPayload,
  signalTypingIfNeeded,
} from "./agent-runner-helpers.js";
import { runMemoryFlushIfNeeded } from "./agent-runner-memory.js";
import { buildReplyPayloads } from "./agent-runner-payloads.js";
import { appendUsageLine, formatResponseUsageLine } from "./agent-runner-utils.js";
import { createAudioAsVoiceBuffer, createBlockReplyPipeline } from "./block-reply-pipeline.js";
import { resolveBlockStreamingCoalescing } from "./block-streaming.js";
import { createFollowupRunner } from "./followup-runner.js";
import {
  auditPostCompactionReads,
  extractReadPaths,
  formatAuditWarning,
  readSessionMessages,
} from "./post-compaction-audit.js";
import { readPostCompactionContext } from "./post-compaction-context.js";
import { enqueueFollowupRun, type FollowupRun, type QueueSettings } from "./queue.js";
import { createReplyToModeFilterForChannel, resolveReplyToMode } from "./reply-threading.js";
import { incrementRunCompactionCount, persistRunSessionUsage } from "./session-run-accounting.js";
import { createTypingSignaler } from "./typing-mode.js";
import type { TypingController } from "./typing.js";

const BLOCK_REPLY_SEND_TIMEOUT_MS = 15_000;
const UNSCHEDULED_REMINDER_NOTE =
  "Note: I did not schedule a reminder in this turn, so this will not trigger automatically.";
const REMINDER_COMMITMENT_PATTERNS: RegExp[] = [
  /\b(?:i\s*['’]?ll|i will)\s+(?:make sure to\s+)?(?:remember|remind|ping|follow up|follow-up|check back|circle back)\b/i,
  /\b(?:i\s*['’]?ll|i will)\s+(?:set|create|schedule)\s+(?:a\s+)?reminder\b/i,
];

function hasUnbackedReminderCommitment(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return false;
  }
  if (normalized.includes(UNSCHEDULED_REMINDER_NOTE.toLowerCase())) {
    return false;
  }
  return REMINDER_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
}

function appendUnscheduledReminderNote(payloads: ReplyPayload[]): ReplyPayload[] {
  let appended = false;
  return payloads.map((payload) => {
    if (appended || payload.isError || typeof payload.text !== "string") {
      return payload;
    }
    if (!hasUnbackedReminderCommitment(payload.text)) {
      return payload;
    }
    appended = true;
    const trimmed = payload.text.trimEnd();
    return {
      ...payload,
      text: `${trimmed}\n\n${UNSCHEDULED_REMINDER_NOTE}`,
    };
  });
}

// Track sessions pending post-compaction read audit (Layer 3)
const pendingPostCompactionAudits = new Map<string, boolean>();

export async function runReplyAgent(params: {
  commandBody: string;
  followupRun: FollowupRun;
  queueKey: string;
  resolvedQueue: QueueSettings;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  isActive: boolean;
  isStreaming: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
  resolvedVerboseLevel: VerboseLevel;
  isNewSession: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  sessionCtx: TemplateContext;
  shouldInjectGroupIntro: boolean;
  typingMode: TypingMode;
}): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    commandBody,
    followupRun,
    queueKey,
    resolvedQueue,
    shouldSteer,
    shouldFollowup,
    isActive,
    isStreaming,
    opts,
    typing,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    isNewSession,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    sessionCtx,
    shouldInjectGroupIntro,
    typingMode,
  } = params;

  let activeSessionEntry = sessionEntry;
  const activeSessionStore = sessionStore;
  let activeIsNewSession = isNewSession;

  const isHeartbeat = opts?.isHeartbeat === true;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat,
  });

  const shouldEmitToolResult = createShouldEmitToolResult({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });
  const shouldEmitToolOutput = createShouldEmitToolOutput({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });

  const pendingToolTasks = new Set<Promise<void>>();
  const blockReplyTimeoutMs = opts?.blockReplyTimeoutMs ?? BLOCK_REPLY_SEND_TIMEOUT_MS;

  const replyToChannel =
    sessionCtx.OriginatingChannel ??
    ((sessionCtx.Surface ?? sessionCtx.Provider)?.toLowerCase() as
      | OriginatingChannelType
      | undefined);
  const replyToMode = resolveReplyToMode(
    followupRun.run.config,
    replyToChannel,
    sessionCtx.AccountId,
    sessionCtx.ChatType,
  );
  const applyReplyToMode = createReplyToModeFilterForChannel(replyToMode, replyToChannel);
  const cfg = followupRun.run.config;
  const blockReplyCoalescing =
    blockStreamingEnabled && opts?.onBlockReply
      ? resolveBlockStreamingCoalescing(
          cfg,
          sessionCtx.Provider,
          sessionCtx.AccountId,
          blockReplyChunking,
        )
      : undefined;
  const blockReplyPipeline =
    blockStreamingEnabled && opts?.onBlockReply
      ? createBlockReplyPipeline({
          onBlockReply: opts.onBlockReply,
          timeoutMs: blockReplyTimeoutMs,
          coalescing: blockReplyCoalescing,
          buffer: createAudioAsVoiceBuffer({ isAudioPayload }),
        })
      : null;
  const touchActiveSessionEntry = async () => {
    if (!activeSessionEntry || !activeSessionStore || !sessionKey) {
      return;
    }
    const updatedAt = Date.now();
    activeSessionEntry.updatedAt = updatedAt;
    activeSessionStore[sessionKey] = activeSessionEntry;
    if (storePath) {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async () => ({ updatedAt }),
      });
    }
  };

  if (shouldSteer && isStreaming) {
    const steered = queueEmbeddedPiMessage(followupRun.run.sessionId, followupRun.prompt);
    if (steered && !shouldFollowup) {
      await touchActiveSessionEntry();
      typing.cleanup();
      return undefined;
    }
  }

  if (isActive && (shouldFollowup || resolvedQueue.mode === "steer")) {
    enqueueFollowupRun(queueKey, followupRun, resolvedQueue);
    await touchActiveSessionEntry();
    typing.cleanup();
    return undefined;
  }

  await typingSignals.signalRunStart();

  activeSessionEntry = await runMemoryFlushIfNeeded({
    cfg,
    followupRun,
    sessionCtx,
    opts,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    isHeartbeat,
  });

  const runFollowupTurn = createFollowupRunner({
    opts,
    typing,
    typingMode,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  });

  let responseUsageLine: string | undefined;
  type SessionResetOptions = {
    failureLabel: string;
    buildLogMessage: (nextSessionId: string) => string;
    cleanupTranscripts?: boolean;
  };
  const resetSession = async ({
    failureLabel,
    buildLogMessage,
    cleanupTranscripts,
  }: SessionResetOptions): Promise<boolean> => {
    if (!sessionKey || !activeSessionStore || !storePath) {
      return false;
    }
    const prevEntry = activeSessionStore[sessionKey] ?? activeSessionEntry;
    if (!prevEntry) {
      return false;
    }
    const prevSessionId = cleanupTranscripts ? prevEntry.sessionId : undefined;
    const nextSessionId = generateSecureUuid();
    const nextEntry: SessionEntry = {
      ...prevEntry,
      sessionId: nextSessionId,
      updatedAt: Date.now(),
      systemSent: false,
      abortedLastRun: false,
      fallbackNoticeSelectedModel: undefined,
      fallbackNoticeActiveModel: undefined,
      fallbackNoticeReason: undefined,
    };
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const nextSessionFile = resolveSessionTranscriptPath(
      nextSessionId,
      agentId,
      sessionCtx.MessageThreadId,
    );
    nextEntry.sessionFile = nextSessionFile;
    activeSessionStore[sessionKey] = nextEntry;
    try {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = nextEntry;
      });
    } catch (err) {
      defaultRuntime.error(
        `Failed to persist session reset after ${failureLabel} (${sessionKey}): ${String(err)}`,
      );
    }
    followupRun.run.sessionId = nextSessionId;
    followupRun.run.sessionFile = nextSessionFile;
    activeSessionEntry = nextEntry;
    activeIsNewSession = true;
    defaultRuntime.error(buildLogMessage(nextSessionId));
    if (cleanupTranscripts && prevSessionId) {
      const transcriptCandidates = new Set<string>();
      const resolved = resolveSessionFilePath(
        prevSessionId,
        prevEntry,
        resolveSessionFilePathOptions({ agentId, storePath }),
      );
      if (resolved) {
        transcriptCandidates.add(resolved);
      }
      transcriptCandidates.add(resolveSessionTranscriptPath(prevSessionId, agentId));
      for (const candidate of transcriptCandidates) {
        try {
          fs.unlinkSync(candidate);
        } catch {
          // Best-effort cleanup.
        }
      }
    }
    return true;
  };
  const resetSessionAfterCompactionFailure = async (reason: string): Promise<boolean> =>
    resetSession({
      failureLabel: "compaction failure",
      buildLogMessage: (nextSessionId) =>
        `Auto-compaction failed (${reason}). Restarting session ${sessionKey} -> ${nextSessionId} and retrying.`,
    });
  const resetSessionAfterRoleOrderingConflict = async (reason: string): Promise<boolean> =>
    resetSession({
      failureLabel: "role ordering conflict",
      buildLogMessage: (nextSessionId) =>
        `Role ordering conflict (${reason}). Restarting session ${sessionKey} -> ${nextSessionId}.`,
      cleanupTranscripts: true,
    });
  try {
    const runStartedAt = Date.now();
    const runOutcome = await runAgentTurnWithFallback({
      commandBody,
      followupRun,
      sessionCtx,
      opts,
      typingSignals,
      blockReplyPipeline,
      blockStreamingEnabled,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      applyReplyToMode,
      shouldEmitToolResult,
      shouldEmitToolOutput,
      pendingToolTasks,
      resetSessionAfterCompactionFailure,
      resetSessionAfterRoleOrderingConflict,
      isHeartbeat,
      sessionKey,
      getActiveSessionEntry: () => activeSessionEntry,
      activeSessionStore,
      storePath,
      resolvedVerboseLevel,
    });

    if (runOutcome.kind === "final") {
      return finalizeWithFollowup(runOutcome.payload, queueKey, runFollowupTurn);
    }

    const {
      runId,
      runResult,
      fallbackProvider,
      fallbackModel,
      fallbackAttempts,
      directlySentBlockKeys,
    } = runOutcome;
    let { didLogHeartbeatStrip, autoCompactionCompleted } = runOutcome;

    if (
      shouldInjectGroupIntro &&
      activeSessionEntry &&
      activeSessionStore &&
      sessionKey &&
      activeSessionEntry.groupActivationNeedsSystemIntro
    ) {
      const updatedAt = Date.now();
      activeSessionEntry.groupActivationNeedsSystemIntro = false;
      activeSessionEntry.updatedAt = updatedAt;
      activeSessionStore[sessionKey] = activeSessionEntry;
      if (storePath) {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({
            groupActivationNeedsSystemIntro: false,
            updatedAt,
          }),
        });
      }
    }

    const payloadArray = runResult.payloads ?? [];

    if (blockReplyPipeline) {
      await blockReplyPipeline.flush({ force: true });
      blockReplyPipeline.stop();
    }
    if (pendingToolTasks.size > 0) {
      await Promise.allSettled(pendingToolTasks);
    }

    const usage = runResult.meta?.agentMeta?.usage;
    const promptTokens = runResult.meta?.agentMeta?.promptTokens;
    const modelUsed = runResult.meta?.agentMeta?.model ?? fallbackModel ?? defaultModel;
    const providerUsed =
      runResult.meta?.agentMeta?.provider ?? fallbackProvider ?? followupRun.run.provider;
    const verboseEnabled = resolvedVerboseLevel !== "off";
    const selectedProvider = followupRun.run.provider;
    const selectedModel = followupRun.run.model;
    const fallbackStateEntry =
      activeSessionEntry ?? (sessionKey ? activeSessionStore?.[sessionKey] : undefined);
    const fallbackTransition = resolveFallbackTransition({
      selectedProvider,
      selectedModel,
      activeProvider: providerUsed,
      activeModel: modelUsed,
      attempts: fallbackAttempts,
      state: fallbackStateEntry,
    });
    if (fallbackTransition.stateChanged) {
      if (fallbackStateEntry) {
        fallbackStateEntry.fallbackNoticeSelectedModel = fallbackTransition.nextState.selectedModel;
        fallbackStateEntry.fallbackNoticeActiveModel = fallbackTransition.nextState.activeModel;
        fallbackStateEntry.fallbackNoticeReason = fallbackTransition.nextState.reason;
        fallbackStateEntry.updatedAt = Date.now();
        activeSessionEntry = fallbackStateEntry;
      }
      if (sessionKey && fallbackStateEntry && activeSessionStore) {
        activeSessionStore[sessionKey] = fallbackStateEntry;
      }
      if (sessionKey && storePath) {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({
            fallbackNoticeSelectedModel: fallbackTransition.nextState.selectedModel,
            fallbackNoticeActiveModel: fallbackTransition.nextState.activeModel,
            fallbackNoticeReason: fallbackTransition.nextState.reason,
          }),
        });
      }
    }
    const cliSessionId = isCliProvider(providerUsed, cfg)
      ? runResult.meta?.agentMeta?.sessionId?.trim()
      : undefined;
    const contextTokensUsed =
      agentCfgContextTokens ??
      lookupContextTokens(modelUsed) ??
      activeSessionEntry?.contextTokens ??
      DEFAULT_CONTEXT_TOKENS;

    await persistRunSessionUsage({
      storePath,
      sessionKey,
      usage,
      lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
      promptTokens,
      modelUsed,
      providerUsed,
      contextTokensUsed,
      systemPromptReport: runResult.meta?.systemPromptReport,
      cliSessionId,
    });

    // Drain any late tool/block deliveries before deciding there's "nothing to send".
    // Otherwise, a late typing trigger (e.g. from a tool callback) can outlive the run and
    // keep the typing indicator stuck.
    if (payloadArray.length === 0) {
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    }

    const payloadResult = buildReplyPayloads({
      payloads: payloadArray,
      isHeartbeat,
      didLogHeartbeatStrip,
      blockStreamingEnabled,
      blockReplyPipeline,
      directlySentBlockKeys,
      replyToMode,
      replyToChannel,
      currentMessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
      messageProvider: followupRun.run.messageProvider,
      messagingToolSentTexts: runResult.messagingToolSentTexts,
      messagingToolSentMediaUrls: runResult.messagingToolSentMediaUrls,
      messagingToolSentTargets: runResult.messagingToolSentTargets,
      originatingTo: sessionCtx.OriginatingTo ?? sessionCtx.To,
      accountId: sessionCtx.AccountId,
    });
    const { replyPayloads } = payloadResult;
    didLogHeartbeatStrip = payloadResult.didLogHeartbeatStrip;

    // ----- NERVOUS SYSTEM INTERCEPTOR -----
    if (sessionKey && !isHeartbeat) {
      const toolMetas = runResult.toolMetas ?? [];
      let calledGovernance = toolMetas.some((m) => m.toolName === "governance");
      const calledPing = toolMetas.some((m) => m.toolName === "ping");

      // Auto-Governance Physical Hooks
      const combinedText = replyPayloads
        .map((p) => p.text || "")
        .join("\n")
        .trim();

      if (!calledGovernance) {
        // 1. Auto-Complete Hook (DONE:)
        const doneMatch = combinedText.match(/^DONE:\s*(.+)/im);
        if (doneMatch) {
          defaultRuntime.log?.(
            `Nervous System: physical hook [DONE:] detected for ${sessionKey}. Auto-completing task.`,
          );
          const summary = doneMatch[1].trim();

          try {
            const vaultMod = await import("../../skynet/vault/manager.js");
            const vault = vaultMod.createVaultManager("~/.skynet/vault");
            // Search ALL project worker directories, not just 'system'
            const projectDirs = await vault.listDirs("projects/").catch(() => [] as string[]);
            let found = false;
            for (const project of projectDirs) {
              if (found) {
                break;
              }
              const workers = await vault
                .list(`projects/${project}/workers/`)
                .catch(() => [] as string[]);
              for (const wf of workers) {
                if (!wf.endsWith(".json")) {
                  continue;
                }
                const wState = (await vault.read(wf)) as Record<string, unknown> | null;
                if (wState && wState.agentId === sessionKey) {
                  const eventId = `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const event = {
                    id: eventId,
                    path: `events/${eventId}.json`,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    metadata: {},
                    type: "event",
                    eventType: "complete-task",
                    eventData: JSON.stringify({
                      taskId: wState.currentTaskId,
                      summary,
                      artifacts: [],
                      workerId: sessionKey,
                      projectName: project,
                    }),
                    recipient: "broadcast",
                    timestamp: Date.now(),
                    status: "pending",
                  };
                  await vault.write(`events/${eventId}.json`, event);
                  // Wake the project manager immediately
                  try {
                    const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");
                    requestHeartbeatNow({
                      reason: "action:task-complete",
                      agentId: `manager-${project}`,
                    });
                  } catch {
                    /* best-effort */
                  }
                  calledGovernance = true;
                  found = true;
                  break;
                }
              }
            }
          } catch (e) {
            defaultRuntime.error?.(`Auto-complete failed:`, e);
          }
        }

        // 2. Auto-Escalate Hook (ERRORS: / BLOCKER:)
        if (!calledGovernance) {
          const errorMatch = combinedText.match(/^(?:ERRORS|BLOCKER):\s*(.+)/im);
          if (errorMatch) {
            defaultRuntime.log?.(
              `Nervous System: physical hook [BLOCKER] detected for ${sessionKey}. Auto-escalating.`,
            );
            const detail = errorMatch[1].trim();

            try {
              const vaultMod = await import("../../skynet/vault/manager.js");
              const vault = vaultMod.createVaultManager("~/.skynet/vault");
              // Find which project this worker belongs to for correct manager routing
              let workerProjectName = "system";
              const projectDirs = await vault.listDirs("projects/").catch(() => [] as string[]);
              for (const proj of projectDirs) {
                const workers = await vault
                  .list(`projects/${proj}/workers/`)
                  .catch(() => [] as string[]);
                for (const wf of workers) {
                  if (!wf.endsWith(".json")) {
                    continue;
                  }
                  const wState = (await vault.read(wf)) as
                    | (Record<string, unknown> & { metadata?: { projectName?: string } })
                    | null;
                  if (wState && wState.agentId === sessionKey) {
                    workerProjectName = wState.metadata?.projectName || proj;
                    break;
                  }
                }
              }
              const escalationId = `escalation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const escalation = {
                id: escalationId,
                path: `events/${escalationId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName: workerProjectName },
                type: "event",
                eventType: "escalation:worker→manager",
                eventData: JSON.stringify({
                  question: `[AUTO-ESCALATION] Worker blocked: ${detail}`,
                  proposedSolution: "Please review and advise.",
                  taskId: "unknown",
                  sender: sessionKey,
                  escalationPath: ["worker", "manager"],
                }),
                recipient: `manager-${workerProjectName}`,
                timestamp: Date.now(),
                status: "pending",
              };
              await vault.write(`events/${escalationId}.json`, escalation);
              // Wake the specific project manager
              try {
                const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");
                requestHeartbeatNow({
                  reason: "action:worker-blocker",
                  agentId: `manager-${workerProjectName}`,
                });
              } catch {
                /* best-effort */
              }
              calledGovernance = true;
            } catch (e) {
              defaultRuntime.error?.(`Auto-escalate failed:`, e);
            }
          }
        }
      }

      // Final Penalty Check
      const hadSystemError = replyPayloads.some((p) => p.isError) || runResult.meta?.error;
      if (!calledGovernance && !calledPing && !hadSystemError) {
        defaultRuntime.error?.(
          `Nervous System: agent ${sessionKey} failed to call governance or ping, and triggered no physical physical hooks. Penalizing.`,
        );

        // Record Violation for RL
        try {
          const { createViolationTracker } = await import("../../skynet/violations/tracker.js");
          const { resolveUserPath } = await import("../../utils.js");
          const tracker = createViolationTracker(resolveUserPath("~/.skynet/vault/"));
          await tracker.recordViolation(
            sessionKey,
            "governance",
            "Agent ended turn without invoking a governance tool or physical hook.",
            "major",
          );
        } catch (err) {
          defaultRuntime.error?.(`Failed to log RL violation:`, err);
        }

        enqueueSystemEvent(
          "[NERVOUS_SYSTEM] Action blocked by Governance. No governance tool called. You are penalized -10 reward points for breaking protocol. Please call the governance tool with an appropriate action before ending your turn.",
          { sessionKey },
        );
        const penaltyRun: FollowupRun = {
          ...followupRun,
          prompt: "",
          messageId: generateSecureUuid(),
        };
        const penaltyQueue: QueueSettings = {
          mode: "followup",
          dropPolicy: "old",
          cap: 10,
        };
        // Enqueue an immediate followup run to force the agent to see the penalty and respond
        enqueueFollowupRun(queueKey, penaltyRun, penaltyQueue, "none");
      }
    }
    // --------------------------------------

    if (replyPayloads.length === 0) {
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);
    }

    const successfulCronAdds = runResult.successfulCronAdds ?? 0;
    const hasReminderCommitment = replyPayloads.some(
      (payload) =>
        !payload.isError &&
        typeof payload.text === "string" &&
        hasUnbackedReminderCommitment(payload.text),
    );
    const guardedReplyPayloads =
      hasReminderCommitment && successfulCronAdds === 0
        ? appendUnscheduledReminderNote(replyPayloads)
        : replyPayloads;

    await signalTypingIfNeeded(guardedReplyPayloads, typingSignals);

    if (isDiagnosticsEnabled(cfg) && hasNonzeroUsage(usage)) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const cacheRead = usage.cacheRead ?? 0;
      const cacheWrite = usage.cacheWrite ?? 0;
      const promptTokens = input + cacheRead + cacheWrite;
      const totalTokens = usage.total ?? promptTokens + output;
      const costConfig = resolveModelCostConfig({
        provider: providerUsed,
        model: modelUsed,
        config: cfg,
      });
      const costUsd = estimateUsageCost({ usage, cost: costConfig });
      emitDiagnosticEvent({
        type: "model.usage",
        sessionKey,
        sessionId: followupRun.run.sessionId,
        channel: replyToChannel,
        provider: providerUsed,
        model: modelUsed,
        usage: {
          input,
          output,
          cacheRead,
          cacheWrite,
          promptTokens,
          total: totalTokens,
        },
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        context: {
          limit: contextTokensUsed,
          used: totalTokens,
        },
        costUsd,
        durationMs: Date.now() - runStartedAt,
      });
    }

    const responseUsageRaw =
      activeSessionEntry?.responseUsage ??
      (sessionKey ? activeSessionStore?.[sessionKey]?.responseUsage : undefined);
    const responseUsageMode = resolveResponseUsageMode(responseUsageRaw);
    if (responseUsageMode !== "off" && hasNonzeroUsage(usage)) {
      const authMode = resolveModelAuthMode(providerUsed, cfg);
      const showCost = authMode === "api-key";
      const costConfig = showCost
        ? resolveModelCostConfig({
            provider: providerUsed,
            model: modelUsed,
            config: cfg,
          })
        : undefined;
      let formatted = formatResponseUsageLine({
        usage,
        showCost,
        costConfig,
      });
      if (formatted && responseUsageMode === "full" && sessionKey) {
        formatted = `${formatted} · session ${sessionKey}`;
      }
      if (formatted) {
        responseUsageLine = formatted;
      }
    }

    // If verbose is enabled, prepend operational run notices.
    let finalPayloads = guardedReplyPayloads;
    const verboseNotices: ReplyPayload[] = [];

    if (verboseEnabled && activeIsNewSession) {
      verboseNotices.push({ text: `🧭 New session: ${followupRun.run.sessionId}` });
    }

    if (fallbackTransition.fallbackTransitioned) {
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          reasonSummary: fallbackTransition.reasonSummary,
          attemptSummaries: fallbackTransition.attemptSummaries,
          attempts: fallbackAttempts,
        },
      });
      if (verboseEnabled) {
        const fallbackNotice = buildFallbackNotice({
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          attempts: fallbackAttempts,
        });
        if (fallbackNotice) {
          verboseNotices.push({ text: fallbackNotice });
        }
      }
    }
    if (fallbackTransition.fallbackCleared) {
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "fallback_cleared",
          selectedProvider,
          selectedModel,
          activeProvider: providerUsed,
          activeModel: modelUsed,
          previousActiveModel: fallbackTransition.previousState.activeModel,
        },
      });
      if (verboseEnabled) {
        verboseNotices.push({
          text: buildFallbackClearedNotice({
            selectedProvider,
            selectedModel,
            previousActiveModel: fallbackTransition.previousState.activeModel,
          }),
        });
      }
    }

    if (autoCompactionCompleted) {
      const count = await incrementRunCompactionCount({
        sessionEntry: activeSessionEntry,
        sessionStore: activeSessionStore,
        sessionKey,
        storePath,
        lastCallUsage: runResult.meta?.agentMeta?.lastCallUsage,
        contextTokensUsed,
      });

      // Inject post-compaction workspace context for the next agent turn
      if (sessionKey) {
        const workspaceDir = process.cwd();
        readPostCompactionContext(workspaceDir)
          .then((contextContent) => {
            if (contextContent) {
              enqueueSystemEvent(contextContent, { sessionKey });
            }
          })
          .catch(() => {
            // Silent failure — post-compaction context is best-effort
          });

        // Set pending audit flag for Layer 3 (post-compaction read audit)
        pendingPostCompactionAudits.set(sessionKey, true);
      }

      if (verboseEnabled) {
        const suffix = typeof count === "number" ? ` (count ${count})` : "";
        verboseNotices.push({ text: `🧹 Auto-compaction complete${suffix}.` });
      }
    }
    if (verboseNotices.length > 0) {
      finalPayloads = [...verboseNotices, ...finalPayloads];
    }
    if (responseUsageLine) {
      finalPayloads = appendUsageLine(finalPayloads, responseUsageLine);
    }

    // Post-compaction read audit (Layer 3)
    if (sessionKey && pendingPostCompactionAudits.get(sessionKey)) {
      pendingPostCompactionAudits.delete(sessionKey); // Delete FIRST — one-shot only
      try {
        const sessionFile = activeSessionEntry?.sessionFile;
        if (sessionFile) {
          const messages = readSessionMessages(sessionFile);
          const readPaths = extractReadPaths(messages);
          const workspaceDir = process.cwd();
          const audit = auditPostCompactionReads(readPaths, workspaceDir);
          if (!audit.passed) {
            enqueueSystemEvent(formatAuditWarning(audit.missingPatterns), { sessionKey });
          }
        }
      } catch {
        // Silent failure — audit is best-effort
      }
    }

    return finalizeWithFollowup(
      finalPayloads.length === 1 ? finalPayloads[0] : finalPayloads,
      queueKey,
      runFollowupTurn,
    );
  } finally {
    blockReplyPipeline?.stop();
    typing.markRunComplete();
  }
}
