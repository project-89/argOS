# Focused world alternatives

Stage 5 adds real choices to the `duet` initial world, not a required plot. The
legacy four-character cookie fixture keeps its original seed. No model/provider
or H3 session is required for deterministic physical tests.

## Places

The focused seed has four real rooms, connected bidirectionally:

`Kitchen — Living Room — Hallway — Street`

Each traversal takes three simulated seconds. The topology is explicit, not an
all-room teleport menu. Current one-step routes appear in cognition; route
admission and completion are handled by the shared `runtime/room-routes.ts`
contract. New rooms need explicit connections before they are reachable. A
destination name does not reveal its objects, occupants or their conversations.

The hallway and street offer physical separation, not an automatic reduction
of emotion or completion of a social goal. Nobody is forced to leave. A phone
carried there still emits real notifications to people in that same room. The
original open Kitchen/Living Room doorway also carries its sound; arbitrary
graph adjacency does not grant through-wall hearing or message knowledge.

## Coffee is an executable resource chain

The kitchen counter holds a pot of four portions of already brewed coffee and
two initially empty, portable mugs. The initial state does not claim the NPC
brewed anything during the episode.

1. Pick up one empty mug through the native timed possession action.
2. `interact Coffee pot / pour` takes two seconds. Exactly one empty mug must
   be held; the visible local pot must have a finite positive portion count.
3. Completed pouring subtracts one portion and fills that exact mug. The actor
   may carry, give or put down the real object.
4. `interact <held mug> / drink` takes three seconds. Actual completion empties
   the mug, increments its drink counter and adds two points of physical energy,
   clamped to 100. It does not change arousal, grief, goals or private memory.

There is no unlimited refill, drinking an empty mug, remote pour, automatic
coffee-making goal, or invented productive-work success. Saying "I made coffee"
does not execute any of these effects. Two empty mugs in hand require putting
one down so the target vessel is unambiguous.

Pending work reserves the exact pot/mug against another package operation.
Completion checks source epoch, actor/room/object/support identities, capability
lifetime, current room and possession, original supply, and actual vessel state
before writing any effect. Moving or replacing the mug, changing the pot, or
stopping/restarting the source consumes neither coffee nor energy. Component
values are authoritative; dynamic coffee/cup components use ordinary persistence.
Runtime callbacks are not restored as authority.

Pouring and drinking are explicit public motor operations. Held mug state is
included in the public scene, while private phone bodies are not. The scene
director captures the authored initial rooms, including the exterior Street.
Rooms generated after a director attaches are not automatically added to that
director's fixed film coverage; dynamic room-lifetime camera transitions remain
separate work. Simulation routes and current scene snapshots can still grow.

## Validation status

Focused physical gate: 22 offline tests, including object removal/recycling,
source restart, finite supply, concurrent pours, public state, phone audibility
and completed component persistence. Expanded camera gate: 48 tests across
four suites, including exact whole gestures and four initial locations. These
are mechanism tests, not autonomous selection or a rendered H3 performance.
Final full suite passed 261 suites / 3288 tests, 10 skipped; TypeScript passed.
The 240s maintenance breakup trial Fx4yPS and 120s core logistics control W04xMz
finished with no reported system/projection errors. Jerry actually fetched an
empty mug, but neither trial completed a coffee chain or visited Hallway/Street.
Thus availability/physical integrity are tested, while autonomous multi-step
follow-through remains a limitation. The evaluation runner retains its default
120s maximum; explicit `--extended` permits at most 300s.
The preceding 120s run g5ctqT still had repeated banter and no phone reply, despite
working reads/disclosures and successful retirement of obsolete narrative beats.
