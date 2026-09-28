# Storm House: three minds, one world

A small authored testbed, not a second brain and not a generated video. Mara, Ivo and Sera share two rooms during a storm. Each has private memories, personality, goals, normal foreground cognition, background planning/reflection, grounded speech and inventory. They need to get a reading lamp working. The cupboard is locked, its key is a real possession, the replacement fuse is hidden inside, and the circuit must be safely isolated before repair.

No character's decisions or dialogue are scripted in live mode. They may collaborate, refuse, misunderstand, fail or get distracted. The physical fixture is separately labelled and uses explicit operator intentions to test mechanics without model calls.

## Run

```sh
# No model calls: scripted physical smoke test, writes artifacts and exits.
npm run demo:agents

# Real shared Argos cognition; existing Gemini key in .env; no FAL/H3 spend.
npm run eval:agents:live -- --seconds=120

# Harder cooperative repair: leak, timed drying, a separate panel holder and installation.
npm run demo:agents -- --challenge
npm run eval:agents:live -- --challenge --seconds=180

# Optional world-growth workers: God, spirits, narrator and coding daemons.
npm run eval:agents:live -- --seconds=240 --evolve
```

The baseline isolates social cognition with the world-growth workers off. It does not disable plans, reflection, memory, needs or schedules. The testbed clock is real time (two ECS ticks/second), not the generic preset's accelerated one-hour-per-30-seconds clock. World growth is opt-in to avoid changing the puzzle during a repeatable baseline. New rooms need an established physical route before characters can travel there; `--evolve` does not manufacture connectivity or grant the camera mutation rights.

Live terminal controls:

```text
/thought Mara | Maybe I should ask Sera what she remembers.
/move Spare fuse | Common Room
/state
/stop
```

Thought planting is an experience, not forced obedience. `/move` is explicitly an operator edit to the ECS. It changes no remote character's memory. Physical rules re-check current ownership and access; narration cannot substitute for a key or fuse. Removing an installed fuse darkens the lamp and permits a subsequent repair.

## Library entry point

```ts
import { GenerativeAgentsTestbed } from "./src/index";

const testbed = await GenerativeAgentsTestbed.create({ live: true });
testbed.onEvent(event => { /* operator-only thoughts + public receipts */ });
await testbed.start();
testbed.plantThought("Mara", "I wonder what Ivo knows.");

const publicRooms = testbed.scenes();
const operatorState = testbed.snapshot();
// Later, when connecting an actual transport:
const configure = testbed.director.configure();
// Only pass an acknowledged version after the transport really acknowledges it.
// Configure/transport acknowledgment is NOT proof of displayed video alignment.
testbed.stop();
```

`createSimulation` remains the underlying entry point; this is a small authored world package on it. `dispatch()` is an explicit operator/test intention, not an autonomous decision. Physics reports completion through the normal action evidence path. Shared goals use the generic `entity_component_equals` success condition, so native goal completion, events and learning run only after ECS proof.

## Camera and physical appearance

`scenes()` returns copied, sanitized public snapshots, one per room. Other characters' private inventory, memories, thoughts and unsent text do not enter them. `snapshot()` and `events.jsonl` are intentionally omniscient operator/debug surfaces; do not expose them as NPC perception or public renderer context.

The deterministic **SceneDirector** is a read-only camera spirit: it chooses between rooms from recent public events, holds shots for a minimum dwell, and compiles establishing, wide, two-shot, over-the-shoulder, close-up and prop-insert prompts. It lists every local character separately with a stable identity and current ECS appearance. It cannot invent successful actions, offscreen knowledge, dialogue or future outcomes. See [scene-director.md](../rendering/scene-director.md).

Appearance separates relatively stable physical identity from current clothes, expression, posture, condition and explicitly held items. A removable raincoat is a physical entity: take it, wear it, remove it, give it away or relocate it. A stale equipment claim does not make it remain visible. Save/load remaps valid wearer IDs; moving a loaded garment away and back does not magically re-equip it.

The director uses the existing H3 configure-envelope format and a latest-one pending queue. This testbed does **not** allocate a video session, solve H3 lag, validate camera obedience, synthesize voices, perform 3D occlusion, or claim exact frame synchronization. Those are transport/rendering evaluations after cognition.

## Evidence and limits

Each run writes a private directory under `recordings/generative-agents-*`:

- `report.md`: readable metrics and actual conversation.
- `events.jsonl`: thoughts, perceptions, actions, outcomes and decision timings.
- `scenes.jsonl`: versioned public camera prompts, explicitly `rendered: false`.
- `result.json`: per-actor goals/memories, state, runtime timings and observed gates.
- `world.json`: ECS checkpoint, **not** a resumable testbed runtime/renderer session.
- `runtime.log`: bounded diagnostic log.

Gates report observations, not manufactured success. An item handoff is optional: Ivo may instead unlock the cupboard himself. A single successful repair does not establish long-horizon relationships, autonomous society, arbitrary prompt-to-world generation, or robust procedural learning across different worlds. Independent simultaneously active worlds still share legacy component storage; use separate processes for separate testbed worlds.

