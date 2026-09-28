# The Last Cookie

A bounded, original apartment-comedy testbed with Jerry, George, Elaine and
Kramer. Four production Argos minds have different memories, social goals,
personalities and appearances. The authored setup is not a dialogue script.
George alone remembers hiding one real cookie inside an opaque closed tin.
The others have reasons to care, but must investigate or talk to learn more.

```sh
npm run demo:sitcom -- --seconds=120
npm run demo:sitcom -- --live --seconds=120
```

The first command is a passive **offline physics fixture**, not autonomous
cognition evidence. The second explicitly enables paid model calls, requires
`GOOGLE_GENERATIVE_AI_API_KEY`, and uses production foreground cognition plus
background planning/reflection/memory. H3, God autopilot, spirits, coding daemons,
world evolution and the server remain off. Each run is capped at 120 wall seconds
after startup or the requested simulation duration, whichever comes first.

At 25 simulation seconds an explicitly labeled **operator stimulus** texts
Elaine's phone. Its statement about the cookie is assembled from actual ECS
state; the initial hiding incident is authored history. The text does not make
any character believe it or act. A powered connected phone delivers after 200ms
and emits its recognizable vibration every six seconds while unread. The sound
reveals no message body or sender. Elaine may investigate, ignore, question or
resist. Other physically capable characters may interact with the device too.

Native movement, pickup, drop, give and timed speech remain production actions.
Opening/closing the tin takes 800ms; reading a held phone takes 1.2s; typing takes
at least 1.6s and scales with text length. Cookie consumption takes three seconds
and requires possession throughout. Scheduled effects revalidate actor, room,
object, package generation, exact message identity/body/direction, possession,
sight and power at completion. Stop cancels pending effects. There is no scripted
NPC action list or fixture decider inside the live loop.

Reading creates a private actor-owned ECS `SitcomInbox` snapshot of the exact
message and source time. It is not live access to a remotely edited phone.
Replies require that person's prior read of that exact incoming message.
Another character's later reply does not silently update their private memory.
The original phone demo is tightly bound to Mara and its house, so this package
reuses its delivery/read/type contract rather than instantiating a second brain.

Terminal commands during a live run:

- `/text your message`
- `/thought Elaine | a subtle thought` (also Jerry, George or Kramer)
- `/state`
- `/stop`

`recordings/sitcom-*/replay.html` is a standalone read-only audience artifact.
It displays one latest **authored foreground thought** per character, with its
actual source timestamp. Injected or background thoughts never replace that
card. A single simulation playhead controls thoughts, actually emitted partial
speech, phone receipts and simple ECS facts. It is an operator view: private
thoughts and the hidden cookie's state are intentionally visible to the audience,
not to other characters. Data is escaped and rendered using `textContent`.

The public `scenes()` projection excludes private thoughts, concealed cookie
contents and message bodies. It deliberately does not yet provide phone-screen
closeups, including after a read. This conservative camera surface can feed the
committed-interval renderer later; this testbed makes no H3 request.

`result.json` records causal phone gates, failures, model latency, exact global
voice overlap, and transcript repetition candidates. Global simultaneous voices
may be in different rooms and are not automatically crosstalk. There is no
manufactured “naturalness” score or requirement that the character obey the
outside sender. One short run cannot establish long-horizon social quality.
`events.jsonl`, `public-events.jsonl`, `frames.json` and the ECS checkpoint retain
evidence. The checkpoint is not a resumable package/callback session.

Offline regressions use explicit intentions through the real executor to test
the causal chain, closed-container boundaries, personal read memory, changed
message/room/actor identity, possession loss while typing/eating and stop.
The existing native executor has a five-second identical-failure cooldown;
opening a lid does not by itself clear a prior failed pickup's cooldown. This
testbed documents that existing pacing limitation rather than changing cognition.

Decision guards retain their generation until execution, replacement, operator
invalidation or stop. `finish()` only releases the in-flight request slot; it
does not cancel the staged thought/action that the executor has yet to consume.
Regression tests mock the model while running the actual cognition-cycle-to-
executor lifecycle, not merely scripted physics. Per-actor foreground disposition
telemetry records admitted, superseded, rejected and omitted-mental-update events
using exact world-owned request IDs and stable actor keys. Name-only global
chronicle records are deliberately excluded. A fast finished request is not
evidence that its result was admitted; latency also includes deterministic plans.

API: `ApartmentSitcom.create({ live, outsideTextAtMs })`, `start()`, `stop()`,
`text()`, `plantThought()`, `scenes()`, `snapshot()`, `onEvent()`. Only offline
fixtures expose explicit `advance()`; `dispatch()` is an operator/test intention,
never evidence of autonomous choice.
