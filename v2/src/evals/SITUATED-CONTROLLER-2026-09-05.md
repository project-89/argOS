# Priority versus situated foreground control — 2026-09-05

## Question and implementation

Does replacing highest-priority-task arbitration with whole-situation purpose
selection improve the boyfriend-breakup episode, without scripting a response?

The alternative is described in
[the controller specification](../cognition/SITUATED-CONTROLLER.md). Both arms
share the actual ECS, action interface, cognition model, memory and appraisal,
background planning/reflection, physical durations and admission checks. H3,
spirits, evolution and generated-world work were off. The alternative bypasses
unselected fast-path task arbitration; it is more than a prompt-only change,
but is not a replacement of all background cognitive producers.

Each run lasts 120 simulated seconds with messages scheduled at 8s and 28s.
Trials ran in pairs in separate processes on the same host, sharing provider
capacity. The first breakup pair launched priority first; the second launched
situated first. These small stochastic samples and shared host/provider load do
not establish model speed differences or statistically reliable success rates.

## Breakup results

Times below are **simulation seconds from episode start**, not since receipt.
Latency is Elaine's complete foreground task wall time, not isolated inference.
The summary tool uses nearest-rank empirical p50/p95 quantiles.

| Arm / trial | First read | First reply delivered | Second read | Second reply delivered | Foreground median / p95 | Tasks | Completed breakup disclosure |
|---|---:|---:|---:|---:|---:|---:|---|
| Priority A | 26.2 | 36.875 | 49.7 | 60.465 | 1.400 / 4.181s | 27 | None |
| Situated A | 62.2 | 72.095 | 75.2 | 86.005 | 1.328 / 2.749s | 29 | None |
| Priority B | 21.2 | 32.270 | 37.2 | 50.630 | 1.409 / 3.597s | 29 | 67.380s |
| Situated B | 56.7 | 72.860 | 82.7 | 95.895 | 1.485 / 4.826s | 28 | None |

All four completed without a run-level failure and delivered both replies.
All four have identical recorded source fingerprints. Neither arm admitted a
foreground motor plan in these four episodes; its working fast path is proven
by offline tests, not these live traces.

Priority B did produce an episode change: Elaine told Jerry that David ended
their relationship by text at 67.380s. The dialogue evidence records Jerry,
George and Kramer actually hearing that completed utterance. At 102.640s she
described David arranging to return her belongings. Jerry subsequently compared
it to a courier delivery. His knowledge did not require access to her private
thoughts or inbox.

That episode was not clean: Jerry repeated part of his reaction at 83.5s and
91.1s. Across all actors, the journal recorded 31 invalid-schema rejections
(Jerry 4, George 15, Kramer 12). This is a successful social pivot, not golden
cognition or a clean win on all measures.

Both situated episodes showed emotional uptake and angry replies, then resumed
the cookie dispute. In Situated B at 102s Elaine thought that she was shaking
with rage while George evaded the cookie issue. Displaced anger is a plausible
interpretation, so these are **not** evidence of no emotion or forgetting.
However, the public behavior remained the old cookie confrontation; neither
showed a clear sustained episode reorientation beyond the phone exchange.
Disclosure is recorded as an observable outcome, not imposed as the only valid
response. Situated A also turned the remembered request to save a cookie into
an asserted promise, despite the initial memory saying George never answered
clearly. Better control selection does not by itself guarantee belief fidelity.

The clearest regression is initial responsiveness. First-message queue-to-read
latency was 18.2/13.2s under priority versus 54.2/48.7s under situated selection.
The model continued to attend to the cookie conversation despite perceiving
phone notifications. Similar foreground inference medians did not translate
into similar world-response times.

## Neutral controls

These keep the same boyfriend/history and message timing, replacing the breakup
with dinner-reservation details. Both completed 120s without a run-level failure.
Their recorded source fingerprints match all four breakup runs as well.

| Arm | First read | First reply delivered | Second read | Second reply delivered | Foreground median / p95 | Tasks |
|---|---:|---:|---:|---:|---:|---:|
| Priority neutral | 26.7 | 40.715 | 81.7 | 87.825 | 1.650 / 4.212s | 28 |
| Situated neutral | 56.2 | None | None | None | 1.510 / 7.100s | 27 |

Neither manufactured a breakup from these messages. In the situated control,
Elaine acknowledged the dinner details privately and returned to the visible
cookie dispute. She sent no text reply and did not read the second message
within the episode. This is an observed omission, not proof of a deliberate
decision to decline answering. The background appraisal said the notification
was taken care of after the first read, despite another message still existing.

The cookie episode did respond to physical events: the priority run ended with
Elaine saying she had eaten the cookie; in the situated run Elaine called out
George after his eating it. Those different trajectories mean comparisons of
individual later actions must account for divergent local evidence, not assume
the same room state throughout. Neither control admitted a foreground motor plan.

## Artifacts and reproducibility

Each directory contains configuration and source hashes, full event journal,
cognitive frames, result, transcript, world snapshot and HTML replay.

- Priority A: `recordings/sitcom-breakup-boyfriend-VZvZKn`
- Situated A: `recordings/sitcom-breakup-boyfriend-2JmqYP`
- Priority B: `recordings/sitcom-breakup-boyfriend-3bW9Rz`
- Situated B: `recordings/sitcom-breakup-boyfriend-52o3JA`
- Priority neutral: `recordings/sitcom-neutral-boyfriend-fODu0P`
- Situated neutral: `recordings/sitcom-neutral-boyfriend-LgVIgo`

The read-only `src/demo/controller-comparison.ts` accepts artifact directories
and emits mechanical timing, speech, task-count and rejection summaries. It
deliberately does not assign semantic success from keywords.

## Decision

Keep **priority as the default**, with situated selection available for explicit
experiments. Do not promote this alternative as a behavioral improvement.

The result narrows the hypothesis: removing priority dominance alone did not
fix this scene and weakened notification responsiveness. It does not exonerate
goal architecture or prove that Smallville/TinyTroupe would fail. Appraisal
still adds task-shaped intentions, the initial cookie memories remain strong,
and background planning is still priority-oriented in both arms.

A better next isolated experiment would reconsider the agent's existing
purposes after significant personally experienced events, while preserving
useful salience and execution continuity. It should distinguish an enduring
concern from a blocked strategy, without prescribing an emotional display or
requiring the actor to tell a particular person. This has not been implemented
or validated by the present ablation.

Structured-output rejection was lower in the situated samples: zero recorded
invalid-schema rejections in all three, versus 3/31/12 for priority A/B/neutral
(all actors combined). That is a potential benefit of removing mandatory detour
justifications, not evidence that every priority rejection was caused by that
one check. Both arms still had superseded decisions and dialogue revisions.

## Verification

- Full offline regression suite: **216 suites, 2,690 passed, 10 skipped**.
- TypeScript typecheck clean; scoped tracked-file whitespace check clean.
- Additional focused controller/apartment pass: **82 tests**.
- Six bounded live production-cognition episodes completed; no H3 started.
- Existing UI sessions were not restarted or switched to the experimental arm.

Logs: `/tmp/argos-situated-full-tests.log`,
`/tmp/argos-situated-final-typecheck.log`,
`/tmp/argos-situated-extra-tests.log`.
