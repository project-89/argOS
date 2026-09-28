# Bounded story-town profile — 2026-09-26

## Why the prior town was quiet

The operator's `spatial-AVRpNs` run reached 391.7 simulated seconds in about
465.4 wall seconds. Narrator completed eight reviews; Weaver completed four.
Neither was disabled, but no weather change or build was demonstrated. The
cast mainly had compatible eat/rest/walk goals and one warm memory each. The
host described a quiet afternoon, favored optional intervention, and gave the
Narrator weather authority but no native incident catalogue. The UI did not
show Narrator reviews. These are authoring, observation and authority gaps,
not evidence that a more urgent generic NPC controller is needed.

There was also a concrete feedback error: `recentEvents` in spirit cognition
was the spirit's own observations/interpretations. The shared legacy action
buffer could be cleared by another spirit's review; its snapshot actions were
not rendered in the prompt. A per-spirit committed-history cursor now carries
native action/speech outcomes and applied environmental receipts separately
from prior interpretations. Accepted, current reviews acknowledge only their
captured high-water marks; provider failures and stale work do not. Overflow
and bounded omissions are explicit. This history grants no execution authority.

## Smallest bounded change

Opt in with `--town --evolving --story` (plus `--live` for cognition). Ordinary
town, Blackout and seating-evidence fixtures remain unchanged. Do not combine
the story profile with a substitute world or growth fixture.

- Keep ten residents, the current spatial layout, native cognition, planning,
  clocks, movement, action execution, private phones and God approval.
- Author four formative memories per resident, distinct drives, named ties,
  and conflicting but achievable intentions using the existing character-past
  schema. Relationships are first-person historical accounts, not a newly
  fabricated typed relationship graph or universal NPC knowledge.
- Story brief: a trial cafe gathering, uneven hosting work, an overdue favor,
  and Otis overstating Ada's agreement to use the workshop. Consequences and
  reactions are not scripted. Stable room descriptions avoid inventory claims.
- Existing Narrator reviews about every 25 wall seconds, with its model,
  controller and agency boundaries unchanged. It can judge public progress,
  offer grounded considerations, or choose an authorized native complication.
  The separate legacy random-atmosphere system is disabled in this profile;
  its ungrounded bell/dog/candle prose is not evidence of native world events.
- Add one native incident family: a branch snaps against an approved existing
  standing tree. It changes ECS state/description and local sensory evidence.
  Residents may choose `clear_branches`, approach normally and work for six
  simulated seconds. The resulting crown remains pruned. No invisible
  obstacle, injury, completed NPC action or whole fallen tree is asserted.
- One source-bound Narrator grant dispatches weather or branch damage. Tree
  events have a two-event budget, ninety-simulation-second cooldown, one damage
  per tree, identity/state/task validation and persistent save/reload state.
  Non-story towns do not gain tree-event authority merely because the strict
  parser recognizes the operation.
- Weaver may review ten times in this 600-second story profile; construction
  still has only four approved catalog furnishing attempts. No new controller,
  model, code-writing authority, NPC spawning or arbitrary system generation.
- Operator UI shows the story brief, review time, requests/results, phase and
  tension explicitly as interpretation. Physical changes are separate applied
  receipts. Public renderer output excludes this operator/private material.

## Verification plan and acceptance boundaries

1. Offline character/schema, native event, stale authority, privacy, native
   dispatch, source isolation, reload and renderer-state tests.
2. Existing spatial, weather, spirit lifecycle/intervention and server tests;
   typecheck and viewer tests.
3. One autonomous 120-wall-second observation, saved through the ordinary stop
   path. No operator-forced event, thought, NPC action or build. Record actual
   interventions, consequences, NPC response, social progression, timing and
   failures. A lively seed or a successful unit test does not prove live use.
4. Fresh ready preview for the operator, not automatically started.

The ten-trial baseline, ten-minute wall AND simulation endurance, and strict
100ms construction gate remain **OPEN**. This pass does not claim runtime
slowdowns or planning timeouts fixed. Strangers, new houses/roads, commerce,
food production, arbitrary systems and H3 remain deferred. Earlier failed
fixtures and live outcomes are retained, not replaced by this profile.

