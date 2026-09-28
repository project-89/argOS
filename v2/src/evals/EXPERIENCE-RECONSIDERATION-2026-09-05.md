# Experience-driven intention revision — 2026-09-05

## Question

Can a personally experienced event reorganize existing personal purposes instead
of only appending another task? Unlike the earlier situated-controller trial,
this retains the standard priority controller, notification salience, foreground
prompt/admission, background systems, timing and action laws.

The opt-in feature adds up to three guarded reprioritize/release edits to the
existing receipt-appraisal response, plus its existing optional new intention.
It adds no model round trip: both arms use the same 700-token appraisal ceiling,
four-second timeout and cognition model. Assigned goals and world completion
proofs remain protected. See [design and limits](../cognition/EXPERIENCE-RECONSIDERATION.md).

## Protocol

Two matched 120-second breakup pairs and one matched neutral-message pair.
Both arms use `--controller=priority`; only `--reconsideration=on/off` differs.
The two fixed operator messages occur at 8s/28s. Same initial personas, memories,
world, physics and model settings; no injected NPC decisions, H3, spirits or
world evolution. Pairs run in separate processes on one host with shared provider
capacity; launch order is reversed in the second breakup pair. Retain all runs.

Small stochastic trials cannot establish reliable success rates or isolate a
provider speed change. Critically, this feature first acts **after a read**:
differences in initial read time are pre-intervention variation, not evidence
that appraisal edits sped up notification handling.

## Breakup observations

All event times are simulation seconds from episode start. Task latency is
Elaine's complete foreground task wall time; p50/p95 use nearest-rank quantiles.

| Trial | First read / reply | Second read / reply | First completed explicit breakup disclosure | Foreground p50 / p95 | Tasks |
|---|---|---|---|---|---:|
| Off A | 39.7 / 55.445 | 113.2 / none | None | 1.444 / 6.638s | 25 |
| On A | 27.2 / 43.860 | 56.7 / 77.165 | 87.100 | 1.476 / 3.554s | 23 |
| Off B | 38.7 / 58.435 | 63.2 / 75.115 | None | 1.493 / 2.761s | 26 |
| On B | 33.2 / 43.970 | 99.2 / none | 61.680 | 1.487 / 3.625s | 26 |

All four completed at 120s with no run-level failure and identical recorded
source fingerprints. No foreground motor plan was admitted in these runs.
Disclosure is an observed outcome, not a compulsory definition of believable
behavior. Here it was accompanied by sustained pursuit and, in On B, actual peer
conversation. Off A formed a private wish to tell Jerry but completed no public
utterance; Off B's completed public speech stayed on the cookie dispute.

### Actual component changes

- **On A, 32s:** cookie desire priority **7 → 2**. One new priority-9 intention:
  “Process David's sudden breakup message and figure out how I want to handle this.”
- **On A, 59s:** the same intention raised **9 → 10**, not replaced by a duplicate
  demand. Its appraisal calls took 1.572s and 1.515s wall time.
- **On B, 37s:** cookie desire priority **7 → 3**. One new priority-9 intention:
  “Process David's sudden breakup text and decide how to confront him or handle the fallout.”
- **On B, 101.5s:** the same intention raised **9 → 10**. Its appraisal calls took
  1.226s and 1.487s wall time.

The exact IDs, priorities, receipts, goals and private reasons are retained in
cognitive frames and the saved world. These live runs exercised reprioritization;
release and stale-batch rejection are demonstrated by offline regression tests.

### What became behavior

In On A, Elaine sent “Fine. Leave my things with the doorman. Don't bother
calling.” at 77.165s. That is a changed communication strategy, not proof that a
doorman exists in ECS or that any belongings were actually returned. She stayed
on the breakup afterward rather than returning to the cookie. However, she
repeated her disclosure at 108.040s while peers remained slow to respond; this
was not a smoothly flowing group scene.

On B produced a sustained actual exchange:

