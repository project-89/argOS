# Five-minute handoff horizon diagnostic

Prospectively declared in SPEECH-AND-PLAN-READINESS.md. One new300s episode,
--extended --core-only --condition=handoff --controller=situated, label
handoff-horizon-diagnostic-01. Same configured models/texts8s/28s, noH3. Source
unchanged/no heavy tests during run.39228 terminal exit0; retained recordings/
sitcom-handoff-boyfriend-CqIwX7, /tmp/argos-handoff-horizon-live.log.

## Separate time horizons

At120s: first text read27.2, correction54.7; refusal created108.63/delivered108.83:
“Alex, I'm having dinner with you, not managing your plumbing. You'll have to
handle the note yourself.” No document work. This is an actual communicated
choice to decline, not failed delivery, task completion, or silently ignored work.
Background desire181pushback active; communicationdesire29stillactive.

At300s: note remains blank/draft/revision0 in Living Room, consistent with refusal.
Cookie actually eaten165–168s. Plumbing/toolbelt/relationship jokes continue for
minutes; weak pacing, not a forced-compliance failure. Late coffee shift: Jerry
picks blue mug287.3, pours289–291; Elaine picks red297.8 and begins pour299.5,
but that second pour is not completed at cutoff. Jerry gives blue toElaine300.
Saved pot3portions/bluefilledheldElaine/redemptyheldElaine. No drinks occurred.
Do not count a completed drink or second pour from intentions/pending actions.
Pushbackgoal181 completed byend; eveninggoal24 and standingcommunication29active.

Runtime failed:null, zero slowticks, mean7.04ms. Foreground countsJerry59/Elaine63;
p95Jerry7518ms/Elaine6645ms (targetstillmissed). Offlinecursor300000/history300000,
reasonnull/tailnull: complete offline compilation for this run, no actualH3 proof.
At120Elaine admissiondiagnostics:25 admissions,20new_stimulus/3first_decision/
2state_changed. This does not show unselected-plan wakes dominating this run.

## Interpretation and follow-up repair

Longer horizon separates autonomous refusal and slow subsequent progression from
an endless failure to perceive or act. It does NOT repair earlier120s outcomes,
pass batch04, demonstrate10/30minute soaks, or prove maintenance-on world growth.
The authored duet explicitly allows conversation with no imminent departure,
and its personalities/motivations support social commentary. Don't retroactively
invent urgency or classify any refusal as a cognition defect.

Source audit found an opportunity-cost visibility gap in activity review:
ActivityState already keeps startedAtSimMs, but captureActivityReview exposed
only elapsedSimMs since the previous review. Each continued review resets that
window, concealing cumulative encounter time from this context. Now expose the
existing total as encounterElapsedSimMs and reviewCount. No added ledger, action
authority, novelty requirement, forced end, or threshold change. The window
elapsedSimMs remains for its existing semantics. This is accurate context, not
proof it changes autonomous behavior.

Regression:20sfirstreview then30smore -> second window30s, total50s, reviewcount1;
continuation remains allowed. Red94928exit1:1fail/19pass0.731s. Focused57294exit0:
193pass/3suites2.273s. Types45698exit0. Logs /tmp/argos-encounter-time-{red,focused,types}.log.
Full76085 terminal exit0:281suites/3512passed/10skipped195.9s,
/tmp/argos-encounter-time-full.log; includes prior typed-review diagnostics.
Whole-worktree diffcheckclean. No more live run started.

## Next cross-scenario protocol

Use the existing escape-room testbed for one bounded live planning diagnostic:
`npm run eval:escape:live -- --seconds=300 --seed=11 --topology=relay`.
First inspect its current lock using PID liveness (the runner already enforces
this), configured capture/shutdown path and any relevant testbed instructions.
Do not pass an unsupported controller flag: this runner currently has no such
option and uses its existing configuration. Record that actual configuration;
do not claim an isolated comparison against situated apartment trials.

The relay is a genuinely constrained ECS puzzle, not a new timer or forced
compliance rule added to the apartment. No perturbation in this first refreshed
baseline; later changed-prerequisite tests remain separate. Inspect actual
milestones, mistakes, own/heard knowledge, plans/working memory and shutdown.
Retain incomplete outcomes; no H3, world-builder enablement, model-default change,
or extension past300s. Passing this one diagnostic would not replace batch04 or
complete maintenance/repeated/10-and30minute acceptance requirements.
