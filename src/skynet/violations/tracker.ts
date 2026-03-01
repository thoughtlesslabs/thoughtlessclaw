import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ContractType =
  | "done_prefix"
  | "artifact_logging"
  | "timeout"
  | "vault_first"
  | "approval_required"
  | "governance";

export interface ViolationRule {
  type: ContractType;
  description: string;
  penalty: number;
  pattern?: RegExp;
}

export const CONTRACT_RULES: Record<ContractType, ViolationRule> = {
  done_prefix: {
    type: "done_prefix",
    description: "Task completion must start with DONE:",
    penalty: 10,
  },
  artifact_logging: {
    type: "artifact_logging",
    description: "Completed tasks must log at least one artifact",
    penalty: 5,
  },
  timeout: {
    type: "timeout",
    description: "Task must complete within allocated time",
    penalty: 15,
  },
  vault_first: {
    type: "vault_first",
    description: "Must read/write state to Vault, not ephemeral context",
    penalty: 20,
  },
  approval_required: {
    type: "approval_required",
    description: "High-risk actions require Triad Council approval",
    penalty: 25,
  },
  governance: {
    type: "governance",
    description: "Turn MUST conclude by calling a governance tool or physical hook",
    penalty: 10,
  },
};

export interface ViolationPatterns {
  version: number;
  patterns: ViolationPattern[];
}

export interface ViolationPattern {
  type: ContractType;
  occurrenceCount: number;
  firstSeen: number;
  lastSeen: number;
  examples: string[];
}

export class ViolationTracker {
  private basePath: string;
  private patterns: ViolationPatterns;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.patterns = {
      version: 1,
      patterns: [],
    };
  }

  async initialize(): Promise<void> {
    const fullPath = path.join(this.basePath, "contracts", "violation_patterns.json");
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      this.patterns = JSON.parse(content);
    } catch {
      await this.savePatterns();
    }
  }

  private async savePatterns(): Promise<void> {
    const fullPath = path.join(this.basePath, "contracts", "violation_patterns.json");
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(this.patterns, null, 2));
  }

  async recordViolation(
    agentId: string,
    type: ContractType,
    details: string,
    severity: "minor" | "major" | "critical" = "major",
  ): Promise<number> {
    const rule = CONTRACT_RULES[type];
    const violation = {
      id: `violation-${Date.now()}-${randomUUID().slice(0, 8)}`,
      path: `contracts/violation-${Date.now()}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "violation" as const,
      agentId,
      contractType: type,
      violation: rule.description,
      severity,
      rewardDeduction: rule.penalty,
      details,
      corrected: false,
      correctionNote: null,
    };

    const fullPath = path.join(this.basePath, violation.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(violation, null, 2));

    await this.updatePatterns(type, details);

    return rule.penalty;
  }

  private async updatePatterns(type: ContractType, details: string): Promise<void> {
    let pattern = this.patterns.patterns.find((p) => p.type === type);

    if (!pattern) {
      pattern = {
        type,
        occurrenceCount: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        examples: [],
      };
      this.patterns.patterns.push(pattern);
    }

    pattern.occurrenceCount++;
    pattern.lastSeen = Date.now();

    if (pattern.examples.length < 5) {
      pattern.examples.push(details.slice(0, 200));
    }

    await this.savePatterns();
  }

  async markCorrected(violationId: string, correctionNote: string): Promise<void> {
    const fullPath = path.join(this.basePath, "contracts", `${violationId}.json`);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const violation = JSON.parse(content);
      violation.corrected = true;
      violation.correctionNote = correctionNote;
      await fs.writeFile(fullPath, JSON.stringify(violation, null, 2));
    } catch {
      // File not found
    }
  }

  getPatterns(): ViolationPattern[] {
    return this.patterns.patterns;
  }

  async getCorrectionGuidelines(): Promise<string> {
    const patterns = this.getPatterns();
    if (patterns.length === 0) {
      return "No violation patterns recorded.";
    }

    const sorted = patterns.slice().toSorted((a, b) => b.occurrenceCount - a.occurrenceCount);
    const guidelines = [
      "# Self-Correction Guidelines",
      "",
      "Review these patterns and avoid them:",
    ];

    for (const pattern of sorted.slice(0, 5)) {
      const rule = CONTRACT_RULES[pattern.type];
      guidelines.push(`\n## ${rule.description}`);
      guidelines.push(`- Occurrences: ${pattern.occurrenceCount}`);
      if (pattern.examples.length > 0) {
        guidelines.push("- Examples:");
        for (const ex of pattern.examples.slice(0, 2)) {
          guidelines.push(`  - "${ex}"`);
        }
      }
    }

    return guidelines.join("\n");
  }
}

export function createViolationTracker(basePath: string): ViolationTracker {
  return new ViolationTracker(basePath);
}
