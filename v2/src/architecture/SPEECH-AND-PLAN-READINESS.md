# Speech occupancy and plan-readiness diagnosis

2026-09-07; retained handoff YswWm4, first80 simulated seconds. No new live run.

Paired sitcom speech pending/succeeded by executionId, not public speech
fragments (which publish succeeded before the utterance finishes). Elaine's
actual voice spans:24.5–31.04,43–49.14,54–59.58,71–76.7s, totaling23.96s.
Either character's voice occupies38.3s of the80s window, neither41.7s. Elaine's
public physical action pending/succeeded pairs total13.6s; own voice or physical
action union37.56s. The other42.44s is NOT automatically idle opportunity: it may
contain listening, inference, explicit waiting, unselected plans or new evidence.

She opens the tin34–34.8, observes35–36, picks cookie37–37.8 (during Jerry's
36.5–40.52 speech), reads correction51–52.2, closes tin60–60.8, walks77–80.
There is a foreground request28.5 during her own voice, following correction
delivery28.2. Thus bodies can act during someone else's speech, and own speech
does not prevent urgent deliberation. Total scheduler starvation is contradicted;
the deliberate banter/late writing is not explained by voice occupancy alone.

getForegroundCognitionReadiness intentionally suppresses quiet reconsideration
while own voice/body is busy, but admits new stimuli and critical needs first.
Automatic activity-return has additional fresh-attention/own-voice/bound-plan
fences. Removing these wholesale would grant new physical work, not just improve
timing. No such removal made.

## Concrete readiness mismatch repaired

hasActionablePlannedStep selected the highest-priority goal for its read-only
readiness probe, even in situated mode, while execution uses situatedPlanGoal.
The speech-deferral branch independently did the same priority lookup. An
unselected background proposal could therefore repeatedly report runnable work
that the situated executor would not select, rather than respecting a quiet
decision and its bounded deadline. This is source/test evidence of a mismatch,
not proof it caused a specific pause in YswWm4 (no full readiness snapshot trace).

Both probes now use the same selected-goal lease in situated mode; priority mode
is unchanged. This grants no motor authority, bypasses no prerequisite, and does
not suppress actual new evidence, plan/goal state changes or bounded idle review.
No selected goal/expired lease means no claimed actionable selected plan.

Regression: a low-priority selected personal intention versus an unselected
higher-priority physical proposal. The latter does not wake as actionable work;
the same physical step attached to the selected goal does, including during a
speech-floor deferral. After10s the lease expires. New stimulus remains first.
Uses production personal-intention identity and a real room move target.

Initial red84981 and59213 exit1; initial fixture later corrected from raw goals
to production personal intentions (raw goals lacked selected identity). Intermediate
focused93065/46485 failed fixture checks. Premature full63776 explicitly stopped
SIGINT at identified JestPID76347, terminal exit130; not counted as validation.
Corrected focused97947 exit0:131passed/2skipped/3suites1.981s,
/tmp/argos-selected-readiness-verified-focused.log. Final full49037 terminal exit0;
see /tmp/argos-selected-readiness-full-final.log. Types19165 terminal exit0,
/tmp/argos-selected-readiness-types-final.log. Whole-worktree diffcheck clean.
No claim of behavioral speedup yet.

Next bounded live diagnostic: one120s core-only handoff, situated controller,
label selected-readiness-diagnostic-01, same configured models and text timings.
Do not change source or run heavy tests during it. Inspect actual read/work/reply
chain and plan readiness/decision counts if available; preserve nonadoption or
failure and do not convert quietness into success. Compare descriptively against
YswWm4, not as an isolated causal experiment: that retained run also predates the
activity-entry context correction. No new acceptance batch or H3 authorized here.

## Retained selected-readiness diagnostic outcome

35961 terminal exit0; recordings/sitcom-handoff-boyfriend-AYBifx,
/tmp/argos-selected-readiness-live.log. Reads24.2/42.7s; no replies. Corrected
note written85.2s, reviewed89.5, finished103.1, picked up104.3, Kitchen107.5,
dropped113.1. Saved document finished/revision1/reviewedRevision1, actualKitchen,
body “Plumber will arrive tomorrow at 11 AM to check the bathroom tap.” Physical
work completed, communication loop incomplete. No false delivery claim.

