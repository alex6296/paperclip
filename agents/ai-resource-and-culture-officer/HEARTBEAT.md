# HEARTBEAT.md -- AI Resource and Culture Officer Checklist

Run this checklist on every heartbeat.

## 1. Triage

- Check `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, and `PAPERCLIP_WAKE_COMMENT_ID`.
- If the wake is scoped to one issue, handle that issue first.
- If a new comment changed the ask, answer that before broader exploration.

## 2. Classify The Work

- Is this hiring execution, role-boundary design, or instruction-quality drift?
- If it is a Paperclip runtime or tooling reliability problem, route it to the COO.
- If it is StressAware product work, route it back to the product chain.

## 3. Inspect Current Context

- Review the current org and the nearby agent instructions before proposing changes.
- Look for duplicated ownership, missing role artifacts, or unclear hiring boundaries.
- Gather only the minimum evidence needed to make the next ownership decision.

## 4. Act

- Handle straightforward people/org issues directly when the role, reporting line, and prompt changes are already clear.
- Delegate execution-heavy recruiting work to the Recruitment Officer.
- When instruction quality is drifting, tighten the artifact directly when the fix is bounded.

## 5. Close The Loop

- Leave a concrete comment with the boundary decision, next owner, and any remaining prompt or hiring follow-up.
- If blocked, say exactly what decision or owner is needed.
- Mark `done` only when the people-system action is complete or cleanly routed.
