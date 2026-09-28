# Focused testbed: available choices and limits

Historical opportunity audit, 2026-09-06, **before Stage 5**. The two-room/four-
object limitations below describe that recorded baseline, not the expanded
package. See [WORLD-ALTERNATIVES.md](WORLD-ALTERNATIVES.md) for the subsequent
connected-place and coffee implementation. Trial artifacts remain unchanged.

## What exists

`apartment-sitcom.ts:180` creates two rooms: Living Room and Kitchen. Its four
physical objects are the Kitchen counter, Orange tin, Last black-and-white
cookie and Elaine's phone (`:187`). The cookie begins inside the closed tin;
the phone and tin are on the counter (`:92`). The couch, coffee table, coffee,
refrigerator, bookshelves and bakery bag mentioned in descriptions are not
independently usable entities in this seed.

Elaine's opening personal intention is to get ready for Alex, including the
cookie, and revise her plans if circumstances change (`:121`). Jerry wants to
enjoy her company before she goes out (`:122`). Both start at priority 7
(`:143`). Elaine also has an ongoing communication motivation at priority 6,
raised to 8 by notifications (`:148-151`). The opening observation explicitly
allows conversation and says departure is not forced (`:146`). These are
initial motives, not success scripts or required emotional reactions.

## Genuinely available alternatives

| Choice | Existing physical/mental support |
| --- | --- |
| Walk between the two rooms | Package destination menu `apartment-sitcom.ts:220`; native timed room walk `cognition-system.ts:1955` |
| Open or close the tin | Current-state-dependent affordance, 0.8s operation (`apartment-sitcom.ts:282`, `:336`) |
| Collect the cookie or phone | Native pickup, subject to actual visible/reachable possession rules; package context explicitly describes this (`:302`) |
| Put an owned object down | Native `drop` moves it to the current **room**, not specifically onto the counter or into the tin (`cognition-system.ts:3363-3380`) |
| Give an owned object to the other person | Native local recipient/possession checks and real containment transfer (`cognition-system.ts:3466-3500`) |
| Eat the cookie | Only while held; 3s operation changes it into nonportable crumbs (`apartment-sitcom.ts:283`, `:336`, `:373-376`) |
| Check a message | Must hold a powered phone; 1.2s completed read grants that exact reader message knowledge (`:285-291`, `:336`, `:377`) |
| Send a reply | Must have actually read its exact message ID; timed typing requires continued possession (`:306`, `:323-336`, `:367-369`, `:401-405`) |
| Disclose, ask advice, argue, listen or rest | Existing speech and self-action pipeline; saying an action happened does not execute it |
| Reconsider plans or let a concern settle | Existing actor/goal/attention review mechanisms; personal settling is not objective world-task proof |

There is no actual exit, street, date venue, coat-taking, sitting-on-couch,
coffee-making, cookie-splitting, phone-silencing or phone-call operation in this
seed. Choosing to drop the phone is possible; claiming it was specifically
pocketed or placed back on the counter is not an equivalent implemented effect.
The phone can reply to known incoming communications, not freely place a call
or message arbitrary new contacts.

The live `--core-only` flag disables world maintenance, not all background
cognition: the package still enables planning and reflection when live
(`sitcom-breakup-check.ts:39`, `apartment-sitcom.ts:176-177`). Full maintenance
enables spirits, narrative, god and coding; those are separate experimental
conditions, not interventions to force a departure.

## What this means for behavior evaluation

Finishing the available preparation and continuing company is not by itself an
executive failure. In logistics run `sitcom-logistics-boyfriend-Dmo6eq`, Elaine
collected the cookie and replied twice. She said she was heading out, but the
seed supplied no actual outside destination. Repeated model decisions to
"keep listening" remain a measurable pacing issue; not leaving an unavailable
room is a different issue.

In breakup run `sitcom-breakup-boyfriend-Tr9yXl`, both messages were read and
Elaine later asked Jerry whether to reply, then chose silence. That is distinct
from failing to read a notification. The test should score actual cognition,
causal knowledge, choices and action completion separately from a desired plot.

## World-growth follow-up: topology, not an all-room menu

The package's `movementTargets` currently returns only the original two IDs
(`apartment-sitcom.ts:220`). Creating another Room does not automatically make
it an advertised route. Returning every Room would make a newly generated,
disconnected or remote place appear one step away; that is not grounded growth.

