import type { Db } from "@paperclipai/db";
import { normalizeAgentUrlKey } from "@paperclipai/shared";
import { agentService } from "./agents.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";
import { routineService } from "./routines.js";

const OPEN_ISSUE_STATUSES = "backlog,todo,in_progress,in_review,blocked";

type OnboardingOwner = "coo" | "ai_resource";
type AgentSummary = Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>[number];

interface HiredAgentContext {
  name: string;
  role: string | null;
  title: string | null;
  reportsToName: string | null;
}

export interface TriggerNewHireOnboardingInput {
  companyId: string;
  hiredAgentId: string;
  hiredAgentName: string;
  source: "approval" | "direct_hire" | "join_request";
  sourceId: string;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isCooAgent(agent: { name: string; title: string | null; urlKey?: string | null }) {
  const name = normalizeText(agent.name);
  const title = normalizeText(agent.title);
  const urlKey = normalizeText(agent.urlKey ?? normalizeAgentUrlKey(agent.name) ?? null);
  if (urlKey === "coo") return true;
  if (name === "coo") return true;
  return title.includes("chief operating");
}

function isAiResourceAgent(agent: { name: string; title: string | null; urlKey?: string | null }) {
  const name = normalizeText(agent.name);
  const title = normalizeText(agent.title);
  const urlKey = normalizeText(agent.urlKey ?? normalizeAgentUrlKey(agent.name) ?? null);
  if (urlKey.includes("ai-resource")) return true;
  if (name.includes("ai resource")) return true;
  return title.includes("ai resource");
}

function buildIssueTitle(hiredAgentName: string) {
  return `Onboard new hire: ${hiredAgentName}`;
}

function buildHireContextLines(context: HiredAgentContext) {
  const lines = [`New hire: ${context.name}`];
  if (context.role) {
    lines.push(`Role: ${context.role}`);
  }
  if (context.title) {
    lines.push(`Title: ${context.title}`);
  }
  if (context.reportsToName) {
    lines.push(`Reports to: ${context.reportsToName}`);
  }
  return lines;
}

function buildIssueDescription(owner: OnboardingOwner, context: HiredAgentContext) {
  const hireContextLines = buildHireContextLines(context);
  if (owner === "coo") {
    return [
      "New-hire onboarding follow-up (operations lane).",
      "",
      ...hireContextLines,
      "",
      "Checklist:",
      "- Confirm org placement and reporting chain are correct.",
      "- Confirm runtime/routine expectations are set for this role.",
      "- Document any operational gaps discovered during onboarding.",
    ].join("\n");
  }
  return [
    "New-hire onboarding follow-up (culture and instruction lane).",
    "",
    ...hireContextLines,
    "",
    "Checklist:",
    "- Review role framing and instruction quality for alignment.",
    "- Confirm onboarding guidance matches current company standards.",
    "- Capture culture/principles follow-ups if the hire reveals drift.",
  ].join("\n");
}

function buildOriginId(input: TriggerNewHireOnboardingInput, ownerAgentId: string) {
  return `new_hire_onboarding:${input.source}:${input.sourceId}:${input.hiredAgentId}:${ownerAgentId}`;
}

function buildHiredAgentContext(allAgents: AgentSummary[], input: TriggerNewHireOnboardingInput): HiredAgentContext {
  const hiredAgent = allAgents.find((agent) => agent.id === input.hiredAgentId) ?? null;
  const reportsToAgent = hiredAgent?.reportsTo
    ? allAgents.find((agent) => agent.id === hiredAgent.reportsTo) ?? null
    : null;

  return {
    name: hiredAgent?.name?.trim() || input.hiredAgentName,
    role: hiredAgent?.role?.trim() || null,
    title: hiredAgent?.title?.trim() || null,
    reportsToName: reportsToAgent?.name?.trim() || null,
  };
}

export async function triggerNewHireOnboarding(
  db: Db,
  input: TriggerNewHireOnboardingInput,
): Promise<void> {
  const agentsSvc = agentService(db);
  const issuesSvc = issueService(db);
  const routinesSvc = routineService(db);
  const allAgents = await agentsSvc.list(input.companyId);
  const activeAgents = allAgents.filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval");
  const hiredAgentContext = buildHiredAgentContext(allAgents, input);

  await routinesSvc.fireEvent({
    companyId: input.companyId,
    eventType: "new_hire",
    idempotencyKey: `new_hire:${input.source}:${input.sourceId}:${input.hiredAgentId}`,
    payload: {
      hiredAgentId: input.hiredAgentId,
      hiredAgentName: hiredAgentContext.name,
      hiredAgentRole: hiredAgentContext.role,
      hiredAgentTitle: hiredAgentContext.title,
      reportsToName: hiredAgentContext.reportsToName,
      source: input.source,
      sourceId: input.sourceId,
    },
  });

  const coo = activeAgents.find(isCooAgent) ?? null;
  const aiResource = activeAgents.find(isAiResourceAgent) ?? null;
  const targets: Array<{ owner: OnboardingOwner; agent: (typeof activeAgents)[number] }> = [];

  if (coo && coo.id !== input.hiredAgentId) {
    targets.push({ owner: "coo", agent: coo });
  }
  if (aiResource && aiResource.id !== input.hiredAgentId) {
    targets.push({ owner: "ai_resource", agent: aiResource });
  }

  for (const target of targets) {
    const originId = buildOriginId(input, target.agent.id);
    const existing = await issuesSvc.list(input.companyId, {
      assigneeAgentId: target.agent.id,
      originId,
      status: OPEN_ISSUE_STATUSES,
      includeRoutineExecutions: true,
      limit: 1,
    });
    const title = buildIssueTitle(hiredAgentContext.name);
    const description = buildIssueDescription(target.owner, hiredAgentContext);

    if (existing.length > 0) {
      const refreshed = await issuesSvc.update(existing[0].id, {
        title,
        description,
        priority: "high",
      });
      if (!refreshed) continue;

      await logActivity(db, {
        companyId: input.companyId,
        actorType: "system",
        actorId: "new_hire_onboarding",
        action: "agent.new_hire_onboarding_issue_refreshed",
        entityType: "issue",
        entityId: refreshed.id,
        details: {
          owner: target.owner,
          ownerAgentId: target.agent.id,
          hiredAgentId: input.hiredAgentId,
          hiredAgentName: hiredAgentContext.name,
          source: input.source,
          sourceId: input.sourceId,
        },
      });
      continue;
    }

    const created = await issuesSvc.create(input.companyId, {
      title,
      description,
      status: "todo",
      priority: "high",
      assigneeAgentId: target.agent.id,
      originKind: "manual",
      originId,
    });

    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "new_hire_onboarding",
      action: "agent.new_hire_onboarding_issue_created",
      entityType: "issue",
      entityId: created.id,
      details: {
        owner: target.owner,
        ownerAgentId: target.agent.id,
        hiredAgentId: input.hiredAgentId,
        hiredAgentName: hiredAgentContext.name,
        source: input.source,
        sourceId: input.sourceId,
      },
    });
  }
}
