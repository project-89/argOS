# Spatial world development

This is an explicit broader profile, not the old four-furnishings/one-wetness
canary. It is also not unrestricted generation of new 3D buildings and actions.

Launch Saltmere with `npm run demo:spatial -- --live --lovecraft --develop`.
The server prints a fresh private local link. Nothing starts before **Start world**.
The default development session is 30 minutes; `ARGOS_SPATIAL_SECONDS` can select
10–3600 seconds. The original profiles retain their ten-minute maximum.

## Ask God

The side panel talks to the existing God agent using its existing serialized
command lane. It is separate from texting a resident or planting a thought.
Examples:

- “Make it rain over Saltmere Common.”
- “Add an ornamental plant at the available garden site.”
- “Build a deterministic moisture mechanic: exposed plants get wetter in rain
  and gradually dry in clear weather. Let me inspect the values.”
- “What has actually been built, and what is still queued?”

Replies are **not** proof that a build succeeded. The panel separately shows
requests, jobs, confirmed native changes, and generated scalar details. God can
inspect public physical state, use native weather/placement tools, and enqueue
managed code. It cannot use this panel to edit private memories, force decisions,
teleport bodies, allocate unregistered geometry, or declare a story event true.

## Existing hierarchy enabled

| Owner | Responsibility |
| --- | --- |
| Watcher | Observe public activity and report needs |
| Arbiter | Review consistency without undoing consequences |
| Narrator | Interpret the coastal story; offer nudges and granted native events |
| Weaver | Design evidenced furnishings and new scalar mechanisms |
| God | Review spirit proposals; handle operator development requests |
| Coding daemons | Implement, independently test and live-load approved systems |
| Tinker | Inspect and repair managed systems; native systems remain protected |

The Crafter, Steward and Lawgiver are not enabled as arbitrary spatial writers.
New rooms, residents, models, navigation and native interactions still need their
host adapters. This profile does not claim those capabilities are installed.

## Generated systems

Mechanisms read a source/identity-bound `SpatialDevelopmentInput` projection and
explicitly admitted prior generated outputs. They write numeric/boolean
`SpatialDev…` fields on registered entities. The host owns location, collision,
inventory, weather, phone privacy and cognition. Concealed contents are excluded.
New native furnishings can join the projection after spatial registration.

Public scalar values appear in the inspector and local resident sensory context.
Committed changes are recorded for spirit review. They do **not** automatically
create new animations, object actions, goals, or completion predicates.

Engineering retains independent positive/boundary tests, isolated execution,
whole-batch freshness checks, source revocation, hot admission, retained failed
outcomes, and managed repair. Prior validated release schemas—not arbitrary
registry names or rejected candidates—authorize cross-mechanic reads on replay.
Numeric output is finite and bounded to ±1,000,000 at schema admission and
runtime, including attachment defaults. Invalid output rejects the whole worker
mutation batch and enters the existing rollback/repair path; it is not clipped.
The builder receives public context for permitted entities, whereas an executing
mechanic reads only its admitted input/output fields. Private cognition and
communications are not builder inputs.

## Finite session resources

- Eight admitted coding jobs shared by operator requests, spirit builds, failures
  and repairs; two pending queue slots.
- 32 God requests; one operator request in flight, shared God command mutex.
- 60 Weaver reviews and 30 Tinker reviews.
- 24 weather changes, at least 30 simulated seconds apart.
- Four native furnishing sites; existing branch-event grants remain limited.

These are explicit resource budgets, not a claim of limitless autonomous growth.
The paid foreground/background models and coding backend are unchanged.

## Related cognition correction

Authored residents without an explicit phone relationship no longer acquire the
same generic “stay reachable” goal merely because they own a device. Standing
motivations no longer request repeated automatic plans. Personally selected
finite intentions, existing plans, timed phone reads, and private messages retain
their normal paths. This does not establish that all long-run behavior is fixed.

The ten-trial behavioral baseline and ten-minute endurance acceptance requirements
remain open; offline profile/transport/worker tests do not substitute for them.

## Live UI check — 2026-09-27

One provider-backed operator turn was tested through the real browser panel:
“Make it rain over Saltmere Common. Tell me what actually changed.” The request
entered at 4.6 simulated seconds, native weather committed at 7.3 seconds, and
the God reply arrived at 9.0 seconds. The renderer showed rain, and the saved
receipt identifies **God · operator request** separately from the conversational
reply. The other outdoor room retained its prior cloudy state.

The test used manual NPCs so it did not spend a live cognition run or claim NPC
responses. No engineering job was requested. The stopped state and request,
reply, weather receipt and world are retained in `recordings/spatial-8n9fN9`.
God's reply mentioned residents' routines; that phrase is not evidence of
autonomous behavior in this manual fixture. Its inspection context now explicitly
includes the simulation mode. No new autonomous, ten-trial, or endurance result
is claimed here.
