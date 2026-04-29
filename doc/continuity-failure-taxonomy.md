# Continuity Failure Taxonomy

Status: Proposed operating guide
Date: 2026-04-29
Audience: COO chain, agent developers, board operators

This document defines the failure classes Paperclip should surface when issue execution continuity breaks or cannot safely continue.

`doc/execution-semantics.md` explains the baseline lifecycle rules. This document adds the operator-facing taxonomy, routing semantics, and rollout sequence for continuity-visible failures.

## 1. Why this exists

Today, several different failure modes can all collapse into a generic `blocked` outcome or an ambiguous interrupted run. That is not enough for operational handling.

We need a small taxonomy that answers three questions consistently:

1. what kind of continuity failure happened
2. whether the current owner should keep the issue or route it
3. what comment/status/escalation behavior the agent should use next

The taxonomy is for company-internal operations handling. It is not a product-bug classification system.

## 2. Core rule

Continuity failure classes do not replace issue status.

- `todo`, `in_progress`, `in_review`, and `blocked` remain the issue-state contract
- the continuity class explains why normal execution could not continue
- the class should appear in the recovery/escalation comment body, run summaries, and any future structured run metadata

In short: status answers "what state is the issue in now"; continuity class answers "why did execution continuity fail or pause".

## 3. Failure classes

Use these exact class names for continuity-visible operations incidents.

### `provider_limit`

The agent could not continue because the upstream model/provider refused service due to quota, rate, concurrency, credit, or provider-enforced usage limits.

Use when:

- API quota is exhausted
- concurrency caps reject new work
- rate limiting persists past normal retry behavior
- provider account credits or usage caps are hit

Do not use when:

- the local adapter crashed before reaching the provider
- Paperclip budget policy intentionally paused work

Expected handling:

- issue usually moves to `blocked`
- comment names the provider/system, observed limit, and next owner
- escalate to CEO only if the fix requires a spend/policy decision
- otherwise route to the operational owner of provider access or adapter configuration

### `budget_guardrail`

The control plane intentionally stopped execution because a Paperclip budget policy or spend control disallowed further work.

Use when:

- company, project, or agent budget policy paused work
- an approval-gated spend path is required before continuing
- execution was rejected by explicit budget enforcement

Do not use when:

- the provider itself refused service for external quota reasons

Expected handling:

- issue moves to `blocked`
- comment must name the policy surface that stopped work
- if spending authority or approval is unclear, escalate to the board/CEO
- if the policy is clearly wrong or misconfigured, route to the operator who owns budget setup

### `adapter_crash`

The local execution path failed because the adapter runtime, wrapper process, session codec, or required local execution dependency broke before the task could complete.

Use when:

- the agent process exits unexpectedly
- session restore/serialization breaks continuity
- required local tools or adapter bootstrapping fail
- runtime-service or workspace wiring causes the adapter to die or mis-start

Do not use when:

- the issue is blocked on a product repo bug
- the provider returned a normal quota/limit refusal

Expected handling:

- first automatic recovery wake may keep the issue `in_progress`
- after retry exhaustion, issue moves to `blocked`
- comment should include the failing adapter/runtime surface and whether the failure reproduced
- COO delegates deeper implementation work to Agent Developer when the fix is beyond a bounded instruction/workflow cleanup

### `operator_interrupt`

Execution continuity was intentionally interrupted by a human or control-plane action, rather than by a technical failure.

Use when:

- a board user stopped, superseded, or intentionally redirected the run
- workspace continuity was intentionally broken by operator action
- a manual process stop or environment intervention interrupted an otherwise healthy run

Do not use when:

- the process died unexpectedly
- the agent was waiting on review or approval in the normal flow

Expected handling:

- if there is a clear next owner, route without escalation theater
- if the interruption means "wait for human review", prefer `in_review`
- if work cannot continue until the operator clarifies intent, use `blocked`
- comment should name the interrupting action and the expected next owner

## 4. Mapping to issue semantics

### `in_progress`

Allowed only when continuity recovery is still actively in flight.

Use `in_progress` with a continuity class only when:

- Paperclip is on the first automatic retry/recovery path
- the same assignee still owns the work
- there is a live execution path and no manual handoff is needed yet

