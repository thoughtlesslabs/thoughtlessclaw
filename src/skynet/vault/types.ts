export type VaultPath = string;

export interface VaultEntry {
  id: string;
  path: VaultPath;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface MemoryEntry extends VaultEntry {
  type: "memory";
  date: string;
  summary: string;
  events: MemoryEvent[];
  tasksCompleted: string[];
  tasksPending: string[];
  learnings: string[];
}

export interface MemoryEvent {
  timestamp: number;
  type: "task" | "decision" | "error" | "goal" | "interaction";
  description: string;
  agentId: string;
}

export interface HeartbeatEntry extends VaultEntry {
  type: "heartbeat";
  agentId: string;
  status: "awake" | "sleeping" | "working" | "error";
  timestamp: number;
  metrics: HeartbeatMetrics;
  pendingTasks: string[];
  lastTask: string | null;
}

export interface HeartbeatMetrics {
  tokensUsed: number;
  tokensBudget: number;
  contextUsagePercent: number;
  activeAgents: number;
  uptime: number;
  errors: number;
}

export interface InboxEntry extends VaultEntry {
  type: "inbox";
  source: "human" | "channel" | "scheduler" | "webhook" | "agent";
  priority: "critical" | "high" | "normal" | "low";
  status: "pending" | "in_progress" | "completed" | "blocked";
  request: string;
  context: string;
  from: string;
  requiresApproval: boolean;
  approvedBy: string[];
}

export interface TaskEntry extends VaultEntry {
  type: "task";
  title: string;
  description: string;
  status: "queued" | "assigned" | "in_progress" | "completed" | "failed" | "blocked";
  priority: "critical" | "high" | "normal" | "low";
  assignee: string | null;
  tier: 1 | 2 | 3;
  parentTaskId: string | null;
  subtasks: string[];
  dependencies: string[];
  createdBy: string;
  assignedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  artifacts: Artifact[];
  doneMarker: boolean;
  doneMessage: string | null;
}

export interface Artifact {
  id: string;
  type: "file" | "code" | "data" | "report" | "decision";
  name: string;
  path: string;
  description: string;
  createdAt: number;
}

export interface ViolationEntry extends VaultEntry {
  type: "violation";
  agentId: string;
  contractType: string;
  violation: string;
  severity: "minor" | "major" | "critical";
  rewardDeduction: number;
  details: string;
  corrected: boolean;
  correctionNote: string | null;
}

export interface AgentState extends VaultEntry {
  type: "agent_state";
  agentId: string;
  role: "executive" | "manager" | "worker";
  tier: 1 | 2 | 3;
  status: "awake" | "sleeping" | "working" | "waiting";
  lastWake: number;
  lastSleep: number;
  currentTaskId: string | null;
  rewardPoints: number;
  violations: string[];
  capabilities: string[];
}

export interface VoteEntry extends VaultEntry {
  type: "vote";
  voteId: string;
  proposal: string;
  description: string;
  proposer: string;
  votes: Vote[];
  threshold: number;
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: number;
}

export interface Vote {
  agentId: string;
  role: string;
  vote: "yes" | "no" | "abstain";
  reason: string;
  timestamp: number;
}

export interface BudgetEntry extends VaultEntry {
  type: "budget";
  agentId: string;
  period: "hourly" | "daily" | "weekly";
  tokenLimit: number;
  tokensUsed: number;
  tokenHistory: TokenUsage[];
  throttleUntil: number | null;
}

export interface TokenUsage {
  timestamp: number;
  tokens: number;
  model: string;
  taskId: string;
}

export interface VaultConfig {
  vaultPath: string;
  heartbeatIntervalMs: number;
  idleSleepThresholdMs: number;
  contextThresholdPercent: number;
  defaultTokenBudget: number;
  violationPenalty: number;
  rewardStartingPoints: number;
  triadThreshold: number;
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  vaultPath: "~/.skynet/vault",
  heartbeatIntervalMs: 60000,
  idleSleepThresholdMs: 300000,
  contextThresholdPercent: 75,
  defaultTokenBudget: 1000000,
  violationPenalty: 10,
  rewardStartingPoints: 100,
  triadThreshold: 0.66,
};

export type ProjectType = "system" | "project";

export interface ProjectEntry extends VaultEntry {
  type: "project";
  name: string;
  projectType: ProjectType;
  description: string;
  status: "active" | "paused" | "completed" | "cancelled";
  createdBy: string;
  createdAt: number;
  managerId: string | null;
  tasks: string[];
  workers: string[];
}

export interface ProjectManagerState extends VaultEntry {
  type: "project_manager";
  projectName: string;
  projectType: ProjectType;
  status: "initializing" | "active" | "waiting" | "paused";
  currentTaskId: string | null;
  activeWorkers: string[];
  completedTasks: number;
  totalTasks: number;
  lastCheckIn: number;
  blockers: string[];
  tickIntervalMs?: number;
  maxConcurrentWorkers?: number;
  autoSpawn?: boolean;
  workerTimeoutMs?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
  lastTickAt?: number;
  nextTickAt?: number;
  agentSessionId?: string;
}

export interface ProposalEntry extends VaultEntry {
  type: "proposal";
  status: "pending" | "approved" | "rejected" | "escalated";
  requester: "main" | "oversight" | "monitor" | "optimizer";
  request: string;
  plan: string;
  improvements: string[];
  votes: Record<
    "main" | "oversight" | "monitor" | "optimizer",
    "approve" | "reject" | "abstain" | "escalate" | undefined
  >;
  approvedAt: number | null;
  rejectedAt: number | null;
}

export interface VoteEntry extends VaultEntry {
  type: "vote";
  proposalId: string;
  voter: "main" | "oversight" | "monitor" | "optimizer";
  vote: "approve" | "reject" | "abstain" | "escalate";
  notes: string | undefined;
  timestamp: number;
}

export interface DecisionEntry extends VaultEntry {
  type: "decision";
  proposalId: string;
  finalPlan: string;
  improvements: string[];
  status: "approved" | "blocked" | "executed";
  executedAt: number | null;
}

export interface RoutingPattern {
  requestPattern: string;
  classification: "system" | "project";
  projectName?: string;
  confidence: number;
  triadsCorrection: boolean;
  matchCount: number;
  lastMatched: number;
}

export interface LearningEntry extends VaultEntry {
  type: "learning";
  patterns: RoutingPattern[];
  lastUpdated: number;
}
