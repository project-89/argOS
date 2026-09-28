# Alive World pass — 2026-09-28

The previous passes made Argos *correct*: grounded actions, admission fences,
receipts, privacy, cancellation. They also made it *inert*. Live Saltmere runs
spent 47–63% of choices waiting or resting, residents talked every mystery
down ("no sense turning an old nick into an omen"), the Narrator requested one
intervention in seven reviews, the Weaver proposed nothing, and the Narrator's
story prose was discarded before any viewer saw it.

This pass keeps the engine's truth guarantees and puts life back on top of them.

## Principles

1. **Truth lives in code, not in prompt prose.** Admission fences, native
   receipts, evidence IDs, privacy projection and goal contracts already
   enforce what is real. Prompts no longer repeat "not proof / not evidence /
   valid to do nothing" caveats. A prompt describes *who you are, what you
   want, what is in front of you and how to answer*. Where a model genuinely
   needs a mechanical fact (exact target names, JSON shape), state it once,
   briefly, positively.
2. **Persona first.** Character material leads every character prompt and
   outweighs procedure. Characters have voices, wants, fears, secrets,
   contradictions and people they love, owe, suspect or resent.
3. **Drama is the product.** Pressure, secrets, suspicion, confession, betrayal,
   loyalty, fear and wonder are welcome. We do not script outcomes; we supply
   motive, means and pressure and let characters decide.
