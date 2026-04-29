# Weekly Operating-Model Scorecard

Status: COO operating definition
Date: 2026-04-29
Audience: CEO, COO, Org Watcher, Agent Developer

This document defines the weekly operating-model scorecard for Temmio's internal Paperclip operations.

The goal is not to create a new analytics system. The goal is to produce a stable weekly review using data Paperclip already records: issues, issue comments, heartbeat runs, approvals, activity, and cost events.

## 1. Cadence

- Reporting window: Monday 00:00 UTC through the next Monday 00:00 UTC
- Review cadence: once per week
- Primary owner: COO
- Reviewers: CEO first, Agent Developer when the scorecard shows tooling or adapter reliability drift

## 2. Where The Scorecard Lives

Use two layers:

1. Canonical metric definition lives in this repo document.
2. Weekly report instances live inside Paperclip as a recurring board-visible issue with markdown comments.

Why:

- The metric contract should be versioned with the control-plane codebase.
- The weekly operating review should stay in Paperclip's native work surface, which is issue/comment centric per `doc/PRODUCT.md` and `doc/SPEC-implementation.md`.
- Weekly comments preserve audit trail, ownership, and follow-up routing without creating a parallel reporting system.

Recommended routine pattern:

- Create one standing issue such as `Weekly operating-model scorecard`.
- A routine or board operator posts one markdown comment per week.
- If a metric breaches threshold, the COO opens or links a follow-up issue from that weekly comment.

## 3. Data Sources

Primary tables:

- `issues`
- `issue_comments`
- `heartbeat_runs`
- `activity_log`
- `approvals`
- `issue_approvals`
- `cost_events`

Useful existing API surfaces:

- `GET /api/companies/:companyId/activity`
- `GET /api/issues/:id/activity`
- `GET /api/issues/:id/runs`
- `GET /api/companies/:companyId/heartbeat-runs`
- `GET /api/companies/:companyId/approvals`
- `GET /api/approvals/:id/issues`
- `GET /api/companies/:companyId/costs/summary`
- `GET /api/companies/:companyId/costs/by-agent`

## 4. Scorecard Metrics

The scorecard has six weekly metrics. Some are exact. Some are V1 proxies because the product does not yet record a first-class `misrouted` or `duplicate_work` event.

### 4.1 Role Clarity Coverage

Purpose:
Measure whether assigned work arrives with enough context for an agent to act without guessing what the task is or why it exists.

Definition:
Percentage of agent-assigned issues first checked out during the week that meet the minimum execution-context contract:

- non-empty `description`
- and at least one structural anchor:
  - `parentId`
  - `projectId`
  - `goalId`

Formula:

`role_clarity_coverage = qualifying_first_checkouts / all_agent_issue_first_checkouts`

Source:

- `issues`
- `activity_log` rows with `action = 'issue.checked_out'`

Interpretation:

- High score means the operating system is creating legible work packets.
- Low score means agents are being asked to act on under-scoped tasks.

Notes:

- This is a V1 proxy for role clarity.
- It intentionally measures task clarity at execution time, not abstract org-chart quality.

### 4.2 Ownership Routing Accuracy

Purpose:
Measure whether work is reaching the correct owner the first time.

Definition:
Percentage of issues first assigned to an agent during the week that do not change assignee before the first meaningful execution signal.

First meaningful execution signal:

- first assignee-authored issue comment
- or first successful issue-linked heartbeat run
- or issue completion/cancellation, whichever comes first

Routing miss:

- any assignee change before that first meaningful execution signal

Formula:

`ownership_routing_accuracy = correctly_routed_issues / first_assigned_issues`

Source:

- `activity_log` rows with `action = 'issue.updated'` and assignee changes in `details` / `details._previous`
- `issue_comments`
- `heartbeat_runs`
- `issues`

Interpretation:

- High score means ownership is clear and routing is efficient.
- Low score means issues are bouncing before real work starts.

### 4.3 Escalation Latency P50 / P90

Purpose:
Measure how long operational escalations sit before another owner actually acts.

Definition:
For each escalation event created during the week, measure the elapsed time until the next qualifying owner action.

Escalation event types:

- issue moved to `blocked`
- approval created and linked to the issue

Qualifying owner action:

- assignee change
- issue status change out of `blocked`
- linked approval decision (`approved` or `rejected`)
- comment on the issue by someone other than the escalation author

Outputs:

- median latency (`P50`)
- tail latency (`P90`)

Source:

- `activity_log`
- `approvals`
- `issue_approvals`
- `issue_comments`

Interpretation:

- P50 shows normal response speed.
- P90 shows whether a minority of escalations are silently aging.

Notes:

- This is a V1 operational escalation metric, not a human communications metric.
- It deliberately uses explicit control-plane events instead of free-text comment parsing.

### 4.4 Run Continuity Reliability

Purpose:
Measure whether assigned work keeps a live execution path without recovery or manual intervention.

Definition:
Percentage of issue-linked heartbeat runs started during the week that complete without continuity loss.

