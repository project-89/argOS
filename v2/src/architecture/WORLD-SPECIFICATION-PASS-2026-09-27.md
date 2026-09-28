# Shared world specification and movement evidence — 2026-09-27

## Scope and status

Follow-up to the [grounding/growth repair](GROUNDING-GROWTH-REPAIR-2026-09-27.md)
and [generation readiness audit](WORLD-GENERATION-READINESS-2026-09-27.md).
Implement the movement-memory linkage and route a consistent authoring brief
through existing owners. This is an **offline implementation pass**, not a new
live quality, repeatability or endurance result. No live model requests, UI
restart, H3, asset work, VR, model change, new controller or commit.

The existing dirty worktree was preserved. Before-edit checkpoint:
`/tmp/argos-world-spec-20260927.h5KEI7` (tracked patch and source archive).
Previous `recordings/household-check-729eHG` remains unchanged, including its
failed movement-evidence gate and shutdown failure. An offline producer repair
does not retroactively turn that run into a pass.

## Ownership and changes

### Native movement → memory

Working-memory capture previously bound targets only from the actor's locally
visible entities. A known destination room can legitimately be outside that
view. Noor's native journey completed under her new personal intention, but
the receipt lacked a structured action target and the evaluator correctly
could not credit it.

`working-memory-observation.ts` now privately captures the unique destination
identity from the existing movement catalogue. It does not inspect the remote
room or reveal its contents. A successful structured move requires the same
actor, source, capability generation, command, one-use issuance and actual
arrival at the same room identity. Failure can remember the attempted target
without claiming arrival. Departure purpose stays historical; it is not
replaced by the actor's intention at arrival. Local object movement remains
supported. The household evaluator is unchanged.

A wider regression also exposed an older prompt-order defect: goal formation
placed `formatCharacterContext` (including past recollections) ahead of recent
physical working memory. The pre-pass archive confirmed both production code
and test were unchanged. Only the existing prompt blocks were reordered;
physical evidence and coordination now precede character recollections. The
test and evidence standard were not weakened.

### One authored brief, existing owners

`world/world-specification.ts` provides a strict, bounded, versioned,
world-local immutable specification:

- Setting: name, genre, public premise and tone.
- Story style and tensions.
- Named inhabitants with existing `CharacterPast` creation data.
- Desired opportunities, discovery guidance and authoring constraints.

These are **design inputs**, not a second ECS state store. Opportunity prose
does not create a mechanic. Discovery guidance does not install visibility
rules. A relationship mentioned in a private memory is that owner's history,
not reciprocal knowledge or an automatically created relationship/entity.
Use existing God relationship and world-authoring tools for concrete state.

God receives author-only named seeds. NPC construction uses a matching seed's
private past if no explicit `past` is supplied; explicit creation data retains
precedence. Config-driven creation uses the declared inhabitants when the
caller has not supplied a separate `agents` list. Restoration does neither.
Creation seeds are not repeated instructions to recreate/reset existing NPCs.

Scaffold, generic spirits, Weaver need/design, Steward, Lawgiver, Tinker and
managed coding context receive the **style projection without private cast**.
Builders still receive their existing capability manifests and observations.
Weaver still needs current evidence and approval; coding still needs validated
releases. No old Crafter automatic-refill path was reconnected. Steward's
implicit medieval-fantasy fallback is now neutral, and a world theme supplies
the default for scoped population unless explicitly overridden.

### Host runtime is separate from fiction

The `embodied-v1` runtime profile selects the existing fast/slow split:
10 deterministic ticks/second, 100 simulation milliseconds/tick, finite speech
and actions, narrative mind, experienced-event reconsideration, planning and
reflection. It keeps the existing controller and models. A supplied tick rate
without a delta retains 1:1 simulation cadence by default.

New specification-driven worlds select this profile. Legacy callers without a
specification/profile keep their existing defaults. A restored specification
selects conservative runtime defaults but does not restore authoring jobs or
grant host permissions. Saved temporal/narrative flags remain intact unless
explicitly overridden by the caller or an explicitly selected runtime profile.

Autonomous evolution, coding, God autopilot, auto-population and real host
tools default **off**. The caller can explicitly select existing facilities;
coding requires a finite `maxTotalJobs` budget. Fresh worlds have 200 lifetime
construction admissions by default; restore retains recorded construction
history rather than replacing it with a fresh limit. Authoring metadata cannot
contain runtime/authority fields. This is not a sandbox for trusted operator
commands or legacy God genesis tools.

