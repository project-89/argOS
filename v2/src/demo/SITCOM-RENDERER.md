# Sitcom renderer bridge

The simulation owns events. The screenwriter turns already-lived public events
and visible state into instructions. H3 renders those instructions; it does not
decide dialogue, NPC actions, message receipts, thoughts, or world outcomes.

### Opening-scene follow-up

Direct openings now introduce the room and local cast in prose instead of
`SET`/`CAST`/`VISIBLE PROP` lists. Captured `SceneActor.publicRole` can add an
explicitly published social role. The apartment fixture publishes only its
authored host/friend/neighbor notes, bound to the original ECS actor lifetime;
it does not export arbitrary `Agent.role`, private biography, motives or phone
contacts. Unknown/generated actors receive no inferred social role. The normal
public snapshot bounds this field, so committed-history replay retains the same
opening notes without consulting the current world.

The opening preserves faces/voices/wardrobe and room layout, rather than asking
H3 to preserve characters' positions indefinitely. Its first performed action and
dialogue remain the committed scene cues; an idle interval stays idle. This is
not permission to invent a dramatic interruption or show concealed props.
Continuations and sparse continuity refreshes retain their compact format.

Offline preview, exact saved-history replay and audit:
`recordings/opening-scene-review/`. All 717 demo/rendering tests and TypeScript
passed. No new H3 output was generated or judged in this follow-up.

## September 14: establish once, direct the next moment

The `direct` prompt style now establishes the visual language and dialogue
convention in the opening, then sends public changes and performances. It removes
the repeated rule blocks, per-line “Then stop speaking”, unchanged blocking,
and identical consecutive camera directions. Exact dialogue remains attributed
to its stable actor, with speech-time public expression/posture/condition. Real
interruptions and partial utterances remain explicit. Quiet intervals use room
tone, rather than a list of forbidden sounds or invented filler activity.