4. **The Narrator is an author.** It sees the whole board — including private
   secrets and motives (author omniscience; residents still never learn
   another's private facts except through the world). It keeps a story ledger
   (dramatic questions, threads, foreshadowing, tension target) and actively
   shapes a good story through the world: sounds, arrivals, letters, found
   objects, lights, weather, phone messages from unknown numbers, and whispers
   routed through each resident's daemon. Its prose is shown to the viewer.
5. **Suggestions flow upward and become world.** Narrator and spirit requests
   (`create_event`, `escalate`, needs) reach God, and God has tools that make
   things happen: stage events, place story props, approve builds, commission
   new systems. Budgets exist for cost control, sized for a living session,
   not two events per run.
6. **Spirits watch and relay.** The Watcher flags *stagnation* (long waits,
   flat tension, idle cast) not just failures. Steward and Crafter furnish and
   populate in theme. The Weaver is asked what would make the place richer for
   these people, with a small novelty budget, not told that returning nothing
   is success.
7. **Daemons whisper.** Each resident's daemon knows its person's inner life
   and the Narrator's current threads, and whispers impulses, doubts, hunches
   and temptations as private perceptions. A whisper never hands over another
   person's secret or asserts a world fact; it is the voice in one's own head.
8. **Invariants kept.** ECS state is authoritative; spirits act through the world
   and never command a resident; speech about an action is not the action;
   private minds stay private between residents; fast loop never awaits models;
   cancellation/source identity rules unchanged.

## Saltmere story bible — "What the Sea Was Paid"

Thirty-one years ago the trawler *Marrow Star* went out on a storm night and did
not come back. Three men were lost: **Tom Hale** (Mara's father), **Ruben
Voss** (Eli's grandfather, never found) and **Jonah Wick** (the skipper, husband
of Agnes Wick — Sera's grandmother, the "widow" of Widow's Garden). The town
tells it as the Three Hooks legend: when three hooked marks appear, the sea is
counting what it is owed, and three knocks come before it takes.

The truth nobody alive fully holds: the *Marrow Star* was not fishing. Leon's
late brother **Callum Brand** organised a smuggling run, the crew went out for
the money despite the storm warning, and Leon — then a young clerk — helped
Callum keep it quiet. At the inquest Leon told the Three Hooks story so
beautifully that nobody asked about cargo. The boat's logbook survived in the
Net House supplies box for three decades. Whether anything *else* is out there
in the water is deliberately undetermined; the Narrator may lean into the
uncanny without ever resolving it.

Marks are appearing again. Some are human; not all are explained.

| Resident | Home | Wants | Secret / pressure |
| --- | --- | --- | --- |
| **Mara** | Lantern House | The truth about her father's death | Her dying mother wrote: "Ask Leon what the sea was paid." She carries the letter and came back for this, not for a quiet life. |
| **Ivo** | Lantern House | Mara's regard; a normal life | He saw Otis force the Net House box two nights ago and said nothing — Otis once covered Ivo's gambling debt. He is sweet on Mara and is lying to her. |
| **Tess** | Lantern House | Save the failing Waking Gull | She scratched the three curves into Cafe table 1 herself. A "haunted Gull" story could bring visitors; a collector has offered to buy the cafe. |
| **Ada** | Rook House | Stay the rational one | Made two alignment cuts last winter; the middle cut is new. She has been hearing three knocks at night in Rook House and is frightened, which humiliates her. Suspects Eli. |
| **Leon** | Rook House | His legacy, his brother's name | Knows the *Marrow Star* was a smuggling run and he helped bury it. Has a failing heart. Dreads Mara, adores Eli, afraid of dying exposed — or unconfessed. |
| **Eli** | Rook House | Belong; find his grandfather | Not a random newcomer: grandson of Ruben Voss, came to learn what happened, hiding it. Saw Otis leave the Net House. |
| **Sera** | Tidemark House | Keep her grandmother close | Agnes Wick's granddaughter. Has Agnes's diary: "L. knows. He tells the sea story so no one asks about the cargo." She loves Leon like family and hasn't told anyone. |
| **Noor** | Tidemark House | Rest; do right | Treated Leon last month; half-sedated he said "I let them go out." Bound by confidentiality, watching Sera and Mara circle it. |
| **Bea** | Gull House | Keep the garden and the dead at peace | Repainted the pot over Agnes's three hooks because Agnes asked her to "keep the sea from counting." More superstitious than anyone knows. |
| **Otis** | Gull House | Get out of debt without losing his friends | Forced the Net House box, took the *Marrow Star* logbook and has been negotiating to sell salvage to the same collector courting Tess. The logbook is hidden in Gull House. His pocketknife has the pale paint from the box. |

Story objects (real, inspectable, portable where sensible): the *Marrow Star*
logbook (hidden in Gull House), Mara's mother's letter (carried by Mara), Agnes
Wick's diary (Tidemark House), Otis's pocketknife with pale paint (Gull House),
Leon's heart pills (Rook House). Reading a document reveals its text only to the
reader; showing or giving it is a real action others perceive.

## Workstreams and owners

| Workstream | Owns |
| --- | --- |
| Character cognition prompts | `cognition/agent-mind.ts` prompt text, `emotional-life.ts`, `decision-policy.ts`, `activity-situation.ts`, `idle-cognition.ts` pacing, `autonomous-goals.ts`, `planning-system.ts`, `reflection-system.ts`, `experience-appraisal.ts` prompt text |
| Narrator + God relay | `spirits/spirit-cognition.ts`, `spirits/narrator-spirit.ts`, Narrator prompt in `demo/spatial-lovecraft-town.ts` (`LOVECRAFT_TOWN_NARRATOR_PROMPT` / `LOVECRAFT_TOWN_STYLE` only), `demo/spatial-story-events.ts` (+ new narrative event module), `god/god-autopilot.ts`, `god/spirit-authority.ts`, `god/narrative-authority.ts`, prose surfacing in `index.ts`/spatial client story feed |
| Spirits + daemons | `spirits/architect-spirit.ts`, `spirits/watcher-spirit.ts`, steward/crafter activation, `spirits/agent-daemon.ts`, daemon nudge bridge in `index.ts`, spirit activation block in `demo/spatial-town-life.ts` |
| Cast + verbs | `CAST` and scenario wiring in `demo/spatial-lovecraft-town.ts`, story props, `demo/spatial-catalog.ts`, spatial executor verbs in `demo/spatial-demo.ts`, per-role schedules |
| Liveliness metric | new `evals/liveliness-score.ts` over recordings |

## Measurement

`evals/liveliness-score.ts` scores recordings offline: wait/rest share, speech
volume and lexical/topic diversity, cross-resident exchanges, conflict and
disclosure signals, goals completed by native outcome, Narrator interventions
committed, God/world events committed, builds, whispers delivered. The baseline
is computed from the existing live recordings before changes are compared.

## Results — bounded live run, 2026-09-28

One authorized Saltmere run: `--live --lovecraft --develop`, 300 s wall cap,
gemini-3.8-flash, fresh port (the user's server was not touched). Codex CLI is
not installed, so no coding jobs ran. Evidence (local, git-ignored):
`recordings/spatial-8M4jvm/` plus `alive-capture/` (full event stream, full
speech, thoughts, story feed, `liveliness.json`).

| | Live crisis baseline (of3NLe / wVJTYc) | Alive pass (8M4jvm) |
| --- | --: | --: |
| wait/rest share | 0.51 / 0.51 | **0.21** |
| deflation lines ("just an old nick…") | 21 / 10 | **0** |
| fear/uncanny lines | 4 / 3 | **35** |
| words per spoken line | 12.9 / 12.0 | **25.2** |
| Narrator prose shown to the viewer | 0 | **5** |
| world events by Narrator/God/spirits (not operator) | 0 | **2** (+rain) |
| builds from spirit proposals | 0 | **1** built, 2 approved, 4 proposed |
| aliveness index | 37.9 / 44.2 | **63** |

What happened, briefly: Mara confronted Leon on the Common ("I want to know what
the sea was paid"); Noor intervened to protect his heart without revealing what
she knows; Bea accused Tess of carving the cafe table; Eli shadowed Otis; the
Narrator put three knocks on Rook House (Ada's house, and Ada's private fear); the
Weaver built a discreet corner chair in the Gull and Ivo sat in it, then — after
his daemon whispered "He calls you *friend* to remind you what you owe. Sit down
and say *oilcloth*" — began confronting Otis about the box. Daemon whispers were
delivered as private perceptions at intensity 0.6.

Measured limits of this run, stated plainly:

- **Pace regression, found and fixed after the run.** The run reached only 155
  simulated seconds in 300 wall seconds. Offline reproduction with a fake model
  (`--import` shim, zero provider calls) showed 0.30 pace vs 0.555 at HEAD. The
  cause was the busier town hammering an existing hot path: bitecs resolves
  `LocatedIn` by copying and scanning every component on every call. Fix:
  `getDirectContainer` keeps a per-world hint re-verified by an O(1) pair check
  (never returns stale data; `direct-container-hints.test.ts`), and trait JSON
  parsing is memoized by its exact string. Same offline harness: **0.735**.
  Not yet re-measured live.
- Only ~2.6 simulated minutes, one trial: no repeatability or endurance claim.
  The ten-trial baseline and ten-minute endurance gates remain open.
- The operator feed records only the first streamed chunk of speech; full lines
  were recovered from the saved world for scoring.
- Three Weaver designs were still discarded as `stale_observation` (the existing
  re-observe path recovered some). Relaxing this for furnishings was tried and
  reverted: the same check also guards source/policy/capability revocation.
- One whisper ("Gran had Bea hide them here") is close to handing Sera part of
  Bea's secret; it may be Sera's own inference from the paint. Worth watching.
