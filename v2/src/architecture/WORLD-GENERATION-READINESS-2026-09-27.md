# World generation readiness — 2026-09-27

Follow-up implementation: [shared specification and movement evidence](WORLD-SPECIFICATION-PASS-2026-09-27.md)
addresses the profile/style propagation and movement-memory gaps below. This
audit records the pre-follow-up boundary; its live acceptance limits remain open.

## Answer and scope

Argos has a genre-independent simulation substrate and a real prompt-to-world
entry point. “Speak a world into existence, enter it, and discover things” is a
credible direction, **not a capability we have validated end to end for arbitrary
worlds**. The last household demonstrated a useful slice, not a general game
generator. This audit accompanies repair of its capability, inspection-grounding
and Weaver handoff gaps; it does not authorize an unbounded generation run.

The ECS owns what exists and what happened. NPC knowledge is a separate,
incomplete view. The narrator proposes opportunities; it must not silently turn
an imagined event into history or a desired reaction into an NPC decision.

## What is implemented

| Layer | Actual path | Important qualification |
| --- | --- | --- |
| Natural-language creation | `createSimulation(prompt)` and `createSimulationFromPrompt(prompt, options)` in `src/index.ts` select genesis. God receives the seed and calls real room/agent/object/component/system tools. | The initial scaffold is small: the prompt asks for 2–4 rooms/people and 3–8 objects. The integrity gate currently checks nonzero rooms/people/objects, not a complete playable world. |
| Character authorship | God `createAgent` and architect-created inhabitants accept private `past`: background, drives, formative recollections, self-beliefs, meanings and cues. Prefabs seed owned narrative records/core drives. | Memories mentioning a person do not create that person, a mutual relationship, or the other person's knowledge. Cross-character history consistency is requested but not comprehensively validated. |
| Social/world vocabulary | God can create traits, affordances, relationship types and canonical relations. | New interaction vocabulary must match actual entity traits and have an executable mechanic. Names and attractive descriptions alone do not make something usable. |
| Narrative direction | Genesis can generate an ECS story scaffold containing tensions, possible beats and narrative roles; the director reconciles it against events. God also has narrative/state presets. | Scaffold secrets and hidden motives are advisory, not automatically NPC-owned beliefs/history. Canonical secrets and relationships need explicit creation data. Genre/style is not yet one consistently applied world specification. |
| Spirit hierarchy | Standard library initialization creates Narrator, Arbiter, Watcher, Weaver, Crafter, Steward, Tinker and Lawgiver. The evolution coordinator schedules specialist work and proposal execution. | Registration is not proof of useful work. Each path needs its observation → proposal → authority → outcome → feedback chain exercised. Narrow spatial demos grant only selected stages/actions. |
| Generated mechanics | God/architect can queue coding-daemon jobs. Validated releases activate at simulation boundaries, with declared read/write capabilities and runtime health/repair support. | Managed systems may extend physical state through allowed components, not arbitrarily rewrite private minds or execute host actions. Unmanaged legacy generation and managed jobs are distinct paths. |
| Continuing direction | The library's God command/injection path is real and invokes authoring tools. | `injectSpiritMessage` currently only logs a TODO in the library bus handler; it must not be advertised as a functioning operator-to-spirit control surface. |
| Presentation | Renderers project world state. The current spatial package supplies assets, collision, anchors and navigation for its authored layout. | Text-world creation does not automatically create a navigable, good-looking 3D asset/animation package. Voice input, in-world builder previews and WebXR are not completed by genesis. |

## Evidence and coverage

Previous live observation `recordings/household-check-uPDjb2` showed an explicitly
commissioned generated wetness system passing 30 release checks, activating,
changing resident/furniture state, and those exact effects reaching the spirits.
It did **not** prove autonomous mechanic discovery or arbitrary world creation.
Both autonomous furnishing proposals failed their stale-evidence handoff; that is
one of the repairs in this pass.