## Evidence

### First integrated live observation (observer-first brief)

`recordings/spatial-FvDERL/{evolution-check,session,world}.json` preserves the
complete bounded outcome. Log: `/tmp/argos-town-story-live-20260926-01.log`.
No operator messages, planted thoughts, forced incident or forced action.

- 111.7 simulated seconds / 120.116 wall seconds, about **0.93x**.
- All ten residents moved. Eleven public speech turns: they assembled at the
  cafe, Ada asked about workshop use, Ivo reported checking its bare supplies
  box, and Otis publicly corrected his overstatement of Ada's agreement.
- Narrator reviewed at 14.8, 52.6 and 82.0 simulation seconds. It observed
  14/58/55 public receipts and interpreted rising tension, but requested **zero
  interventions**. Weather remained clear, tree budget untouched, no build.
- Weaver completed one review with zero suggestions. No native action failure
  appeared in the sampled operator feed. Two planning tasks were cancelled at
  stop; preserve those separately from successful completion. The log reports
  at least 131 ticks over its 50ms slow-tick threshold. No runtime-health gate
  is closed by the 0.93x throughput result.
- One opening Mara thought referred to a phone vibration despite no operator
  message in this check. This is not proof of a real notification; perception
  grounding still needs separate investigation.

**Live Narrator intervention and autonomous incident response remain OPEN.**
The richer cast and working native tools alone did not solve director initiative.

### Follow-up, without another full town run

Replace only the story-mode Narrator's passive default-plus-appendix with a
coherent 161-word active-director brief. It may initiate a grounded complication
before stagnation, using already-granted native tools; residents still choose
their responses. Ordinary town keeps the original observer-first definition.
No model, controller, event timer, drama quota or acceptance gate is changed.

One isolated Narrator decision is authorized in the diagnostic protocol:
`spatial-town-narrator-check.ts --live`. It permits one HTTP attempt and a
30-second inference deadline, with a manual frozen clock and no NPC inference.
It preserves initial/final state, output, actual receipts and source ownership.
It is explicitly **not** a second autonomous town trial or proof of resident
response. Append its actual outcome before handing off a new ready preview.

### Isolated active-director decision

`recordings/town-narrator-check-bFil31/{protocol,initial,result,final,world}.json`;
log `/tmp/argos-town-narrator-probe-20260926-01.log`.

One HTTP attempt, 13.700 seconds, frozen simulation clock, no resident inference.
The real Narrator chose `tree_damage` for Common tree 1, with a room target and
issued evidence. The engine rejected it: response `intervention.content` was a
structured command object, while the physical-effect parser accepted only a
JSON-encoded string. No physical change or resident response occurred. Actor
transforms stayed unchanged. This failed outcome remains saved.

Fix the transport boundary to accept either representation of the **same exact
closed command schema**, then normalize to a fresh frozen command. Preserve all
existing grant, source, target, state, evidence, cooldown and budget checks.
Regression coverage must exercise the actual cognition output path as well as
the parser and native tree host. Do not describe deterministic replay or mocked
provider output as a second successful autonomous run. No additional paid retry
is part of this pass; the new preview is for the operator to test.

### Final offline verification / handoff

- Spatial/runtime/server/phone/weather/growth regressions: **240/240**, 13
  suites, `/tmp/argos-story-spatial-regression-01.log`.
- Native branch/weather module checks: **48/48**, including 29 new branch
  cases, `/tmp/argos-story-events-20260926-04.log`.
- Per-spirit public-event and lifecycle/evidence regressions: **109/109**, six
  suites, `/tmp/argos-spirit-public-events-20260926-03.log`.
- Final active-director/seed/review/default-behavior set: **57/57**,
  `/tmp/argos-story-director-regression-02.log`.
- Final transport + full-host tree integration: **52/52**,
  `/tmp/argos-story-content-transport-20260926-01.log`. This exercises structured
  model content through actual mocked spirit cognition and native host grants;
  unknown operations, extra fields, accessors/proxies, changed source and stale
  evidence remain rejected. No paid retry followed the format repair.
