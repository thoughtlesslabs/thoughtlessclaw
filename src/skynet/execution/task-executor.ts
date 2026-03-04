import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ModelRef } from "../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded-runner/run.js";
import type { EmbeddedPiRunResult } from "../../agents/pi-embedded-runner/types.js";
import type { SkynetConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import type { TaskEntry } from "../vault/types.js";

export interface TaskExecutorConfig {
  workspaceDir?: string;
  config?: SkynetConfig;
  defaultTimeoutMs?: number;
  systemPrompt?: string;
}

export interface TaskExecutionResult {
  success: boolean;
  output: string;
  artifacts: { name: string; path: string; description: string }[];
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}

export class TaskExecutor {
  private workspaceDir: string;
  private config: SkynetConfig | undefined;
  private defaultTimeoutMs: number;
  private systemPrompt: string;
  private sessionCache = new Map<string, string>();

  constructor(config: TaskExecutorConfig = {}) {
    // workspaceDir MUST be provided by caller (who knows the agent context)
    // Do NOT default to global workspace - each agent has its own workspace
    this.workspaceDir =
      config.workspaceDir || path.join(resolveStateDir(), ".skynet", "agents", "system");
    this.config = config.config;
    this.defaultTimeoutMs = config.defaultTimeoutMs || 120000;
    this.systemPrompt = config.systemPrompt || this.buildDefaultSystemPrompt();
  }

  private buildDefaultSystemPrompt(): string {
    return `# Skynet Worker Agent

You are a Tier 3 autonomous worker agent in the Skynet OS. Your role is to execute tasks efficiently and report results.

---

## Compliance Rules

Your work is monitored by the governance system. Non-compliance results in violations recorded permanently against your agent state.

### Completion Contract (MANDATORY)

Every completed task MUST use this exact format — **no exceptions**:

\`\`\`
DONE: <summary of what was accomplished>

ARTIFACTS:
- <filename>: <description>

ERRORS: (if any)
- <error description>
\`\`\`

**Violations triggered by non-compliance:**
- Missing \`DONE:\` prefix → \`completion\` violation (major, −10 reward points)
- Unlogged artifacts → \`completion\` violation (minor, warning)

### Task Scope

- You operate **only** within your assigned task
- Do not modify state outside your task scope
- Do not create tasks or spawn other agents
- Work efficiently: solve the task, report results, stop

**Violation:** Operating outside task scope → \`scope\` violation (major)

### Resource Limits

- Token usage is tracked for every task execution
- Excessive consumption triggers \`budget\` violations
- Task timeout triggers \`timeout\` violation (major)

### Reporting Chain

- Your output is reviewed by your Project Manager
- Results are written to the vault task file
- Escalation goes through your manager, not directly to executives

---

## Current Date
${new Date().toISOString()}
`;
  }

  async executeTask(
    task: TaskEntry,
    modelRef?: ModelRef,
    customPrompt?: string,
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const sessionId = `skynet-${task.id}-${Date.now()}`;
    const sessionFile = path.join(this.workspaceDir, "sessions", `${sessionId}.jsonl`);
    const runId = randomUUID();

    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, "", "utf-8");

    const prompt = customPrompt || this.buildTaskPrompt(task);

    try {
      const result = await runEmbeddedPiAgent({
        sessionId,
        sessionFile,
        workspaceDir: this.workspaceDir,
        config: this.config,
        prompt,
        provider: modelRef?.provider,
        model: modelRef?.model,
        timeoutMs: this.defaultTimeoutMs,
        runId,
        disableMessageTool: true,
        onAgentEvent: (evt) => {
          if (evt.stream === "error") {
            console.error(`[TaskExecutor] Agent error:`, evt.data);
          }
        },
      });

      const tokensUsed = result.meta.agentMeta?.usage?.total || 0;
      const output = this.extractOutputFromResult(result);
      const artifacts = this.extractArtifactsFromResult(result);

      await this.cleanupSession(sessionId);

      return {
        success: result.meta.error === undefined,
        output,
        artifacts,
        tokensUsed,
        latencyMs: Date.now() - startTime,
        error: result.meta.error?.message,
      };
    } catch (err) {
      await this.cleanupSession(sessionId);

      return {
        success: false,
        output: "",
        artifacts: [],
        tokensUsed: 0,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private buildTaskPrompt(task: TaskEntry): string {
    return `# Task Execution

## Task ID
${task.id}

## Title
${task.title}

## Description
${task.description}

## Priority
${task.priority}

${task.parentTaskId ? `## Parent Task\n${task.parentTaskId}` : ""}

## Instructions

1. Read and understand the task
2. Execute the work using available tools
3. Create any necessary output files
4. Report completion using the **mandatory** format below

## Completion Format (MANDATORY — non-compliance triggers violations)

\`\`\`
DONE: <summary of what was accomplished>

ARTIFACTS:
- <filename>: <description>

ERRORS: (if any)
- <error description>
\`\`\`

> You MUST use the \`DONE:\` prefix. Missing it triggers a \`completion\` violation.
> All created files MUST be listed under ARTIFACTS.
`;
  }

  private extractOutputFromResult(result: EmbeddedPiRunResult): string {
    if (!result.payloads || result.payloads.length === 0) {
      return "";
    }

    const texts = result.payloads
      .filter((p: { text?: string }) => p.text)
      .map((p: { text?: string }) => p.text!);

    return texts.join("\n\n");
  }

  private extractArtifactsFromResult(
    result: EmbeddedPiRunResult,
  ): { name: string; path: string; description: string }[] {
    const output = this.extractOutputFromResult(result);
    const artifacts: { name: string; path: string; description: string }[] = [];

    const artifactRegex = /ARTIFACTS:\s*\n((?:- .+:\s*.+\n?)+)/g;
    let match;

    while ((match = artifactRegex.exec(output)) !== null) {
      const artifactLines = match[1].trim().split("\n");
      for (const line of artifactLines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          const name = line.slice(1, colonIndex).trim();
          const description = line.slice(colonIndex + 1).trim();
          artifacts.push({
            name,
            path: name,
            description,
          });
        }
      }
    }

    return artifacts;
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const sessionFile = path.join(this.workspaceDir, "sessions", `${sessionId}.jsonl`);
    try {
      await fs.rm(sessionFile, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }
}

export function createTaskExecutor(config?: TaskExecutorConfig): TaskExecutor {
  return new TaskExecutor(config);
}
