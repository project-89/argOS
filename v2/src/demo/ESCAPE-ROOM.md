# The Drowned Observatory

A fixed-rule, seeded cooperative escape-room benchmark on the production Argos
runtime. It tests investigation, working memory, communication, delayed action,
coordination and recovery. It does not supply a second NPC brain or a solution
script to the characters.

## Run and inspect

From the `v2` package:

```sh
npm run demo:escape -- --seed=11
npm run demo:escape -- --topology=relay --seed=701
npm run eval:escape:live -- --seed=917 --seconds=300
npm run eval:escape:live -- --seed=917 --seconds=300 --perturb-after=exit_code_read
npm run eval:escape:live -- --seed=2718 --seconds=300 --perturb-after=exit_unlock_started
```

The default command is a no-model scripted mechanics oracle. `--live` uses the
configured Gemini model and requires `GOOGLE_GENERATIVE_AI_API_KEY`; it stops at
actual all-actor escape or its wall-time limit. Never treat the default fixture
as evidence of autonomous cognition. The live runner refuses concurrent trials.

Each run writes a unique `recordings/escape-room-*` directory with an operator-only
event tape, physical/readiness samples, coordination revisions, final actor memory,
world data and a scored report. No server or video session is started. Results
separate committed escape from cognition coverage and requested disruption.
Decision timing includes deterministic foreground attempts, not just model calls;
`thoughtType` distinguishes insights from foreground reasoning in newer traces.

Seeds vary combinations and calibration. `topology: "observatory"` remains the
default; `topology: "relay"` selects a second authored causal graph with different
initial accessibility and electrical dependencies. Neither multiple seeds nor
these two authored graphs establish generalization to arbitrary puzzle
structures. The overnight campaign's evidence and remaining limits are tracked in
`src/evals/COGNITION-OVERNIGHT.md`.

## Runtime boundary

`EscapeRoomTestbed.create({ live: false, seed, topology: "relay" })` creates a deterministic physical
fixture. `start()`, `dispatch(character, action)` and `advance(milliseconds)` are
explicit test controls. Passing `live: true` enables the existing foreground
cognition, background planning and reflection loops. God, builders, narrative
expansion, H3 and servers remain disabled so a failed puzzle cannot be solved by
inventing a new exit or changing its laws.

Each actor has a priority-10 intention to reach the Courtyard while cooperating
with the other two. Individual completion uses native, actor-local `in_room`
proof. Benchmark completion separately requires **all three actual actors** in
the Courtyard; unlocking a door, promising to leave, or one person escaping does
not satisfy it.

The physical authority is `LocatedIn`, native portable-item/inventory components,
the `EscapeRoomState` component, and `EscapeRoomActivity` deadlines. `ObjectState`
is the public description of those mechanisms, not an alternative source of truth.
Changing a descriptive string cannot unlock a door. Removing an installed coil
removes power; a flag cannot substitute for the real part.

## Information boundary

The local context describes visible objects, controls, physically available
routes, and the actor's current activity. It contains no seed-derived answers or
unread clue text. The seed changes both four-digit combinations and the optical
calibration. It is included only in operator snapshots for reproducibility.

Operating labels describe what a mechanism supports in principle. Its advertised
affordances separately describe what the current actor can actually operate now:
installed/carried parts, power, a distinct local helper, and resource occupancy
use the same checks as the executor. A busy pump or keypad is not offered to a
second operator. Slot availability never tests whether an unknown code is correct.
Deliberate invalid attempts still receive real failure; the menu is not a solver.

Nearby people see a shared structured public-activity projection: someone is
holding a control, operating a mechanism, or moving toward an available local
doorway. This outranks stale `idle` object labels and refreshes cached perception
as soon as the physical activity changes. It exposes no command arguments,
codes, private intentions or thoughts. Blind/remote observers cannot query it;
hidden target IDs do not reveal names or remote destinations. Travel remains a
pending journey until actual arrival, and body-busy cognition gates are unchanged.

