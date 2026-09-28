# Someone on the other side

A focused Argos demonstration: text Mara from outside her world; her physical
phone receives it upstairs; she chooses whether to fetch it, read it, type a reply,
or keep investigating the basement. Thought injection remains a separate channel.

## Run

```sh
npm run demo:phone
```

Open the complete token-bearing URL printed by the server (default port 3462).
The token is removed from the address bar after loading. A reload needs the
original URL. The server binds to **127.0.0.1**, not the public internet.

- `.env`: `GOOGLE_GENERATIVE_AI_API_KEY` for cognition, planning and world agents;
  `FAL_KEY` for H3. Coding uses the configured Argos coding-daemon backend.
- Start with H3: one video session, server-proxied credentials. Simulation ticks
  wait for the first video playback event; texts can arrive during warm-up.
- Simulation only: live cognition without FAL/video-generation spend.
- `ARGOS_DEMO_SIMULATION_ONLY=1 npm run demo:phone`: disables H3 in both the
  viewer and the server. Use this while evaluating cognition and world behavior.
- `ARGOS_DEMO_COGNITION=fixture npm run demo:phone`: explicitly labelled,
  deterministic test policy, no live NPC generation. H3 is still opt-in.
- `ARGOS_DEMO_SECONDS=90`: wall-clock bound, 10–120 seconds, including warm-up.
- `ARGOS_DEMO_PORT=3464`: alternate local port.
- One run per server launch. Stop aborts in-flight runtime model work, cancels
  pending coding jobs and retains the world. Initial cognition prepares a real
  source-time-zero thought before allocating H3; no artificial opening wait.

### Watch-first viewer

The main area is the video, then **one current thought** from the playing scene,
then four compact state readouts. The right drawer has phone messages at the top
and thought planting at the bottom. Thought history is collapsed there; the live
ECS inspector and interventions are under “Under the hood.” “Hide chat” expands
the viewing area. Fullscreen includes the thought/state strip and optional drawer;
the video's native fullscreen control is still available for raw-video-only viewing.
On narrow screens, the video, current thought and state stay first, with the drawer
stacked below. None of this UI is burned into the recording.

Revisit a saved run without running cognition, simulation or FAL:

```sh
ARGOS_DEMO_REPLAY=recordings/phone-2026-09-04T07-41-30-479Z-fb4b2a npm run demo:phone
```

Use `ARGOS_DEMO_PORT=3463` if a live server occupies 3462. Replay is explicitly
read-only; inputs are disabled. The ⋯ player menu includes exact-phone-text
visibility, raw download and scene jumps. Original runs need both presentation
snapshots in `demo.json` and `playback.json`; old recordings without them cannot
reconstruct this synchronization. All replay state/media routes require the local
capability token, and no world-write or provider-proxy routes are registered.

For the main demo, start and immediately text “Don't open the basement door.”
Watch the message's **queued → delivered → read** states. Mara cannot see the
body merely because it was delivered. Her response appears in your chat only
after typing completes and the outgoing message is delivered. With video on,
that reveal waits until the film reaches the corresponding source snapshot.
Your own sent text appears immediately; its receipt says “awaiting scene” until
the film catches up. This browser chat is the phone interface; no SMS number is required.

Try killing the battery before sending, restoring it later, disconnecting the
network while she types, silencing the phone, or moving it into the basement
while she walks upstairs. These controls mutate actual ECS component fields or
containment, not the render prompt. A planted thought does not force obedience.

## Authority and integration

The production entry point is `PhoneDemo.createLivingWorld()`, built on the
library's `createSimulation`. It enables the actual God autopilot, spirit
hierarchy, narrative engine, evolution coordinator, coding daemons, native
cognition, planning, reflection, memory, needs and schedules. `sim.start()` runs
the dual-loop runtime: deterministic ECS systems continue while model calls run
in separate queued operations. Planning does not block the action-selection loop.

