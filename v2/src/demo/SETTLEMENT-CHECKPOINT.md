# Saltmere Settlement — checkpoint (2026-10-01)

The walkable settlement: ten residents in tents on bare land beside a drowned
town, who must feed and build it. Habits (learned skill graphs) run the day;
minds wake when something matters; spirits keep it in balance and grow it.
This records what exists on branch `alive-world` (not yet on `main`), how to run
it, where it lives, what it costs, and what is open. It supersedes nothing in the
[tick/Narrator checkpoint](TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md); it is the
record for the settlement profile.

## Run it (from `v2/`)

| What | Command | Model calls |
| --- | --- | --- |
| 3D, habits only | `npx tsx src/run-spatial-demo.ts --settlement recordings/settlement-skills.json` | none |
| 3D, live | add `--live` (and `ARGOS_SPATIAL_SECONDS=3600`; the default session is 10 min) | Gemini, Jev |
| Headless live session with a log | `ARGOS_SETTLEMENT_DAY_MINUTES=20 npx tsx src/demo/settlement-live-session.ts 25` | Gemini, Jev |
| Headless trade training | `npm run settlement` (`--no-spirits`, `--max-calls`) | optional |
| Start the town over | `--fresh-town` (launcher) / `ARGOS_FRESH_TOWN=1` (observer) | — |

Open the printed `SPATIAL_DEMO_READY` URL including its `#token`. The live
observer writes `recordings/settlement-live-<stamp>/session.log` (speech, choices,
plans, spirits, console errors, a clock watchdog) and a cost summary.

**Spend.** Live runs are paid. A 25-minute live session uses about 11–13M Gemini
input tokens plus ~1.1M output/thinking (roughly $15–20 at the rate implied by the
2026-09-30 bill). Run one only when the operator asks; use the habits-only modes
for everything else. Keys live in `v2/.env` (`GOOGLE_GENERATIVE_AI_API_KEY`,
`TYPESAFE_API_KEY`); never print or commit them.

## What carries between sessions (`recordings/`, git-ignored)

- `settlement-skills.json` — trade skill graphs (habits of work).
- `settlement-skills.habits.json` — routine choices written as habits.
- `settlement-skills.town.json` — the town: buildings and parts, homes, coins,
  treasury, prices, sources, tool wear, holdings, stall, trades, hunger,
  conditions, what the Weaver grew, what the Surveyor took up. Minds start fresh.
- Models the workshop draws live go to `src/demo/spatial-client/assets/generated/grown/`
  and `assets/catalog/grown-*.json` — local world data (git-ignored). A deliberate
  "promote to the committed catalog" step is not built yet.

## Where it lives

| Concern | Owner |
| --- | --- |
| Scenario, places, cast, lore | `spatial-settlement.ts`, `learning/settlement/saltmere-land.ts` |
| Crafts, trade, building, sleep, conditions in 3D | `spatial-recipes.ts` |
| A resident's day (habits, menu, errands, supper, work rhythm) | `spatial-trade-life.ts` |
| When a mind looks up (floors, pacing, set aside, night, answering in passing) | `spatial-autopilot.ts`, `cognition/autopilot-attention.ts` |
| Fast judge (choices, appraisals, God triage, habit writing) | `llm/jev.ts`, `spatial-demo.ts` (`chooseByHabitOrJev`, `appraiseWithJev`, `triageForGod`), `cognition/habit-book.ts` |
| Goals set in play (tending, taking up again) | `settlement-intentions.ts` |
| Balance spirits (Watcher, Lawgiver, Steward incl. building watch, Weaver) | `learning/settlement/balance-spirits.ts`, `spatial-balance.ts` |
| Recipe Weaver (sources, crafts, drink, conditions, wear, trades) | `spirits/recipe-weaver.ts` |
| Surveyor (fidelity gaps → model / craft / condition lanes) | `spirits/surveyor-spirit.ts`, `spatial-demo.ts` (`surveyTown`) |
| Body conditions (drink going to the head) | `learning/settlement/conditions.ts` |
| Asset workshop (generated kit code → Blender → catalog) | `spatial-asset-workshop.ts`, `scripts/blender/workshop_build.py` |
| Authored models (stations, goods) | `scripts/blender/settlement_props.py` → `assets/generated/settlement/` |
| Town save | `settlement-town.ts` |
| Skill graph and solver | `learning/skill-graph.ts`, `learning/skill-runtime.ts` |
| Viewer: construction stages, work ring and motions, buffered playback | `spatial-client/client.mjs`, `spatial-client/view-model.mjs` |

## Verified (offline unless noted)

- Settlement, autopilot, asset workshop, conditions, Weaver, Surveyor, habits and
  God autopilot suites pass; the working-memory/coordination/inspection/attention
  cognition suites pass (377 tests). `src/spirits/__tests__/architect-admission.test.ts`
  fails with or without this branch's changes.
- Live (runs 5–10, 2026-09-30): first habit written and used; the Surveyor proposed a
  rowing boat, tool smithing and ale on its own; smithing became real (iron vein,
  forge, smelt and forge axes, a smith trade); the workshop drew forge, vein, ore,
  ingots and an elderberry shrub live; the town saved and carried into the next session.

## Open

- **Speed after the cognition fixes is unverified live.** Before them, a restored town
  ran at 54% speed (65% of CPU re-parsing working memory every tick); run 10 nearly
  stopped. Re-profile on a quiet machine (`--cpu-prof`).
- **No house has been finished.** Every earlier blocker was a bug and is fixed; the
  carried town now has a foundation and frame under way.
- The rowing boat's model was refused (list methods; now allowed) and the ale waits
  (one design a day).
- Cost: prompt caching for the minds' stable prefix, switching off the engine's
  architect spirits in the settlement (top callers, ~45k tokens a call), and a hard
  per-session token cap are proposed, not built.
- Not seen in a browser by an agent: construction stages, work motions, conditions
  labels and the 800 ms playback buffer were checked by tests and code, not visually.
