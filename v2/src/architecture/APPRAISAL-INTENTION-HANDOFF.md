# Ordinary experience into personal deliberation

An understood opportunity is not necessarily emotional, and an emotional desire
is not necessarily a task. The existing personal-review lane owns the choice of
whether to form a new intention. Intensity should not gate access to that lane.

## Evidence and scope

In failed Elaine trial `elaine-growth-integration-3Y7vGU`, the invitation was read
at 34.2 s and appraised at 44 s with importance 0.5. The 0.6 wake threshold skipped
its personal review. Three later reviews returned no goal despite remembering
dinner. Those prompts did not distinguish a standing phone motivation from a
concrete intention. Missing type context is an ambiguity, not proof of why the
model said no. No undertaking existed for the commitment handoff to follow.

This repair changes admission to deliberation and the clarity of its inputs.
It does not guarantee a reply, acceptance, departure, or a successful episode.

## Existing owners, clearer handoffs

1. Native receipt/perception producers alone enqueue experienced evidence.
   Unread message bodies, director suggestions, and other actors' private state
   do not enter through this repair. Appraisal remains asynchronous, private,
   source/owner/cancellation checked, and separate from body-action selection.
2. Every admitted appraisal is retained in the existing `PersonalConcerns` ECS
   component, including `innerThought` without optional affect/episode updates.
   Importance retains its actual value, including zero. There is no new schema,
   request classifier, mental subsystem, or inference call inside appraisal.
3. This is an eight-channel latest-interpretation buffer, not a complete memory
   ledger. The latest interpretation replaces that channel; retention is by
   appraisal recency so old intense events cannot crowd out a calm new one.
   Foreground recall still ranks importance. Episodic and narrative memory keep
   their existing separate storage and recall policies. A calm resolution remains
   available evidence rather than being dropped for falling below 0.25.
4. `autonomous-goals` consumes the changed buffer alongside own unrepresented
   undertakings in its existing bounded personal-review lane. The extra 0.6
   eligibility filter is removed. The existing combined revision acknowledges
   a successful proposal or no-op once; clocks, affect decay and duplicate native
   receipts do not reopen it. Coalesced receipts are considered as a batch.
5. The review can adopt a concrete intention or return `goal:null`, including
   declining or ignoring the opportunity. Standing/episodic persistence and
   scheduling source are projected from existing GoalLifecycle data, not guessed
   from keywords. A standing motivation is not a concrete plan already covering
   all its possible activities. A scheduled meal is not acceptance of a new
   invitation. Existing concrete active/deferred work should not be duplicated.
6. New intentions still use prepare/commit, ordinary planning, foreground choice,
   resource/time/access checks, and native outcomes. Review has no motor authority,
   does not send messages, and does not mark a request accepted. The separate
   commitment handoff applies only to an actual own undertaking.

## Guards and operational tradeoff

- No-op acknowledgement remains existing transient scheduler state. Reload may
  reconsider the saved batch once, with persisted intentions in context; it does
  not replay a plan, sent message, or action. Intentions and private memories remain
  ECS-owned and owner-scoped across serialization/remapping.
- Source/owner/goal/private-correspondence/emotional-life changes invalidate old
  in-flight review proposals. Persistence and goal source now also participate in
  the review fingerprint because they affect interpretation of its inputs.
- Historical appraisal can request fresh review but cannot replay stale emotion
  or goal edits. Receipt and appraisal times remain distinct simulation times.
- Existing cooldown, active-goal capacity, task bounds and cancellation remain.
  Ordinary newly appraised evidence can now cause more personal reviews than
  before. This is not a claim of reduced provider cost or live latency; those
  need measurement in the next authorized bounded trial.
- Native appraisal deduplicates receipts before this buffer. It remains bounded;
  eight-channel retention is not a durable guarantee to individually deliberate
  every event in an arbitrarily overloaded world. No new unbounded backlog.

Tests use scripted model answers to verify mechanics, privacy and authority,
including both choice and refusal. They do not prove the real model chooses well.
Personal review's strict output, structural diagnostics and bounded format-retry
backoff are documented in [PERSONAL-REVIEW-CONTRACT.md](PERSONAL-REVIEW-CONTRACT.md).
Ten-trial and 600 actual-wall AND simulation-second endurance gates remain intact;
world generation and H3 are deferred.