Each NPC has an independently scheduled foreground cognition operation. Two
foreground slots are reserved separately from the three background slots used
by planning and world-building. Concrete new input cancels a stale in-flight
decision; daemon/narrator suggestions invite the next decision without repeatedly
interrupting the current one. Readiness delays and model durations are recorded.

Mara has real `Goal`/`Plan` entities, personality, memories and internal thoughts.
New significant perceptions or daemon whispers invite deliberation; they do not
force obedience. Goals can change, and a new high-priority intention does not
silently resume a lower-priority plan while awaiting its own plan. A small bounded
attention reserve prevents routine furnishing stimuli from erasing a notification.
Spirits and architects read actual ECS goals, arousal and thoughts. Newly created
NPCs receive their own daemons on subsequent daemon cycles.

`AgentWorldCapabilities` adds the phone package's observations, surface visibility,
affordances and timed execution to shared Argos cognition. It is not a second
brain or a seven-action whitelist. Normal actions against generated rooms,
objects and characters remain available. Phone pickup/read/reply and journeys
report success, record memory and advance matching plan steps **only when physical
completion occurs**. A moved phone produces a real failed pickup and replanning.

In the full living-world house, travel costs four seconds per adjacent room on
the Basement → Landing → Stairs → Bedroom route. Taking that route in several
decisions costs the same travel time as choosing the final destination directly.
The isolated test fixture retains its configurable fixed travel duration.

The starting house and `PhoneDemoPhysics` are authored, not generated by God.
God and spirits can grow it through the existing proposal/build/validate/activate
pipeline; the Under-the-hood runtime panel reports actual jobs, world counts,
whispers and system health. A proposal or queued job is not an activated system.
Narrative suggestions are not memories of events that happened. Camera prompts
receive the actual local entities and their descriptions as world data.
The old focus-word `GoalProgress` counter is disabled: attention alone cannot
complete a goal. Native plan completion and goal evaluation remain enabled.
The automatic beat detector consumes completed actions, not LLM intentions, and
only considers the next pending beat. Free-text beat matching/director judgments
remain heuristic; they are not typed proof of arbitrary puzzle completion.

`PhoneDemo.create(decider)` remains an isolated fixture/test seam. Only explicit
`ARGOS_DEMO_COGNITION=fixture` runs that bounded policy in the server. It is not
the production cognition path.

The world contains:

| ECS data | Owner / meaning |
| --- | --- |
| `LocatedIn` | Physical rooms, phone on actual Bedroom desk, carried phone, messages contained in phone |
| `DemoPhone`, `DemoHearing` | Battery, connectivity, unread count, repeated buzz timing and the sound Mara actually recognized |
| `DemoMessage` | Exact body, direction, delivery/read status and times, reply linkage |
| `DemoActivity` | Accepted physical action, deadline, target and draft being typed |
| `Thought`, `Perception`, `Memory` | Real cognition records and perceived experiences |
| `ObjectState.current` on the door | Closed/open world fact |
| `Inventory` cache | Synchronized through existing inventory helpers on phone transfers |

The desk is an actual entity, not just narrative prose: `phone → desk → Bedroom`.
Pickup has a four-second approach/grip phase before an inventory transfer commits.
Moving the phone away mid-reach cancels pickup. Power is not required to pick up
an object. Moving the phone back to Bedroom places it on the desk; the other
operator destinations place it on their indoor floors, which rendering describes.

Only delivered incoming messages can be read. Reading requires a powered phone
in hand and takes five simulation seconds. Typing takes seven. Losing the phone
or power cancels either activity. Offline phones can read messages already
delivered; outgoing replies wait for connectivity. Battery changes are explicit
operator interventions in this scenario, not a fabricated battery-drain model.

An unread, powered, unsilenced phone gives a familiar double vibration every six
simulation seconds. The open basement doorway transmits that sound; the closed
door isolates it. Hearing identifies her phone, not the sender or message body.
Reminders reinforce the observation without repeatedly invalidating a slow model
decision. Reading, silencing or loss of power stops reminders.

