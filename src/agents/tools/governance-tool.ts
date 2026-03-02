import os from "node:os";
import { Type } from "@sinclair/typebox";
import {
  ensureAgentInConfig,
  ensureManagerInMainAllowAgents,
} from "../../agents/config-helpers.js";
import { ensureWorkerConfigFromMain } from "../../agents/config-provision.js";
import { spawnSubagentDirect } from "../../agents/subagent-spawn.js";
import { callGateway } from "../../gateway/call.js";
import {
  WORKER_CONFIGS,
  createWorkerAgent,
  createProjectManager,
  getPatternLearner,
  ExecutiveCollaboration,
  createExecutiveCollaboration,
  requestHeartbeatNow,
  getPriorityBoard,
} from "../../skynet/proactive/governance-helpers.js";
import { createVaultManager } from "../../skynet/vault/manager.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

// Permission types for agent protocol enforcement
const PERMISSION_TYPES = {
  // File operations
  READ_ANY_FILE: "READ_ANY_FILE",
  WRITE_PROJECT_FILES: "WRITE_PROJECT_FILES",
  WRITE_SYSTEM_CONFIG: "WRITE_SYSTEM_CONFIG",
  WRITE_MANAGER_CONFIG: "WRITE_MANAGER_CONFIG",

  // Agent operations
  SPAWN_WORKERS: "SPAWN_WORKERS",
  HIRE_MANAGERS: "HIRE_MANAGERS",
  MODIFY_GOVERNANCE: "MODIFY_GOVERNANCE",

  // Communication
  ESCALATE_TO_EXECUTIVES: "ESCALATE_TO_EXECUTIVES",
  ESCALATE_TO_USER: "ESCALATE_TO_USER",

  // Task operations
  CREATE_TASKS: "CREATE_TASKS",
  COMPLETE_TASKS: "COMPLETE_TASKS",
  ASSIGN_TASKS: "ASSIGN_TASKS",

  // Wildcard
  ALL: "*",
};

// Agent permission levels - what each agent type can do
const AGENT_PERMISSIONS: Record<string, string[]> = {
  // Main agent - coordinates but delegates execution
  main: [
    PERMISSION_TYPES.READ_ANY_FILE,
    PERMISSION_TYPES.ESCALATE_TO_EXECUTIVES,
    PERMISSION_TYPES.ESCALATE_TO_USER,
    PERMISSION_TYPES.CREATE_TASKS,
    PERMISSION_TYPES.COMPLETE_TASKS,
  ],

  // Managers - run projects and spawn workers
  manager: [
    PERMISSION_TYPES.READ_ANY_FILE,
    PERMISSION_TYPES.WRITE_PROJECT_FILES,
    PERMISSION_TYPES.SPAWN_WORKERS,
    PERMISSION_TYPES.ESCALATE_TO_EXECUTIVES,
    PERMISSION_TYPES.CREATE_TASKS,
    PERMISSION_TYPES.COMPLETE_TASKS,
    PERMISSION_TYPES.ASSIGN_TASKS,
  ],

  // Workers - execute tasks, limited permissions
  worker: [
    PERMISSION_TYPES.READ_ANY_FILE,
    PERMISSION_TYPES.WRITE_PROJECT_FILES,
    PERMISSION_TYPES.COMPLETE_TASKS,
  ],

  // Executive - high level governance
  executive: [PERMISSION_TYPES.ALL],

  // System - can do anything
  system: [PERMISSION_TYPES.ALL],
};

function getAgentPermissions(agentType: string): string[] {
  return AGENT_PERMISSIONS[agentType] || AGENT_PERMISSIONS.worker;
}

const GovernanceConsultSchema = Type.Object({
  action: Type.Union([
    Type.Literal("consult"),
    Type.Literal("fast-consult"),
    Type.Literal("vote"),
    Type.Literal("spawn-worker"),
    Type.Literal("hire-manager"),
    Type.Literal("get-proposal-status"),
    Type.Literal("list-managers"),
    Type.Literal("get-my-task"),
    Type.Literal("complete-task"),
    Type.Literal("evaluate-worker-task"),
    Type.Literal("create-task"),
    Type.Literal("assign-task"),
    Type.Literal("run-worker"),
    Type.Literal("exec-worker"),
    Type.Literal("worker-status"),
    Type.Literal("list-workers"),
    Type.Literal("system-status"),
    Type.Literal("get-system-info"),
    Type.Literal("send-event"),
    Type.Literal("poll-events"),
    Type.Literal("check-pattern"),
    Type.Literal("learn-pattern"),
    Type.Literal("list-patterns"),
    Type.Literal("submit-priority"),
    Type.Literal("vote-priority"),
    Type.Literal("get-priorities"),
    Type.Literal("resolve-priority"),
    Type.Literal("start-tick-handlers"),
    Type.Literal("stop-tick-handlers"),
    Type.Literal("list-tick-handlers"),
    Type.Literal("hibernate"),
    Type.Literal("read-schedule"),
    Type.Literal("activate-manager"),
    Type.Literal("sync-manager"),
    Type.Literal("create-decision"),
    Type.Literal("propagate-decision"),
    Type.Literal("check-permission"),
    Type.Literal("request-permission"),
    Type.Literal("check-in"),
    Type.Literal("health-summary"),
    Type.Literal("ask-executive"),
  ]),
  request: Type.Optional(Type.String()),
  plan: Type.Optional(Type.String()),
  proposalId: Type.Optional(Type.String()),
  executive: Type.Optional(
    Type.Union([Type.Literal("oversight"), Type.Literal("monitor"), Type.Literal("optimizer")]),
  ),
  vote: Type.Optional(
    Type.Union([Type.Literal("approve"), Type.Literal("reject"), Type.Literal("abstain")]),
  ),
  evaluation: Type.Optional(Type.Union([Type.Literal("approved"), Type.Literal("rejected")])),
  feedback: Type.Optional(Type.String()),
  workerType: Type.Optional(
    Type.Union([
      Type.Literal("developer"),
      Type.Literal("comms"),
      Type.Literal("content"),
      Type.Literal("media"),
      Type.Literal("research"),
      Type.Literal("thinker"),
      Type.Literal("builder"),
      Type.Literal("tester"),
    ]),
  ),
  taskDescription: Type.Optional(Type.String()),
  projectName: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  workerId: Type.Optional(Type.String()),
  taskPath: Type.Optional(Type.String()),
  result: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  priority: Type.Optional(Type.String()),
  task: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  eventType: Type.Optional(Type.String()),
  eventData: Type.Optional(Type.String()),
  recipient: Type.Optional(Type.String()),
  since: Type.Optional(Type.Number()),
  taskType: Type.Optional(Type.String()),
  context: Type.Optional(Type.String()),
  success: Type.Optional(Type.Boolean()),
  category: Type.Optional(Type.String()),
  baseScore: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.String()),
  score: Type.Optional(Type.Number()),
  enabled: Type.Optional(Type.Boolean()),
  question: Type.Optional(Type.String()),
  proposedSolution: Type.Optional(Type.String()),
  escalationId: Type.Optional(Type.String()),
  response: Type.Optional(Type.String()),
  escalationPath: Type.Optional(Type.String()),
  decision: Type.Optional(Type.String()),
  sender: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
});

