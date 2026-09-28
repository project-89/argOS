# Small household checkpoint — 2026-09-26

## Purpose

Test meaningful continuation in a small world before new assets, larger casts,
VR, Aureum integration or renderer work. This is an authored scenario using the
existing cognition and spirit loop, not another controller or an outcome script.

## The household

Four adult housemates inhabit a sitting room, sheltered kitchen and exposed
patio. Each has four authored formative/recent memories, distinct drives,
personal opening intentions, different hunger/energy, and a private phone.

- Tess wants to enjoy hosting without becoming responsible for every task.
- Ivo is hungry and privately promised to leave the pear pastry for Noor.
- Noor is tired and balances a seated break against company.
- Mara is deciding whether to share a private concern about Alex or take quiet
  time. Her housemates do not start with knowledge of that concern.

There are two finite pastries and one usable outdoor chair. The promise is
not a magical ownership lock: an inappropriate choice can really consume the
portion. There is one validated site for an additional indoor chair. The sofa
is currently decorative/examinable, not an installed usable seat; the renderer
and action catalog still need richer affordance coverage later.

Relationships are authored perspective-specific history, not a new formal
relationship graph. Initial geographic familiarity is explicit (this is their
home), not evidence that unknown-world exploration already works. Phone replies
require a personally read incoming message. This first trial injects none and
does not test two-way messaging or proactive outgoing texting.

## Authority and control loop

Existing priority cognition, narrative mind, planning, reflection, needs,
goal lifecycle and native timed actions remain in use. Authored intentions can
be reconsidered through the same personal lifecycle as generated intentions.
No model, thinking level or cognition cadence is changed for this test.

Watcher observes public activity. Arbiter checks grounding. Narrator can suggest
and use the existing native weather grant on the patio (three changes maximum,
at least 60 simulation seconds apart). Weaver can propose one indoor chair,
subject to current evidence, God approval, validated placement and actual
construction. No household tree incidents, food replenishment, new residents,
rooms, arbitrary systems or coding-daemon execution are granted.

Spirits cannot decide residents' reactions. Applying rain is not proof that an
NPC adapts; requesting a chair is not a build; a build is not useful until it is
used. Subsequent feedback requires exact receipts in accepted spirit reviews.

## Prospectively bounded live observation

Run once with:

```sh
npx tsx src/demo/spatial-household-check.ts --live
```

Hard bounds: 180 seconds wall time, 180 seconds simulation time, 300 actual
provider HTTP attempts, eight-second cancellation drain. Stop at the first
bound or failure. No early-success exit, automatic repeat, forced action,
message, weather change or construction. SDK transport retries remain within
the same request cap. H3 and coding agents are disabled.

The protocol is written before startup. Preserve provider exchanges privately,
initial/final world, goals, continuations, committed actions, native state at
receipt time, own working-memory receipts, spirit inputs/outcomes, proposals,
God reviews, runtime measurements and failures. Credentials are not evidence.

The pure evaluator separates authored setup, native physical outcomes,
own-action memory, new enacted intentions, and Narrator change/feedback.
Learning and memory's causal influence require a controlled comparison; they
cannot be inferred from a character saying "I remember." Optional furnishing
growth is reported separately, not silently substituted for missing behavior.

## Interactive mode

```sh
ARGOS_SPATIAL_SECONDS=180 npm run demo:spatial -- --household --evolving --story --live
```

The local UI starts ready, and only clicking **Start world** starts paid NPC
cognition. Omit `--live` for manual offline physics verification. The household
is a fixed, explicit host profile; passing a custom world cannot inherit its
spirit authority. Existing town and Blackout profiles remain separate.

## Verification and retained failures

- Seed/geometry checks: 9 passing; including real routes and growth anchors.
- Initial combined checks: 37 passing, 3 failing in
  `/tmp/argos-household-offline.vc9YyQ`. Two tests incorrectly interacted with a
  remote prop before moving through rooms; the third attempted concurrent
  worlds through the explicitly single-world in-process API. The fixtures now
  use native room moves and sequential replacement. These are test repairs,
  not changes to NPC behavior or execution authority.
- Corrected native integration: 5/5 in
  `/tmp/argos-household-integration.xwqL04`.
- Renderer presentation checks: 7/7.
- Typecheck clean: `/tmp/argos-household-types-all.W8HZPV` (final verification
  and live outcome to be appended below).