The NPC receives restricted observations, never the inspector, camera history,
operator receipts or unread message bodies. The UI's inspector is deliberately
omniscient. Its generic enumeration includes newly added registered components
and newly created entities, excludes prefabs, and shows scalar fields plus
containment. It does not yet visualize all cognition relation edges. Historical
thought receipts can outlive pruned Thought entities; their IDs are historical
references, not guaranteed-live entities. Receipts are demo telemetry, **not** an
implementation of the proposed canonical event schema.

## Two directors, two clocks

`PhoneCameraDirector` is read-only cinematography, not world steering. It selects
interior establishing shots, enclosed stair-follow coverage, phone notification inserts, surface-to-hand pickup coverage, and hands
inserts for reading/typing/sending. It never moves an entity or marks a text read.

Every meaningful source change retains an immutable presentation snapshot: source
time, thought history, physical phone facts, message receipts, screen content and
door. Thought-only and delivery-only changes also make a new version. This
read-only source tape is retained for the bounded demo run; it is not a second ECS,
the new event schema, or yet an indefinite event store. The tape itself is not
evicted, and current state responses repeatedly clone and serialize its full
history. That makes cumulative state traffic/work roughly O(n²) as shots accrue;
the current implementation is safe only behind this demo's 10–120 second bound,
not as the storage protocol for an indefinite stream.

The render deck is deliberately different from that audit tape. It has capacity
one: while H3 is busy, a newer source projection replaces the obsolete **unissued**
one instead of forming a stale FIFO backlog. The replacement carries a bounded
bridge of up to six body-free causal checkpoints so physical continuity is not
silently lost. A prompt already issued to H3 is immutable and cannot be retracted.
The ECS remains the sole authority throughout; coalescing changes only which source
state is requested next from the renderer.

Accepted timed physical actions expose a conditional near-future trajectory to the
camera prompt. Director requests accept 5–15 second chunks, but requested duration
is not the same as playable continuation duration. The forecast window is a
guarded estimate of the pixels H3 will actually emit. With the new ten-second
default it starts at eight seconds, then calibrates from chunk playback metadata
with a 500 ms end guard: floor to a half-second, subtract 500 ms, then clamp to
1–15 seconds. Thus an 8.5-second continuation permits an eight-second forecast;
the measured 3.542-second continuation permits only three seconds. Session
information updates the estimate immediately, and chunk playback is the later
ground truth. The opening segment (`chunk_index: 0`) may be untrimmed, so it is a
ceiling-only observation: it can lower an overoptimistic horizon but cannot raise
one. Only real continuations recalibrate the estimate both upward and downward.
This guard was added and regression-tested after the paid probe; in particular, a
10.125-second opening can no longer inflate the initial eight-second forecast to
9.5 seconds. That post-probe refinement has not yet had a separate paid validation
run.
Walking, pickup, reading, typing and door opening may name their completion beat
only once it falls inside that safe horizon. Before that, H3 is asked for immediate
purposeful progress but forbidden to arrive, transfer, read, send or open early. A
forecast does not commit an ECS fact and grants Mara no future knowledge or message
content. When an operator edit contradicts an active action—for example moving
Mara off her accepted route, moving the phone during pickup, or removing phone
access or power during reading/typing—the action fails and its projection
disappears immediately, without waiting for the next tick.

The raw generated pixels remain conditional and best-effort. Once H3 has generated
or displayed a speculative completion, a later ECS invalidation cannot retract it
from the media stream or raw recording. The next prompt can recover from committed
state, but this layer is not yet a visual transaction or conformance checker.

The UI has a narrower proof rule. Action acceptance freezes a `basisSequence`; an
`actionCommits` record is appended only when that exact physical action actually
completes in ECS. At a projected cue, the UI may apply one minimal milestone patch
only if a later immutable source shot contains the same basis and event committed
at or after the projected `atMs` (and, for message actions, the matching message).
The common patch advances only cue time, phase and that proof record; arrival then
changes location, pickup changes possession, read/send expose only their matching
message state, and opening changes only door/location. Every unrelated field
remains frozen at the segment's source snapshot. With no exact proof—including an
invalidated forecast—the UI holds the pre-milestone state even if H3 happened to
paint otherwise.