Deterministic tests cover physical access, safe repair, inventory handoff, delayed travel, local speech perception, private thought isolation, wardrobe changes, camera selection and save/load continuity. Live trials exercise the real scheduling and cognition layers that a fixture alone cannot prove.

### Live observations, September 4, 2026

The first 120-second run (`generative-agents-4m87Mo`) failed to restore the lamp. It exposed a lower-priority leisure goal suppressing Ivo's actual movement plan, plus independent schedule/grid movement bypassing the physical package. Regressions now cover both problems. The testbed also replaces accelerated preset time with physical elapsed time, so a two-minute repair does not silently become several simulated hours and trigger bedtime.

The next 120-second run (`generative-agents-Gyg3F4`, Gemini `gemini-3.8-flash`) autonomously restored light at **21.5 seconds**:

- 1.5–3 seconds: all three characters began thinking and exchanging relevant knowledge.
- 11 seconds: Sera switched off the circuit.
- 16 seconds: Ivo used his own key to open the cupboard.
- 18.5 seconds: Sera physically picked up the fuse.
- 20 seconds: Sera installed it; Mara's simultaneous stale pickup failed correctly.
- 21 seconds: Ivo restored power; the physical system lit the lamp on the next half-second tick.
- The characters returned to the Common Room and continued talking; all three produced background reflective insights about the shared experience.

Per-actor decision p95 was 2.09 seconds (Mara), 2.56 seconds (Ivo), 2.46 seconds (Sera). This measures shared decision jobs, including deterministic plan decisions, not pure provider latency. Mara had two rejected actions (stale fuse pickup and observing Ivo after he left); Ivo and Sera had none. There was **no item handoff in this live run**: Ivo opened the cupboard himself. Handoff is separately covered by the fixture and regression tests.

The remaining visible quality weakness is repetitive post-repair conversation and repeated questions whose answers were already heard. Abstract social desires do not yet have a strong satisfaction/novelty model. This run proves useful autonomous cooperation in a small configured world, not that long-horizon social cognition is finished. No H3 session was opened in either trial.

## Cognition cleanup and cooperative challenge — 4 September 2026

See [the cognition prompt review](../cognition/PROMPT-REVIEW.md) for all reviewed
prompt families, runtime fixes and explicit remaining limitations.

The cleaned baseline `generative-agents-CoAISC` ran for 119.5 simulated seconds.
It restored light at 14 seconds, with 40 public speech turns versus 129 in the
archived run of the same duration. The deterministic evaluator found no repeated
information checks after recorded hearing in this run, versus three before.
These are single stochastic runs, not a controlled estimate of each change.

The harder run `generative-agents-YRABVL` then ran for 179 simulated seconds with
live Gemini cognition and no operator interventions or H3 session:

| Source time | Committed evidence |
| --- | --- |
| 12.5s | Ivo closed the leak valve. |
| 14s / 15s | Ivo unlocked the cupboard and acquired the real spare fuse. |
| 24–29s | Sera dried the floor for five seconds, carrying the cleaning cloth. |
| 32–39s | Sera held the access panel; Ivo's six-second installation ran from 33–39s. |
| 40.5s / 41s | Sera restored power; the physical lamp state became lit. |
| 44s / 47s / 58s | Ivo, Sera and Mara separately recorded subjective social satisfaction against owned speech evidence. |

The circuit began tripped/off in this challenge; no new switch-off action was
needed. Ivo installed the same fuse he acquired, so no live item handoff occurred.
Mara shared the panel requirement, but the engine did not reserve repair for her;
Ivo and Sera adapted their roles using the actual local state.

The challenge produced 42 public turns, four rejected actions, and per-actor
decision p95 of 3.12s (Mara), 3.97s (Ivo), and 2.23s (Sera). Timings include
deterministic and model-backed decision jobs. The evaluator flagged one lexical
speech repeat and no repeated information-check candidates. There were 56
lexical-repeat candidates among 223 recorded thoughts. Requested words would
still require about 1.77 times the available duration at 150 spoken words/minute;
text-turn timing is not realistic synthesized speech timing.

### What is still not natural

The shared physical goal and all three authored social desires settled, but
separately generated custom goals remained active at 90%: Mara kept checking the
lamp, Ivo kept re-verifying the dry floor, and Sera rechecked a cloth she had
already returned. Those goals lack native completion/dependency contracts. This
is a goal-lifecycle defect, not evidence that the repair remained unfinished.
Frequent idle decisions also produce repeated “time to rest” thoughts. The next
structural work is retirement of satisfied/obsolete intentions and event-driven
idle cognition, retaining immediate reactions to meaningful new stimuli.

The baseline additionally invented pantry/corridor details; no corresponding
rooms or supplies were created in ECS. Source-aware beliefs and contradiction
handling still need work. Lower repetition scores alone do not prove grounded
or interesting conversation.

Verification after the final code changes: **117 test suites passed, 980 tests
passed, 10 live tests skipped; typecheck and diff whitespace checks passed**.
Challenge interruption/recovery cases use explicit fixture inputs, separate
from the unperturbed autonomous trial. No video-generation credits were spent.