- Viewer: **71/71**, `/tmp/argos-story-viewer-final.log`.
- Whole-project typecheck passed after the final parser repair:
  `/tmp/argos-story-content-transport-types-20260926.log`.

These suites overlap; do not add their counts. First failed branch fixtures,
the integration assertion typo and the temporary diagnostic RequestInfo typing
error are retained in their earlier logs. Neither live failure was deleted.

Fresh 600-second, ready-at-zero live preview uses `--town --evolving --story`.
Log: `/tmp/argos-town-story-ready-20260926.log`. It is not auto-started. The
ready server is on local port **52638**, with artifacts in
`recordings/spatial-Q63hPi`; the private token is only in its server log/browser.
Browser verified the new title, story brief, native budgets, zero clock and
Start world control after the final transport repair.
The
completed temporary 120-second server was stopped after its normal save;
the user's prior town server and all recorded evidence remain intact.

Next acceptance check: in this revised integrated profile, observe an actual
Narrator-native effect, an independently chosen resident response, and that
outcome reaching a subsequent real Narrator review. Then evaluate longer social
progression and useful world growth. No claim of indefinite growth, strangers,
full-tree collapse/collision, planning reliability, or endurance acceptance.

## Bounded autonomous loop check — 2026-09-26

User requested one integrated simulation and a hierarchy/managed-system-growth
audit. Current town runs Watcher, Narrator, Arbiter and entity-only Weaver with
God approval; individual NPC guardian daemons remain active. Coding daemons,
Tinker, Crafter, Steward and Lawgiver remain disabled. Broader engine managed
system generation exists but is not enabled by this trial. New deterministic
mechanics need explicit public-state/perception/affordance bridges, not new 3D
assets; activating every specialist is not a prerequisite for this check.

Prospective protocol: `spatial-town-story-check.ts --live`, one autonomous
community-drama town with ten residents; four wall minutes and four simulation
minutes maximum, 550 HTTP-attempt ceiling, eight-second cancellation drain,
zero forced incidents/actions/thoughts, zero retries or mid-run policy changes.
Stop early only if the complete native chain passes. Capture protected local
protocol, initial/final world, samples, receipts, working memory, actual Narrator
exchanges/review diagnostics, failed outcomes and runtime metrics. The existing
ready preview is untouched. This run is not baseline or endurance acceptance.

The pure evaluator requires same-source/same-identity native Narrator branch
damage; subsequent resident clearing through a matched admitted and completed
six-second native action; exact-target own-action memory; committed pruned
state; and later accepted Narrator reviews acknowledging the exact damage,
clearing and action receipts. Approaching, promising, interpretations, pending
or rejected effects and counts alone are insufficient. Gate/host/transport
regressions passed **99/99** in three suites before launch:
`/tmp/argos-story-loop-offline-20260926.log`. The 47 evaluator cases are included
in this total, not additional. Typecheck also passed after fixing harness
readonly collection typing and an evaluator callback-narrowing error; the two
earlier typecheck failure logs remain preserved.

### Actual live outcome — full-loop gate remains open

`recordings/town-story-check-na3Hta/` contains protocol, initial/final world,
working memory, source-bound receipts, narrator exchanges, review diagnostics,
operator events, samples and `result.json`. Log:
`/tmp/argos-town-story-loop-live-20260926-01.log`. One trial only; no forced
incident, repair, thought or second attempt.

- Stopped at the declared wall bound: **240.716 wall seconds / 229.6 simulation
  seconds**, approximately **0.96x real time** including startup/stop. All ten
  residents completed movement; 28 speech executions emitted at least one word.
- Narrator completed seven accepted reviews at 13.4, 53.9, 89.1, 128.1, 164.5,
  193.0 and 222.2 simulation seconds. Its second review autonomously applied
  `story:123:1:tree_damage` to Common tree 1 at **53.9s**. The 89.1s accepted
  review explicitly received that native receipt. No weather change occurred.