The final proof review tightened these patches further: reading advances exactly
one message and its counters; pickup reconstructs possession in the original
room; arrival and opening move a carried phone with Mara. Pressing send while
offline leaves the reply queued, even if the proof snapshot was captured after
a later reconnection. These refinements were regression-tested after the paid
probe. The cue is an editorial alignment to the projected film beat, supported
by a real commit; the immutable commit retains its actual simulation timestamp.

Latest-only coalescing can still skip a complete short action if its start and
completion both occur before a prompt is issued. The bounded continuity bridge
preserves context but does not guarantee visible coverage. A future bounded lane
for important committed transitions would preserve those action beats without
restoring the old queue of every intermediate state.

Prompt transport and displayed truth use separate acknowledgements. A matching
`prompt_pending` is a delivery receipt: the provider has the version, so the client
must never send that `prompt_version` again. `prompt_applied` releases flow control;
`prompt_rejected` is terminal; a gap-free generated chunk remains the compatibility
settlement when an applied event is absent. None advances the thought, phone state
or chat shown to the audience. Those advance only from a gap-free provider chunk
timeline keyed by `prompt_version`, when the browser actually crosses that segment
on a displayed video frame. The browser uses `requestVideoFrameCallback` when
available and persists per-segment telemetry for source → prompt sent → prompt
pending/applied → chunk ready → displayed, including source-to-film offset and
frame-crossing lateness.
Wall-clock source latency is anchored to `capturedWallMs` on the immutable shot,
not reconstructed from simulation time; this keeps pauses and uneven ticks from
masquerading as renderer latency.

The client commits a prompt version as sent only after the synchronous realtime
send succeeds. There are no timeout resends of the same version: Director requires
strictly increasing `prompt_version` values and rejects duplicates. No receipt
within 15 seconds is terminal. A `prompt_pending` receipt starts a separate
30-second pending-to-settled watchdog; that timeout is terminal too, never a resend.

The thought stream, simple world summary, phone-screen overlay and NPC reply
reveals follow the **source snapshot of the playing chunk**, not world now.
Metadata is indexed and deduplicated; missing chunks cannot advance the timeline.
If timing is missing, the audience sees a waiting state or the last mapped scene,
never the latest live world as a fallback. Paused video holds its source state;
recorded replay uses a corrected clock origin and supports backwards seeking.
This synchronizes requested source states at chunk granularity, not each depicted
motion within a chunk. H3 can still omit or mistime the requested action.

The first paid transport probe established that `chunk_duration: 5` is accepted.
Its initial chunk played for 5.167 seconds, but each continuation played for only
3.542 seconds because Director trims 39 context frames. That is too little usable
film for the richer physical beats this demo needs. The probe then attempted a
same-version timeout resend; Director returned `stale_prompt_version` (“must
increase”), stopping the recording around 12.8 seconds. Its saved evidence is in
`recordings/phone-2026-09-04T21-09-36-176Z-dbcda2/`.

The default request is therefore now ten seconds, expected to yield roughly 8.5
seconds of playable continuation and an initial safe projection horizon of eight
seconds. Session information and runtime playback metadata recalibrate the guarded
horizon. The provider's published schema ambiguity is retained only as a
configure-time compatibility fallback: an explicit initial `chunk_duration`
schema rejection may resend configure once without that field. It is unrelated to
prompt delivery, which never resends a version. Configured, requested and playback
durations are saved in telemetry.

The corrected 60-second probe is saved at
`recordings/phone-2026-09-04T21-16-35-564Z-4bd5d7/`; its raw H.264/AAC recording
is `director-2026-09-04T21-18-12-579Z-ad33cecc.mp4` (59.304 seconds, 832×480).
Director accepted and reported the ten-second configure. The opening chunk played
for 10.125 seconds and all six measured continuations played for 8.5 seconds, so
the expected eight-second guarded horizon was correct.