The original failed tree-repair and Tess-specific seating gates stay open.
The ten-trial baseline, ten-minute wall **and** simulation endurance, and
construction-performance requirements stay unchanged and OPEN. A successful
three-minute household observation cannot establish ten-resident scale or
long-term realism.

### Final offline results and recording corrections

- The first wider invocation used a Jest option unsupported by this repository's
  version and selected all suites. It was interrupted with SIGINT (exit 130),
  not counted as a pass: `/tmp/argos-household-regression.HhtrJ5`. 63 suites
  had passed; two assertions in the physical-effect suite still expected two
  rain senses, although the existing weather system now emits four. Those
  assertions now check the exact recipient plus sight, sound, touch and smell.
  No weather behavior was changed to make the tests pass.
- Correctly scoped regression: 628 passing / 1 failing across 31 suites in
  `/tmp/argos-household-focused.FezbjX`. The remaining in-progress observer
  integration incorrectly treated a recycled numeric entity ID as the original
  consumed pastry. Component-array cells can retain a stale key even when the
  replacement entity lacks that component. Observer identity checks now require
  actual component membership as well as a matching durable key.
- The native integration also showed that spatial receipts may omit the optional
  operation field. Meal evidence uses a matching pending/completed execution,
  removal of the exact pastry and a native hunger reduction; it rejects an
  explicitly contradictory operation. A consumed-food action currently has a
  removal fact and textual own-action memory but can lack structured action
  identity; that specific memory linkage is **not** falsely credited. Seating
  provides an actual exact own-action memory join in the manual fixture.
- Final household seed/integration/evaluator plus spirit-grant regression:
  **133/133 across four suites**, `/tmp/argos-household-final.uDq1D5`.
  The other 27 correctly scoped suites already passed above.
- Final typecheck clean: `/tmp/argos-household-types-final.09J281`.
- One live trial started with frozen protocol and no forced input:
  `recordings/household-check-ellYtF`; console `/tmp/argos-household-live.QOdJMN`.
  Its result is recorded below after the bounded observation ends.

## Live outcome — useful partial success, not the complete behavioral gate

Evidence: `recordings/household-check-ellYtF/result.json`. Exactly one trial,
stopped by the **300 HTTP-attempt cap** after **160.562s wall / 157.2s simulation**,
not a completed 180-second run. 293 responses returned; seven outstanding
requests were cancelled. Drain 159ms, zero remaining requests, no observer
errors. No forced action, message, weather event or construction.

### What happened

| Simulation time | Confirmed outcome |
| --- | --- |
| 5.9s | Noor sat in the existing outdoor chair. |
| 8.6s | Ivo ate the apple pastry; the pear portion remained. His preceding model response explicitly referred to his promise to save it for Noor. |
| 18.3s | Narrator committed native rain on the patio. |
| 30.2s | Noor arrived in the kitchen. Her preceding decision explicitly mentioned the rain; this supports a grounded response, not a counterfactual causal proof. |
| 37.1s | Noor consumed the pear pastry. |
| 43.1s | Noor joined the others in the sitting room. |
| 69.7–82.8s | Weaver identified missing usable indoor seating, proposed an armchair, God approved, and the native builder committed the catalog chair. |
| 86.9s | Noor independently sat in that new chair. ECS `SittingOn` confirmed use. |
| 118.4s | Narrator cleared the patio rain through the native grant. |
| 124.2s | Accepted Weaver review contained the exact chair-use receipt ID. |

Growth evidence is source-bound: proposal `proposal_1` named the
`household-sitting-seat` site and transitioned proposed → approved → executed;
the resulting chair had durable key `entity:ce39fb60-2a2e-487c-8285-c2fb01c443ce`.
Use receipt `public-event:f618ac80-04c5-4777-96c2-ffc0433163e4` identifies Noor's
native seated outcome and appears in the subsequent accepted Weaver history.
This manually reviewed household chain is **not** a pass for the old
Tess-specific town gate. The 3.347ms build preflight is not total construction
latency or proof of the outstanding performance requirement.

Native meals, seating, room changes, one exactly joined own-action memory,
multiple actors' physical action, Narrator effects and exact subsequent
Narrator feedback all passed their separate checks. **New personal intention
creation and enactment did not.** `boundedHouseholdChainObserved` remains false.

### What still fails or looks weak

- After gathering, the cast repeated versions of "nice to pause together."
  Fifteen reconstructed spoken utterances stayed near the same quiet-company
  theme; 88 wait receipts and repeated Mara observations did not produce a new
  substantive direction. Quiet is compatible with these particular memories;
  this is not sufficient evidence of sustained, adaptive inner life.