Prefer a shared explicit one-step route contract for future integration. The
existing `AdjacentTo` relation (`ecs/relations.ts:17`) is a possible substrate,
but currently has no producer/consumer establishing traversal semantics in this
package. The initial bidirectional edge would need to be materialized, and
generated places would need explicit connecting edges. A locally present Portal
could also carry a destination; its current fields only specify destination and
bidirectionality (`ecs/components.ts:759`), not locks or other access semantics.
Those must not be inferred from arbitrary descriptive prose.

The destination menu is **not a verified execution-security boundary**. Static
inspection shows native room movement resolves a global room name and changes
containment (`cognition-system.ts:2935-2957`); native timed completion captures
source/target identity but does not obviously share a route predicate
(`:1977-2035`). This audit has not experimentally established every dispatch
path. A future shared route contract must be tested at menu projection,
selection/dispatch and timed completion, including removed edges, replaced
rooms, disconnected rooms and newly connected rooms. Preserve legacy native
world semantics explicitly; do not silently make an absent menu a new security
policy or expose unobserved destination contents.

This is remaining world-generation integration work, not part of the current
repair's cognition/generated-mechanics gates. No new rooms, routes, forced
departures or blindly expanded action set are recommended for the present trial.

## Full-maintenance evidence: `sitcom-breakup-boyfriend-k5pJPR`

The 120-second `activity-maintenance-1` trial used live cognition and full world
maintenance, without H3. Its `result.json` (`runtime.evolution`, lines 945–983)
reports 14 created entities, one populated room, no proposals, no new components
or systems, and no proposal failures. Coding has revision 0, no jobs and no
active generated systems. The 29 native/runtime systems report no execution
errors; stop-time background cancellation is not a builder rejection. This run
does **not** test new-code validation or activation. That requires the separate
generated-mechanic host tests and bounded real-worker probe.

### What genuinely happened

The saved `world.json` contains 11 furnished objects (IDs 127–137: door, sofa,
chair, table, television, bookshelf, floor lamp, rug, plant, laptop and food)
and three ambient objects (IDs 138–140), all located in Living Room. This matches
the Steward's schema-room population path (`steward-spirit.ts:881–965`), which
materializes chosen object types through `ObjectManager`; it is not new system
code. The chair and laptop use existing base schema types (`world/schema.ts:726`
and `:1195`). Individual object creation receipts are not retained in this
trial's public event stream, so exact spawn timing is not established there.

`sitcom-events.jsonl` and `public-events.jsonl` establish actual actor choices and
completed effects, rather than inferring action from inner monologue:

- Elaine arrives in Living Room at 88.5s (private journal sequence 516).
- At 92.5s, `sit chair` succeeds (sequence 540); the executor reports
  `empty -> occupied` and `SittingOn -> chair` (541). The saved chair, ID 129,
  remains occupied.
- At 99.0s, `power_on laptop` succeeds (590); the executor reports
  `closed -> powered_on` (593). Saved laptop ID 136 remains powered on, and
  Jerry receives the public action stimulus (591–592).
- At 102.5s, `check_email laptop` succeeds as an affordance invocation (615),
  but its implemented effect is only the private device stimulus
  `Checking email inbox...` (619). `world/schema.ts:389–396` has no inbox
  records, message lookup, document mutation or delivered result for it.
  This is not proof of reading actual mail or completing productive work.

### What the work goal actually proves

Saved goal 71 is named `Follow schedule: afternoon work (Living Room)` and has
parameters `activityType: work_block`, `startHour: 13`, `durationHours: 4`.
Its actual success predicate is only:

```json
{"type":"all_of","conditions":[
  {"type":"in_room","roomName":"Living Room"},
  {"type":"did_action_type","actionType":"interact"}
]}
```

The four-hour duration is metadata, **not** a success condition. The saved
cognitive frames show this goal completing at 93.0s, directly after the chair
interaction and before powering the laptop. The native work template explicitly
accepts `sit` among possible actions (`scheduled-activity-systems.ts:755–770`);
the success contract accepts any qualifying interaction (`:274–287`). Thus the
executor fulfilled its weak engagement predicate, but the UI/goal label
overstates that as completion of an afternoon work block. It proves neither
four hours of engagement nor a useful work product. Future activity contracts
should name and measure the intended outcome; this repair does not add an email
or work simulator or a forced behavior.

