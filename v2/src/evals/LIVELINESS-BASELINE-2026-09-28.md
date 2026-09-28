# Liveliness baseline — 2026-09-28

Offline score of existing live recordings, computed before the Alive World pass
(`src/architecture/ALIVE-WORLD-2026-09-28.md`, "Measurement"). No provider calls;
recordings were read only. Full numbers, composite breakdowns and tension
trajectories are in `LIVELINESS-BASELINE-2026-09-28.json`.

```
npm run eval:liveliness -- recordings/town-crisis-live-of3NLe recordings/town-crisis-live-wVJTYc \
  recordings/spatial-CyN3yn recordings/household-check-729eHG recordings/spatial-ezhJW9 \
  recordings/spatial-FvDERL recordings/spatial-J5GmEp --json src/evals/LIVELINESS-BASELINE-2026-09-28.json
```

| metric | crisis of3NLe | crisis wVJTYc | spatial CyN3yn | household 729eHG | spatial ezhJW9 | spatial FvDERL | spatial J5GmEp |
| --- | --: | --: | --: | --: | --: | --: | --: |
| coverage | full | full | window | full | window | window | window |
| residents / run min | 10 / 4.1 | 10 / 4.2 | 10 / 4.7 | 4 / 2.4 | 10 / 3.1 | 10 / 1.9 | 10 / 6.6 |
| **wait/rest share** | **0.51** | **0.51** | **0.79** | 0.42 | 0.71 | 0.68 | 0.57 |
| speech lines (per resident-min) | 42 (1.03) | 45 (1.06) | 14 (1.11) | 22 (2.32) | 19 (0.90) | 11 (0.67) | 7 (0.56) |
| words/line · MATTR50 · echo | 12.9 · 0.89 · 0.07 | 12.0 · 0.87 · 0.04 | 10.6 · 0.84 · 0.01 | 11.2 · 0.87 · 0.03 | 11.6 · 0.81 · 0.09 | 13.0 · 0.82 · 0.06 | 11.0 · 0.82 · 0.01 |
| exchange pairs (distinct) | 32 (9) | 34 (10) | 11 (6) | 16 (5) | 7 (6) | 2 (2) | 5 (2) |
| conflict / disclosure / fear lines | 1 / 2 / 4 | 1 / 0 / 3 | 1 / 0 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| **deflation lines (density)** | **21 (0.24)** | **10 (0.12)** | **4 (0.17)** | 0 | 0 | 0 | 0 |
| goals created / completed (native) | 22 / 5 (0) | 31 / — | — | — | — | — | — |
| narrator reviews · requested · committed | 7 · 1 · 0 | 8 · 0 · 0 | 8 · 1 · 0 | 4 · 1 · 1 | 6 · 2 · 1 | 3 · 0 · 0 | 0 |
| narrator prose produced / shown | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| tension start → end | 0.25 → 0.45 | 0.25 → 0.45 | 0.44 | 0.35 → 0.48 | 0.45 | 0.35 | — |
| world commits non-operator / operator | 0 / 8 | 0 / 8 | 0 / 0 | 1 / 0 | 1 / 1 | 0 / 0 | 0 / 0 |
| builds (proposals) · whispers | 0 (0) · 0 | 0 (1) · 0 | 0 · 0 | 1 (1) · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| **alivenessIndex** | **37.9** | **44.2** | **37.3** | 64.7 | 39.9 | 29.4 | 41.6 |

"window" = spatial `session.json` only keeps the last ~100 feed entries; speech/action
rates use the window span, world/narrator counts use the whole run. "—" = not recorded
in that format (the composite rescales over the components that are available).

## Observations

- **Waiting dominates.** Half of all chosen actions in the full Saltmere crisis runs are
  `wait`/`rest` (0.51 in both), and 0.57–0.79 in the late windows of the spatial town
  sessions: the cast settles into sitting still as the evening goes on.
- **Residents talk the mystery down.** In of3NLe, 21 of 88 speech+thought lines (24%)
  deflate the uncanny, against 4 fear/uncanny lines. Example: *Ivo: "No sense turning an
  old nick into an omen."* Deflation costs of3NLe about 9 index points, the largest single
  penalty in the baseline.
- **Conversation mechanics work, drama does not.** Speech runs at about 1 line per
  resident-minute. Every line is distinct, topic echo is low (≤ 0.09), and 9–10 of the 45
  possible resident pairs trade replies. Conflict and disclosure are near zero: across all
  runs there are 3 conflict lines and 2 disclosure lines in total.
- **The authorities barely act.** Narrator interventions committed: 0, 0, 0, 1, 1. Weaver
  builds: one chair in the household check. Every world commit in the crisis runs came from
  the operator (8 each). No Narrator prose reached the viewer and no daemon whispers exist
  yet. Tension creeps up from 0.25 to about 0.45 and then stays flat.
- **Goals close subjectively.** of3NLe created 22 autonomous goals and completed 5, all
  through `subjective_social_review`, none through a native outcome. The household check scores
  highest (64.7) because it has less waiting, a high speech rate and one Narrator weather
  commit plus a build. That is a different, non-mystery scenario, so its 0 drama/deflation
  is not comparable to the Saltmere runs.

## Caveats

- Drama lexicons are regexes tuned to the Saltmere mystery, and the scorer uses them to
  compare runs, not to judge single lines. Look at the per-lexicon examples in the JSON
  before trusting small differences.
- Only of3NLe has a `chronicle.jsonl`, so it is the only run with addressees, goal
  completion sources and a decision histogram (decision wait/rest share 0.51 matches the
  feed). The other runs infer addressees from names and room co-presence.