- Ivo's and Noor's opening intentions were released; Tess and Mara retained
  theirs. Background goal proposals remained null. Default schedule goals
  supplied leisure/sleep/dinner even in this small authored scenario. Some
  use the initial spawn room (including the patio) as their location. Inspect
  that generic schedule integration before treating all flatness as an LLM
  intelligence failure.
- Generic standing phone motivations competed despite no incoming message.
  Four native phone pickups failed with `no_reachable_anchor` (Ivo three,
  Noor one). Static reachability passed; transient multi-person occupancy
  around the shared phone table needs a specific collision/anchor test.
- Rest restored Noor's energy to 100 by roughly 104s, while her authored aching
  legs/tiredness remained salient in thought. Need values, prose and subjective
  recovery must not be assumed to update each other automatically.
- Foreground cognition execution: median **1.469s**, p95 **2.713s**, max **5.560s**;
  max observed foreground queue wait **2.775s**. These exclude one another and
  are not end-to-end interaction latency. The simulation ran about **0.98x**
  realtime. Four slow ticks were recorded; native fast-system health was passing.
- Background coordination waited up to **98.170s**; Ivo's subconscious job up
  to **96.240s**, despite those jobs then executing in roughly 1–1.6s. This is
  a scheduling/fairness lead, not proof that all background work is slow inference.
- Consumed-object action memory lost structured target identity in the offline
  native trace, although removal facts and prose were retained. Keep exact
  identity through the action's completion boundary rather than relying on a
  still-present target when writing memory. The evaluator does not waive this.

### Next bounded work, not performed in this trial

1. Reproduce shared-table transient occupancy and prove either a free approach
   or an honest temporary-blocked outcome that can be reconsidered. Do not
   disable collision or teleport actors to manufacture success.
2. Trace background scheduler eligibility, priority and queue fairness using
   the captured long-wait jobs; test that goal/coordination reviews receive
   bounded service without stalling foreground cognition or physics.
3. Review default schedules and unconditional standing phone concerns against
   authored home, present needs and no-message state. Preserve personal choice;
   do not solve repetition by commanding the cast to argue or act more often.
4. Repair consumed-target action-memory identity with native regression coverage.
5. Then a separately authorized, predeclared continuation/changed-condition
   comparison. No automatic second paid trial in this pass.

An interactive household instance is also ready at local port 54800, bounded
to 180 seconds once **Start world** is clicked. It was opened but not started;
the recorded trial above is the only paid run made by this pass.

## Follow-up: coherent-agency challenge, 2026-09-27

This is a **new explicitly selected scenario**, not a relabeling of the quiet
household above. Full implementation decisions, evidence and next steps:
[`COHERENT-AGENCY-PASS-2026-09-27.md`](../architecture/COHERENT-AGENCY-PASS-2026-09-27.md).

The changes preserve authored drives separately from aspirations, share grounded
character context across background goal paths, allow bounded agenda review
alongside activity, remove synthetic observation plans that override a chosen
wait, age queued subconscious work, share a deadline across planning/repair,
deduplicate unchanged observation learning and preserve consumed-target identity
in own-action memory. Native custody, privacy, collision and stale-result checks
remain execution boundaries.

`--challenge` selects `household-competing-wants-v1`: one pastry with an asymmetric
private promise, an unfinished box task, a privacy/relationship concern and shared
space. It does not script who eats, how anyone feels, or whether anyone argues.
`--weather-mechanic` explicitly commissions one existing approved wetting/drying
build; it does not grant arbitrary coding or prove autonomous world growth.

### Frozen command and verification

```sh
./node_modules/.bin/tsx src/demo/spatial-household-check.ts --live --challenge --weather-mechanic
```

- **631 targeted tests across 26 suites passed**, plus typecheck. Final core and
  evidence reports: `/tmp/argos-coherent-agency-20260927.u5nB1W/core-regressions.json`
  and `evidence-final.json`.
- Exact live evidence: `recordings/household-check-uPDjb2/result.json`.
- One trial; stopped by the 300 Google-attempt limit at **156.8s simulated /
  161.433s wall**. Single separately declared Codex build. No forced actions,
  messages or weather. No retry.
- 293 responses; seven remaining requests cancelled; 199ms drain; zero active
  requests or observer errors. Coding worker settled and its release persisted.
