import { describe, expect, it, vi } from "vitest";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";

describe("queueIssueAssignmentWakeup", () => {
  it("skips wakeup when assignment still has unresolved blockers", async () => {
    const wakeup = vi.fn(async () => undefined);
    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        assigneeAgentId: "11111111-1111-4111-8111-111111111111",
        status: "blocked",
      },
      hasUnresolvedBlockers: true,
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
      requestedByActorType: "user",
      requestedByActorId: "board-user",
    });

    expect(wakeup).not.toHaveBeenCalled();
  });

  it("queues wakeup when blockers are resolved", async () => {
    const wakeup = vi.fn(async () => undefined);
    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        assigneeAgentId: "11111111-1111-4111-8111-111111111111",
        status: "todo",
      },
      hasUnresolvedBlockers: false,
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
      requestedByActorType: "user",
      requestedByActorId: "board-user",
    });

    expect(wakeup).toHaveBeenCalledTimes(1);
    expect(wakeup).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        source: "assignment",
        reason: "issue_assigned",
        payload: expect.objectContaining({
          issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mutation: "create",
        }),
      }),
    );
  });
});