- **No resident attempted or completed tree clearing.** The tree remains
  `branch_damage`, revision 1. The evaluator correctly returns
  `completeNativeStoryLoopObserved:false`; no own-action repair/memory or
  subsequent repair-feedback stage is claimed.
- This was not simply invisible damage: Ivo, Otis and Sera retained
  `visible_observation` working-memory facts recording that exact tree's
  `ObjectState.current=branch_damage`. Its native `clear_branches` affordance
  was available. The final capped perception history alone cannot prove which
  earlier sound stimuli reached attention.
- The Narrator chose the incident using a snapshot with Tess, Leon, Noor and
  Otis crossing the square. Near commitment, Tess/Leon/Noor were already inside;
  Ivo/Sera/Otis remained outside. Target identity was current, but the intended
  social opportunity had partly moved on during inference.
- Residents instead gathered at the cafe, discussed Ivo's empty-box report,
  Ada's workshop-use boundaries and Bea's wish to keep the garden quiet. They
  volunteered for cups/napkins, but no supplies acquisition was demonstrated.
  Weaver completed **three** need reviews, each with zero suggestions; no God
  construction decision, native build or generated system occurred.
- 406 HTTP attempts: 396 settled responses, five timeout failures, one other
  mid-run abort and four shutdown aborts. Nothing remained in flight after
  drain; no observer errors. One unfinished Mara utterance was cancelled at the
  session boundary and retained as a failed public receipt. No pre-stop failed
  native physical action was observed.
- Runtime fast-system health reported no execution failures, **not** perfect
  responsiveness: 254 ticks exceeded the configured 50ms budget; last-100-tick
  mean was 49.08ms. Maximum WorldTick/ActorControl calls were 166.5/147.0ms.
  Foreground queue delays reached 10.476s and background planning queue delays
  36.143s. No construction occurred, so the construction-under-100ms gate is
  still unassessed.

Interpretation: native intervention, perception of changed state and receipt
feedback are working in this trial. Harmless branches with no injury, blockage
or effect on a resident's current purpose need not interrupt a meaningful cafe
visit. That is not proof of a cognitive defect; neither does it satisfy the
intended incident-to-independent-response test. Do not force an NPC to clean up
merely to turn this gate green.

Next bounded steps: make proposed complications depend on a still-current
purpose and real consequences; trace whether environmental attention remains
available when decisions become possible; address ten-agent queue pressure.
For deterministic growth without new geometry, start with one God-approved
managed build on existing entities (for example observable wetness/drying),
explicit native public-state and interaction bridges, independent positive and
negative tests, tick-boundary installation, and a one-job budget. Verify actual
NPC perception/use and returned outcomes before broadening authority. Do not
simply enable every specialist: Lawgiver's scoped auto-approval is a separate
authority path, not the managed God-approved build path.

Ten-trial baseline, ten wall/simulation minute endurance, useful generated-system
growth and the full story-response-feedback gate remain **OPEN**. Existing ready
preview and all earlier failed evidence are preserved.

Post-trial observer-only hardening: the memory matcher now normalizes the first
command token exactly as the native host does (case/trailing arguments), while
requiring matching action type, own-action provenance, target identity and
completion time. The earlier strict spelling check could incorrectly reject a
valid repair. It had no effect on this outcome, which contained **zero** tree
actions. Original trial artifacts/results were not altered or relabeled; there
was no rerun. Final evidence/host/transport regressions passed **124/124**,
including 25 added matcher cases, in
`/tmp/argos-story-loop-offline-final-20260926.log`; whole-project typecheck passed
in `/tmp/argos-story-loop-types-final-20260926.log`.

## Subsequent simulation-depth wiring pass

See `SIMULATION-DEPTH-PASS-2026-09-26.md`: authored resident opening purposes
now enter the existing personal intention lifecycle rather than the legacy
fixed-goal path. Weaver also receives source-bound historical outcomes between
reviews. Offline regressions pass; no new autonomous run or changed outcome for
the above failed tree-response gate is claimed. Assets/rendering remain deferred.