This follows the continuity-oriented advice in Fal's
[Director guide](https://fal.ai/learn/tools/what-is-minimax-h3-max-director).
Its memory is rolling, not indefinite: the writer introduces new visible
context and sparsely refreshes known cast/place/prop descriptions after ten
accepted script versions. Room cuts identify the people already present; they
are not entrances. The last view and context registry advance only on commit,
so a discarded candidate cannot suppress the next accepted introduction.

This is a **presentation change**, not an event reducer or new director. The
original beats, full performance ledger, speaker/visibility intervals, word
evidence, failures, privacy filtering, source bounds and 1:1 timing remain intact.
Known renderer boilerplate is simplified outside quoted data; authored dialogue
and public descriptions are never rewritten to remove negative words. Legacy
`timed` formatting and the native append/admission/playback contracts are unchanged.

Reprojecting `h3-bounded-verification-Q0aTi4` offline produced
`recordings/sitcom-ensemble-check-KNK9vd/prompts.md`: 34,028 → 9,746 characters
(71.36% reduction), with 22 → 13 camera instruction lines. All non-prompt
screenplay fields compare identically. Audit and preserved failing test logs:
`recordings/simple-directions-gxqEHH/`. These numbers are **not** evidence of
better generated speech or fewer actual cuts. Same-source H3 replay remains
necessary; mid-utterance packet boundaries and physical insert cuts still exist.

Earlier sections below describe historical prompt contracts, not the new prose.

## September 13: queued plain-language, real-time scenes

New GUI launches use the existing native script-append transport with **plain
directions and 1:1 source time**, not the former timed/performance-packed writer.
One committed scene may queue behind the current one. A one-beat script-admission
receipt permits that successor; a `prompt_pending` receipt does not. Only actual
contiguous media versions and playback advance the displayed world. The queue
count, 28s media-debt cap, 30s source-lead cap and oldest-pending timeout remain.

The recorded `h3-bounded-verification-EJity7` direct run sent v8 about 15ms after
receiving v7's slow chunk; H3 nevertheless generated another v7. Waiting for
generation completion was too late for that update. Native append queues a
successor without replacing an undispatched current scene. Do not implement
direct lookahead by treating `prompt_applied` as proof that generation started:
the [Fal contract](https://fal.ai/models/minimax/h3-max/director/api) describes
admission, not completed depiction or a direct-prompt dispatch fence.

Native default packets cover 10 committed simulation seconds each. Exact
configured duration/resolution and actual media identity/duration are checked;
incompatibility stops the run, never silently retimes it. `--h3-direct` (or
`ARGOS_H3_SCRIPT_QUEUE=0`) retains the explicit 10.125s/8.5s direct diagnostic
transport. `--h3-script` overrides that environment setting. There is no fallback
from failed append to replacement prompts. Low-level director tools still expose
the historical performance-packed mode for forensic comparison.

Room transitions now explicitly cut to the recorded destination with its exact
cast count and stable identity labels. Holding a composition applies **within**
that room, not across a location cut. No NPC movement, cast member, speech or
private information is added by this instruction change. Offline checks cannot
guarantee that H3 stops duplicating characters; that requires a new visual test.

The sections below retain earlier design history; this section supersedes the
old GUI defaults and one-outstanding-window transport description.

## September 5 wiring review

The saved `sitcom-live-nM1FiN` run issued only five prompt versions, covering
0–42.5 seconds of simulation, despite recording 23 provider chunks. Sixteen
chunks carried version 5. The client recorded `source_ended` but did not stop
provider generation. This explains the stuck source-aligned thoughts and later
messages waiting for a scene while video kept playing. The old logging discarded
the source-end reason, so its original trigger cannot be recovered conclusively.

The old projector also repeated large JSON state snapshots and supplied short
speech fragments. These are poor render instructions, but they do not prove the
cause of every audio defect in the old recording.

## Prompt contract

### Real-time ensemble camera

The real-time GUI path now holds a locked-off room-wide ensemble through ordinary
speech, reactions, pauses and movement. A different speaker changes the voice
owner, not the camera subject. Read/type/pickup/pour/drink intervals retain their
physical inserts, then return to the group. Cross-room and competing-audio
coverage, exact words, cue times and the unit-rate source/media map are unchanged.
The older performance-packed/timed path is not changed by this framing pass.

Public event witnesses can reorder actor arrays without anyone moving. The
real-time visible roster is normalized by entity ID before comparing framing;
this is a stable listing, **not a left-to-right layout**. Camera directions retain
established positions and the camera side; they do not manufacture ECS staging
or infer movement from list order. Fine-grained authored room blocking remains
a separate gap where the source does not provide it.

Offline comparison (no H3 or cognition calls):

```sh
node --import tsx src/demo/sitcom-ensemble-check.ts recordings/sitcom-live-k8oRLC
```

The first ensemble projection exposed roster-order churn (29 old camera lines
became 36); that evidence remains at `recordings/sitcom-ensemble-check-LGJr4V`.
After fixing roster order, `recordings/sitcom-ensemble-check-zinioP` has 13 camera
lines, one per update, over the same 112.125 seconds. All beats, dialogue,
cue times, source maps and coverage compare identically. These counts are prompt
instructions, not verified H3 cuts. A paid visual test is still needed to assess
spatial stability and whether wider frames regress voice attribution.

### Provider context

See the [official Fal Director API](https://fal.ai/models/minimax/h3-max/director/api).
`memory` is the number of preceding segment prompts retained for context (default
12, supported range 1–50). This is bounded context, not a guarantee that an opening
description remains authoritative forever. Configure uses memory 12. Do not send
unsupported `chunk_duration` fields or treat `prompt_applied` as depicted media.

`SitcomScreenwriter` emits:

- Opening cast, setting, visible props, and blocking. Every tenth subsequent
  version gets a state-only continuity refresh, not a replay of events.
- Compact continuation blocking plus new visible changes. Lazy assignment of an
  ECS stable identity is not interpreted as a physical entrance or disappearance.
- Ordered dialogue, movement, phone use, and sound beats, with **pre-budgeted media**
  times. Dialogue slices from one execution are joined, preserving their actual
  words; thoughts and private phone message bodies never become spoken dialogue.
- Explicit pickup targets and their publicly witnessed origin. Event witnesses
  carry the bound target and visible support, not a later lookup in live ECS.
- Silence when no dialogue was committed; hold the ending silently if a prompt
  remains active. These are instructions, not verified provider adherence.

### September 6: performance before generation

The saved `sitcom-live-OJ5IGi` opening requested two empty source seconds but
occupied a 10.125-second media chunk. Version 17 requested 13.58 source seconds
containing 27 spoken words inside an 8.5-second continuation. Mapping the UI after
generation could not repair those already-issued directions.

`sitcom-performance.ts` now builds a bounded performance **before** the prompt:

- Default media calibration is 10.125 seconds for the opening and 8.5 seconds for
  continuation; `openingMediaMs`/`continuationMediaMs` configure alternatives.
- The first source horizon is at least the opening media duration. A tiny empty
  prefix cannot become an artificial ten-second establishing shot. Short
  continuation prefixes containing only point-state or sound changes likewise
  remain queued until a meaningful complete beat fits; full lived waits are
  still honest intervals, and final receipts are not discarded.
- Cuts preserve complete spoken executions and essential pickup/read/typing
  gestures. Only actual completion receipts count, never expected deadlines.
  The director considers a bounded 20-second source horizon and tries safe cuts
  when a whole window cannot fit. Irreducible overflow fails explicitly without
  advancing the cursor or silently dropping words. A completed final spoken tail
  is covered even when shorter than the nominal source window.
- Exact dialogue receives a conservative 2.5-word/second minimum plus a clean
  ending. Pickups receive at least 1.6 seconds; reads/typing receive at least 1.8
  seconds of focal camera coverage. These are editorial budgets, not guarantees
  of H3 adherence. Conflicting speech/essential simultaneous gestures fail rather
  than being silently lost. The simulation itself is not slowed or rewritten.
- Idle source gaps may be compressed; performed movement is never stretched to
  fill spare space. Spare media time is an explicit silent ending, with mouths
  closed and no invented action. Phone inserts can retain actual dialogue from a
  different offscreen speaker; they do not expose unread text or private thoughts.
- Every source beat has a media cue and evidence IDs. `script.performance` stores
  focal shots, the cue ledger, and the source/media map. Segment metadata carries
  the same immutable map through server responses, recording, and replay.

Playback now follows that **issued map**, not a duration inferred after H3 has
already generated its performance. A materially shorter provider chunk is
unmapped; extra duration holds the ending. Older saved mapless episodes retain
legacy retiming. Neither version claims frame-exact or word-exact visual/audio
adherence. The 12,000-character prompt ceiling remains fail-closed.

Explicit `wholeUtterances:false` exists only for forensic small-window fixture
tests. Production defaults to whole utterances and essential gestures regardless
of the selected source-window size.

## Transport and failure behavior

The direct diagnostic path keeps one outstanding source window. The GUI append
path permits one queued successor after script admission, without consuming its
playback debt. Neither applied nor pending notifications advance audience time.
A repeated old version fails closed for real-time performances; it must not fabricate
new receipts or jump thoughts to the live world. The UI reports mapped/held state
and simulation lead; pending messages say they were sent to the simulation and
are waiting for video.

Source faults now stop video and simulation with a visible reason. Normal source
exhaustion sends stop to the provider before draining buffered playback. Provider
errors use its actual `error` field. A prompt that receives no representing chunk
within 45 seconds stops rather than indefinitely repeating the last scene.

Saved episodes include `screenplay.json` (exact issued prompts and evidence),
`renderer.json` (history bounds and source errors), `segments.json`, and transport
telemetry with versions, prompt lengths, chunk indices, durations and error reasons.

## Checks without H3 spending

### Restrained real-time conversation framing

`ConversationFraming` is small transactional editorial memory, cloned for each
screenplay candidate and advanced only with the accepted script. It does not
control NPCs. It is opt-in (`conversationFraming: true`); the live hybrid test
regressed spatial continuity on return from its two-shot. The production default
remains the stable room-local ensemble. In the candidate, after an observed
alternating exchange, two grounded speakers can earn a held two-shot across
roughly two continuation packets (17 seconds), followed by an ensemble cooldown.
Third-party dialogue, movement, loss/replacement of a participant, room/world
change or a source discontinuity cancels the pair. Continuations of the same
utterance do not count as new conversational turns. Physical inserts still
take precedence. Every interval rechecks public presence and actor lifetime.

Cue timing, exact dialogue, public action receipts and the unit-rate source map
are unchanged. A framing choice changes the camera/visible-cast ledger, not the
world's geometry. Instruct H3 to frame actors where they already are, never move
them together to compose a shot. The render model can still violate these
directions; automated ledger checks are not proof of visual fidelity.

`src/demo/run-hybrid-phone-verification.ts` launches one fresh full-profile cookie
episode, injects David's ordinary dinner notification at 34.5 simulation seconds,
begins bounded source drain at120 seconds, and allows a165-second receiver budget.
The source freezes its already-started public-action cohort at120s, gives those
actions time to settle, and seals on a calibrated packet boundary (hard latest
146.125s, within the declared30s source grace). New actions cannot renew this
budget. It records unfinished execution IDs on expiry; no predicted success or
phone delivery is fabricated. Operator abort and receiver spending caps still
stop immediately. This bounded test launcher uses stable ensemble framing now.
Browser Start is required. Both raw video and the synchronized thought/phone
composition are recorded. No host-forced phone action or success-seeking retry.

Phone emissions carry public acoustic reach sampled at emission. The apartment's
existing open-plan kitchen/living sound boundary now feeds perception and the
renderer from the same list. Audible offscreen sounds may enter a camera packet;
other-room speech/actions and private phone content do not. Acoustic reach never
moves the camera or makes hidden props visible. Old recordings without reach
metadata retain their original conservative scope; do not retrofit historical
audibility from the current world.

```sh
npx tsx src/demo/sitcom-renderer-check.ts
npx tsx src/demo/sitcom-renderer-check.ts --live --seconds=110
```

The default four-minute check is scripted offline physics, **not** an autonomous
cognition evaluation. It exercises speech, buzzing, pickup, read and reply, with
an intentionally lagging camera. The live option makes NPC model calls but never
opens an H3 session. Each run writes a separate `recordings/sitcom-renderer-check-*`
directory containing `report.json`, `screenplay.json`, and readable `prompts.md`.

The 110-second live check during this review had no source fault and brought
Elaine's read into the render instructions, but she did not send a reply. The
subsequent speech-boundary refinement was covered with deterministic tests and
the offline check, not another live NPC run. Do not confuse transport correctness
with motivation quality or claim that video/audio fidelity has been verified
without a new H3 run.
# Resolution selection and verification

New `demo:sitcom:ui` launches default to 768p. Set `ARGOS_H3_RESOLUTION` to
`480p`, `768p`, or `1080p` before launch to select another resolution; restart
the episode to change it. Low-level callers retain their 480p default unless
they pass `h3Resolution` to `createSitcomDemoApp`.

The client requires an exact `configured.resolution` receipt before admitting
chunks. A missing or mismatched confirmation stops the session; it is not a
silent downgrade. Playback telemetry records `resolution_confirmed` and actual
`received_dimensions`. Resolution alone does not verify a model release number,
visual adherence, speech quality, or source/video synchronization.

The provider endpoint remains `minimax/h3-max/director`. Official resolution
contract: https://fal.ai/models/minimax/h3-max/director/api (checked 2026-09-13).
