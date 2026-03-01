import type { VaultManager, ProposalEntry, VoteEntry } from "../../vault/index.js";
import type { ExecutiveRole } from "./executive.js";

export interface CollaborationResult {
  approved: boolean;
  votes: Record<ExecutiveRole, "approve" | "reject" | "abstain">;
  improvements: string[];
  summary: string;
}

const APPROVAL_THRESHOLD = 0.66;

export class ExecutiveCollaboration {
  private vault: VaultManager;
  private proposalId: string;

  constructor(vault: VaultManager, proposalId: string) {
    this.vault = vault;
    this.proposalId = proposalId;
  }

  static async createProposal(
    vault: VaultManager,
    request: string,
    plan: string,
    requester: ExecutiveRole = "main",
  ): Promise<string> {
    const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const proposal: ProposalEntry = {
      id: proposalId,
      path: `proposals/${proposalId}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "proposal",
      status: "pending",
      requester,
      request,
      plan,
      improvements: [],
      votes: { main: undefined, oversight: undefined, monitor: undefined, optimizer: undefined },
      approvedAt: null,
      rejectedAt: null,
    };
    await vault.write(`proposals/${proposalId}.json`, proposal);
    return proposalId;
  }

  async submitVote(
    executive: ExecutiveRole,
    vote: "approve" | "reject" | "abstain",
    notes?: string,
  ): Promise<void> {
    const proposal = await this.vault.read<ProposalEntry>(`proposals/${this.proposalId}.json`);
    if (!proposal || proposal.status !== "pending") {
      return;
    }

    const voteEntry: VoteEntry = {
      id: `vote-${executive}-${Date.now()}`,
      path: `votes/${executive}-${this.proposalId}.json`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
      type: "vote",
      proposalId: this.proposalId,
      voter: executive,
      vote,
      notes,
      timestamp: Date.now(),
    } as VoteEntry;

    proposal.votes[executive] = vote;
    proposal.updatedAt = Date.now();
    await this.vault.write(`proposals/${this.proposalId}.json`, proposal);
    await this.vault.write(
      `votes/${executive}-${this.proposalId}.json`,
      voteEntry as unknown as Parameters<typeof this.vault.write>[1],
    );

    await this.checkApproval();
  }

  async addImprovement(executive: ExecutiveRole, improvement: string): Promise<void> {
    const proposal = await this.vault.read<ProposalEntry>(`proposals/${this.proposalId}.json`);
    if (!proposal || proposal.status !== "pending") {
      return;
    }

    proposal.improvements.push(`[${executive}] ${improvement}`);
    proposal.updatedAt = Date.now();
    await this.vault.write(`proposals/${this.proposalId}.json`, proposal);
  }

  async checkApproval(): Promise<boolean> {
    const proposal = await this.vault.read<ProposalEntry>(`proposals/${this.proposalId}.json`);
    if (!proposal || proposal.status !== "pending") {
      return false;
    }

    const executives: ExecutiveRole[] = ["main", "oversight", "monitor", "optimizer"];
    const weights: Record<ExecutiveRole, number> = {
      main: 2,
      oversight: 1,
      monitor: 1,
      optimizer: 1,
    };

    let totalWeight = 0;
    let approvedWeight = 0;

    for (const exec of executives) {
      const vote = proposal.votes[exec];
      if (vote === "approve") {
        approvedWeight += weights[exec];
      }
      if (vote === "approve" || vote === "reject") {
        totalWeight += weights[exec];
      }
    }

    if (totalWeight < 3) {
      return false;
    }

    const approvalRatio = approvedWeight / totalWeight;
    const approved = approvalRatio >= APPROVAL_THRESHOLD;

    if (approved) {
      proposal.status = "approved";
      proposal.approvedAt = Date.now();
    } else {
      const rejects = executives.filter((e) => proposal.votes[e] === "reject");
      if (rejects.length >= 2) {
        proposal.status = "rejected";
        proposal.rejectedAt = Date.now();
      }
    }

    proposal.updatedAt = Date.now();
    await this.vault.write(`proposals/${this.proposalId}.json`, proposal);

    // Move approved/rejected proposals to appropriate folders
    if (proposal.status === "approved") {
      const decisionPath = `decisions/${this.proposalId}.json`;
      await this.vault.write(decisionPath, proposal);
      await this.vault.delete(`proposals/${this.proposalId}.json`);
    } else if (proposal.status === "rejected") {
      const rejectedPath = `rejected/${this.proposalId}.json`;
      await this.vault.write(rejectedPath, proposal);
      await this.vault.delete(`proposals/${this.proposalId}.json`);
    }

    return approved;
  }

  async getResult(): Promise<CollaborationResult> {
    const proposal = await this.vault.read<ProposalEntry>(`proposals/${this.proposalId}.json`);
    if (!proposal) {
      return {
        approved: false,
        votes: { main: "abstain", oversight: "abstain", monitor: "abstain", optimizer: "abstain" },
        improvements: [],
        summary: "Proposal not found",
      };
    }

    return {
      approved: proposal.status === "approved",
      votes: proposal.votes as Record<ExecutiveRole, "approve" | "reject" | "abstain">,
      improvements: proposal.improvements,
      summary:
        proposal.status === "approved"
          ? `Approved at ${new Date(proposal.approvedAt!).toISOString()}`
          : proposal.status === "rejected"
            ? `Rejected at ${new Date(proposal.rejectedAt!).toISOString()}`
            : "Pending review",
    };
  }

  static async createAndRunCollaboration(
    vault: VaultManager,
    request: string,
    plan: string,
    requester: ExecutiveRole = "main",
  ): Promise<CollaborationResult> {
    const proposalId = await this.createProposal(vault, request, plan, requester);
    const collaboration = new ExecutiveCollaboration(vault, proposalId);

    const executives: ExecutiveRole[] = ["oversight", "monitor", "optimizer"];

    const { runEmbeddedPiAgent } = await import("../../../agents/pi-embedded-runner/run.js");
    const { createExecutiveAgent } = await import("./executive.js");
    const { resolveStateDir } = await import("../../../config/paths.js");
    const path = await import("node:path");
    const workspaceDir = path.join(resolveStateDir(), "workspace");

    const tasks = executives.map(async (exec) => {
      try {
        const agent = createExecutiveAgent(vault, exec);
        const prompt = `You have been asked to review a proposal from the ${requester} executive.
        
REQUEST:
${request}

PROPOSED PLAN:
${plan}

Evaluate this proposal against your specific directives and responsibilities.

Reply format MUST be exactly:
VOTE: <APPROVE|REJECT|ABSTAIN>
REASON: <Provide brief, actionable feedback or improvements based on your role>`;

        const sessionId = `eval-${exec}-${Date.now()}`;
        const sessionFile = path.join(workspaceDir, "sessions", `${sessionId}.jsonl`);

        const result = await runEmbeddedPiAgent({
          sessionId,
          sessionFile,
          workspaceDir,
          messageChannel: "governance",
          prompt,
          extraSystemPrompt: agent.getSystemPrompt(),
          runId: `proposal-${proposalId}-${exec}`,
          disableMessageTool: true,
          timeoutMs: 60000,
        });

        const outputs =
          result.payloads
            ?.filter((p: { text?: string }) => p.text)
            .map((p: { text?: string }) => p.text) || [];
        const text = outputs.join("\n").trim();

        let vote: "approve" | "reject" | "abstain" = "abstain";
        let reason = "No reason provided.";

        if (text) {
          const voteMatch = text.match(/VOTE:\s*(APPROVE|REJECT|ABSTAIN)/i);
          if (voteMatch && voteMatch[1]) {
            vote = voteMatch[1].toLowerCase() as "approve" | "reject" | "abstain";
          }
          const reasonMatch = text.match(/REASON:\s*([\s\S]*)/i);
          if (reasonMatch && reasonMatch[1]) {
            reason = reasonMatch[1].trim();
          } else {
            reason = text;
          }
        }

        if (reason && reason !== "No reason provided.") {
          await collaboration.addImprovement(exec, reason);
        }
        await collaboration.submitVote(exec, vote, reason);
      } catch (err) {
        console.error(`[Collaboration] ${exec} failed to vote:`, err);
        await collaboration.submitVote(exec, "abstain", "Error during evaluation");
      }
    });

    await Promise.all(tasks);
    await new Promise((resolve) => setTimeout(resolve, 50));

    return collaboration.getResult();
  }
}

export function createExecutiveCollaboration(
  vault: VaultManager,
  proposalId: string,
): ExecutiveCollaboration {
  return new ExecutiveCollaboration(vault, proposalId);
}
