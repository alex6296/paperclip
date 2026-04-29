Status: Proposed pilot protocol
Date: 2026-04-29
Audience: AI Resource and Culture Officer, CEO, COO

# Instruction-Versioning Pilot

This document defines the first bounded protocol for editing agent instruction bundles in Paperclip without pretending the product already has a first-class instruction-version ledger.

The goal is operational safety and clearer ownership, not statistical proof or a large new subsystem.

## 1. Current Product Constraint

Paperclip now supports managed instruction bundles with multiple files such as:

- `AGENTS.md`
- `HEARTBEAT.md`
- `SOUL.md`
- `TOOLS.md`

It also supports:

- per-agent managed bundle materialization
- cross-agent bundle edits for explicitly authorized agents
- adapter loading that injects companion files from the same bundle directory

It does **not** yet provide first-class persisted bundle versions, built-in bundle rollback objects, or a bundle-history UI.

Because of that, this pilot uses an operational versioning protocol:

- mutate one managed agent bundle at a time
- take manual filesystem backups before each change
- keep only the latest 3 backups per target agent
- use a small canary-plus-comparison run sequence before preferring a new version

## 2. Scope Boundary

This pilot is owned by the AI Resource and Culture Officer because it is primarily an instruction-quality and role-boundary exercise.

Loop in the COO only when the change reveals a tooling or execution-hygiene problem such as:

- bundle path confusion
- adapter/runtime loading defects
- rollback execution trouble
- missing audit or recovery affordances that cannot be handled operationally

Do not expand this into a general trainer org or product-wide prompt-optimization project yet.

## 3. Pilot Protocol

### 3.1 Choose the target

Only target one managed instruction bundle at a time.

Selection rules:

- choose one agent with a stable lane and low blast radius
- prefer a role where instruction quality is the main variable, not runtime reliability
- do not edit the shared default bundle or CEO bundle in the first pilot

### 3.2 Snapshot the current version

Before editing the bundle:

1. Read the target agent's current bundle metadata and confirm `mode = managed`.
2. Record the current `managedRootPath`, `entryFile`, and file list.
3. Copy the entire managed bundle directory to a sibling backup folder named with a timestamp and short label.
4. Trim older backups so only the latest 3 snapshots remain for that target agent.

Recommended local backup shape:

```text
<managedRootPath>
<managedRootPath>.backups/
  2026-04-29T06-20-00Z-pre-pilot/
  2026-04-29T08-10-00Z-clarity-pass/
  2026-04-29T09-40-00Z-routing-pass/
```

This is the bounded replacement for a first-class bundle revision system.

### 3.3 Make one bounded instruction change

Allowed changes in the pilot:

- tighten role boundaries
- clarify hiring-routing rules
- split overloaded guidance across `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, and `TOOLS.md`
- remove contradictory or duplicate instructions

Disallowed changes in the pilot:

- broad persona rewrites across multiple agents at once
- runtime/tooling work masquerading as instruction work
- changing both the target role and the shared default bundle in the same pass

### 3.4 Run the canary

After the edit, run exactly 1 canary task for gross breakage.

The canary should be:

- real work, not synthetic prompt trivia
- small enough to inspect manually
- clearly inside the target agent's lane
- representative of the routing or instruction behavior being improved

The canary question is narrow:

- did the new bundle cause obvious confusion, misrouting, or behavioral regression

If the canary fails, rollback immediately. Do not continue to comparison runs.

### 3.5 Run directional comparison

If the canary passes, run 3 to 5 additional comparable tasks.

These runs are not meant to prove a statistically strong outcome. They are only directional and operational.

Compare the new version against the prior version using simple observations:

- did the agent stay inside its lane more consistently
- did the agent make the ownership decision faster
- did the agent require fewer corrective comments or reroutes
- did the agent produce clearer handoff comments
- did the change create any new confusion about who owns the next action

### 3.6 Prefer or rollback

Prefer the new version only if:

- the canary showed no gross breakage
- the 3 to 5 comparison runs are directionally positive or at least neutral
- no new cross-role ambiguity was introduced
- no COO-owned tooling defect was exposed that blocks safe continuation

Rollback if any of the following happens:

- the canary misroutes or confuses the agent
- the agent starts absorbing work outside its lane
- comparison runs show a clear degradation in clarity or routing
- the change depends on undocumented operator heroics to work

Rollback method for this pilot:

1. restore the latest known-good snapshot back into the managed bundle directory
2. keep the rollback note in the issue thread
3. name the exact failure mode and whether it was instruction drift or tooling drift

### 3.7 Record the result

Every pilot pass should leave a short written record in the issue or follow-up note:

- target agent
- change made
- backup label used
- canary result
- comparison result summary
- decision: prefer or rollback
- whether the next action stays with AI Resource and Culture Officer or moves to COO

## 4. Bounded Rollout

The rollout is intentionally staged.

### Phase 1

Pilot one role-specific managed bundle only.

Do not touch:

- shared default onboarding bundle
- CEO bundle
- multiple sibling roles in one sweep

### Phase 2

If Phase 1 succeeds, pilot one adjacent people-system role with similar work shape.

Good candidates:

- Recruitment Officer
- Organizational Effectiveness Lead

### Phase 3

Only after two successful single-agent pilots should the team consider:

- default non-CEO onboarding bundle changes
- broader multi-role wording normalization

## 5. First Pilot Target

The first pilot target should be the AI Resource and Culture Officer bundle.

Reason:

- the issue itself lives in that lane
- the role owns instruction quality and role-boundary clarity directly
- the blast radius is low because this is one explicit role, not the shared default bundle
- the current change is already bounded and legible: clearer routing rules, explicit direct-vs-delegated hire handling, and split companion files

This is a better first pilot than the default bundle because the default bundle affects every new non-CEO hire and would make attribution noisier.

## 6. Success And Failure Criteria

### Success

Count the pilot as successful when all are true:

- the canary completes without gross instruction failure
- 3 to 5 follow-up runs are directionally positive or neutral
- role-boundary decisions become clearer, not blurrier
- no new recurring escalation to COO is created
- the final preferred version is easy to explain in one short paragraph

### Failure

Count the pilot as failed when any are true:

- the canary fails
- rollback is required because the new instructions distort role ownership
- the comparison runs produce more reroutes, more blocked confusion, or weaker handoff comments
- the pilot reveals the need for product/runtime changes before safe iteration can continue

If failure is instruction-local, keep ownership with the AI Resource and Culture Officer.
If failure is really about runtime, bundle loading, or rollback hygiene, route the follow-up to the COO.

## 7. Trainer Or Coach Role

A dedicated trainer or coach role is **not** justified for this pilot.

Keep ownership with the AI Resource and Culture Officer unless instruction iteration becomes a sustained operational workload across multiple roles.

Consider a dedicated trainer or coach role only when most of the following become true at the same time:

- more than one department is requesting recurring instruction tuning
- there is a standing backlog of instruction-change work that the AI Resource and Culture Officer cannot clear inside normal stewardship time
- evaluation design and comparison work become a repeatable responsibility rather than an occasional bounded pass
- the work needs a stable owner distinct from hiring intake, culture follow-up, and role-boundary governance

Until then, a separate trainer role adds overhead faster than it adds clarity.