- Challenge gates passed for native meals/seating/travel, exact action memory,
  multiple actors acting, a new intention linked to a real physical effect, and
  Narrator intervention/feedback. Original two-pastry fixture and its failed
  gate remain unchanged. Challenge-only box/phone evidence is matched against
  real pre/post state, execution identity and own-action memory, not prose.

### What genuinely happened

Tess ate the only pastry (11.5s), then closed the open box (24.1s). Ivo deliberately
released his original save-the-pastry intention after consumption; no fabricated
success. Noor responded to native rain (20.5s) with an expressed decision to leave
it and reached the kitchen (31.3s). Mara picked up her phone (6.2s), went outdoors
and sat. New autonomous intentions appeared at 40.6s, 41.9s and 49.1s: Ivo sought
food, Noor asked about the promised pastry, and Ivo wanted to take responsibility
for the resulting awkwardness. Ivo opened the empty storage box at 82.2s under
his exact new hunger-goal key: **enacted, not accomplished**.

The generated `SpatialRainWetness` system passed 30 release checks and activated
after roughly 102 wall seconds of building. Actual damp/wet thresholds followed
on exposed residents and the chair at 100.8/118.8s simulation time. This is a
working commissioned generated mechanic, not evidence of an autonomous Weaver
proposal being built. Both Weaver needs reviews instead failed their design
handoff as `stale_observation`; no new furnishing was built in this trial.

Foreground execution median/p95 were 1.417/2.358s (max 7.371s), with separate
maximum queue delay 2.676s. Maximum subconscious queue wait was 13.813s rather
than the earlier run's roughly 98s, but the changed cohort prevents a clean A/B
claim. Native fast systems recorded no failures; three slow ticks remain visible.

### Failed or incomplete evidence to retain

- Mara's phone menu advertised `use_phone`/`make_call` even though the spatial
  executor implements only read/reply. Her attempted contact correctly failed,
  but the contradictory menu remained. No incoming message existed to reply to.
- Ivo inspected walls and later asserted that kitchen cupboards were empty.
  Reflection and extraction reinforced this unsupported conclusion. Wall
  descriptions were present, but generic object/occupancy choices and weak
  inspection summaries also contributed. This is not reliable grounded memory.
- Noor's new question goal lagged behind information already spoken; goal
  formation alone does not prove coherent revision.
- Quiet actions still consumed repeated inference: 63 wait, 14 rest and six
  reflection proposals out of 153 returned foreground proposals. These are not
  execution counts and quiet is not itself a failure.
- 27 planning requests, 15 admissions, including six visible-state discards.
  Snapshot relevance needs review without weakening source/identity boundaries.
- Two Weaver designs rejected as stale; no autonomous need-to-new-furniture chain.

Next pass should first reconcile installed capabilities with all advertised
actions, then preserve semantic inspection evidence through memory, then repair
the two captured Weaver handoffs. No additional run or UI restart was made after
this result. Learning, sustained narrative quality, ten-trial repeatability,
ten-minute wall/simulation endurance, older repair/use requirements and complete
construction latency remain **OPEN**.

## Grounding/growth follow-up — 2026-09-27

See [`GROUNDING-GROWTH-REPAIR-2026-09-27.md`](../architecture/GROUNDING-GROWTH-REPAIR-2026-09-27.md)
for the three repairs, preserved red tests, **910 passing combined checks** and
the single frozen follow-up `recordings/household-check-729eHG`.

Weaver's stale handoff now exercised a complete live recovery: same Tess goal →
fresh design → God approval → chair built at 102.0s → Tess sits at 114.5s → exact
receipt in accepted Weaver/Arbiter reviews. The separately commissioned generated
wetness system activated and changed physical state. Phone availability matched
the installed executor; actual box inspections stayed grounded. No live wall
inspection occurred, and subjective storage assumptions remain fallible.

This trial is **not an overall pass**: request cap at 144.877s wall / 142.1s
simulation, shutdown AbortError, and new-intention enactment gate remains false.
Noor did travel under a new intention, but her movement-memory receipts lack the
structured action linkage required by the evaluator. Preserve that schema gap,
the failed chair approach and failed final review. No second live run was made.
Ten-trial baseline and ten-minute wall/simulation endurance remain OPEN.

Post-run shutdown repair was verified offline, including the real stopped
runtime/source and no later ticks/movement. Final combined targeted regression:
**1,059/1,059 across 56 suites**, plus clean typecheck; checkpoint
`/tmp/argos-grounding-growth-20260927.SPSngr/final-candidate.json`. The recorded
live error/gates remain unchanged. No further live run or UI restart occurred.