Standing communicationgoal29activepriority6. Appraisal27s current reprioritized
eveninggoal24 to8;47historical,49.5invalid_emotional_episode,54current,
82.5historical,99current. Long banter still occurs. Foreground25completedElaine/
24Jerry; p95Elaine8019ms/Jerry7122ms; timeouts60.5/69s. Runtime mean5.88ms,
0slowticks/failednull. No demonstrated latency improvement. Offlinecursor119500
vs history120000/tailnull/reasonnull still uncertain fullcoverage, notH3proof.

No reply action recorded. At114.5s the foreground rejected invalid_schema at
goalReview;115s begins another request but no accepted result before shutdown.
Cannot infer which proposed operation failed from the old coarse telemetry.
This motivates typed rejection diagnostics, not forced reply or relaxed atomicity.

## Goal-review diagnostics

prepareGoalReview now optionally emits only fixed categories schema/goal/
operation/deferral/changed. The foreground records them as schemaField and also
distinguishes disabled review and conflict with the simultaneously selected goal.
No raw model values/private prose added; validation still rejects the whole
inconsistent decision before writes. This changes diagnostics, not permitted
choices. A failed/stale review does not silently detach its action from its meaning.

Red82290exit1:5fail/18pass0.716s. Focused27101exit0:209pass/four suites3.278s.
Types75075exit0. Added caller-level chronicle assertion; final focused pending
in /tmp/argos-review-diagnostic-final.log. No full-suite claim for diagnostics yet;
prior full3506passes covers selected-readiness and entry-context repairs.

NEXT: one120s core-only/situated handoff diagnostic with unchanged inputs/models,
label goal-review-diagnostic-01 after final focused passes. Retain outcome and
inspect typed rejection causes, timeouts, actual work and reply. No source edits
or heavy tests during run; no H3. This is diagnostic evidence, not batch acceptance.

## Retained typed-review trial

Final focused14331exit0:209tests/4suites3.112s; caller chronicle verifies typed
goalReview.goal. Typed diagnostic trial34753exit0, recordings/
sitcom-handoff-boyfriend-yeH2wu, /tmp/argos-goal-review-live.log. Read14.7/36.2s;
no reply, blank draft/revision0 in Living Room at120s. Cookie actually picked
up70.8s, then further listening/joking. Autonomous goal120 to write the note
exists, but no foreground choice of that goal or writing action is observed;
do not count background goal generation as adopted/executed work.

Only decision rejections are Jerrytimeout38s and Elainetimeout51.5s. No goal-review
rejection, so this run does not identify AYBifx's old failure subtype and shows
that such a rejection is not necessary for prolonged banter/nonadoption.
Current choices59.5 agree/vent,77 reply to joke,84 wait for quip response,
96 joke about overalls,102.5/106.5/108.5 listen,112.5 banter back. All listed
goal24 preparing for evening. Request creates a perceived subject, not reliably
an organizing task. Standing communicationdesire remains available.

Runtime mean5.81ms/0slowticks/failednull. Foreground countJerry28/Elaine25,
p95Jerry3575/Elaine6478ms. Offlinecursor118000/history120000/reasonnull; still
not proof of complete footage. No H3, no source edits/heavy tests during trial.

## Next prospective horizon diagnostic

The authored duet explicitly says there is time for conversation, no forced
departure, and dinner is later. It supplies no immediate deadline. Do not impose
a new deadline retroactively or call arbitrary social delay a cognition failure.
Equally, do not relabel the120s incomplete handoff as a pass.

Run one new300s episode using the existing --extended safety opt-in, core-only,
situated, same handoff texts at8/28s and configured models; label
handoff-horizon-diagnostic-01. Preserve120s outcome separately from300s outcome.
This distinguishes eventual deliberate work/refusal/defer from an open-ended
conversation cycle over a longer horizon. Inspect actual reads, outgoing replies,
work artifact and placement, activity/intention expiration or withdrawal, waits,
decision failures and clock/runtime health. Retain failure/nonadoption; don't
extend this episode again to manufacture success. This is NOT the required
10/30minute acceptance soak or a replacement for batch04. NoH3 or serverrestart.