The one repaired follow-up, `recordings/household-check-729eHG`, does exercise
that recovery: same Tess goal → fresh design → God approval → native chair at
102.0s → Tess uses it at 114.5s → exact use receipt in accepted Weaver/Arbiter
reviews. Its commissioned generated wetness system also activates (31 checks,
296 changed commits). This establishes a useful bounded growth handoff, not
arbitrary creation or autonomous discovery of a new mechanic. The request-bound
shutdown records an AbortError; a movement-memory schema gap leaves the separate
new-intention-enactment gate unproven. Neither failure is waived.
Shutdown was subsequently repaired and checked offline; the final combined
targeted regression is 1,059 tests across 56 suites with a clean typecheck.
There was no post-repair live rerun, and those counts are not a live creative
quality or arbitrary-world acceptance result.

`src/__tests__/world-genesis-wiring.test.ts` now exercises the real public genesis
entry point and God tool implementations with **scripted model responses** for
three different settings:

- A fogbound coastal mystery.
- An affectionate domestic comedy.
- An orbital greenhouse survival story.

The tests verify real ECS creation, actual room placement, private formative
history and core drives, peer privacy, the same shared cognition-service wiring,
and an advisory scaffold that does not become fabricated NPC knowledge. Empty
model prose fails the current integrity gate. These four offline checks passed
without network access; they establish wiring, **not live creative quality,
playability, or behavior in those genres**. They deliberately do not start the
runtime or enable coding/spirits and therefore do not claim those stages ran.

Existing focused tests separately cover character-past persistence, narrative
authority/reconciliation, specialist materialization, evolution coordination and
managed coding. The earlier ten-trial baseline and ten-minute wall/simulation
endurance requirements remain open.

## Concrete integration debt found in the audit

1. **Profiles differ.** Plain library defaults leave `narrativeMind` and
   `experienceReconsideration` off; recent spatial demos opt in. Library tick
   default is one every three seconds, unlike the fast spatial setup. A new
   world must select an explicit supported runtime profile; otherwise it will
   not automatically exercise the same settings as the tested household.
   Plain AI-enabled library initialization also enables God autopilot,
   evolution and coding daemons by default (`src/index.ts`); the household
   instead grants narrowly bounded actions and builds. A profile must specify
   execution authority and build budgets as well as cognition and cadence.
   Broad library defaults do not inherit the household's bounded safety claims.
2. **Theme can drift.** Config-driven room auto-population passes literal
   `worldTheme: "fantasy"`; Steward fallback says “medieval fantasy.” The free
   text seed flows to God/scaffold, but not every builder receives a consistent
   setting/style contract. Do not promise a sci-fi world will remain coherent
   solely because its initial prompt says sci-fi.
3. **Initial completeness is weakly checked.** Genesis checks counts, not
   traversable routes, correct affordance/executor bindings, every actor's
   placement/history, useful need-satisfying opportunities, or completed
   generated mechanics. It can return while engineering jobs are pending.
4. **Narrative possibility is not authored truth.** The scaffold prompt asks for
   secrets, but storage correctly leaves them advisory. A mystery needs explicit
   world facts, NPC-specific knowledge, evidence and disclosure mechanisms at
   creation, not a runtime shortcut that makes the narrator's guesses true.
5. **Operator voice is not integrated.** Speech-to-text could feed the existing
   God command path, but that is not yet an in-world builder workflow. Proposed
   changes, previews, allowed scope, coherent commit and usable affordances
   still need a single user-facing path. Fix the logging-only spirit-message
   handler before exposing it as a supported control.
6. **The 3D bridge remains authored.** Generated places/entities/mechanics need
   asset bindings, scale/collision, interaction points, animation mapping,
   navigation and visibility. Asset packs provide reusable parts, not these
   semantic guarantees. Multiple simultaneous worlds should use the existing
   process-isolated host; the legacy in-process API has global component state.

## Smallest next proof, not implemented by this audit

Use one reusable world specification carrying setting/style, inhabitants with
private histories and relationships, opportunities/mechanics, discovery rules,
runtime profile and build budgets. Route it through the existing owners rather
than introduce another controller or duplicate state store.

Then run a bounded cross-style acceptance sequence: prompt → native world →
inhabitants pursue a purpose → one genuinely missing capability is proposed and
built → a resident independently uses it → consequences return to the spirits →
save/reload preserves the accepted world. First prove this renderer-free; add a
single navigable 3D room/street and spoken builder edits after that. Compare
different styles using the same behavioral gates, not just different prose.

Do not weaken private knowledge, action evidence, temporal correctness or
execution authority to make the story move. Give creativity explicit authoring
opportunities and reliable feedback instead of both promising and blocking the
same action.
