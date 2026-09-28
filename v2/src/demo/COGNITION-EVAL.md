# Cognition first: September 4 timing audit

No H3 sessions were allocated for these checks. Live checks used native Argos
cognition, planning, God/spirits and world evolution, with real phone physics.
They are bounded interaction tests, not proof of sustained narrative quality.

## Historical rendering mismatch: not just a clock offset

The saved run `recordings/phone-2026-09-04T09-04-46-411Z-22d657/` contains an
initial 10.125-second video chunk and subsequent 8.5-second chunks, not five-second
chunks. At video second 50, inspected footage already shows Mara holding the
phone. That chunk's assigned source snapshot is simulation second 31, when she
has only reached the Landing and the phone is still on the Bedroom desk. The
actual ECS pickup finishes at simulation second 62, assigned to a later shot
mapped to video second 95.125.

That saved baseline used the old ordered prompt queue: the camera director waited
for the previous rendered version before releasing the next prompt, so its 750 ms
state poll was not prompt throughput. Intermediate opening/delivery/furnishing
snapshots could each consume a chunk. Changing the thought offset cannot repair a
video that invents a future physical action: doing so would reveal knowledge or
message receipts before the corresponding ECS event.

## Current rendering architecture and corrected paid probe

The source audit tape still preserves every meaningful immutable source snapshot,
but the H3 render deck now holds at most one unissued projection. A new source
state supersedes an obsolete unissued prompt rather than accumulating a FIFO
backlog; issued segments remain immutable. Up to six compact causal checkpoints
bridge skipped states without carrying thought or message bodies. The committed
ECS is still the only world truth.

An accepted timed physical action can also provide a conditional trajectory to H3.
Director accepts requested chunks from 5–15 seconds, but its continuation trim
means requested duration is not the safe visual horizon. The new ten-second
default begins with an eight-second forecast window; actual playback metadata then
recalibrates it by flooring to a half-second, subtracting a 500 ms end guard and
clamping to 1–15 seconds. Session information applies immediately; playable chunk
duration is the later ground truth. An 8.5-second continuation therefore yields an
eight-second horizon, while 3.542 seconds yields three seconds. Completion is named
only when it lies inside that guarded horizon; otherwise the prompt requests
normal-speed progress and explicitly forbids an early arrival, pickup, read, send
or door opening. The trajectory is rendering guidance, not a committed event or
NPC knowledge. A contradictory operator edit immediately fails the relevant
activity and removes its projection.

The opening segment (`chunk_index: 0`) can be untrimmed, so a post-probe refinement
treats it as a ceiling-only observation: it may lower an overoptimistic horizon but
cannot raise one. Real continuation metadata still recalibrates in either direction.
The regression now proves that a 10.125-second opening cannot inflate an eight-second
forecast to 9.5 seconds. This guard landed after the paid run below and has not yet
received a separate paid validation run.

Raw H3 pixels are still speculative and best-effort. Once generated, they cannot
be recalled when a later ECS mutation invalidates the forecast. The adjacent UI
is stricter: each accepted action freezes a `basisSequence`, and successful ECS
completion appends an `actionCommits` proof. At the cue, the presentation applies
only the minimal arrival/pickup/read/send/open patch when a later immutable shot
matches that exact basis and event with a commit at or after the projected `atMs`
(plus message identity where applicable). It advances cue time, phase and proof,
then only the event-specific fields; all unrelated future fields stay frozen at
the source snapshot. Without exact proof the UI holds the pre-state, but it cannot
erase contradictory pixels already delivered by H3.

The post-probe proof review added regressions against copying later aggregate
read counts, unread reminders, phone locations or delivery receipts backward.
Each patch now reconstructs the exact event delta from its source and commit:
one read, pickup in the original room, carried inventory moving on arrival, and
offline sends remaining queued until actual delivery. Film cue time is editorial;
the proof record preserves when the event actually committed in simulation time.

Transport flow and displayed truth are now independent. `prompt_pending` is a
delivery receipt but does not claim that pixels are displayed. `prompt_applied`
releases the one-slot deck, `prompt_rejected` is terminal, and a gap-free chunk can
settle transport when an applied event is absent. The audience presentation still
advances only through contiguous chunk metadata at the segment's displayed-frame
boundary. Where supported, the browser uses `requestVideoFrameCallback` rather
than a UI polling estimate. Saved telemetry decomposes source → sent →
pending/applied → chunk ready → displayed and records source-to-film offset and
frame-crossing lateness. Source-to-sent/applied/display wall latency is anchored to
the immutable shot's capture wall time, rather than inferred from simulation time.

No same-version timeout retry is valid. Once any matching delivery receipt arrives,
the client waits for settlement and never sends that version again. No receipt in
15 seconds is terminal; `prompt_pending` starts a distinct 30-second
pending-to-settled watchdog whose timeout is also terminal, never a resend.

The default configure now requests ten-second chunks. An explicit configure-time
schema rejection may still fall back once without `chunk_duration`, but that
compatibility path is separate from prompt transport and never duplicates a
`prompt_version`.

