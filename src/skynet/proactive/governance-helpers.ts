export const WORKER_CONFIGS = {
  content: {
    description: "Content Creator",
    capabilities: ["writing"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  thinker: {
    description: "Strategic Thinker",
    capabilities: ["analysis"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  research: {
    description: "Researcher",
    capabilities: ["search"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  developer: {
    description: "Developer",
    capabilities: ["coding"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  comms: {
    description: "Communications",
    capabilities: ["messaging"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  media: {
    description: "Media Specialist",
    capabilities: ["design"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  builder: {
    description: "Builder",
    capabilities: ["scaffolding"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
  tester: {
    description: "QA Tester",
    capabilities: ["testing"],
    defaultModelPreference: "claude-3-5-sonnet",
  },
};

export function createWorkerAgent(_vault: unknown, type: string) {
  return { getWorkerId: () => `worker-${type}-${Date.now()}` };
}

export function createProjectManager(_vault: unknown, name: string, description: string) {
  return {
    initialize: async () => {},
    getStatus: () => ({
      id: `manager-${name}`,
      path: `projects/${name}/manager.json`,
      projectName: name,
      status: "active",
      agentSessionId: undefined as string | undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    }),
    getSystemPrompt: () => `You are the manager for ${name}: ${description}`,
  };
}

export function getPatternLearner(_vault: unknown) {
  return {
    checkAutoApprove: async (_taskType: string, _context: string, _data: unknown) => ({
      shouldAutoApprove: true,
      confidence: 100,
      pattern: { patternHash: "test" },
    }),
    recordApproval: async (
      _hash: string,
      _type: string,
      _context: string,
      _data: unknown,
      _approved: boolean,
    ) => {},
    recordRejection: async (
      _hash: string,
      _type: string,
      _context: string,
      _data: unknown,
      _reason: string,
    ) => {},
    listPatterns: async () => [
      {
        taskType: "general",
        context: "none",
        confidence: 100,
        approvalCount: 1,
        rejectionCount: 0,
        autoApproved: true,
      },
    ],
  };
}

export function getPriorityBoard(_vault: unknown) {
  return {
    submitPriority: async (
      _title: string,
      _desc: string,
      _submitter: string,
      _category: string,
      _baseScore: number,
      _tags: string[],
    ) => "priority-test-123",
    vote: async (_priorityId: string, _executive: string, _score: number) => {},
    getPriorities: async (_limit: number) => [
      {
        priority: {
          id: "priority-test-123",
          title: "Test Priority",
          description: "A mock priority",
          category: "task",
          submittedBy: "main",
          votes: {},
        },
        score: 50,
      },
    ],
    resolvePriority: async (_priorityId: string) => {},
  };
}

export class ExecutiveCollaboration {
  static async createAndRunCollaboration(_vault: unknown, _request: string, _plan: string) {
    return { approved: true, feedback: "Approved by mock executive" };
  }
  constructor(
    private _vault: unknown,
    private _proposalId: string,
  ) {}
  async submitVote(_executive: string, _vote: string) {}
  async getResult() {
    return { approved: true };
  }
}

export function createExecutiveCollaboration(_vault: unknown, proposalId: string) {
  return new ExecutiveCollaboration(_vault, proposalId);
}

export function requestHeartbeatNow({
  reason: _reason,
  agentId: _agentId,
}: {
  reason: string;
  agentId: string;
}) {
  // Mock heartbeat request
}