### Remaining materialization/persistence gaps exposed here

At the time of this trial, the strict engineering entity materializer was not
the universal spawning path. Steward's `ObjectManager.applyComponentSpec` was
log-only. The base laptop requested a dynamic Battery component, but laptop 136
and the saved component definitions have none. Room-schema generation therefore
could not claim every requested component was installed merely because its
object existed.

The subsequent bounded repair replaces that log-only path: every default and
additional component is preflighted before entity allocation, using the same
canonical scalar/default validation as engineering entity creation. Explicit
dynamic schemas such as Battery are registered through the component registry;
untyped names, unknown fields, mismatched schemas/values, and private actor/host
components fail visibly instead of being skipped. Registry defaults fill new
components, while explicit overrides preserve existing initialized physical
fields. This intentionally changes compatibility for previously ignored bad
specs: those object spawns now return `null` with an error. New dynamic types
require declared schemas, never inference from values. Focused regressions in
`world/__tests__/object-manager-components.test.ts` cover base laptop/phone/
computer/forge data, real Steward spawning, overrides and pre-allocation
rejection. This repair does not retroactively change the recorded trial or add
battery-drain behavior; a component is state, not a running mechanic.

Likewise, `sit` really added `SittingOn` in the live executor, but the old save
path omitted it: this trial's saved actor has no `SittingOn`, while the chair's
occupied state survives. The subsequent repair now round-trips `SittingOn`,
`SleepingOn`, `OnTopOf`, and explicitly present `OccupiedBy`, with exact ID
remapping independent of room containment. Native sit/sleep regressions cover
duplicate names, shifted IDs and dangling targets. Missing links in old saves
are not reconstructed by guessing from an `occupied` string.

The package now supplies bounded, read-only narrative evidence: current local
physical objects, completed personally delivered turns and actually heard
unfinished prefixes. It does not supply message bodies, contact cards, private
thoughts or hidden motives. This replaces the empty evidence feed in the
recorded maintenance run; it is not proof that every future director proposal
will be relevant. Scaffold generation and role reassignment no longer write
their speculative secrets/motives into NPC memories.

At trial time, powered laptop traits also advertised native office affordances including
`list_dir`, `run_command` and file operations, not just fictional email. No such
tool completion is demonstrated in this trial. Generated props should expose
only explicitly enabled host capability channels; a convincing work narrative
is not evidence that those capabilities were correctly authorized or executed.

The subsequent host-authority repair denies office tools by default for every
new world and explicitly denies them in this apartment package. A host-owned
WeakMap policy gates `runOfficeTool` before any handler/workspace resolution;
ECS metadata, serialized snapshots, device traits, shell mode and environment
variables cannot grant permission. Both native and ObjectManager menus hide
denied `run_tool` effects. Legitimate office workflows must explicitly use
`createSimulation({ hostOfficeTools: ["workspace.list_dir", ...] })` or configure
their manually created world with `setWorldOfficeToolPolicy`; `true` is a broader
explicit opt-in. The independent managed coding daemon is a separate channel
and is unaffected. Denial, per-world opt-in, revocation and controlled-tempdir
file effects are covered by `office-tools/__tests__/world-authorization.test.ts`.

## Expanded-place and coffee projection boundary

The offline Stage 5 camera regression captures every place present in the
package's `scenes()` when the director attaches, including the duet's Living
Room, Kitchen, Hallway and Street. Actual room transitions, a phone vibration
and read in the Hallway, and the finite pot-to-held-mug pour/drink chain reach
the scene compiler. Held mugs retain public fill state. Pouring and drinking
receive complete source-action boundaries and at least 1.8 seconds of visible
focal performance; an impossible overlap fails rather than silently omitting
the gesture. These are deterministic projection tests, not proof of H3 visual
fidelity or autonomous actor interest in coffee.

The director freezes this **initial room set**. Rooms generated later in the
same live recording are not dynamically registered for multi-room editorial
coverage. The history may capture their snapshots, but this camera does not
assemble those later rooms into its scene windows. Safe room-lifetime admission
and dynamic camera registration remain separate work; do not claim arbitrary
mid-film world growth is fully rendered. Attach a fresh director to a new
recording after generating its initial places. Changing numeric room IDs or
replacing an existing room identity must never be treated as continuity.