An `interact ... read` action delivers clue text through the ordinary committed
action-result, episodic-memory and working-memory pipelines. Seeing or examining
a document does not silently read its fine print. Remote and inaccessible reads
fail. A dark optical display can be successfully inspected, but its blankness
does not reveal the code or count as reading that code.

Clue contents and read receipts are private until actually communicated. Other
actors do not receive them through a shared notebook. Public renderer scenes
contain object descriptions and visible physical actions, never private read
receipts or internal thoughts. Reading letters requires sight.

## Physical dependency chain

This is operator/test documentation, **not an NPC prompt**.

1. The Gallery plaque supplies the first pair of the locker combination.
2. The Workshop notebook supplies its last pair and their ordering.
3. The actual combination opens the locker, revealing one real Pump crank.
4. Someone picks up that crank and installs it in the Drain pump.
5. One actor physically holds the spring-loaded Pump bypass.
6. A different actor pumps for eight continuous seconds, draining the Archive.
7. The newly passable Archive contains a calibration diagram, Copper coil and
   Glass prism. Its diagram must be read, and the parts physically collected.
8. The coil is installed in the Workshop generator; the prism in the Gallery
   optical bench. They cannot be installed by describing or promising possession.
9. Power is routed to optics and the bench is calibrated to the discovered detent.
10. Someone reads the illuminated four-digit exit code.
11. Power must be switched to the exit, extinguishing the optical projection. The
    characters now need to retain or communicate what they actually read.
12. One actor holds the Atrium release while a different actor enters the valid
    code; two uninterrupted seconds unlock the door.
13. All three actors must traverse the exterior doorway into the Courtyard.

Depending on division of labor, this requires roughly twenty substantive
interactions plus local travel and communication. The third actor can investigate
in parallel, transport a part, relay information or relieve a helper. There is no
preassigned role script. Three rooms initially accessible, a fourth unlocked by
physical work, and a final exterior space establish a real navigation chain.

### Relay topology: different branches, shared power

This variant keeps the same people, unique props, private seeded clues and final
cooperative unlock. Its Archive doorway is dry and open from the start. The
Archive equipment therefore can be recovered before any drainage; the installed
Copper coil supplies an **electrically assisted** drain pump. The pump still
needs its actual locked-away crank and a distinct person continuously holding
the bypass, but now also needs exclusive `route pump` power for all eight seconds.

The pump drains the exterior threshold instead of the Archive. The keypad's
drainage interlock prevents even a powered, correctly coded, cooperatively held
unlock before actual drainage. The optical-code branch and the drainage branch
can finish in either order, but cannot receive power simultaneously. Only their
merge permits a final unlock under `route exit` power. Changing power away from
`pump` interrupts unfinished pumping; switching it back requires a fresh full
eight-second operation. Installed parts and the helper's original deadline remain.

The local labels explain each control's real operating prerequisites. They do
not provide a global action recipe or seeded answers. Public route contracts add
the `pump` enum value, and the local keypad exposes `Observable.drainageClear`.
The completion milestone is `threshold_drained`, not the original graph's
`archive_drained`; the shared `Observable.drained` fact describes the actual pump's
completed work in either world.

The explicit offline fixture accepts `branchOrder: "pump-first" | "optics-first"`
and rotated actor roles; `interruptPumpWith: "off" | "optics" | "exit"` deliberately
tests power loss and a new full-duration retry through real commands. These
options belong only to the no-model oracle, never the NPC context or live driver.

Relay scoring independently pairs actual engine execution identities for the
eight-second pump and its original distinct helper, rejects intervening body
work or supply loss, requires prior Archive arrival/coil installation/locked
crank installation, and requires a later two-second cooperative unlock followed
by every actual exit. The other branch requires the installed prism, optical
supply, and a real successful private code read at the physical code-read marker;
merely inspecting a blank display does not count. Speech, a renamed snapshot, missing pending work, an old
failed operation or a milestone alone cannot satisfy that causal gate. Successful
fixtures establish mechanical solvability, not autonomous transfer.

## Timing and interruption