The profile also closes the generic spirits' legacy direct physical/mood
mutation path. Hosts can subsequently install their explicit, source-scoped
physical-effect grants. Advice and proposed opportunities remain available.
The NLE director remains advisory, not a second world mutation authority.

### Save/reload

Snapshots preserve detached authoring metadata and the existing canonical
world/memory state. Both the public restore envelope and direct deserialization
validate specification data; invalid/conflicting briefs fail before restoration
writes. Restoring does not spawn cast, seed pasts again, resume jobs or infer
permissions. A supplied replacement brief conflicting with a saved one is
rejected; create a new world to change this immutable design input.

## Library usage

Use the existing entry point, not another controller:

```ts
const sim = await createSimulation({
  name: "Tidehaven",
  worldSpecification: {
    version: 1,
    setting: {
      name: "Tidehaven", genre: "coastal mystery",
      premise: "A missing keeper divides a close fishing community.",
      tone: "Uneasy warmth; grounded daily life",
    },
    story: { style: "Discoverable clues and conflicting personal concerns" },
    // Optional inhabitants use the existing private CharacterPast schema.
    opportunities: ["Fishing, meals, friendship and investigating the dark lighthouse"],
    discovery: ["Residents learn clues through their own encounters and conversations"],
    constraints: ["A missing object is not automatically replaced"],
  },
  runtimeProfile: "embodied-v1",
  genesis: true,
  // Later runtime growth needs explicit scoped host configuration.
  evolution: false, codingDaemons: false, godAutopilot: false,
});
```

This example invokes live God authoring when run with AI credentials; it was
not run live in this pass. Its brief is not proof that a fishing mechanic,
playable mystery, navigation mesh or 3D asset binding has been constructed.
Concurrent worlds still require the existing process-isolated simulation host.

## Verification and preserved failures

New offline coverage includes destination/source/identity/time/cancellation
checks; a real manual household movement joined to the unchanged evaluator;
private past seeding through actual God tools across mystery/comedy/survival;
shared specialist prompt capture; strict schema/privacy/isolation; runtime
cadence and authority; and public-library save/reload without reseeding.
Model outputs are scripted in authoring tests. These prove wiring, not creative
quality or autonomous behavior.

Intermediate failures are retained: the genuine movement red test, original
goal-context ordering regression, initial incomplete test memory fixture, a
God-prompt test that initially checked only user messages rather than its system
prompt, and profile safety/restore regressions. None modify the failed live run.
The first combined runner listed two nonexistent test filenames: its 81 actual
suites/1,312 tests passed, but the runner correctly exited nonzero for those
paths. `final-candidate.log/.json` preserve that outcome. The corrected runner
includes the real Tinker and Lawgiver suites; no test was waived.

**Final combined verification: 83 suites, 1,355 tests passed; zero failures or
pending tests.** Typecheck and scoped whitespace checks pass. The combined set
includes the prior 56-suite candidate, the new movement/specification/profile
checks, all persistence suites, the unchanged working-memory consumer gate,
and additional specialist authority tests. This is targeted regression coverage,
not the entire repository or the live behavioral acceptance suite.

Artifacts in `/tmp/argos-world-spec-20260927.h5KEI7`:
`final-verified.json`, `final-verified.log`, `typecheck-final.log`, intermediate
failed outputs, copied movement/order red-green logs, before/after source
archives, and worktree status. The recorded live household remains separate.

## Exact next steps / gates still open

1. Freeze this candidate, then authorize one bounded renderer-free household
   rerun with the previous wall/simulation/request limits. Verify a new personal
   intention's actual movement receipt, growth/use feedback and clean shutdown.
   Do not credit the older missing receipt retroactively or force a choice.
2. Apply the same behavioral gates to specification-authored worlds of different
   styles: actual purposes and actions, a genuinely missing capability proposed
   and built, independent use, effect feedback and save/reload. Keep construction,
   coding and physical intervention budgets explicit. Offline prompt capture is
   not this acceptance test.
3. Preserve the ten-trial baseline and ten-minute wall/simulation endurance
   requirements. They remain open. Full initial playability validation, genuinely
   useful autonomous mechanic discovery, some repeated reflections, reachable
   interaction anchors and learning/retained-memory comparison remain work.
4. Only after the simulation proof: navigable 3D bindings, assets/animations,
   in-world builder previews, voice and WebXR. None is delivered by this pass.