Generic non-phone actions now carry pending/succeeded/failed outcomes into their
camera directions, with completed consequences limited to committed local state.
Prompts are capped at 50,000 characters: identity and final authority/trajectory
rules survive, while oversized grown-world context in the middle is explicitly
truncated.

### Paid H3 validation status

The first paid probe is saved at
`recordings/phone-2026-09-04T21-09-36-176Z-dbcda2/`. It proved that the provider
accepted a five-second configure. The initial chunk reported 5.167 seconds of
playback; continuations reported 3.542 seconds after the provider's 39-frame trim,
which is too short for rich action beats. A timeout resend of prompt version 7 then
received `stale_prompt_version` (“prompt_version must increase”), and the provider
returned a terminal error; the client stopped at about 12.8 displayed seconds.
The MP4, `demo.json` and `playback.json` preserve that failed probe rather than
hiding it.

The corrected second probe is saved at
`recordings/phone-2026-09-04T21-16-35-564Z-4bd5d7/`, including the raw
`director-2026-09-04T21-18-12-579Z-ad33cecc.mp4`, `demo.json` and `playback.json`.
The MP4 is 59.304 seconds (59.295 seconds on the saved playback clock), H.264/AAC,
832×480. The provider accepted and reported a ten-second configure: the opening
chunk played for 10.125 seconds and each of six continuations for exactly 8.5
seconds. The eight-second guarded projection horizon therefore matched this run's
continuation contract.

| Corrected probe measure | Observed |
| --- | ---: |
| Meaningful immutable source shots | 52 |
| Issued prompt versions | 9 |
| Coalesced unissued versions | 42 |
| Maximum pending render-deck depth | 1 |
| Segments crossing a displayed-frame boundary | 7 |
| Source-to-film offset p50 / p95 / max | 12.125s / 13.625s / 13.625s |
| Capture-wall source-to-display p50 / p95 / max | 11.624s / 13.438s / 13.438s |
| Provider generation p50 / p95 / max | 1.982s / 2.865s / 2.865s |

The directly comparable old ordered-queue gap was p50 20.625s, p95 36.625s and
max 42.625s. The one-slot projection substantially reduced and bounded that
backlog in this sample, although display still trails source by roughly one
continuation. Frame-clock boundary observation itself was within 38ms at worst;
that measures when metadata changed beside the video, not whether H3 obeyed the
prompt inside every frame.

The provider emitted one `deadline_missed` for chunk 4. It was nonfatal: chunk 4
and later chunks 5 and 6 arrived. There were zero terminal provider errors, prompt
rejections, duplicate-version retries, missing-receipt timeouts and
pending-to-settled timeouts. The final prompt and one newest deck entry remained
outstanding when the run was stopped manually near its 60-second target; they are
normal bounded-stop state, not evidence of a deadlock.

### Cognition and committed action sequence

- At 0s Mara decided to investigate and began opening the basement door. The
  outside warning was delivered to her upstairs phone, which emitted its familiar
  vibration; she perceived it without receiving the unread body.
- The door opening committed at 5s. Mara then decided to follow the phone alert,
  reaching the Landing at 9s, Stairs at 14s and Bedroom at 18s.
- A physically unavailable action at 18s failed instead of changing the world.
  Her next deliberation identified that she first needed the phone; the desk-to-
  hand pickup committed at 25s.
- She chose to inspect the notification at 26s. Reading committed at 31s, only
  then exposing “Mara, don’t open the basement door. Someone is down there.”
- At 32s she decided to question the sender. Typing remained unsent until the
  outgoing “Who is this?” commit and delivery at 39s.
- She waited, then attempted to examine the basement door remotely at 45s. World
  constraints rejected it. At 51s she reasoned that she needed the Landing first,
  departed with the phone, and arrived there at 59s.

This is a successful causal ECS/cognition trace with exact `actionCommits`, not a
claim of flawless policy. The unavailable actions are visible evidence that the
world rejected invalid intent and cognition recovered; they also show remaining
room to improve action selection. Per-second contact sheets were visually
inspected and show the interior opening, basement-door opening, house traversal,
explicit desk-to-hand pickup, and read/type/send coverage. That sampling is not a
formal frame-by-frame semantic conformance score: phone lettering drifts, visual
cadence can differ from requested cues, and this run did not invalidate a
projection after its segment had already been generated.

This is also not an indefinite-stream implementation yet. The source audit tape
grows without eviction, and each full state response clones/serializes that
history, producing roughly O(n²) cumulative traffic/work. The 10–120 second demo
bound contains it. A continuous service still needs append-only event persistence,
bounded in-memory windows and cursor/delta delivery rather than full tape snapshots.

## Engine changes

- Independent per-NPC cognition operations use two reserved foreground slots;
  background planners/builders have three separate slots. A slow builder or
  another slow NPC no longer occupies all available cognition capacity.
