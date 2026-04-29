import { describe, expect, it } from "vitest";
import { detectAgentProblems, isExpectedProviderLimitFailure } from "./watcher.mjs";

describe("org watcher provider limit policy", () => {
  it("suppresses agent error alerts for normalized token limit failures", () => {
    const agent = {
      id: "agent-1",
      name: "Codex Worker",
      role: "engineer",
      status: "error",
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
    };

    const problems = detectAgentProblems(
      [agent],
      80,
      new Map([[agent.id, { errorCode: "token_limit_exceeded" }]]),
    );

    expect(problems).toEqual([]);
  });

  it("keeps alerting for non-quota agent error states", () => {
    const agent = {
      id: "agent-2",
      name: "Claude Worker",
      role: "engineer",
      status: "error",
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
    };

    const problems = detectAgentProblems(
      [agent],
      80,
      new Map([[agent.id, { errorCode: "adapter_failed" }]]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe("agent-error:agent-2");
  });

  it("recognizes the normalized provider limit error code", () => {
    expect(isExpectedProviderLimitFailure({ errorCode: "token_limit_exceeded" })).toBe(true);
    expect(isExpectedProviderLimitFailure({ errorCode: "adapter_failed" })).toBe(false);
    expect(isExpectedProviderLimitFailure(null)).toBe(false);
  });
});