If the recovery path is gone, do not leave the issue in silent `in_progress`. Move it.

### `blocked`

This is the default resting state for unresolved continuity failures.

Use `blocked` when:

- the retry path is exhausted
- another human/agent/system must act first
- the failure is known and execution cannot safely continue now

The blocker comment should include:

- `Continuity class: <class>`
- one-sentence evidence
- exact owner or decision needed

### `in_review`

Use `in_review` instead of `blocked` when the interruption intentionally hands the next move to a reviewer/approver or board operator.

Typical case:

- `operator_interrupt` because a human explicitly wants the task back for review

Do not overload `in_review` for quota, budget, or crash failures.

## 5. Comment template

Agents do not need a new API field to start using the taxonomy. They can include it in comments immediately.

Recommended shape:

```md
Continuity update

- Continuity class: adapter_crash
- Evidence: codex_local exited during session restore after checkout recovery
- Status impact: moving issue to blocked after retry exhaustion
- Next owner: Agent Developer to fix adapter/session continuity
```

If a board decision is needed, add:

```md
- Escalation needed: CEO decision on spend/policy/owner
```

## 6. Routing rules

### COO handles directly

COO should directly handle:

- instruction ambiguity about blocked vs review semantics
- missing routing guidance
- heartbeat or ownership playbook gaps
- small operational artifact fixes around continuity reporting

### Delegate to Agent Developer

Delegate when the failure indicates deeper implementation work:

- adapter runtime crashes
- workspace/session restore defects
- plugin loader/runtime-service breakage
- repeated recovery-loop failures without a doc-only fix

### Escalate to CEO

Escalate when:

- `budget_guardrail` needs policy or spend authority
- `provider_limit` requires a spend/vendor tradeoff
- repeated continuity incidents show a broader operating outage
- ownership is structurally ambiguous

### Route to CTO chain

Route out of COO scope when the root cause is not Paperclip-internal operations:

- product repository bugs
- application feature regressions
- product-side deployment/debugging work

## 7. Files to update in rollout

The taxonomy should roll out in this order.

### Phase 1: central semantics

Update these first:

- `doc/execution-semantics.md`
- `skills/paperclip/SKILL.md`
- `docs/guides/agent-developer/heartbeat-protocol.md`
- `docs/guides/agent-developer/task-workflow.md`

Reason:

- these files define generic issue-state and heartbeat behavior across agents

### Phase 2: shared onboarding artifacts

Update shared/default instruction bundles next:

- `server/src/onboarding-assets/default/HEARTBEAT.md`
- `server/src/onboarding-assets/default/AGENTS.md`
- `server/src/onboarding-assets/ceo/HEARTBEAT.md`

Reason:

- continuity semantics should be visible in the default operating contract and in the CEO escalation path

### Phase 3: role-specific company instructions

Update the roles that actively route or respond to operations failures:

- `agents/coo/AGENTS.md`
- `agents/org-watcher/AGENTS.md`
- `agents/agent-tester/AGENTS.md`
- `agents/organizational-effectiveness-lead/AGENTS.md`
- `agents/ai-resource-and-culture-officer/AGENTS.md`
- `agents/deployer/AGENTS.md`

Reason:

- these roles either surface continuity failures, test them, or package escalations

### Phase 4: optional product/API surfacing

Consider structured surfacing later in:

- issue/run summary generation
- dashboard wording for stranded-work incidents
- future structured run/issue metadata if continuity class becomes first-class API state

This phase should not block Phase 1 wording cleanup.

## 8. Validation plan

Validation should be light and operational, not a large product project.

1. Update the central docs and shared instructions.
2. Run one documentation pass for status/continuity consistency:
   confirm `blocked` vs `in_review` guidance does not conflict.
3. Add or update focused tests only where product behavior is explicit:
   recovery/escalation comments, heartbeat summaries, or other surfaced wording if code changes are made.
4. Run a tabletop review with COO + Agent Developer:
   classify a quota failure, a budget stop, an adapter crash, and a manual interruption using the new rules.

## 9. Recommended rollout decision

Adopt the four-class taxonomy now as comment-and-doc semantics first.

Do not wait for a new database enum or API field before using it. The immediate problem is inconsistent operator interpretation, and that is fixed primarily by instruction and documentation clarity.
