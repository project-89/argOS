# Unread attention and heard appraisal — 2026-09-05

## Scope

Production Argos cognition, priority controller, `experienceReconsideration: true`,
configured `gemini-3.8-flash`, fixed boyfriend texts at 8s and 28s, 120 simulation
seconds. No H3, no forced reaction/action/goal, no spirit intervention. Neutral
controls use dinner information from the same boyfriend. Times below are actual
completed receipts/actions, not proposed thoughts. See each directory's
`configuration.json` for exact source fingerprints and settings.

## Confirmed engine causes

1. Historical goal cleanup cancelled valid work. In the earlier retained
   `sitcom-breakup-boyfriend-lOwWap`, Elaine's queued reply was revised at 75.5s
   with `goal_changed`. The frame diff shows expired schedule goals disappearing,
   not a changed active purpose. Regression tests now isolate this case both at
   foreground execution and during private appraisal.
2. A successful read cleared notification priority even with more unread
   messages. The reader now observes the remaining count, preserving salience
   without exposing the next sender/body.
3. Every reminder buzz generated a new attention identity and could invalidate
   pending work. Stable actor-local signal identities retain the physical pulses
   without restarting attention for the same notification.
4. Personally heard disclosures lacked access to receipt-driven intention
   reconsideration. Foreground now optionally selects exact heard turn IDs for
   that lane, using the existing foreground call rather than a screening model.
5. The diagnostic run revealed repetitive `control.switchReason` rejections:
   Jerry at 74.5, 76, 78, 81 and 84s, plus three elsewhere. The guard treated an
   independent response like a transfer to a lower-priority goal. Independent
   responses now require a valid stated purpose, but not an additional switch
   rationale; explicit lower-ranked goal switches still require one.

## Retained runs during iteration

| Label / artifact directory | First read / first-message reply | Second read / second-message reply | Completed disclosure |
|---|---|---|---|
| `unread-heard-breakup-a` / `sitcom-breakup-boyfriend-USAOJd` | 23.2 / 37.445 | 43.2 / 58.435 | 84.660 |
| `unread-heard-neutral-a` / `sitcom-neutral-boyfriend-rV0rT7` | 23.7 / none | 33.7 / none | n/a |
| `unread-heard-diagnostic-b` / `sitcom-breakup-boyfriend-6yfmQo` | 26.7 / none | 62.7 / 77.490 | 58.960 |
| `unread-final-breakup` / `sitcom-breakup-boyfriend-3Um9kb` | 25.2 / 59.355 | **not read** / none | 52.860 |
| `unread-final-neutral` / `sitcom-neutral-boyfriend-SP5Uzn` | 28.2 / 52.170 | 55.7 / none | n/a |
| `unread-indicator-breakup` / `sitcom-breakup-boyfriend-JSNmtd` | 24.7 / 62.175 | 76.2 / 84.015 | 53.660 |

All six finished 120s with `failed: null`. These are iterations, not six matched
samples of identical code. The first pair overlapped local test execution and
shared provider/host load; do not interpret its latency differences causally.
The diagnostic run added field-level rejection instrumentation. The final pair
also includes the independent-response and empty-selection fixes. It ran without
the full test suite concurrently. Paired processes still share the host/provider.

## What changed behavior, and what did not

In run A, Elaine lowered her cookie goal to 3 after the first read, then retired
it after the second read and raised her existing breakup concern to 10. Jerry
actually heard her disclosure at 84.660s, appraised that receipt at 90s, retired
his cookie-related desire, and completed a related response at 95.240s. George
also responded publicly at 110.560s. This exercises hearing → private appraisal
→ changed intention → subsequent behavior, without private inbox leakage.

The diagnostic run also contains public responses from all three peers. It
exposes a separate canonical-character-memory error: Jerry and others sometimes
call David “Puddy,” though that surname was not in the configured contact.

The final breakup pair is an important negative result, not a success to hide:
Elaine reads and answers the first message and shares the breakup, but leaves
the second unread through 120s. Her breakup goal remains priority 9 and the
notification goal remains 8. She repeatedly frames her purpose as venting and
then confronting George's hypocrisy. At 94.5s a heard appraisal retires her old
cookie goal, but a new confrontation goal appears at priority 6. Merely retaining
the higher-priority concern does not enforce useful progress toward it.

That final breakup has two schema rejections (`goalReview`, `affectUpdate`),
versus nine in the diagnostic run (eight switch-reason checks and one control
error). The final neutral has none. No missing-switch-reason rejection appears
in the final pair. These are small stochastic samples, not an effect-size claim.
The neutral control reads both messages, sends a normal dinner acknowledgment,
and continues the cookie dispute; it is not forced into a crisis or forced to
answer every message.

Elaine's foreground task wall-time p50/p95 in that final pair is 1.591/2.757s
(breakup, 24 tasks) and 1.276/3.349s (neutral, 27 tasks). These measure individual
foreground requests, not complete cognitive-to-action latency. There are still
many speech waiting/revision events, including 13 `local_view_changed` revisions
in each final run. Do not call the overall simulation golden from model latency.

## Follow-up observability correction

After reviewing the final negative result, the apartment context was corrected
to expose the **current unread indicator** while a sighted actor holds the powered
phone. Previously, the main context listed previously read messages and available
verbs but did not explicitly distinguish them from the current unread backlog.
This is observable device state, not an instruction to check it. A focused
regression covers the count, unseen body, remote observer and powered-off cases.

The remaining behavioral question is how a broad concern recruits and resumes
useful next steps instead of repeated conversational reactions. This change set
does not add a prospective “after this exchange, do X” commitment or force a
notification policy. Further evals should measure postponed intentions resumed,
completed contributions, and evidence gathering—not just more thoughts or calls.

The indicator follow-up ran on the current code, alone without the full test
suite or another trial concurrently. All recorded source fingerprints were
checked against current files after the run and matched. Elaine read and replied
to both messages, and disclosed the second text to the room at 103.060s. Jerry,
George and Kramer completed related responses. Her foreground task p50/p95 was
1.478/2.957s (25 tasks). The second message still waited **48 seconds after
delivery** before being read. This is a working causal chain, not robust low
latency behavior or proof that the indicator alone caused the improvement.

## Verification

- Full suite: 218 suites passed; 2,753 tests passed, 10 skipped.
- Typecheck passed; whitespace check clean.
- The final indicator/context edit was additionally checked with both apartment
  physics and production-cognition integration suites: 42 tests passed.
- New offline tests cover historical cleanup, newly activated goals, independent
  response versus lower-ranked goal switches, recurring and novel signals,
  unread backlog privacy, selected heard speech, partial/remote/own exclusions,
  malformed IDs, full-batch queue capacity, source/actor/option changes, and
  actual appraisal input/goal creation from heard evidence.
- All live trials kept H3 off. No UI server restart or repository commit.
