import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ASSIGNEE_AGENT_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ISSUE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  getRelationSummaries: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
  }),
  agentService: () => ({
    getById: vi.fn(async () => null),
    resolveByReference: vi.fn(async (_companyId: string, raw: string) => ({
      ambiguous: false,
      agent: { id: raw },
    })),
  }),
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
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
    fireEvent: vi.fn(async () => []),
  }),
  workProductService: () => ({}),
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => ({
      canUser: vi.fn(async () => true),
      hasPermission: vi.fn(async () => true),
    }),
    agentService: () => ({
      getById: vi.fn(async () => null),
      resolveByReference: vi.fn(async (_companyId: string, raw: string) => ({
        ambiguous: false,
        agent: { id: raw },
      })),
    }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
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
      fireEvent: vi.fn(async () => []),
    }),
    workProductService: () => ({}),
  }));
}

async function createApp() {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeCreatedIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: "company-1",
    status: "todo",
    priority: "medium",
    projectId: null,
    goalId: null,
    parentId: PARENT_ISSUE_ID,
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "PAP-1000",
    title: "Child issue",
    executionPolicy: null,
    executionState: null,
    executionWorkspaceSettings: null,
    hiddenAt: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("child issue create wakeups (in_progress parent regression)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.resetAllMocks();
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
  });

  it("returns 201 and wakes assignee when in_progress parent has no blockers on child", async () => {
    const created = makeCreatedIssue({
      assigneeAgentId: ASSIGNEE_AGENT_ID,
      status: "todo",
    });
    mockIssueService.create.mockResolvedValue(created);

    const res = await request(await createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Child issue",
        parentId: PARENT_ISSUE_ID,
        assigneeAgentId: ASSIGNEE_AGENT_ID,
        status: "todo",
      });

    expect(res.status).toBe(201);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      ASSIGNEE_AGENT_ID,
      expect.objectContaining({
        source: "assignment",
        reason: "issue_assigned",
        payload: expect.objectContaining({
          issueId: created.id,
          mutation: "create",
        }),
      }),
    );
  });

  it("returns 201 and suppresses wakeup when child has an unresolved blocker", async () => {
    const created = makeCreatedIssue({
      assigneeAgentId: ASSIGNEE_AGENT_ID,
      status: "blocked",
    });
    mockIssueService.create.mockResolvedValue(created);
    mockIssueService.getRelationSummaries.mockResolvedValue({
      blockedBy: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          identifier: "PAP-101",
          title: "Upstream blocker",
          status: "in_progress",
          priority: "high",
          assigneeAgentId: "upstream-agent",
          assigneeUserId: null,
        },
      ],
      blocks: [],
    });

    const res = await request(await createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Child issue",
        parentId: PARENT_ISSUE_ID,
        assigneeAgentId: ASSIGNEE_AGENT_ID,
        status: "blocked",
        blockedByIssueIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      });

    expect(res.status).toBe(201);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("returns 201 and does not attempt wakeup when child has no assignee", async () => {
    const created = makeCreatedIssue({ assigneeAgentId: null, status: "todo" });
    mockIssueService.create.mockResolvedValue(created);

    const res = await request(await createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Child issue",
        parentId: PARENT_ISSUE_ID,
        status: "todo",
      });

    expect(res.status).toBe(201);
    expect(mockIssueService.getRelationSummaries).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });
});