Continuity loss means either:

- run ends with `errorCode = 'process_lost'`
- or the run triggers automatic recovery such as `process_lost_retry`
- or the related issue is later moved to `blocked` by stranded-work escalation

Formula:

`run_continuity_reliability = continuity_clean_runs / all_issue_linked_runs`

Source:

- `heartbeat_runs`
- `activity_log`
- `issues`

Interpretation:

- High score means execution stays attached to ownership.
- Low score points to adapter instability, workspace drift, or heartbeat recovery gaps.

### 4.5 Duplicate Work Signal

Purpose:
Flag likely duplicate execution, even though Paperclip does not yet persist a first-class duplicate-work relation.

Definition:
Count weekly issue pairs that meet all of the following:

- same company
- normalized titles match exactly after lowercasing and trimming repeated whitespace
- both are in active statuses (`todo`, `in_progress`, `in_review`, `blocked`) during overlapping time
- different assignees
- not parent/child of one another

Output:

- raw count of suspected duplicate pairs
- optional list of top offending issue pairs in the weekly comment

Source:

- `issues`
- `activity_log`

Interpretation:

- This is a signal, not a truth table.
- The point is to surface likely duplicate ownership for COO review, not to auto-close tasks.

### 4.6 Decision Throughput Without Ambiguity

Purpose:
Measure whether governance decisions resolve cleanly without repeated revision loops.

Definition:
For approvals resolved during the week, track:

- total approvals resolved
- approval decision latency from `createdAt` to `decidedAt`
- ambiguity-free resolution rate

An ambiguity-free resolution is an approval that reaches `approved` or `rejected` without an intermediate `revision_requested` event.

Formula:

- `decision_throughput = resolved_approvals`
- `ambiguity_free_rate = approvals_without_revision_loop / resolved_approvals`

Source:

- `approvals`
- `activity_log` rows:
  - `approval.created`
  - `approval.approved`
  - `approval.rejected`
  - `approval.revision_requested`
  - `approval.resubmitted`

Interpretation:

- High throughput with high ambiguity-free rate means decisions are landing cleanly.
- Low ambiguity-free rate means request packaging or ownership framing is weak.

## 5. Weekly Report Format

Post one markdown comment with this structure:

```md
# Weekly Operating-Model Scorecard

Window: 2026-04-20 00:00 UTC -> 2026-04-27 00:00 UTC

## Summary
- Overall read: stable | watch | degraded
- Main change from last week
- Top operational risk to route this week

## Metrics
| Metric | This Week | Prior Week | Target | Notes |
| --- | --- | --- | --- | --- |
| Role Clarity Coverage | 87% | 82% | >=90% | 3 first-checkout issues lacked structural anchors |
| Ownership Routing Accuracy | 91% | 95% | >=95% | 2 issues bounced before first execution |
| Escalation Latency P50 / P90 | 3.2h / 19.4h | 2.8h / 11.0h | <=4h / <=12h | Tail got worse on board approvals |
| Run Continuity Reliability | 96% | 98% | >=98% | One process-lost retry, one stranded continuation |
| Duplicate Work Signal | 2 pairs | 1 pair | 0-1 pairs | Review issue links below |
| Decision Throughput Without Ambiguity | 6 resolved, 83% clean | 4 resolved, 100% clean | >=90% clean | One approval required revision |

## Incidents / Follow-up
- [TEM-123] ... short reason
- [TEM-456] ... short reason

## COO Recommendation
- One paragraph: what needs to change in routing, instructions, or runtime operations this week
```

## 6. Thresholds

Use simple default thresholds until Temmio has 4-6 weeks of baseline data:

- Role Clarity Coverage: target `>= 90%`
- Ownership Routing Accuracy: target `>= 95%`
- Escalation Latency P50: target `<= 4h`
- Escalation Latency P90: target `<= 12h`
- Run Continuity Reliability: target `>= 98%`
- Duplicate Work Signal: target `<= 1` suspected pair per week
- Decision Throughput Without Ambiguity: target `>= 90%` ambiguity-free

Threshold policy:

- One miss: note it in the weekly comment and assign follow-up if needed.
- Two consecutive misses on the same metric: create an explicit COO follow-up issue.
- Three consecutive misses or broad multi-metric degradation: escalate to CEO with owner recommendation.

## 7. Review Path

Recommended weekly flow:

1. COO prepares the scorecard comment.
2. CEO reviews the weekly summary and approves any owner/routing changes.
3. Agent Developer is tagged only when the signal points to adapter, runtime, workspace, or instruction-build work.
4. Org Watcher can use the scorecard as upstream evidence for new operations issues.

## 8. Implementation Guidance

Do not block on perfect automation.

Phase 1 is acceptable if it is partly manual and query-backed. The minimum acceptable operating loop is:

- metrics computed from current DB/API data
- weekly markdown comment posted on schedule
- follow-up issues opened when thresholds are missed

Automation can come later. The definition should stabilize first.