- **61.680s Elaine:** “Jerry, David just dumped me over a text message. Two years, and he sends a text!”
- **71.300s Jerry:** “A text? Two years and you get a text? What did he write, 'It's over, TTFN'?”
- **80.180s George:** “A text?! You don't dump someone in a text, that's outrageous!”
- **93.380s Elaine:** quotes the actual first message.
- **105.260s Jerry:** “That doesn't even sound like a breakup, Elaine. It sounds like an eviction notice.”
- **115.420s Elaine:** tells them about the second text after actually reading it.

The public sequence above does not imply another actor knew the inbox contents
before hearing Elaine; the hearing records retain the actual delivery boundary.
The second message remained unread until 99.2s, and no second reply was delivered
before the stop. That remains an attention/throughput limitation, not a success.

## Neutral controls and appraisal overhead

Both controls preserved the same boyfriend/history and message timing, replacing
the breakup with dinner-reservation information. Both finished all 120s and read
both messages, but neither delivered a second reply before the stop.

| Trial | First read / reply | Second read / reply | Foreground p50 / p95 | Tasks |
|---|---|---|---|---:|
| Off neutral | 39.2 / 55.800 | 94.2 / none | 1.456 / 6.995s | 27 |
| On neutral | 32.7 / 48.215 | 57.2 / none | 1.384 / 3.328s | 27 |

In the enabled control, both appraisals omitted intention revisions and new
goals. The existing cookie desire remained priority 7: ordinary dinner logistics
did not manufacture a personal crisis. The disabled control added a priority-6
dinner intention, showing that the original appraisal can add goals even for
routine information. These are observations from one neutral pair, not proof
of calibration across all kinds of significant/insignificant experiences.

All six runs have identical recorded source fingerprints and completed handling
both receipt appraisals. Successful enabled breakup appraisals took 1.226–1.572s
wall time. On A had one discarded `goals_changed` attempt before retrying; the
enabled neutral run likewise had one discarded `goals_changed` attempt (3.043s)
before a successful retry. The other four runs had no appraisal failures in the
final counters. Thus the feature adds no new required inference stage, but
existing ownership races can still require another attempt and delay uptake.
No appraisals failed schema/JSON validation in these sampled runs. This does not
mean foreground action generation was free of schema failures or revisions.

## Artifacts

- Off A: `recordings/sitcom-breakup-boyfriend-Zxtqyx`
- On A: `recordings/sitcom-breakup-boyfriend-zibHA1`
- Off B: `recordings/sitcom-breakup-boyfriend-a6Ok0P`
- On B: `recordings/sitcom-breakup-boyfriend-lOwWap`
- Off neutral: `recordings/sitcom-neutral-boyfriend-pX8C4X`
- On neutral: `recordings/sitcom-neutral-boyfriend-ICVGfS`

Each contains configuration/source hashes, full event journal, cognitive frames,
result, transcript, world snapshot and HTML replay. Use
`src/demo/controller-comparison.ts` for read-only mechanical summaries.

## Interpretation and limits

This is a promising mechanism-level result, not golden cognition. We can observe
an actual priority revision and subsequent sustained behavior rather than only
an emotional thought. We cannot separate the contribution of the revised
appraisal instructions from the new edit capability with this two-arm experiment.
An additional prompt-only arm would be needed for that attribution.

Keep the feature opt-in (`experienceReconsideration: true`) while expanding
coverage. Foreground inference remains roughly 1.5s at the median; long scene
delays, rejected/stale speech and unread messages remain. Other characters still
have their original task anchors. Currently only the sitcom's completed phone
read is wired as a production appraisal receipt; generalizing to personally heard
events will need a salience/scheduling design, not an appraisal for every word.

No H3 or live UI session was started/restarted for this work.

## Verification

- **217 suites, 2,724 tests passed, 10 skipped** in the full regression run.
- Focused appraisal/reconsideration/pursuit run: **99 passed**.
- Focused controller/apartment run: **84 passed**.
- Typecheck clean; scoped tracked/new-file whitespace checks clean.
- Six bounded production-cognition trials completed and all artifacts retained.

Logs: `/tmp/argos-reconsider-full-tests.log`,
`/tmp/argos-reconsider-final-typecheck.log`, `/tmp/argos-reconsider-focused.log`,
`/tmp/argos-reconsider-controller-tests.log`.