export function createGovernanceTool(): AnyAgentTool {
  return {
    label: "Governance",
    name: "governance",
    description:
      "Interact with Skynet governance: consult executives, hire managers, spawn workers, vote on proposals",
    parameters: GovernanceConsultSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = params.action as string;

      try {
        const vault = createVaultManager("~/.skynet/vault");

        switch (action) {
          case "consult": {
            const request = params.request as string;
            const plan = params.plan as string;
            if (!request || !plan) {
              return jsonResult({ success: false, error: "request and plan required for consult" });
            }
            const result = await ExecutiveCollaboration.createAndRunCollaboration(
              vault,
              request,
              plan,
            );
            return jsonResult({ success: true, type: "consultation", result });
          }

          case "vote": {
            const proposalId = params.proposalId as string;
            const executive = params.executive as "oversight" | "monitor" | "optimizer";
            const vote = params.vote as "approve" | "reject" | "abstain";
            if (!proposalId || !executive || !vote) {
              return jsonResult({
                success: false,
                error: "proposalId, executive, and vote required",
              });
            }
            const collab = createExecutiveCollaboration(vault, proposalId);
            await collab.submitVote(executive, vote);
            const result = await collab.getResult();
            return jsonResult({ success: true, type: "vote", result });
          }

          case "health-summary": {
            // 1. Get Models Health
            let modelsHealth = "Offline/Unknown";
            try {
              const { resolveUserPath } = await import("../../utils.js");
              const fs = await import("node:fs/promises");
              const path = await import("node:path");
              const healthPath = path.join(resolveUserPath("~/.skynet"), "provider-health.json");
              if (
                await fs
                  .stat(healthPath)
                  .then(() => true)
                  .catch(() => false)
              ) {
                const rawHealth = await fs.readFile(healthPath, "utf-8");
                const healthData = JSON.parse(rawHealth) as Record<
                  string,
                  { provider: string; model?: string; status: string }
                >;

                const lines = Object.entries(healthData).map(([, data]) => {
                  const icon =
                    data.status === "healthy" ? "✅" : data.status === "half-open" ? "⚠️" : "❌";
                  return `${icon} **${data.provider}** (${data.model || "default"}): ${data.status}`;
                });
                modelsHealth =
                  lines.length > 0 ? lines.join("\n") : "No routing profiles configured.";
              }
            } catch {
              modelsHealth = "Failed to load provider health cache.";
            }

            // 2. Get active blockers from all projects
            let activeBlockers = [];
            let totalWorkers = 0;
            let totalTasks = 0;
            let pendingTasks = 0;

            const projects = await vault.listDirs("projects/").catch(() => [] as string[]);
            for (const proj of projects) {
              const mgr = (await vault
                .read(`projects/${proj}/manager.json`)
                .catch(() => null)) as unknown as
                | import("../../skynet/vault/types.js").ProjectManagerState
                | null;
              if (mgr && mgr.blockers && Array.isArray(mgr.blockers) && mgr.blockers.length > 0) {
                activeBlockers.push(...mgr.blockers);
              }
              if (mgr && Array.isArray(mgr.activeWorkers)) {
                totalWorkers += mgr.activeWorkers.length;
              }

              const tasks = await vault.list(`projects/${proj}/tasks/`).catch(() => [] as string[]);
              totalTasks += tasks.length;
              for (const tf of tasks) {
                if (!tf.endsWith(".json")) {
                  continue;
                }
                const task = (await vault
                  .read(`projects/${proj}/tasks/${tf}`)
                  .catch(() => null)) as unknown as
                  | import("../../skynet/vault/types.js").TaskEntry
                  | null;
                if (task && task.status !== "completed") {
                  pendingTasks++;
                }
              }
            }

            const unassignedQueue = await vault.list("tasks/").catch(() => [] as string[]);
            totalTasks += unassignedQueue.length;
            pendingTasks += unassignedQueue.length; // Unassigned are pending

            const dashboard = `# System Health Summary

## Model Infrastructure
${modelsHealth}

## Capacity
- **Active Workers:** ${totalWorkers}
- **Task Backlog:** ${pendingTasks} pending / ${totalTasks} total tasks

## Global Blockers
${
  activeBlockers.length > 0
    ? activeBlockers.map((b) => `- ${b}`).join("\n")
    : "✅ No active blockers reported by Project Managers."
}
`;
            return jsonResult({ success: true, type: "health-summary", report: dashboard });
          }

          case "spawn-worker": {
            const workerType = params.workerType as keyof typeof WORKER_CONFIGS;
            const taskDescription = params.taskDescription as string;
            const projectName = (params.projectName as string) || "system";

            if (!workerType || !taskDescription) {
              return jsonResult({
                success: false,
                error: "workerType and taskDescription required",
              });
            }
            if (!WORKER_CONFIGS[workerType]) {
              return jsonResult({ success: false, error: `Unknown worker type: ${workerType}` });
            }

            // --- Pre-Flight Model Health Check ---
            try {
              const { resolveUserPath } = await import("../../utils.js");
              const fs = await import("node:fs/promises");
              const path = await import("node:path");
              const healthPath = path.join(resolveUserPath("~/.skynet"), "provider-health.json");

              if (
                await fs
                  .stat(healthPath)
                  .then(() => true)
                  .catch(() => false)
              ) {
                const rawHealth = await fs.readFile(healthPath, "utf-8");
                const healthData = JSON.parse(rawHealth) as Record<string, { status: string }>;
                const hasAvailableProvider = Object.values(healthData).some(
                  (p) => p.status === "healthy" || p.status === "half-open",
                );

                if (!hasAvailableProvider && Object.keys(healthData).length > 0) {
                  return jsonResult({
                    success: false,
                    error:
                      "Provider Cooldown: All routing models are currently rate-limited. Yield control (hibernate) and try again later.",
                  });
                }
              }
            } catch {
              // Non-fatal if health file isn't ready
            }
            // -------------------------------------

            // Check executive approval / reinforcement learning first for spawning workers
            const patternLearner = getPatternLearner(
              vault as unknown as import("../../skynet/vault/manager.js").VaultManager,
            );
            const approvalCheck = await patternLearner.checkAutoApprove(
              projectName,
              "spawn-worker",
              { workerType, taskDescription },
            );

            if (approvalCheck.confidence < 60) {
              // Not approved by RL - force an escalation to executives
              const escalationId = `escalation-${Date.now()}`;
              const escalation = {
                id: escalationId,
                path: `events/${escalationId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName },
                type: "event",
                eventType: "escalation:manager→executive",
                eventData: JSON.stringify({
                  question: `Requesting approval to spawn ${workerType} worker for: ${taskDescription}`,
                  projectName,
                }),
                recipient: "executive",
                timestamp: Date.now(),
                status: "pending",
                sender: "manager",
              };
              await vault.write(`events/${escalationId}.json`, escalation);
              // Immediately wake the executive agent so the escalation is not silently pending
              try {
                requestHeartbeatNow({ reason: "action:escalation", agentId: "oversight" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "monitor" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "optimizer" });
              } catch {
                /* heartbeat wake is best-effort */
              }
              return jsonResult({
                success: false,
                error:
                  "Action requires executive approval. An escalation has been automatically filed.",
                directive: `[NERVOUS_SYSTEM] Action blocked by Governance. Escalation ${escalationId} filed to Executives. Hibernate and await response.`,
              });
            }
            await patternLearner.recordApproval(
              approvalCheck.pattern?.patternHash || "unknown",
              projectName,
              "spawn-worker",
              { workerType, taskDescription },
              true,
            );

            const worker = createWorkerAgent(vault, workerType as WorkerType);
            const workerId = worker.getWorkerId();

            // Determine task id
            let taskId: string | null = (params.taskId as string) || null;
            if (!taskId) {
              taskId = `task-${Date.now()}`;
              const taskEntry = {
                id: taskId,
                path: `tasks/${taskId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName },
                type: "task",
                title: `Task for ${workerType}`,
                description: taskDescription,
                status: "in_progress",
                priority: "normal",
                assignee: workerId,
                tier: 3,
                doneMarker: false,
                doneMessage: null,
                completedAt: null,
                artifacts: [],
              };
              await vault.write(`tasks/${taskId}.json`, taskEntry);
            }

            const workerState = {
              id: workerId,
              path: `projects/${projectName}/workers/${workerId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { taskId, projectName },
              type: "worker" as const,
              agentId: workerId,
              role: "worker",
              tier: 3,
              status: "running" as const,
              lastWake: Date.now(),
              lastActivity: Date.now(),
              lastSleep: 0,
              currentTaskId: taskId,
              rewardPoints: 100,
              violations: [] as string[],
              capabilities: [workerType],
              sessionId: null as string | null,
            };

            // Dynamic workspace isolation
            const vaultPath = vault.getBasePath();
            const workerAgentAlias = `worker:${workerType}`;
            const workerWorkspace = `${vaultPath}/projects/${projectName}/workers/${workerId}`;

            await vault.write(`projects/${projectName}/workers/${workerId}.json`, workerState);

            try {
              const workerConfig = WORKER_CONFIGS[workerType];
              const taskPrompt = `# You are a ${workerConfig?.description || workerType}

Your capabilities: ${(workerConfig?.capabilities || []).join(", ")}

---

## THIS TASK

Project: ${projectName}
Description: ${taskDescription}

## Project Context
- You are working on project: ${projectName}
- Your memories and artifacts MUST go to: vault/projects/${projectName}/

## Completing Your Task
When you finish, output ONE of the following trigger lines — the Nervous System Gateway Interceptor will automatically route it to your manager:

- Success: Start a line with exactly: DONE: <brief summary of what you accomplished>
- Error: Start a line with exactly: ERRORS: <what went wrong>
- Blocked: Start a line with exactly: BLOCKER: <what is blocking you>

DO NOT attempt to call governance(complete-task) manually. DO NOT contact your manager directly.
The Interceptor will catch your trigger line and handle everything automatically.
`;
              const spawnResult = await spawnSubagentDirect(
                {
                  task: taskPrompt,
                  agentId: workerAgentAlias,
                  mode: "run",
                  label: `${projectName}-${workerType}`,
                  runTimeoutSeconds: 600,
                  workspaceDir: workerWorkspace,
                  agentDir: `${workerWorkspace}/agent`,
                },
                {
                  agentSessionKey: "agent:main",
                  requesterAgentIdOverride: `manager:${projectName}`,
                },
              );

              if (spawnResult.status === "accepted" && spawnResult.childSessionKey) {
                workerState.sessionId = spawnResult.childSessionKey;
                await vault.write(`projects/${projectName}/workers/${workerId}.json`, workerState);
              }
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              console.error(
                `Failed to spawn worker subagent [${workerType}] for project ${projectName}:`,
                errorMessage,
              );

              // Mark worker state as crashed so it doesn't stay 'awake' indefinitely without a session
              (workerState as Record<string, unknown>).status = "fault";
              workerState.violations.push(`Failed to spawn session: ${errorMessage}`);
              await vault.write(`projects/${projectName}/workers/${workerId}.json`, workerState);

              return jsonResult({
                success: false,
                error: `Failed to spawn worker subagent: ${errorMessage}`,
              });
            }
            return jsonResult({
              success: true,
              type: "worker-spawned",
              directive:
                "[NERVOUS_SYSTEM] Worker spawned. Yielding control. Call governance(hibernate) or pick up next task.",
              workerId,
              workerType,
            });
          }

          case "get-proposal-status": {
            const proposalId = params.proposalId as string;
            if (!proposalId) {
              return jsonResult({ success: false, error: "proposalId required" });
            }
            const collab = createExecutiveCollaboration(vault, proposalId);
            const result = await collab.getResult();
            return jsonResult({ success: true, type: "proposal-status", result });
          }

          case "hire-manager": {
            const projectName = params.projectName as string;
            const description = params.description as string;
            if (!projectName || !description) {
              return jsonResult({ success: false, error: "projectName and description required" });
            }

            // Check executive approval / reinforcement learning first
            const patternLearner = getPatternLearner(
              vault as unknown as import("../../skynet/vault/manager.js").VaultManager,
            );
            const approvalCheck = await patternLearner.checkAutoApprove(
              projectName,
              "hire-manager",
              { description },
            );

            if (approvalCheck.confidence < 80) {
              // Not approved by RL - force an escalation to executives
              const escalationId = `escalation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const escalation = {
                id: escalationId,
                path: `events/${escalationId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName },
                type: "event",
                eventType: "escalation:manager→executive",
                eventData: JSON.stringify({
                  question: `Requesting approval to hire manager for project ${projectName}: ${description}`,
                  projectName,
                }),
                recipient: "executive",
                timestamp: Date.now(),
                status: "pending",
                sender: "manager",
              };
              await vault.write(`events/${escalationId}.json`, escalation);
              // Immediately wake the executive agent so the escalation is not silently pending
              try {
                requestHeartbeatNow({ reason: "action:escalation", agentId: "oversight" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "monitor" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "optimizer" });
              } catch {
                /* heartbeat wake is best-effort */
              }
              return jsonResult({
                success: false,
                error:
                  "Action requires executive approval. An escalation has been automatically filed.",
                directive: `[NERVOUS_SYSTEM] Action blocked by Governance. Escalation ${escalationId} filed to Executives. Hibernate and await response.`,
              });
            }
            // Record successful execution of approved pattern
            await patternLearner.recordApproval(
              approvalCheck.pattern?.patternHash || "unknown",
              projectName,
              "hire-manager",
              { description },
              true,
            );

            const manager = createProjectManager(vault, projectName, description);
            await manager.initialize();
            const state = manager.getStatus();

            // Add manager to config with workspace
            const vaultPath = vault.getBasePath();
            const managerWorkspace = `${vaultPath}/agents/manager-${projectName}`;
            await ensureAgentInConfig(`manager:${projectName}`, managerWorkspace);

            // Also ensure main can spawn this manager
            await ensureManagerInMainAllowAgents(`manager:${projectName}`);

            // PROVISION AGENT CONFIG: Create agent/ directory with auth and models
            // This ensures the manager has the credentials it needs to run
            await ensureWorkerConfigFromMain(`manager:${projectName}`);

            // Also spawn the manager as an independent agent (not a subagent)
            try {
              const managerSystemPrompt = manager.getSystemPrompt();
              const managerSessionKey = `agent:manager-${projectName}:main`;

              const spawnResult = await callGateway<{ runId: string }>({
                method: "agent",
                params: {
                  sessionKey: managerSessionKey,
                  message: managerSystemPrompt || "[SYSTEM] Booting manager...",
                  idempotencyKey: `hire-manager-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  label: `Manager: ${projectName}`,
                },
                timeoutMs: 30_000,
              });

              if (spawnResult?.runId) {
                state.agentSessionId = managerSessionKey;
                await vault.write(state.path, state);
                return jsonResult({
                  success: true,
                  type: "manager-hired",
                  managerId: state.id,
                  projectName: state.projectName,
                  description,
                  agentSessionId: managerSessionKey,
                });
              } else {
                return jsonResult({
                  success: true,
                  type: "manager-hired",
                  managerId: state.id,
                  projectName: state.projectName,
                  description,
                  warning: "Manager created but failed to spawn agent",
                });
              }
            } catch (err) {
              return jsonResult({
                success: true,
                type: "manager-hired",
                managerId: state.id,
                projectName: state.projectName,
                description,
                warning: "Manager created but spawn error: " + String(err),
              });
            }
          }

          case "list-managers": {
            const projectDirs = await vault.listDirs("projects/");
            const managerList: Array<{ id: string; projectName: string; status: string }> = [];
            for (const dir of projectDirs) {
              const m = `projects/${dir}/manager.json`;
              const state = (await vault.read(m)) as unknown as {
                id: string;
                projectName: string;
                status: string;
              } | null;
              if (state) {
                managerList.push({
                  id: state.id,
                  projectName: state.projectName,
                  status: state.status,
                });
              }
            }
            return jsonResult({ success: true, type: "managers-list", managers: managerList });
          }

          case "get-my-task": {
            const workerId = params.workerId as string | undefined;
            const tasks = await vault.list("tasks/");
            for (const taskPath of tasks) {
              const task = await vault.read<{
                id: string;
                status: string;
                assignee?: string;
                title: string;
                description: string;
                path: string;
                createdAt: number;
                updatedAt: number;
                metadata: Record<string, unknown>;
              }>(`tasks/${taskPath}`);
              if (
                task &&
                task.status === "pending" &&
                (!task.assignee || task.assignee === workerId)
              ) {
                return jsonResult({ success: true, type: "task-found", taskPath, task });
              }
            }
            return jsonResult({
              success: true,
              type: "no-tasks",
              message: "No pending tasks available",
            });
          }

          case "check-in": {
            const projectName = params.projectName as string;
            const message = params.message as string;
            if (!projectName || !message) {
              return jsonResult({ success: false, error: "projectName and message required" });
            }

            const eventId = `checkin-${projectName}-${Date.now()}`;
            const event = {
              id: eventId,
              path: `events/${eventId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { projectName },
              type: "event",
              eventType: "manager-checkin",
              eventData: JSON.stringify({ message, projectName }),
              recipient: "main",
              timestamp: Date.now(),
              status: "pending",
              sender: `manager-${projectName}`,
            };
            await vault.write(`events/${eventId}.json`, event);

            // Wake main to process the check-in immediately
            try {
              requestHeartbeatNow({ reason: "manager-checkin", agentId: "main" });
            } catch {
              // best effort
            }

            return jsonResult({
              success: true,
              type: "check-in-sent",
              directive: "[NERVOUS_SYSTEM] Check-in delivered to Main Executive.",
            });
          }

          case "ask-executive": {
            const question = params.question as string | undefined;
            const msg = params.message as string | undefined;
            const proposedSolution = params.proposedSolution as string | undefined;
            const projName = params.projectName as string | undefined;

            const text = question || msg;
            if (!text) {
              return jsonResult({ success: false, error: "question or message required" });
            }

            const evtId = `escalate-${Date.now()}`;
            const evt = {
              id: evtId,
              path: `events/${evtId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { projectName: projName, proposedSolution },
              type: "event",
              eventType: "manager-escalation",
              eventData: JSON.stringify({ message: text, proposedSolution, projectName: projName }),
              recipient: "main",
              timestamp: Date.now(),
              status: "pending",
              sender: projName ? `manager-${projName}` : "system",
            };
            await vault.write(`events/${evtId}.json`, evt);

            try {
              requestHeartbeatNow({ reason: "manager-escalation", agentId: "main" });
            } catch {}

            return jsonResult({
              success: true,
              directive: "[NERVOUS_SYSTEM] Escalation delivered to Main Executive.",
            });
          }

          case "complete-task": {
            const taskPath = params.taskPath as string;
            const result = params.result as string;
            const _notifyMain = (params.notifyMain as boolean) ?? true;
            if (!taskPath || !result) {
              return jsonResult({ success: false, error: "taskPath and result required" });
            }
            const task = await vault.read<{
              id: string;
              status: string;
              doneMarker: boolean;
              doneMessage: string | null;
              completedAt: number | null;
              path: string;
              createdAt: number;
              updatedAt: number;
              metadata: Record<string, unknown>;
              assignee?: string | null;
              title?: string;
            }>(taskPath);
            if (task) {
              task.status = "in_review";
              task.doneMessage = result;
              await vault.write(taskPath, task as unknown as Parameters<typeof vault.write>[1]);

              // NERVOUS SYSTEM MESSAGE dispatch to Manager
              const projectName = task.metadata?.projectName as string | null;
              if (projectName) {
                const managerSessionKey = `agent:manager-${projectName}:main`;
                callGateway({
                  method: "agent",
                  params: {
                    sessionKey: managerSessionKey,
                    message: `[NERVOUS_SYSTEM] Worker finished task ${task.id} (${task.title || taskPath}).\nResult: ${result || "No result provided."}\nYou MUST review this work using governance(evaluate-worker-task) with evaluation="approved" or "rejected".`,
                    idempotencyKey: `ns-completion-${task.id}-${Date.now()}`,
                    label: `Manager: ${projectName}`,
                  },
                  timeoutMs: 15000,
                }).catch((err) =>
                  console.error("[Nervous System] Failed to route completion to manager:", err),
                );
              }

              return jsonResult({
                success: true,
                type: "task-submitted",
                taskPath,
                directive:
                  "[NERVOUS_SYSTEM] Task submitted for review. Hibernate and wait for Manager evaluation.",
              });
            }
            return jsonResult({ success: false, error: "Task not found" });
          }

          case "evaluate-worker-task": {
            const taskPath = params.taskPath as string;
            const evaluation = params.evaluation as "approved" | "rejected";
            const feedback = params.feedback as string;
            const notifyMain = (params.notifyMain as boolean) ?? true;

            if (!taskPath || !evaluation) {
              return jsonResult({ success: false, error: "taskPath and evaluation required" });
            }
            if (evaluation === "rejected" && (!feedback || feedback.trim() === "")) {
              return jsonResult({
                success: false,
                error: "feedback is required when rejecting a task",
              });
            }

            const task = await vault.read<{
              id: string;
              status: string;
              doneMarker: boolean;
              doneMessage: string | null;
              completedAt: number | null;
              path: string;
              createdAt: number;
              updatedAt: number;
              metadata: Record<string, unknown>;
              assignee?: string | null;
              title?: string;
            }>(taskPath);
            if (!task) {
              return jsonResult({ success: false, error: "Task not found" });
            }

            const assignee = task.assignee;
            const projectName = task.metadata?.projectName as string | null;
            let workerSessionId: string | null = null;
            let workerPath: string | null = null;

            if (assignee && projectName) {
              const workersPath = `projects/${projectName}/workers/`;
              const workerFiles = await vault.list(workersPath);
              const matchingWorker = workerFiles.find((wf) => wf.includes(assignee));

              if (matchingWorker) {
                workerPath = workersPath + matchingWorker;
                const worker = (await vault.read(workerPath)) as {
                  sessionId?: string;
                  status?: string;
                  completedAt?: number;
                  doneMessage?: string | null;
                } | null;
                if (worker) {
                  workerSessionId = worker.sessionId || null;
                  if (evaluation === "approved") {
                    await vault.delete(workerPath);
                  }
                }
              }
            }

            if (evaluation === "approved") {
              task.status = "completed";
              task.doneMarker = true;
              task.completedAt = Date.now();
              await vault.write(taskPath, task as unknown as Parameters<typeof vault.write>[1]);

              if (notifyMain) {
                const completionId = `task-completed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const completionEvent = {
                  id: completionId,
                  path: `events/${completionId}.json`,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  metadata: { taskPath, projectName },
                  type: "event",
                  eventType: "task-completed:manager→main",
                  eventData: JSON.stringify({
                    taskTitle: task.title || taskPath,
                    taskId: task.id,
                    projectName,
                    result: task.doneMessage,
                    completedAt: task.completedAt,
                  }),
                  recipient: "main",
                  timestamp: Date.now(),
                  status: "pending",
                };
                await vault.write(`events/${completionId}.json`, completionEvent);
              }

              // Route a dismissal message to the worker to formally close their session
              if (workerSessionId) {
                callGateway({
                  method: "agent",
                  params: {
                    sessionKey: workerSessionId,
                    message: `[NERVOUS_SYSTEM] Your work on task ${task.id} has been APPROVED by the manager. Your assignment is complete. You may hibernate.`,
                    idempotencyKey: `ns-approved-${task.id}-${Date.now()}`,
                    label: `Worker: ${assignee}`,
                  },
                  timeoutMs: 15000,
                }).catch((err) =>
                  console.error("[Nervous System] Failed to route approval to worker:", err),
                );
              }

              return jsonResult({
                success: true,
                type: "task-evaluated",
                evaluation,
                taskPath,
                notificationSent: notifyMain,
                directive: "[NERVOUS_SYSTEM] Task approved.",
              });
            } else {
              // Rejected
              task.status = "in_progress";
              task.doneMarker = false;
              await vault.write(taskPath, task as unknown as Parameters<typeof vault.write>[1]);

              // Route feedback directly back to the worker
              if (workerSessionId) {
                callGateway({
                  method: "agent",
                  params: {
                    sessionKey: workerSessionId,
                    message: `[NERVOUS_SYSTEM] WARNING: Your work on task ${task.id} was REJECTED by the manager.\nManager Feedback: ${feedback || "No feedback provided."}\nResume work on the task and address the feedback before calling complete-task again.`,
                    idempotencyKey: `ns-rejected-${task.id}-${Date.now()}`,
                    label: `Worker: ${assignee}`,
                  },
                  timeoutMs: 15000,
                }).catch((err) =>
                  console.error("[Nervous System] Failed to route rejection to worker:", err),
                );
              }

              return jsonResult({
                success: true,
                type: "task-evaluated",
                evaluation,
                taskPath,
                directive: `[NERVOUS_SYSTEM] Task rejected. Feedback sent to worker ${assignee}. Hibernate or continue managing.`,
              });
            }
          }

          case "hibernate": {
            const _projectName = params.projectName as string;
            return jsonResult({
              success: true,
              type: "hibernate",
              directive: `[NERVOUS_SYSTEM] Agent hibernating. Awaiting next stimulus.`,
            });
          }

          case "read-schedule": {
            const projectName = params.projectName as string;
            if (!projectName) {
              return jsonResult({ success: false, error: "projectName required" });
            }
            try {
              const schedule = await vault.read(`projects/${projectName}/SELF_GENERATION.md`);
              return jsonResult({
                success: true,
                type: "schedule",
                content: schedule,
                directive:
                  "[NERVOUS_SYSTEM] Schedule loaded. Evaluate whether it is time to spawn any tasks.",
              });
            } catch {
              return jsonResult({
                success: false,
                error: `No SELF_GENERATION.md found for ${projectName}`,
              });
            }
          }

          case "create-task": {
            const title = params.title as string;
            const description = params.description as string;
            const assignee = params.assignee as string | undefined;
            const priority = params.priority as string | undefined;
            const projectName = params.projectName as string | undefined;
            if (!title || !description) {
              return jsonResult({ success: false, error: "title and description required" });
            }

            // Check executive approval / reinforcement learning first
            const rLProjectName = projectName || "system";
            const patternLearner = getPatternLearner(
              vault as unknown as import("../../skynet/vault/manager.js").VaultManager,
            );
            const approvalCheck = await patternLearner.checkAutoApprove(
              rLProjectName,
              "create-task",
              { title, description, assignee, priority },
            );

            if (approvalCheck.confidence < 60) {
              // Not approved by RL - force an escalation to executives
              const escalationId = `escalation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const escalation = {
                id: escalationId,
                path: `events/${escalationId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName: rLProjectName },
                type: "event",
                eventType: "escalation:manager→executive",
                eventData: JSON.stringify({
                  question: `Requesting approval to create task: ${title}`,
                  projectName: rLProjectName,
                }),
                recipient: "executive",
                timestamp: Date.now(),
                status: "pending",
                sender: "manager",
              };
              await vault.write(`events/${escalationId}.json`, escalation);
              // Immediately wake the executive agent so the escalation is not silently pending
              try {
                requestHeartbeatNow({ reason: "action:escalation", agentId: "oversight" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "monitor" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "optimizer" });
              } catch {
                /* heartbeat wake is best-effort */
              }
              return jsonResult({
                success: false,
                error:
                  "Action requires executive approval. An escalation has been automatically filed.",
                directive: `[NERVOUS_SYSTEM] Action blocked by Governance. Escalation ${escalationId} filed to Executives. Hibernate and await response.`,
              });
            }
            await patternLearner.recordApproval(
              approvalCheck.pattern?.patternHash || "unknown",
              rLProjectName,
              "create-task",
              { title, description, assignee, priority },
              true,
            );

            const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            let assignedTo = assignee;
            let taskTier = assignee ? 3 : 2;

            if (projectName) {
              const managerPath = `projects/${projectName}/manager.json`;
              const manager = (await vault.read(managerPath)) as unknown as Record<
                string,
                unknown
              > | null;
              if (manager && manager.status === "active") {
                assignedTo = manager.id as string;
                taskTier = 2;
                manager.totalTasks = ((manager.totalTasks as number) || 0) + 1;
                await vault.write(
                  managerPath,
                  manager as unknown as Parameters<typeof vault.write>[1],
                );
              } else {
                assignedTo = `manager-${projectName}`;
                taskTier = 2;
              }
            }

            const task = {
              id: taskId,
              path: `tasks/${taskId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { projectName: projectName || null },
              type: "task",
              title,
              description,
              status: "pending" as const,
              priority: priority || "normal",
              assignee: assignedTo,
              tier: taskTier,
              doneMarker: false,
              doneMessage: null,
              completedAt: null,
              artifacts: [],
            };
            await vault.write(`tasks/${taskId}.json`, task);
            return jsonResult({
              success: true,
              type: "task-created",
              taskId,
              title,
              assignedTo: assignedTo || null,
              projectName: projectName || null,
            });
          }

          case "assign-task": {
            const taskId = params.taskId as string;
            const projectName = params.projectName as string;
            if (!taskId || !projectName) {
              return jsonResult({ success: false, error: "taskId and projectName required" });
            }

            // Check executive approval / reinforcement learning first
            const patternLearner = getPatternLearner(
              vault as unknown as import("../../skynet/vault/manager.js").VaultManager,
            );
            const approvalCheck = await patternLearner.checkAutoApprove(
              projectName,
              "assign-task",
              { taskId },
            );

            if (approvalCheck.confidence < 60) {
              // Not approved by RL - force an escalation to executives
              const escalationId = `escalation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const escalation = {
                id: escalationId,
                path: `events/${escalationId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { projectName },
                type: "event",
                eventType: "escalation:manager→executive",
                eventData: JSON.stringify({
                  question: `Requesting approval to assign task ${taskId} to project ${projectName}`,
                  projectName,
                }),
                recipient: "executive",
                timestamp: Date.now(),
                status: "pending",
                sender: "manager",
              };
              await vault.write(`events/${escalationId}.json`, escalation);
              // Immediately wake the executive agent so the escalation is not silently pending
              try {
                requestHeartbeatNow({ reason: "action:escalation", agentId: "oversight" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "monitor" });
                requestHeartbeatNow({ reason: "action:escalation", agentId: "optimizer" });
              } catch {
                /* heartbeat wake is best-effort */
              }
              return jsonResult({
                success: false,
                error:
                  "Action requires executive approval. An escalation has been automatically filed.",
                directive: `[NERVOUS_SYSTEM] Action blocked by Governance. Escalation ${escalationId} filed to Executives. Hibernate and await response.`,
              });
            }
            await patternLearner.recordApproval(
              approvalCheck.pattern?.patternHash || "unknown",
              projectName,
              "assign-task",
              { taskId },
              true,
            );

            const taskPath = `tasks/${taskId}.json`;
            const task = (await vault.read(taskPath)) as unknown as Record<string, unknown> | null;
            if (!task) {
              return jsonResult({ success: false, error: "Task not found" });
            }

            const managerPath = `projects/${projectName}/manager.json`;
            const manager = (await vault.read(managerPath)) as unknown as Record<
              string,
              unknown
            > | null;
            if (!manager) {
              return jsonResult({ success: false, error: "Manager not found" });
            }

            if (manager.status !== "active") {
              return jsonResult({ success: false, error: `Manager ${projectName} is not active` });
            }

            task.assignee = manager.id;
            task.tier = 2;
            task.metadata = {
              ...(task.metadata as Record<string, unknown>),
              projectName,
              assignedAt: Date.now(),
            };
            await vault.write(taskPath, task as unknown as Parameters<typeof vault.write>[1]);

            manager.totalTasks = ((manager.totalTasks as number) || 0) + 1;
            await vault.write(managerPath, manager as unknown as Parameters<typeof vault.write>[1]);

            return jsonResult({
              success: true,
              type: "task-assigned",
              taskId,
              managerId: manager.id,
              projectName,
            });
          }

          case "activate-manager": {
            const projectName = params.projectName as string;
            if (!projectName) {
              return jsonResult({ success: false, error: "projectName required" });
            }

            const managerPath = `projects/${projectName}/manager.json`;
            const manager = (await vault.read(managerPath)) as unknown as Record<
              string,
              unknown
            > | null;
            if (!manager) {
              return jsonResult({ success: false, error: `Manager ${projectName} not found` });
            }
            if (manager.status !== "active") {
              return jsonResult({ success: false, error: `Manager ${projectName} is not active` });
            }

            const allTasks = await vault.list("tasks/");
            const pendingTasks: Array<{
              id: string;
              title: string;
              description: string;
              path: string;
            }> = [];

            for (const t of allTasks) {
              if (!t.endsWith(".json")) {
                continue;
              }
              const task = (await vault.read(`tasks/${t}`)) as unknown as Record<
                string,
                unknown
              > | null;
              if (!task) {
                continue;
              }
              if (task.status !== "pending") {
                continue;
              }
              if (
                (task.assignee &&
                  typeof task.assignee === "string" &&
                  task.assignee.includes(projectName)) ||
                (task.metadata &&
                  typeof task.metadata === "object" &&
                  "projectName" in task.metadata &&
                  task.metadata.projectName === projectName)
              ) {
                pendingTasks.push({
                  id: task.id as string,
                  title: task.title as string,
                  description: task.description as string,
                  path: t,
                });
              }
            }

            if (pendingTasks.length === 0) {
              return jsonResult({
                success: true,
                type: "manager-activated",
                projectName,
                tasksStarted: 0,
                message: "No pending tasks",
              });
            }

            const workerTypes = Object.keys(WORKER_CONFIGS) as Array<keyof typeof WORKER_CONFIGS>;
            const started: string[] = [];

            for (const task of pendingTasks) {
              const taskTitle = task.title.toLowerCase();
              const taskDesc = task.description.toLowerCase();
              const combined = `${taskTitle} ${taskDesc}`;

              let workerType = "content";
              for (const wt of workerTypes) {
                if (
                  combined.includes(wt) ||
                  combined.includes(WORKER_CONFIGS[wt].description.toLowerCase())
                ) {
                  workerType = wt;
                  break;
                }
              }

              const workerId = `worker-${workerType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

              const workerState = {
                id: workerId,
                path: `projects/${projectName}/workers/${workerId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { taskId: task.id, projectName },
                type: "worker" as const,
                agentId: workerId,
                role: "worker",
                tier: 3,
                status: "awake" as const,
                lastWake: Date.now(),
                lastSleep: 0,
                currentTaskId: task.id,
                rewardPoints: 100,
                violations: [],
                capabilities: [workerType],
              };

              await vault.write(`projects/${projectName}/workers/${workerId}.json`, workerState);

              const taskUpdate = (await vault.read(task.path)) as unknown as Record<
                string,
                unknown
              >;
              if (taskUpdate) {
                taskUpdate.status = "in_progress";
                taskUpdate.assignee = workerId;
                taskUpdate.startedAt = Date.now();
                await vault.write(
                  task.path,
                  taskUpdate as unknown as Parameters<typeof vault.write>[1],
                );
              }

              manager.activeWorkers = [...((manager.activeWorkers as string[]) || []), task.id];
              started.push(`${task.id}:${workerType}`);

              // Immediately wake a subagent to begin processing this task
              const workerPrompt = `# You are a ${WORKER_CONFIGS[workerType as keyof typeof WORKER_CONFIGS]?.description || workerType}\n\nTask: ${task.description}\n\nComplete this task and report back using \`governance(complete-task)\`.`;
              const { callGateway } = await import("../../gateway/call.js");
              callGateway({
                method: "agent",
                params: {
                  sessionKey: `worker:${workerId}`,
                  message: workerPrompt,
                  idempotencyKey: `spawn-${workerId}`,
                  label: `Worker: ${workerType}`,
                  workspaceDir: `projects/${projectName}/workers/${workerId}`,
                  spawnedBy: manager.id,
                  execute: true,
                },
                timeoutMs: 0, // don't block tool execution
              }).catch((err) => console.error("[activate-manager] Worker spawn failed:", err));
            }

            manager.lastCheckIn = Date.now();
            await vault.write(managerPath, manager as unknown as Parameters<typeof vault.write>[1]);

            return jsonResult({
              success: true,
              type: "manager-activated",
              projectName,
              tasksStarted: started.length,
              workers: started,
            });
          }

          case "sync-manager": {
            const projectName = params.projectName as string;
            if (!projectName) {
              return jsonResult({ success: false, error: "projectName required" });
            }

            const managerPath = `projects/${projectName}/manager.json`;
            const manager = (await vault.read(managerPath)) as unknown as Record<
              string,
              unknown
            > | null;
            if (!manager) {
              return jsonResult({ success: false, error: `Manager ${projectName} not found` });
            }

            const allTasks = await vault.list("tasks/");
            const projectTasks: Array<{
              id: string;
              title: string;
              description: string;
              path: string;
              status: string;
              assignee?: string;
            }> = [];
            const activeWorkers: string[] = [];
            const syncedWorkers: string[] = [];

            for (const t of allTasks) {
              if (!t.endsWith(".json")) {
                continue;
              }
              const task = (await vault.read(`tasks/${t}`)) as unknown as Record<
                string,
                unknown
              > | null;
              if (!task) {
                continue;
              }
              // A task belongs to this project if its assignee explicitly binds to the manager
              // (e.g. "manager-system", "manager-system-123456", or "system")
              // or if the metadata explicitly tags it.
              const isAssigneeMatch =
                typeof task.assignee === "string" &&
                (task.assignee === `manager-${projectName}` ||
                  task.assignee.startsWith(`manager-${projectName}-`) ||
                  task.assignee === projectName ||
                  task.assignee.includes(manager.id as string));

              const isMetadataMatch =
                task.metadata &&
                typeof task.metadata === "object" &&
                "projectName" in task.metadata &&
                task.metadata.projectName === projectName;

              if (isAssigneeMatch || isMetadataMatch) {
                projectTasks.push({
                  id: task.id as string,
                  title: task.title as string,
                  description: task.description as string,
                  path: t,
                  status: task.status as string,
                  assignee: task.assignee as string | undefined,
                });
                if (task.status === "in_progress") {
                  activeWorkers.push(task.id as string);
                }
              }
            }

            const workerTypes = Object.keys(WORKER_CONFIGS);

            for (const task of projectTasks) {
              if (task.status === "in_progress" && task.assignee) {
                const workerId = task.assignee;
                const taskTitle = task.title.toLowerCase();
                const taskDesc = task.description.toLowerCase();
                const combined = `${taskTitle} ${taskDesc}`;

                let workerType = "content";
                for (const wt of workerTypes) {
                  const wtKey = wt as keyof typeof WORKER_CONFIGS;
                  if (
                    combined.includes(wt) ||
                    combined.includes(WORKER_CONFIGS[wtKey].description.toLowerCase())
                  ) {
                    workerType = wt;
                    break;
                  }
                }

                const existingWorkerPath = `projects/${projectName}/workers/${workerId}.json`;
                const existingWorker = await vault.read(existingWorkerPath);

                if (!existingWorker) {
                  const workerState = {
                    id: workerId,
                    path: existingWorkerPath,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    metadata: { taskId: task.id, projectName, synced: true },
                    type: "worker" as const,
                    agentId: workerId,
                    role: "worker",
                    tier: 3,
                    status: "awake" as const,
                    lastWake: Date.now(),
                    lastActivity: Date.now(),
                    lastSleep: 0,
                    currentTaskId: task.id,
                    rewardPoints: 100,
                    violations: [],
                    capabilities: [workerType],
                  };
                  await vault.write(existingWorkerPath, workerState);
                  syncedWorkers.push(`${task.id}:${workerType}`);
                }
              }
            }

            const tickInterval = (manager.tickIntervalMs as number) || 60000;
            manager.activeWorkers = activeWorkers;
            manager.lastCheckIn = Date.now();
            manager.lastTickAt = Date.now();
            manager.nextTickAt = Date.now() + tickInterval;
            manager.autoSpawn = manager.autoSpawn !== undefined ? manager.autoSpawn : true;
            manager.maxConcurrentWorkers = (manager.maxConcurrentWorkers as number) || 3;
            manager.workerTimeoutMs = (manager.workerTimeoutMs as number) || 600000;
            manager.maxRetries = (manager.maxRetries as number) || 2;

            await vault.write(managerPath, manager as unknown as Parameters<typeof vault.write>[1]);

            return jsonResult({
              success: true,
              type: "manager-synced",
              projectName,
              tasksFound: projectTasks.length,
              activeWorkers: activeWorkers.length,
              workersSynced: syncedWorkers.length,
              config: {
                autoSpawn: manager.autoSpawn,
                maxConcurrentWorkers: manager.maxConcurrentWorkers,
                tickIntervalMs: tickInterval,
                workerTimeoutMs: manager.workerTimeoutMs,
                maxRetries: manager.maxRetries,
              },
            });
          }

          case "run-worker": {
            const workerType = params.workerType as string;
            const task = params.task as string;
            if (!workerType || !task) {
              return jsonResult({ success: false, error: "workerType and task required" });
            }
            const config = WORKER_CONFIGS[workerType as keyof typeof WORKER_CONFIGS];
            if (!config) {
              return jsonResult({ success: false, error: `Unknown worker type: ${workerType}` });
            }

            const workerId = `worker-${workerType}-${Date.now()}`;
            const sessionId = `worker:${workerId}`;

            const workerPrompt = `# You are a ${config.description}\n\nYour capabilities: ${config.capabilities.join(", ")}\n\nModel preference: ${config.defaultModelPreference || "claude-sonnet-4-6"}\n\nTask: ${task}\n\nComplete this task and report back with:\n- What you accomplished\n- Any artifacts created\n- Any errors encountered\n\nUse the Skynet tools to complete your task. When done, summarize your work.`;

            const taskId = `task-${Date.now()}`;
            const taskEntry = {
              id: taskId,
              path: `tasks/${taskId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: {},
              type: "task",
              title: `Worker: ${workerType}`,
              description: task,
              status: "in_progress" as const,
              priority: "high",
              assignee: workerId,
              tier: 3,
              doneMarker: false,
              doneMessage: null,
              completedAt: null,
              artifacts: [],
            };
            await vault.write(`tasks/${taskId}.json`, taskEntry);

            return jsonResult({
              success: true,
              type: "worker-started",
              workerId,
              sessionId,
              workerType,
              task,
              taskId,
              prompt: workerPrompt,
              instructions: `To start the worker, use sessions_spawn with agentId="${sessionId}" and message="${encodeURIComponent(workerPrompt)}"`,
            });
          }

          case "exec-worker": {
            const workerType = params.workerType as string;
            const task = params.task as string;
            const projectName = (params.projectName as string) || "system";
            if (!workerType || !task) {
              return jsonResult({ success: false, error: "workerType and task required" });
            }
            const config = WORKER_CONFIGS[workerType as keyof typeof WORKER_CONFIGS];
            if (!config) {
              return jsonResult({ success: false, error: `Unknown worker type: ${workerType}` });
            }

            const workerId = `worker-${workerType}-${Date.now()}`;

            const workerPrompt = `# You are a ${config.description}\n\nYour capabilities: ${config.capabilities.join(", ")}\n\nModel: ${config.defaultModelPreference || "claude-sonnet-4-6"}\n\nTask: ${task}\n\nComplete this task. Use available tools. Report what you did.`;

            const taskId = `task-${Date.now()}`;
            const taskEntry = {
              id: taskId,
              path: `tasks/${taskId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: {},
              type: "task",
              title: `Worker: ${workerType}`,
              description: task,
              status: "in_progress" as const,
              priority: "high",
              assignee: workerId,
              tier: 3,
              doneMarker: false,
              doneMessage: null,
              completedAt: null,
              artifacts: [],
            };
            await vault.write(`tasks/${taskId}.json`, taskEntry);

            const workerState = {
              id: workerId,
              path: `projects/${projectName || "system"}/workers/${workerId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { projectName: projectName || "system" },
              type: "worker" as const,
              agentId: workerId,
              role: workerType,
              tier: 3,
              status: "awake" as const,
              lastWake: Date.now(),
              lastSleep: 0,
              currentTaskId: taskId,
              rewardPoints: 100,
              violations: [],
              capabilities: [workerType],
            };
            await vault.write(
              `projects/${projectName || "system"}/workers/${workerId}.json`,
              workerState,
            );

            return jsonResult({
              success: true,
              type: "worker-launched",
              workerId,
              workerType,
              task,
              taskId,
              message: `Worker ${workerType} launched with task ${taskId}`,
              spawnCommand: `Use sessions_spawn with agentId="worker:${workerId}" and message="${encodeURIComponent(workerPrompt)}"`,
            });
          }

          case "worker-status": {
            const workerId = params.workerId as string;
            if (!workerId) {
              return jsonResult({ success: false, error: "workerId required" });
            }
            // Search all project worker directories for this worker
            const projectDirs = await vault.listDirs("projects/").catch(() => [] as string[]);
            for (const proj of projectDirs) {
              const workerState = await vault.read<{
                id: string;
                status: string;
                currentTaskId?: string;
                lastWake?: number;
                lastSleep?: number;
                rewardPoints?: number;
                path: string;
                createdAt: number;
                updatedAt: number;
                metadata: Record<string, unknown>;
              }>(`projects/${proj}/workers/${workerId}.json`);
              if (workerState) {
                return jsonResult({
                  success: true,
                  type: "worker-status",
                  workerId,
                  status: workerState.status,
                  currentTaskId: workerState.currentTaskId,
                  rewardPoints: workerState.rewardPoints,
                });
              }
            }
            return jsonResult({ success: false, error: "Worker not found" });
          }

          case "list-workers": {
            // Search all project worker directories
            const projectDirs = await vault.listDirs("projects/").catch(() => [] as string[]);
            const workerList: Array<{
              id: string;
              status: string;
              currentTaskId?: string;
              project: string;
            }> = [];
            for (const proj of projectDirs) {
              const workers = await vault
                .list(`projects/${proj}/workers/`)
                .catch(() => [] as string[]);
              for (const w of workers) {
                if (w.endsWith(".json")) {
                  const workerState = await vault.read<{
                    id: string;
                    status: string;
                    currentTaskId?: string;
                    path: string;
                    createdAt: number;
                    updatedAt: number;
                    metadata: Record<string, unknown>;
                  }>(w);
                  if (workerState) {
                    workerList.push({
                      id: workerState.id,
                      status: workerState.status,
                      currentTaskId: workerState.currentTaskId,
                      project: proj,
                    });
                  }
                }
              }
            }
            return jsonResult({ success: true, type: "workers-list", workers: workerList });
          }

          case "system-status": {
            const managers = await vault.list("projects/");
            const workers = await vault.list("projects/system/workers/");
            const proposals = await vault.list("proposals/");
            const tasks = await vault.list("tasks/");

            const status = {
              uptime: os.uptime(),
              memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
              },
              cpuCount: os.cpus().length,
              platform: os.platform(),
              managersCount: managers.filter((m) => m.includes("/manager.json")).length,
              workersCount: workers.filter((w) => w.endsWith(".json")).length,
              proposalsCount: proposals.filter((p) => p.endsWith(".json")).length,
              pendingTasks: tasks.filter((t) => {
                const task = vault.read(t).catch(() => null);
                return task && task.then
                  ? task.then((t: unknown) => {
                      if (!t || typeof t !== "object" || !("status" in t)) {
                        return false;
                      }
                      if (t.status !== "pending") {
                        return false;
                      }
                      // Count it as pending if it's assigned to any valid manager format
                      const assignee =
                        "assignee" in t && typeof t.assignee === "string" ? t.assignee : "";
                      return (
                        assignee.startsWith("manager-") ||
                        ("metadata" in t &&
                          typeof t.metadata === "object" &&
                          t.metadata &&
                          "projectName" in t.metadata)
                      );
                    })
                  : false;
              }).length,
              timestamp: Date.now(),
            };
            return jsonResult({ success: true, type: "system-status", status });
          }

          case "get-system-info": {
            const vaultPath = "~/.skynet/vault";
            return jsonResult({
              success: true,
              type: "system-info",
              info: {
                vaultPath,
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                cpuCount: os.cpus().length,
                totalMemory: os.totalmem(),
                freeMemory: os.freemem(),
                uptime: os.uptime(),
              },
            });
          }

          case "send-event": {
            const eventType = params.eventType as string;
            const eventData = params.eventData as string;
            const recipient = params.recipient as string;
            if (!eventType || !eventData) {
              return jsonResult({ success: false, error: "eventType and eventData required" });
            }
            const eventId = `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const event = {
              id: eventId,
              path: `events/${eventId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: {},
              type: "event",
              eventType,
              eventData,
              recipient: recipient || "broadcast",
              timestamp: Date.now(),
            };
            await vault.write(`events/${eventId}.json`, event);
            return jsonResult({
              success: true,
              type: "event-sent",
              eventId,
              eventType,
              recipient: recipient || "broadcast",
            });
          }

          case "poll-events": {
            const since = (params.since as number) || Date.now() - 60000;
            const recipient = params.recipient as string;
            const events = await vault.list("events/");
            const relevantEvents: Array<{
              id: string;
              eventType: string;
              eventData: string;
              timestamp: number;
            }> = [];
            for (const e of events) {
              if (!e.endsWith(".json")) {
                continue;
              }
              const event = await vault.read<{
                id: string;
                eventType: string;
                eventData: string;
                timestamp: number;
                recipient: string;
                path: string;
                createdAt: number;
                updatedAt: number;
                metadata: Record<string, unknown>;
              }>(e);
              if (event && event.timestamp > since) {
                if (
                  !recipient ||
                  event.recipient === "broadcast" ||
                  event.recipient === recipient
                ) {
                  relevantEvents.push({
                    id: event.id,
                    eventType: event.eventType,
                    eventData: event.eventData,
                    timestamp: event.timestamp,
                  });
                }
              }
            }
            return jsonResult({
              success: true,
              type: "events",
              events: relevantEvents,
              count: relevantEvents.length,
            });
          }

          case "create-decision": {
            const escalationId = params.escalationId as string;
            const decision = params.decision as string;
            const question = (params.question as string) || "";
            const proposedSolution = (params.proposedSolution as string) || "";
            if (!escalationId || !decision) {
              return jsonResult({ success: false, error: "escalationId and decision required" });
            }
            const decisionId = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const decisionEntry = {
              id: decisionId,
              path: `decisions/${decisionId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: {},
              type: "escalation_decision",
              originalEscalationId: escalationId,
              escalationPath: ["worker", "manager", "executive", "user"],
              question,
              proposedSolution,
              decision,
              decidedBy: "user",
              decidedAt: Date.now(),
              status: "pending_propagation",
            };
            await vault.write(`decisions/${decisionId}.json`, decisionEntry);
            return jsonResult({ success: true, type: "decision-created", decisionId, decision });
          }

          case "propagate-decision": {
            const decisionId = params.decisionId as string;
            if (!decisionId) {
              return jsonResult({ success: false, error: "decisionId required" });
            }
            const decisionPath = `decisions/${decisionId}.json`;
            const decision = (await vault.read(decisionPath)) as unknown as Record<
              string,
              unknown
            > | null;
            if (!decision) {
              return jsonResult({ success: false, error: "Decision not found" });
            }
            if (decision.status !== "pending_propagation") {
              return jsonResult({ success: true, type: "decision-already-propagated", decisionId });
            }
            const escalationPath = (decision.escalationPath as string[]) || [
              "worker",
              "manager",
              "executive",
              "user",
            ];
            const propagated: string[] = [];
            for (let i = escalationPath.length - 2; i >= 0; i--) {
              const recipient = escalationPath[i];
              const responseId = `response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const responseEvent = {
                id: responseId,
                path: `events/${responseId}.json`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: { originalDecisionId: decisionId },
                type: "event",
                eventType: "response:user→executive",
                eventData: JSON.stringify({
                  decisionId,
                  decision: decision.decision,
                  question: decision.question,
                  escalationPath,
                }),
                recipient,
                timestamp: Date.now(),
                status: "pending",
              };
              await vault.write(`events/${responseId}.json`, responseEvent);
              propagated.push(recipient);
              // Immediately wake the recipient agent so the decision is not silently pending
              try {
                requestHeartbeatNow({ reason: "action:decision-propagated", agentId: recipient });
              } catch {
                /* best-effort wake */
              }
            }
            decision.status = "propagated";
            await vault.write(
              decisionPath,
              decision as unknown as Parameters<typeof vault.write>[1],
            );
            return jsonResult({
              success: true,
              type: "decision-propagated",
              decisionId,
              propagatedTo: propagated,
            });
          }

          case "fast-consult": {
            const request = params.request as string;
            const plan = params.plan as string;
            const taskType = (params.taskType as string) || "general";
            const context = (params.context as string) || "";
            if (!request || !plan) {
              return jsonResult({
                success: false,
                error: "request and plan required for fast-consult",
              });
            }
            const patternLearner = getPatternLearner(vault);
            const check = await patternLearner.checkAutoApprove(taskType, context, { plan });

            if (check.shouldAutoApprove) {
              return jsonResult({
                success: true,
                type: "fast-consult",
                autoApproved: true,
                confidence: check.confidence,
                message: `Auto-approved (pattern match: ${check.confidence}% confidence)`,
                result: {
                  approved: true,
                  votes: {},
                  improvements: [],
                  summary: "Auto-approved via pattern",
                },
              });
            }

            const result = await ExecutiveCollaboration.createAndRunCollaboration(
              vault,
              request,
              plan,
            );

            if (result.approved) {
              await patternLearner.recordApproval(
                `${taskType}:${context}`,
                taskType,
                context,
                { plan },
                true,
              );
            }

            return jsonResult({
              success: true,
              type: "fast-consult",
              autoApproved: false,
              confidence: check.confidence,
              patternSuggestion:
                check.confidence > 50
                  ? `Consider learning this pattern (${check.confidence}% approval history)`
                  : undefined,
              result,
            });
          }

          case "check-pattern": {
            const taskType = (params.taskType as string) || "general";
            const context = (params.context as string) || "";
            const patternLearner = getPatternLearner(vault);
            const check = await patternLearner.checkAutoApprove(taskType, context, {});
            return jsonResult({
              success: true,
              type: "pattern-check",
              shouldAutoApprove: check.shouldAutoApprove,
              confidence: check.confidence,
              pattern: check.pattern,
            });
          }

          case "learn-pattern": {
            const taskType = (params.taskType as string) || "general";
            const context = (params.context as string) || "";
            const success = (params.success as boolean) ?? true;
            const patternLearner = getPatternLearner(vault);
            const patternHash = `${taskType}:${context}`;

            if (success) {
              await patternLearner.recordApproval(patternHash, taskType, context, {}, true);
            } else {
              await patternLearner.recordRejection(
                patternHash,
                taskType,
                context,
                {},
                "Manual rejection",
              );
            }

            return jsonResult({
              success: true,
              type: "pattern-learned",
              taskType,
              context,
              wasSuccessful: success,
            });
          }

          case "list-patterns": {
            const patternLearner = getPatternLearner(vault);
            const patterns = await patternLearner.listPatterns();
            return jsonResult({
              success: true,
              type: "patterns-list",
              patterns: patterns.map((p) => ({
                taskType: p.taskType,
                context: p.context,
                confidence: p.confidence,
                approvalCount: p.approvalCount,
                rejectionCount: p.rejectionCount,
                autoApproved: p.autoApproved,
              })),
            });
          }

          case "submit-priority": {
            const title = params.title as string;
            const description = params.description as string;
            const category =
              (params.category as "task" | "idea" | "improvement" | "safety" | "urgent") || "task";
            const baseScore = (params.baseScore as number) || 50;
            const tagsStr = (params.tags as string) || "";
            const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : [];

            if (!title || !description) {
              return jsonResult({ success: false, error: "title and description required" });
            }

            const priorityBoard = getPriorityBoard(vault);
            const id = await priorityBoard.submitPriority(
              title,
              description,
              "main",
              category,
              baseScore,
              tags,
            );

            return jsonResult({ success: true, type: "priority-submitted", id, title });
          }

          case "vote-priority": {
            const priorityId = params.proposalId as string;
            const executive = params.executive as "main" | "oversight" | "monitor" | "optimizer";
            const score = (params.score as number) || 10;

            if (!priorityId || !executive) {
              return jsonResult({
                success: false,
                error: "priorityId, executive, and score required",
              });
            }

            const priorityBoard = getPriorityBoard(vault);
            await priorityBoard.vote(priorityId, executive, score);

            return jsonResult({
              success: true,
              type: "priority-voted",
              priorityId,
              executive,
              score,
            });
          }

          case "get-priorities": {
            const priorityBoard = getPriorityBoard(vault);
            const priorities = await priorityBoard.getPriorities(10);

            return jsonResult({
              success: true,
              type: "priorities-list",
              priorities: priorities.map((p) => ({
                id: p.priority.id,
                title: p.priority.title,
                description: p.priority.description,
                category: p.priority.category,
                submittedBy: p.priority.submittedBy,
                score: p.score,
                votes: p.priority.votes,
              })),
            });
          }

          case "resolve-priority": {
            const priorityId = params.proposalId as string;
            if (!priorityId) {
              return jsonResult({ success: false, error: "priorityId required" });
            }

            const { getPriorityBoard } = await import("../../skynet/governance/priority-board.js");
            const priorityBoard = getPriorityBoard(vault);
            await priorityBoard.resolvePriority(priorityId);

            return jsonResult({ success: true, type: "priority-resolved", priorityId });
          }

          case "start-tick-handlers": {
            const { getTickHandler } = await import("../../skynet/proactive/tick-handler.js");
            const tickHandler = getTickHandler(vault);
            await tickHandler.initialize();
            tickHandler.start(60000);

            return jsonResult({
              success: true,
              type: "tick-handlers-started",
              handlers: tickHandler.listHandlers().map((h) => h.name),
            });
          }

          case "stop-tick-handlers": {
            const { getTickHandler } = await import("../../skynet/proactive/tick-handler.js");
            const tickHandler = getTickHandler(vault);
            tickHandler.stop();

            return jsonResult({ success: true, type: "tick-handlers-stopped" });
          }

          case "list-tick-handlers": {
            const { getTickHandlerRegistry } =
              await import("../../skynet/proactive/tick-handler.js");
            const registry = getTickHandlerRegistry();
            const handlers = registry?.listHandlers();
            return jsonResult({
              success: true,
              type: "tick-handlers",
              handlers:
                handlers?.map(
                  (h: {
                    name: string;
                    description: string;
                    enabled: boolean;
                    lastRun: number;
                  }) => ({
                    name: h.name,
                    description: h.description,
                    enabled: h.enabled,
                    lastRun: h.lastRun,
                  }),
                ) || [],
            });
          }

          // Permission system for agent protocol enforcement
          case "check-permission": {
            const requestedAction = params.action as string;
            const agentType = (params.agentType as string) || "worker";
            if (!requestedAction) {
              return jsonResult({ success: false, error: "action required for check-permission" });
            }

            const permissions = getAgentPermissions(agentType);
            const hasPermission =
              permissions.includes(requestedAction) || permissions.includes("*");

            return jsonResult({
              success: true,
              type: "permission-check",
              action: requestedAction,
              agentType,
              hasPermission,
              requiredPermissions: permissions,
            });
          }

          case "request-permission": {
            const requestedAction = params.action as string;
            const agentType = (params.agentType as string) || "worker";
            const purpose = (params.purpose as string) || "unspecified";
            if (!requestedAction) {
              return jsonResult({
                success: false,
                error: "action required for request-permission",
              });
            }

            const permissions = getAgentPermissions(agentType);
            const hasPermission =
              permissions.includes(requestedAction) || permissions.includes("*");

            // Log permission request for audit
            const requestId = `perm-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const requestEvent = {
              id: requestId,
              path: `events/${requestId}.json`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              metadata: { agentType, purpose },
              type: "event",
              eventType: "permission-request",
              eventData: JSON.stringify({
                agentType,
                action: requestedAction,
                purpose,
                granted: hasPermission,
              }),
              recipient: "audit",
              timestamp: Date.now(),
              status: "pending",
            };
            await vault.write(`events/${requestId}.json`, requestEvent);

            return jsonResult({
              success: true,
              type: "permission-requested",
              requestId,
              action: requestedAction,
              agentType,
              purpose,
              granted: hasPermission,
              message: hasPermission
                ? `Action "${requestedAction}" is permitted for ${agentType}`
                : `Action "${requestedAction}" requires governance approval for ${agentType}. Use governance(ask-executive) to request.`,
            });
          }

          default:
            return jsonResult({ success: false, error: `Unknown action: ${action}` });
        }
      } catch (error) {
        return jsonResult({ success: false, error: String(error) });
      }
    },
  };
}
