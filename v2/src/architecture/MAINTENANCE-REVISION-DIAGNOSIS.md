# Bounded architect revision after a rejected build

2026-09-07. Deterministic integration work; no provider calls or H3.

## Defect and contract

The architect's duplicate checks included every historical proposal, regardless
of status. `validateObservedNeeds` rejected a repeated need description even when
the previous build had failed; `designProposal` separately rejected its existing
proposal name. This prevented a grounded correction, not just duplicate work.

Removing both checks would permit endless rebuilds. Instead, a need may now
explicitly name `revisionOf` and cite `proposal:<id>` as evidence. The referenced
proposal must be failed, have a recorded failure reason, and represent the same
need and type. The design must retain its name. Pending, building, executed and
explicitly rejected proposals do not acquire retry permission.

Each chain permits at most two corrections after its original proposal. A parent
with any child cannot be reused to branch or reset the budget. Missing ancestry,
cycles, or another proposal for the same name/need fail closed. Admission is
checked again against current factory state after model design returns. This is
bounded permission to reconsider, not an automatic retry scheduler. The limit
is an engineering safeguard, not a claim about NPC cognition.

Architect context now includes proposal IDs, failure reasons and revision links.
Both needs assessment and design receive the actual failure reason. The existing
managed loader, independent acceptance checks and activation callback still own
whether a proposal becomes executed. A ready candidate is not yet executed.

## Evidence

- Failing admission regression: 8437 exit 1, one failed / six passed,
  `/tmp/argos-architect-revision-red.log`.
- Initial integration fixture used invalid artifact paths and failed before
  reaching its intended acceptance failure (54788 exit 1). Corrected the fixture
  to the required `components/` and `systems/` directories; did not weaken the
  package validator.
- Corrected integration: 4516 exit 0, nine tests, 0.787s,
  `/tmp/argos-architect-recovery-integration2.log`.
- Expanded architect, coding daemon, usable mechanic and evolution-coordinator
  checks: 64044 exit 0, 47 tests / four suites, 3.78s,
  `/tmp/argos-architect-recovery-expanded.log`.
- TypeScript: 21274 exit 0,
  `/tmp/argos-architect-recovery-types-final.log`.
- Full regression: 42155 exit 0, **281 suites / 3520 passed / 10 skipped**,
  195.863s, `/tmp/argos-architect-recovery-full.log`. Diff check passed.

The integration uses production architect assessment/design/admission/execution,
CodingDaemon validation and managed workers, native affordance effects, and
subsequent architect context gathering. Model outputs and builder files are
fixtures. The chain is:

1. An existing physical valve is cited as needing a quantity mechanic.
2. The architect proposes it; the proposal becomes building, not executed.
3. Two native ticks continue while the builder waits; no quantity component is
   prematurely installed.
4. The candidate passes its own tests but fails the independent designer check:
   three units of flow instead of two. Proposal records that rejection.
5. A new assessment explicitly cites the failed proposal. Both model prompts
   contain its failure reason. A revised proposal queues exactly one second job.
6. The corrected candidate becomes ready, then executed only at activation.
7. Its worker adds two units; a native close action stops further accumulation
   and changes the prop description. Native reopening resumes accumulation.
8. Five native ticks are accounted for, exactly two jobs exist, and the next
   architect context observes the revised proposal as executed.

## What this does not prove

This is not an autonomous God or actor evaluation. Entity-based need selection
and the actor's close/open actions are fixtures; they do not demonstrate that a
model discovers the gap, chooses the action, or interprets its result. The
integration does not exercise the library's `system:build` bus-to-God/requester
inbox bridge or supervisor decision making. It does not introduce a new native
affordance; the new quantity mechanic responds to the existing valve action.

The proposal factory is still process-local; this work does not establish a
durable revision budget across restarting its global proposal ledger. Active
system repair/rollback has a separate coding-daemon repair path. Do not infer a
complete repeated maintenance cycle, world isolation, naturalness, or runtime
soak pass from this test.

Next integration work: inspect real observation provenance (a proposed action is
not a committed outcome), exercise the actual library God/requester feedback
bridge, and retain causal links through local discovery/use and observed effects.
Only then run a bounded maintenance-enabled model diagnostic. Preserve the
distinction between a missing capability and an NPC legitimately declining work.