- Readiness is checked before enqueueing. A ready world-capability actor is not
  blocked again by unrelated arousal/tick-parity gating. Runtime simulation ticks,
  rather than wall-clock millisecond parity, drive cognition scheduling.
- Per-actor stimulus draining preserves other actors' queued input. Goal cooldowns
  advance once per world tick, not once per NPC operation.
- Concrete new input immediately cancels an obsolete model request, including
  nested calls. Soft daemon/narrator suggestions wait for the next decision rather
  than repeatedly invalidating one already in flight.
- Full-demo movement is distance-based: four seconds per adjacent house room.
  Basement-to-Bedroom travel takes twelve seconds whether selected directly or
  in three steps. Pickup/read/type still take four/five/seven seconds respectively.
- Routine furnishings and repeated perception summaries no longer manufacture
  arousal; significant novel stimuli still attract attention.
- The live evaluator records readiness delay, model duration, perception-to-thought
  time, completed actions and unread-message context leakage. A successful reply
  with failed latency gates now produces a failing process exit status.

## Run and acceptance gates

```sh
npm run test:phone:live
ARGOS_PHONE_CHECK_SCENARIO=moved npm run test:phone:live
ARGOS_PHONE_CHECK_SCENARIO=power npm run test:phone:live
ARGOS_DEMO_SIMULATION_ONLY=1 npm run demo:phone
```

Live checks spend cognition/world-building credits but never allocate FAL.
The last command also blocks H3 start requests server-side, even with a configured
FAL key. These are acceptance targets for this small authored house:

- A real opening thought at source time zero (prepared before the runtime starts).
- Readiness-to-start p95 at or below two seconds.
- Recognized notification to a subsequent thought at or below eight seconds.
- A delivered reply within sixty seconds of incoming delivery.
- No unread message body in sampled NPC world-capability context.

Reply timing is measured from **delivery**, not original send time. A phone without
power cannot deliver. A character choosing not to reply remains a valid character
choice, but does not meet this particular interaction test's acceptance target.
Privacy checks sample the world-capability context; they are not exhaustive proof
against paraphrased leakage through every possible cognition channel.

## Observed live results

All paths below are under `recordings/phone-live-check-<id>/result.json`.
Times in the read/reply columns are elapsed since incoming delivery.

| Scenario | Result ID | Heard → thought | Delivery → read | Delivery → reply | Ready delay p95 | Model duration p95 |
| --- | --- | --- | --- | --- | --- | --- |
| Normal, latest rerun | 1788554678904 | 3 s | 26 s | 34 s | 0 ms | 1,660 ms |
| Normal, final rerun | 1788514754817 | 1 s | 28 s | 36 s | 0 ms | 2,528 ms |
| Phone moved during approach | 1788514422732 | 2 s | 50 s | 60 s | 0 ms | 3,792 ms |
| Dead battery, then restored | 1788514533720 | 2 s | 26 s | 36 s | 1,000 ms | 2,944 ms |

All four passed their gates. The latest normal run's decision duration was p50
982 ms and p95/max 1,660 ms, with no action failures or sampled privacy violations.
The earlier final normal run's median model duration was 972ms. In the moved case,
Mara went upstairs, observed the missing phone and returned to the Landing after
recognizing its buzz there; relocation did not automatically inform her mind. The
moved/power runs precede the final stale-request cancellation improvement; they
are counterfactual evidence from that checkpoint, not repeated trials of final code.

The normal repeat `1788514642640` **failed** its readiness gate despite eventually
replying. A message superseded an in-flight decision, but its provider request
kept running, producing a five-second p95 readiness delay. This led to immediate
cancellation on concrete input; the final rerun above passed. Keep this failure
in the evidence, rather than counting every eventual reply as success.

Historical regression checkpoint after the cancellation fix: **541 passed, 10
skipped across 78 suites**. Build passed. New regressions at that checkpoint cover
reserved concurrency, independent NPC progress, scoped stimulus draining,
route-equivalent travel, arousal stability, concrete-input cancellation versus
soft whispers, and the simulation-only guard.

Final full-repository verification after the timing and proof refinements passed
**95/95 suites: 777 passed, 10 skipped** in 36.803 seconds. The focused demo suite
passed all **84 tests across 10 suites**. Typecheck and diff-check passed. The
earlier full-suite checkpoint before this final review was 774 passed, 10 skipped.

## Still unproven

These short runs do not establish long-form planning/story quality, multiple-world
isolation in one process, or completed hot activation of a new generated system.
God/evolution created entities and furnished rooms during the checks, but queued
coding work is not evidence of activation. Those need longer targeted evaluations.
The revised H3 render deck, duration calibration and receipt protocol now have one
successful bounded paid run; repeatability, counterfactual interruption behavior
and raw-pixel visual compliance remain unproven. Indefinite event storage and
bounded state delivery are not implemented. Keep video generation disabled for
cognition-only evaluation; validate rendering semantics separately.

Latest-only coalescing can skip a short action's visual coverage when it finishes
before its prompt is issued. The continuity bridge retains context, but preserving
important committed transitions in a bounded priority lane is still future work.
