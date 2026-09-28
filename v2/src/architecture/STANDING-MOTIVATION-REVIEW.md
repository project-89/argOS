# Standing desires are not completed notification tasks

Implemented contract repair, 2026-09-07; autonomous behavior not yet verified.
Evidence motivating it comes from batch04 handoff pYvbvr.

At17.5s a current background appraisal releases goal29, the standing communication
motivation. The preserved episodic memory records its exact reason:

> I checked the notification and know what it is; no need to keep checking the phone.

This is task completion being used to retire a standing desire. A new episodic
goal25 to reply about the note is created, but no response is chosen/executed.
The correction delivered28.2 remains unread at120 despite sixteen realbuzzes.

createCommunicationMotivation deliberately boosts only its still-active original
goal. It does not resurrect a retired desire, correctly preserving autonomy.
Therefore subsequentbuzzes cannot boost that retired communication motivation.
The buzz/perception path still runs; retirement alone is not proof of every
subsequent decision's cause. It is a concrete loss of persistent motivation,
with an explicit erroneous rationale, not merely an inference from noreply.

The review interfaces omit the relevant distinction:

- experience-appraisal ownGoals omits GoalLifecycle.persistence.
- captureIntentionReconsideration exposes editable descriptions/priorities/status,
  but neither persistence nor distinct standing-withdrawal semantics.
- its current-source basis also omits persistence.
- foreground formatGoalPursuitContext likewise lists descriptions without
  persistence; prepareGoalReview uses the same release for both types and its
  definition/basis omits persistence.

Next: use the existing ECS persistence field, not a parallel motivation ledger.
Expose standing/episodic and allowed operations in both review paths. Separate
episodic release from an explicit withdrawal of a standing desire; retain
reprioritization and bounded deferral. Source-fence persistence changes. The
actor must remain able to choose “I do not want to be reachable tonight”; no
automatic resurrection, forced phone reads, compulsory replies, lexical reason
classification or prohibition on changing values.

Start with production regressions using a standing communication motivation:
ordinary task-release cannot retire it after one read; a subsequent genuine
notification still raises its salience. Explicit standing-withdrawal can retire
it and later notifications do not revive it. Episodic release remains unchanged.
Cover both background appraisal and foreground goal review, late persistence
changes, mixed-batch atomicity, and existing cleanup/restore semantics. Update
the intentional-standing-release regression to the explicit withdrawal operation,
not to make retirement impossible. Do not claim a behavioral pass before new
bounded evidence; batch04 remains closed failed.

## Implemented contract and validation

Both review paths now expose persistence and their allowed operations. Episodic
intentions permit release; standing desires permit explicit withdraw. Both can
still be reprioritized in appraisal or deferred in foreground review. Existing
ECS GoalLifecycle.persistence remains authoritative; no parallel ledger or
lexical classification of reasons. Retirement does not imply task completion,
and subsequent notifications do not resurrect a deliberately withdrawn desire.

Pending review bases include persistence, and appraisal's own-goals basis does
too. Late semantic changes invalidate edits; appraisal may retain historical
interpretation without applying obsolete affect/goals. Deferred-goal definition
serialization is unchanged: resumption asks for fresh review, grants no action
authority, and never changes the stored persistence.

First red: 97651 exit1, five new failures/21 passes, 0.844s,
/tmp/argos-standing-red.log. Final focused: 4162 exit0, four suites/134 tests,
1.911s, /tmp/argos-standing-focused-final.log. Types: 27191 exit0,
/tmp/argos-standing-types-final.log. Includes production appraisal with and
without narrative mode, ordinary-release rejection without partial affect/goals,
explicit withdrawal/no resurrection, mixed-batch atomicity, late persistence
changes, and existing cleanup/defer/restore coverage. An intermediate test used
the wrong historical status spelling; corrected to the actual historical_only
contract. Full regression44006 terminal exit0: 281 suites, 3503 passed, 10 skipped,
194.801s, /tmp/argos-standing-full.log. Whole-worktree diff check passed.

## Prospective bounded diagnostic

After the full regression passes: one 120s no-H3 core-only handoff run with
--controller=situated --label=standing-desire-diagnostic-01. Use the unchanged
handoff correction contract and configured models; no source edits/heavy tests
during the run. Retain every outcome. This is a diagnostic, not a replacement
for closed batch04 or a new acceptance batch.

Inspect both actual read times, current appraisal revisions/reasons, the standing
motivation lifetime, actual document actions and replies, foreground latency,
and runtime/rendering health. A goal or stated intention is not task completion.
Explicit withdrawal/refusal remains a valid choice, not a forced failure. If
ordinary release is proposed and rejected, record it as controller noncompliance
rather than claiming the underlying semantic confusion is solved. No required
reply or scripted emotion; no acceptance claim from one favorable run.

## Retained diagnostic outcome

51673 terminal exit0; recordings/sitcom-handoff-boyfriend-YswWm4,
/tmp/argos-standing-live.log. Simulation120s, core-only/situated, no H3. No source
edits or heavy tests during the run. First text read18.7s; correction read52.2s
(24.2s after injection). Appraisal21s current,55s historical_only because
affect_changed. Neither emits an intention revision; no rejected standing release
appears in appraisal diagnostics. Saved communication goal29 remains active,
standing, priority6/progress0. This supports preservation in this trial, not proof
that the model can no longer misuse withdraw or that all later choices are fixed.

Elaine discloses the first instruction31s and correction59.6s, with extended
plumbing banter. Moves toward the notebook80s, picks it up82.8, writes89.85:
“Plumber visit scheduled for tomorrow at 11:00 AM to inspect the bathroom tap.”
Reads91.2, reviews96.5, moves Kitchen99.5, finishes101.6, drops104.1. Saved
WikiDoc.status=finished; WorkDocument revision=reviewedRevision=1; actual
LocatedIn Kitchen. Reply created110.485/delivered110.685 accurately reports
the updated note left in Kitchen. This is one completed actual document chain,
not merely goal adoption, and not an acceptance-batch replacement.

Runtime failed:null, zero slow ticks, mean6.1ms. Foreground operation p95 Jerry
4839ms/Elaine3729ms, maxima7167/4137ms. Offline compilation reason:null and
cursor119500ms versus history end120000ms, unfilmedTail:null: do not claim full
120s coverage from that incomplete cursor or any actual H3 result.

Next diagnosis: distinguish persistence from stale activity. Cognitive frames
22/55/65/85s still retain the original5s activity purpose “Go to the kitchen to
check my buzzing phone and get the cookie from the orange tin,” linked to the
evening-with-Alex goal. By85s she is collecting the notebook elsewhere. Inspect
how same-goal strategy changes, completed substeps, interruption/resumption and
conversation decisions update this activity. Do not automatically erase a larger
purpose on each sentence or force work whenever there is banter. Determine whether
the retained purpose is a valid larger undertaking, stale executable context, or
misleading display before changing it. No further run started; batch04 stays failed.