During those 59 simulation seconds, Mara opened the basement door at 5s, followed
the recognized phone buzz upstairs, reached the Bedroom at 18s, recovered from one
physically unavailable action, picked the phone up from its desk at 25s, read the
warning at 31s and delivered “Who is this?” at 39s. She later rejected a remote
door interaction through normal world constraints and reached the Landing at 59s,
still holding the phone. These are ECS/action-commit facts, not claims that every
generated frame depicted each beat correctly.

Per-second contact sheets from the raw recording were also visually inspected.
They show an interior opening, the basement-door opening, travel through the
house, an explicit desk-to-hand phone pickup, and phone reading/typing/sending.
That is strong sampled visual evidence, not a formal pixel-conformance score:
generated phone lettering still drifts and H3's visual cadence can differ from the
requested cue timing.

The camera captured 52 meaningful source versions but issued only nine; 42 stale
unissued versions were coalesced and pending deck depth never exceeded one. Seven
segments crossed displayed-frame boundaries during the recording. Comparable
source-to-film offset fell from the old ordered-queue baseline of p50 20.625s,
p95 36.625s and max 42.625s to p50 12.125s and p95/max 13.625s. The new
capture-wall source-to-displayed-frame measurement was p50 11.624s and p95/max
13.438s; provider generation itself was p50 1.982s and p95/max 2.865s.

There was one nonfatal provider `deadline_missed` for chunk 4; that chunk and two
later chunks still arrived. The run recorded no duplicate-version retry, terminal
provider error, prompt rejection, no-receipt timeout or pending-to-settled timeout,
and ended manually near the 60-second target. This validates the corrected
transport and bounded-queue behavior once. It does **not** prove frame-level H3
semantic compliance, eliminate the remaining roughly one-segment lag, exercise a
late projection invalidation, or make the O(n²) demo state path suitable for an
indefinite stream.

An optional, UI-only overlay makes phone messages legible during the reading,
typing and sent shots. Drafts are labelled “not sent yet” and do not appear as
received replies in chat. Long overlay text is limited to three lines; chat keeps
the full message. The checkbox restores an unobstructed player. Recordings are
always raw. The advanced inspector, causal receipts and operator controls remain
explicitly **LIVE / may be ahead of film**. In simulation-only mode all panels
follow the live simulation; there is no fake video timeline.

Prompts read the engine's actual room descriptions and phone containment. The
opening establishes an enclosed interior hallway, plaster walls, ceiling and rug;
the green basement door is an interior door, not a front door. Pickup coverage
names the real source surface, shows empty hands approaching it, then finishes
the lift after the ECS transfer. Carried-phone continuity explicitly excludes
pocket retrieval. These are stronger grounded requests, not a visual guarantee.

Generic Argos actions also carry their actual pending/succeeded/failed outcome to
the renderer. Pickup, drop, use/interact, give, attack/defend, rest and private
think/reflect/wait actions receive outcome-specific grounding; failed or pending
actions cannot request an invented success, and completed actions may depict only
consequences already present in committed facts. Director prompts are capped at
50,000 characters. If a grown world exceeds that, the camera keeps the visual
identity at the head and committed facts, trajectory and safety rules at the tail,
while explicitly truncating bulky local-world context in the middle.

