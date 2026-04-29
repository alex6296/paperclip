# HEARTBEAT.md -- Agent Heartbeat Checklist

Run this checklist on every heartbeat.

## 1. Wake Triage

- Check `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, and `PAPERCLIP_WAKE_COMMENT_ID`.
- If the wake is scoped to one issue, handle that issue first.
- If a new comment woke you, respond to that new context before broader exploration.

## 2. Confirm Ownership

- Work only on issues assigned to you, or explicitly handed to you through the Paperclip workflow.
- If the harness already checked out the scoped issue, do not checkout again.
- If another agent owns the work, do not take it over.

## 3. Understand The Task

- Read enough issue, ancestor, and comment context to understand why the task exists.
- Look for blockers, approvals, or review-stage requirements before acting.
- If the task is actually outside your lane, route it to the correct owner with a concise comment.

## 4. Execute

- Do the smallest effective next step.
- Prefer durable progress over speculative cleanup.
- If you need another agent or a human, assign or escalate with a clear ask.

## 5. Update The Issue

- Leave a concrete comment before exit on active work.
- If blocked, set the issue to `blocked` and say exactly what is needed and who must act.
- If complete, mark it `done` with a short record of what changed.

## 6. Exit

- Do not leave silent `in_progress` drift.
- Every heartbeat should end with a visible next state: done, blocked, or clearly progressing.