Travel takes three seconds. Pumping takes eight seconds. Keypad unlocking takes
two seconds. A spring-loaded control can be held for at most forty-five seconds.
Timed operations are pending intentions until completion. Continuous prerequisites
are checked throughout: actor location, actual installed parts, distinct helper
presence, the helper's held control, and power where required. An interruption
leaves the result unfinished. Retrying pays the full work duration.

Deadlines are processed in chronological order, including coarse fixture time
steps. A completed eight-second job is not retroactively erased by a later
forty-five-second helper deadline. Successful cooperative completion releases its
helper; an early release or timeout interrupts dependent work.

`perturb()` performs a recoverable power trip. It returns `{ changed: false }`
when power was already off, without producing a fictitious disruption. A real
trip preserves installed parts and discovered information, interrupts a powered
unlock, and emits only local observable cues. It does not insert a diagnosis into
remote characters' memories. Code-reading is a useful trigger for a disruptive
live trial, but it can coincide with a power-routing change the actors already
needed to make; it is not by itself strong evidence of interrupted-work recovery.

The harder `--perturb-after=exit_unlock_started` trigger waits for an **actually
accepted, still-pending** unlock, not a spoken intention or an old milestone.
It turns off exit power while the door remains locked. The original keypad entry
receives a real failure; it cannot later finish at its old deadline. The helper
keeps holding under the original forty-five-second deadline until legitimate
completion, explicit release or timeout. Someone must physically restore power
and submit a new entry, paying the full two-second duration again. If the trigger
window is missed, the run does not qualify as disruption recovery.

`perturb({ after: "exit_unlock_started" })` rechecks the pending-work guard at
the mutation boundary. `canPerturbAfter(stage)` is operator-only readiness for
the runner; it is not part of the actors' knowledge. The existing no-argument
power trip and `exit_code_read` stage remain supported. Unknown stages and mixing
`--perturb-after` with `--perturb-at` are rejected by the live CLI.

## Evidence and limitations

Public controls also expose a small typed state contract through the shared
observable-state projection: the pump's `Observable.drained` boolean, the
router's `Observable.route` enum, visible installed parts, held controls,
illumination and keypad power/open state. These values come directly from
physical components and containment, not from parsing `ObjectState` display
sentences. Only local sighted observation admits them into working memory.
The catalog does not expose combinations, the correct calibration answer,
private read contents, helper identities or the global all-escaped flag.
An exact boolean barrier can therefore wait for the actual eight-second drain
without guessing a composed English state string. Offline proof of this path
is not evidence that an autonomous model chose it.

The operator event stream records thought, speech, private action feedback,
physical action status, decision latency and monotonic milestone timestamps.
Power trips retain an operator-only snapshot of the interrupted action and helper
deadline. For the harder trigger, evaluation joins that snapshot to the original
pending/failed receipt, an actual power-restoration action, and a fresh successful
two-second retry. These are additional gates; all three committed Courtyard
arrivals and the final physical snapshot are still required. A flag saying an
interruption was applied is insufficient. Planning-request lifecycle events are
also operator-only, separate from memories, stimuli and renderer scene events.
`snapshot()` separates current state from historical milestones. `invariants()`
detects impossible location/gate and power/part combinations. The offline fixture
belongs in the evaluation package, not in this runtime's context.

A scripted fixture demonstrates physical solvability and exercises gates; it is
not evidence of autonomous planning. Live runs must be scored separately, with
their own actual read, timed-work and arrival receipts. A single lucky completion
does not establish robust cognition across seeds and interruptions.

`src/evals/escape-room-recovery-fixture.ts` is an explicit offline recovery oracle,
tested against multiple seeds and rotated actors. It reads through the production
executor and restores power/retries through ordinary actions; it never patches
ECS fields or lends the characters a hidden answer. Run its independent checks
with `npm test -- --runInBand src/demo/__tests__/escape-room-interruption.test.ts`.

This authored benchmark deliberately limits world growth and assumes intact
mechanisms. It is not a save/resume format for arbitrary pending work, a renderer
integration test, or a claim that arbitrary natural-language actions can mutate
any component. Operator edits can invalidate the benchmark; they are detectable
evidence, not automatically repaired instructions to the characters.