Camera/framing is requested through prompts;
there is no separate native camera-angle control assumed here. Provider reference:
[FAL Director API](https://fal.ai/models/minimax/h3-max/director/api).

## Recording and limits

The browser records cloned handles of the **incoming video and audio tracks**
directly using MediaRecorder. No canvas capture, crop, resize, captions, UI panels
or overlays. This is source-only visual content, not a byte-identical copy of the
provider's compressed transport. Simulation-only mode saves the world, not a
misleading diagram/video recording.

Stop offers a raw-video download, loads it into the player for replay, and uploads
the recording to this local server. Each video run saves `world.json`, `demo.json`,
`playback.json` (provider chunk indices, durations, versions and recording origin),
and MP4/WebM under a unique `recordings/phone-*`
directory. Video upload is bounded to 64 MB and one recording per run. API keys
remain server-side, only the Director model is permitted through the proxy, and
only one session allocation is allowed. All state/control/proxy/recording routes
require the local capability token.

Closing the page best-effort stops the stream; a server deadline independently
stops simulation/proxy access. The provider's session cap bounds an orphaned media
session. Browser recording support varies; lack of support is reported and does
not pretend a recording was saved. Local MP4s can be shared separately; this is
not yet a remotely hosted multiplayer or real SMS/telephony service.

## Verification

```sh
npm test -- --runInBand --silent src/demo/__tests__/phone
npm run test:phone:live
```

The opt-in live check runs the **full living-world runtime**, sends a message
after eight simulation seconds, stops on an actually delivered reply, and saves
runtime state plus causal receipt history. Its default running limit is 180 wall
seconds, independently of the H3 viewer cap. `ARGOS_PHONE_CHECK_SECONDS` selects
30–300 seconds; `ARGOS_PHONE_CHECK_MESSAGE_SECONDS` tests a later interruption.
This spends model/coding credits, but never allocates a FAL session.

`ARGOS_PHONE_CHECK_SCENARIO=moved` relocates the phone while she approaches it;
`ARGOS_PHONE_CHECK_SCENARIO=power` queues the message with a dead battery, then
restores power. Checks measure readiness and decision latency, actual delivery/
read/reply timestamps, and unread-message privacy. An eventual reply is not enough:
the command exits unsuccessfully if any acceptance gate fails. See
[the cognition and timing audit](COGNITION-EVAL.md) for thresholds, results and
the measured rendering contract and remaining visual caveats.

The living-world regression suite covers preserved core systems, normal cognition
and plan execution, completion timing, moved-phone failure, unread privacy,
daemon interruptions, spatial consistency, generated-room/object actions,
upward spirit telemetry and priority changes. Task-scope tests cover cancellation
propagating into nested model calls and discarding late provider responses.

Historical evidence below predates the full-runtime integration; those videos
demonstrate rendering/phone continuity, not the new God/spirit runtime.

### Full-runtime simulation checks (September 4)

The latest latency/counterfactual checks are in
[COGNITION-EVAL.md](COGNITION-EVAL.md). Final verification after the timing and
proof refinements passed 95/95 suites: 777 passed and 10 skipped; all 84 focused
demo tests, typecheck and diff-check also passed. The results immediately below are
the earlier integration baseline, before foreground scheduling and route timing
fixes.

- Latest normal live check: heard notification → thought 3s, delivery → read 26s,
  delivery → reply 34s, readiness p95 0ms, decision p50 982ms and p95/max 1,660ms.
  It recorded no action failures or sampled unread-body privacy violations.
  Result: `recordings/phone-live-check-1788554678904/result.json`.

- First successful full-runtime phone exchange: read at 122s, reply at 152s.
  After separating background planning and improving attention/priority handling:
  message at 8s, pickup at 60s, read at 78s, delivered reply at 99s: “Who is this?”
  Result: `recordings/phone-live-check-1788512437652/result.json`.
- That run had two NPCs, five rooms, 26 evolution-created entities, two furnished
  rooms, and two whispers to Mara. A coding job was submitted but cancelled when
  the check stopped; it did **not** activate a newly generated system in that run.
- Full suite passed with 536 tests and 10 skipped, including the physical-beat
  regression. Build passed. No new H3 session was used for
  these checks. Native cognition remains nondeterministic; 99s is an observation,
  not a promised response time or proof of polished story pacing.

Verified in the original implementation run (recordings below used the previous,
now-removed composited presentation):

- 13 focused tests: knowledge boundaries; powered/connected delivery; silence and
  acoustic isolation; moved phones; interrupted reading/typing; offline reply
  queue; non-mandatory thoughts; stale/late decisions; `sim.step()` integration;
  live inspector enumeration; immutable ordered camera projection.
- Whole suite: 500 passed, 10 skipped across 70 suites. Typecheck and build passed.
- Live cognition check: read at simulation second 33, reply delivered at second 42.
- One bounded live H3 + live NPC run: read at second 29, reply delivered at second
  39. Mara then chose to investigate despite the warning. Inspected actual video
  frames showed stair movement and phone-in-hands reading/typing inserts.
- Saved live recording: `recordings/phone-2026-09-04T06-22-49-904Z-9e10fe/director-2026-09-04T06-25-03-093Z-465a3d98.mp4`
  (about 103 seconds, H.264/AAC, 1080×1350). Reading/typing shots trailed live state
  by roughly 22–25 seconds. Generated phone lettering drifted; exact inset text
  remained correct. The render leaned cinematic rather than strictly isometric.
  A fast-start copy for convenient playback is `recordings/argos-phone-demo-2026-09-04.mp4`.
- Desktop/mobile UI inspected at 390px; sticky overlap and inspector row churn
  fixed; dead-phone UI kept a text queued and restoring power delivered it.

The source-only update also has regression guards in `phone-video.test.ts` for
direct incoming-track recording, no canvas capture/drawImage path, hiding the
diagram in live mode, and replaying the saved raw recording. Run both demo test
files for the original 15 focused tests. The continuity/presentation suites and
overlay guard add 10 tests covering real desk containment, timed and interrupted pickup, interior
grounding, immutable audience state, deferred replies, missing/duplicate metadata,
pause/backwards-seek behavior and avoiding redundant coverage when an offscreen buzz
expires. Run `npm test -- --runInBand --silent src/demo/__tests__/phone` (25 tests).

Source-only live run verified: `recordings/argos-phone-raw-2026-09-04.mp4`,
78.28 seconds, 832×480 H.264 with AAC audio. Inspected a saved phone-reading frame
with no overlay, verified browser replay, and stopped the live session. This is a
fresh generation; the old composited recordings cannot recover obscured pixels.

Interior/continuity + synchronized-presentation run (September 4):

- Raw fast-start video: `recordings/argos-phone-interior-2026-09-04.mp4`,
  103.08 seconds, 832×480 H.264/AAC. Original, ECS save, shot snapshots and indexed
  playback metadata are in `recordings/phone-2026-09-04T07-41-30-479Z-fb4b2a/`.
- Inspected frame at 2s establishes the interior hallway, plaster walls and rug.
  Frames at 44–55s show empty hands approach the phone on its desk, grip it and
  lift it. No pocket retrieval in that inspected sequence.
- Real ECS transfer at simulation 32s, message read at 41s, reply delivered at
  53s. Browser chat withheld the delivered reply during the filmed typing shot,
  then revealed it with the sent shot (around video 87s). The small exact-text
  overlay matched that scene; the raw recording has no overlay.
- Simulation ran 102s before the provider cap. The viewer's second warning
  arrived at simulation 99s and is saved in the ECS, but its interaction was not
  reached by the recording. Unrendered future thoughts/replies stayed hidden.
- Browser returned to a saved, paused replay at 0s with scene-state 0s, no errors.
  Chunk durations estimate source alignment; they do not certify each frame.
- Full-suite rerun: 511 passed, 10 skipped, 73 suites. One earlier run hit an
  unrelated 25ms coding-daemon sandbox timeout; that suite and the whole suite
  passed on rerun. A final offscreen-buzz regression was added afterward and is
  covered by the 25 focused tests. Build/typecheck passed.

Watch-first UI revision: 29 focused tests pass, including current-thought selection,
video/thought/state hierarchy, drawer/fullscreen wiring, and authenticated read-only
replay routes that reject world/proxy writes. Typecheck/build passed. Saved-run
browser checks covered the prominent thought, scene jumps, deferred reply reveal,
collapsed history, drawer toggle, fullscreen entry and a 390×844 mobile layout.
This UI revision used the saved recording, with no new H3 session.

Remaining: broader reusable communication systems in generated worlds; voice
calls; richer spatial navigation; frame-exact editorial playback;
visual conformance checks; authenticated remote hosting. None is implied by this
authored vertical slice.
