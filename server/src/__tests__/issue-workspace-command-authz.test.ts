import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const mockIssueService = vi.hoisted(() => ({
  addComment: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  create: vi.fn(),
  findMentionedAgents: vi.fn(),
  getByIdentifier: vi.fn(),
  getById: vi.fn(),
  getRelationSummaries: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  update: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(async () => true),
  getMembership: vi.fn(async () => null),
  hasPermission: vi.fn(async () => true),
  setPrincipalPermission: vi.fn(async () => undefined),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: (...args: Parameters<typeof mockAccessService.canUser>) => mockAccessService.canUser(...args),
    getMembership: (...args: Parameters<typeof mockAccessService.getMembership>) =>
      mockAccessService.getMembership(...args),
    hasPermission: (...args: Parameters<typeof mockAccessService.hasPermission>) =>
      mockAccessService.hasPermission(...args),
    setPrincipalPermission: (...args: Parameters<typeof mockAccessService.setPrincipalPermission>) =>
      mockAccessService.setPrincipalPermission(...args),
  }),
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({
    getById: vi.fn(async () => null),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
    getRun: vi.fn(async () => null),
    getActiveRunForAgent: vi.fn(async () => null),
    cancelRun: vi.fn(async () => null),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    companyId: "company-1",
    status: "todo",
    priority: "medium",
    projectId: null,
    goalId: null,
    parentId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByUserId: "board-user",
    identifier: "PAP-1000",
    title: "Workspace authz",
    executionPolicy: null,
    executionState: null,
    executionWorkspaceId: null,
    hiddenAt: null,
    ...overrides,
  };
}

describe("issue workspace command authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockAgentService.getById.mockResolvedValue(null);
    mockIssueService.addComment.mockResolvedValue(null);
    mockIssueService.create.mockResolvedValue(makeIssue());
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.update.mockResolvedValue(makeIssue());
  });

  it("rejects agent callers that create issue workspace provision commands", async () => {
    const app = createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Exploit",
        executionWorkspaceSettings: {
          workspaceStrategy: {
            type: "git_worktree",
            provisionCommand: "touch /tmp/paperclip-rce",
          },
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed workspace commands");
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rejects agent callers that patch assignee adapter workspace teardown commands", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());
    const app = createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/issues/issue-1")
      .send({
        assigneeAdapterOverrides: {
          adapterConfig: {
            workspaceStrategy: {
              type: "git_worktree",
              teardownCommand: "rm -rf /tmp/paperclip-rce",
            },
          },
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed workspace commands");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("repairs legacy agent assignment access when membership is missing", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ID,
      companyId: "company-1",
      role: "engineer",
      permissions: {},
    });

    const app = createApp({
      type: "agent",
      agentId: AGENT_ID,
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Legacy assignment repair",
        assigneeAgentId: AGENT_ID,
      });

    expect(res.status).toBe(201);
    expect(mockAccessService.getMembership).toHaveBeenCalledWith("company-1", "agent", AGENT_ID);
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      "company-1",
      "agent",
      AGENT_ID,
      "tasks:assign",
      true,
      null,
    );
    expect(mockIssueService.create).toHaveBeenCalled();
  });

  it("keeps assignment disabled for agents with membership but no grant", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAccessService.getMembership.mockResolvedValue({
      id: "membership-1",
      companyId: "company-1",
      principalType: "agent",
      principalId: AGENT_ID,
      membershipRole: "member",
      status: "active",
    });
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ID,
      companyId: "company-1",
      role: "engineer",
      permissions: {},
    });

    const app = createApp({
      type: "agent",
      agentId: AGENT_ID,
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Assignment should stay forbidden",
        assigneeAgentId: AGENT_ID,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("tasks:assign");
    expect(mockAccessService.setPrincipalPermission).not.toHaveBeenCalled();
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });
});
