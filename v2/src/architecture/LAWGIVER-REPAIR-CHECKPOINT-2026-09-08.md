# Lawgiver-only bounded repair

Authorized by user "Do it" after the offline spirit readiness HOLD. Started
2026-09-09 04:34 UTC. Stop within30 minutes; no live inference, server, H3,
Watcher/Arbiter repair, model change, or new controller.

Original red evidence: recordings/spirit-readiness-offline-iaEEyh.
Pre-edit files and dirty-worktree checkpoint: recordings/lawgiver-repair-TpXAm2.

Smallest repair, before implementation:

- KEEP existing RulesEngine, trusted base rules, supported effect vocabulary,
  native ECS effects, explicit approval, and all failed evidence.
- REUSE managed private/protected component policy and native source/task scopes.
- VALIDATE entire candidate atomically; reject unknown/malformed effects, numeric
  field misuse, private/protected coordinates, ambiguous condition merges and
  unowned name replacement. No silently dropped rule fragments.
- BIND requests explicitly to a World; preserve request/proposal identity and
  definition across inference/approval; reject cancellation, replacement and stop.
  Old unscoped author calls must fail clearly, not obtain implicit world authority.
  Update two legacy harness call sites and the gate fixture mechanically; preserve
  all eight original assertions and their original failed snapshot.
- FENCE EXECUTION: WorldSchema is still process-wide. Mark Lawgiver-authored rules
  as runtime-scoped and require a private grant in the existing engine. A copied
  or restored marker is not permission. Trusted unmarked base/host rules retain
  their prior behavior; arbitrary host rule writing is outside this checkpoint.
- Retain rejected requests/proposals and concise reasons. No persistent grant or
  new rules engine. Restoring/re-authorizing generated rules is explicitly deferred.

Verification: focused offline regression tests for valid native effects and
adversarial boundaries, then one rerun of the SAME24-suite spirit gate selection
and normal typecheck. Arbiter/Watcher HOLDs and the known W2 fixture failure remain
untouched. At most one focused correction iteration; stop rather than broaden.
Do not call the whole hierarchy ready merely because Lawgiver gates improve.

## Result — Lawgiver checkpoint complete; hierarchy remains HOLD

Completed offline within the30-minute bound. No live runs, model changes,
controller changes, automatic follow-on work or Watcher/Arbiter changes.

Implementation:

- `rule-admission.ts` validates complete supported effect/condition structures
  with existing managed private/protected policy and registered numeric fields.
  Unknown keys, invalid parameters, ambiguous merges, unsupported coordinates,
  private read expressions and partially invalid rules reject before registry writes.
- Requests require `requestRule(description, context, requestedBy, world)`.
  The fourth argument is explicit. Missing-world calls fail clearly; the two
  legacy harnesses were updated mechanically. A setup request can establish the
  first event epoch, but cannot restart a stopped world. Eight original gate
  assertions were unchanged; only their request fixture supplies its World.
- Request/proposal identity and definitions, cancellation, source lifetime,
  removal during inference, and single-producer request ownership are checked.
  Rejected proposals and concise reasons remain; malformed/provider failures keep
  the request. Different worlds cannot consume one another's request queues.
- Generated rules cannot replace an existing name. Effect definitions are sealed
  and deeply protected; existing host enable/disable remains supported.
- The existing RulesEngine checks a private runtime grant, world and source before
  execution and again between effects/targets. The process-wide schema remains,
  but Lawgiver-authored rules execute only in their admitted world. Serialized
  `executionScope: lawgiver-runtime` is an explicit non-authoritative marker;
  copied/restored definitions cannot recover an execution grant.
- Trusted unmarked base/host rules retain their existing semantics. No new engine.
  The contradictory prompt example requiring and excluding the same trait was
  corrected; models and sampling configuration were not changed.

Verification, all artifacts retained:

1. `recordings/lawgiver-repair-TpXAm2/focused-01.*`:42/42passed. A bounded code
   review then preserved host enable/disable and hardened pending-request withdrawal
   and proposal-ID freshness. This was the single allowed correction iteration.
2. `focused-02.*`:45/45passed (35new admission regressions,8original Lawgiver
   gates,2existing RulesEngine compatibility tests). Jest1.331s, no network attempts.
3. SAME24-suite selection, once: `recordings/spirit-readiness-offline-IzHK4D`.
   22suites pass /2fail;405tests pass /4fail. All393selected existing regressions
   and all8Lawgiver gates pass. Tests10.135s +normal typecheck8.244s, typesexit0.
   No timeout/network attempt; frozen source unchanged throughout the run.
   Normal tsconfig excludes spirit tests; no claim that it statically checked them.
4. Test/typecheck processes99246/99336 independently confirmed gone. Focused
   child processes exited0. Changed tracked files pass `git diff --check`.

The four remaining failed cases are deliberately untouched:
A1ordinaryprop lookup; A4missing-target auto-fix recommendation;
W4cross-world activity report; W2invalid test fixture (missing roomId, NOT an
engine-behavior conclusion). Original iaEEyh failure evidence remains unchanged.

## Limits and next gate

This is Lawgiver admission/execution safety evidence, not successful live rule
design, useful world growth or a full-suite regression run. WorldSchema remains
process-wide; its general active-rule listings are not a per-world execution
readiness report. Trusted host/base rule creation and other authoring APIs were
not converted or audited here. Runtime grants are intentionally not durable;
restoration/re-authorization of generated rules requires a separate contract.
The new validation does not prove every valid rule is narratively useful or free
of semantic loops, nor does it establish indefinite growth/resource bounds.

Next authorized checkpoint should address Watcher's world/source isolation,
then Arbiter's entity lookup and evidence-only recommendations; correct W2's
fixture as test maintenance without erasing its original failure. Retain the
same overall gates. Live probes still require a separate explicit bounded plan.

Stop here. No recurring goal or automation was created. The earlier10-trial
cognition baseline and10-minute endurance requirements/evidence remain unchanged.
