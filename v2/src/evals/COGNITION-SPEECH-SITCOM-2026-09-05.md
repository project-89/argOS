# Speech mechanics and the apartment sitcom trial

Date: 2026-09-05. H3, external SMS, God autopilot, spirits, coding daemons and
world evolution were disabled. This pass isolates NPC cognition and physical
interaction before adding rendering or prompt-to-world generation.

## Result: the live trial failed, and exposed a package integration defect

One live run was attempted, bounded to 120 wall seconds after startup. It reached
119.5 simulation seconds (239 ticks). Preserve its artifacts as failed evidence:

- [Measured result](../../recordings/sitcom-trCYEu/result.json)
- [Operator replay](../../recordings/sitcom-trCYEu/replay.html)
- [Private/operator events](../../recordings/sitcom-trCYEu/events.jsonl)
- [Actual public word/action tape](../../recordings/sitcom-trCYEu/public-events.jsonl)
- [Runtime log](../../recordings/sitcom-trCYEu/runtime.log)

The source/test snapshot used by that run contained 646 TypeScript files and
had SHA-256 `d76260a53755bd94d42904bb8c6b86d92784c8a384e30999dbff0a720fc4369b`.
Post-trial fixes must not be credited as live-verified by this recording.

Configured foreground/background model: `gemini-3.8-flash`.

| Character | Decision wall p50 / p95 | Fresh foreground thoughts | Completed speech |
| --- | --- | --- | --- |
| Jerry | 960 / 2447 ms | 0 | 2 |
| George | 1160 / 2606 ms | 0 | 0 |
| Elaine | 1010 / 2343 ms | 0 | 0 |
| Kramer | 1024 / 2588 ms | 0 | 0 |

These timings measure completed foreground attempts, including deterministic
selections; they are not successful-decision latency or model-only percentiles.
The loop averaged 2.34 ms of tick work and reported zero slow ticks. Fast
inference did not produce a functioning episode.

Jerry spoke a 22-word deflection over 2.50–12.20s and a distinct 13-word coffee
offer over 14.50–20.24s. Both were stored deterministic plan steps, not newly
admitted model decisions. The words reached the other characters' dialogue
ledgers, but nobody answered. Two distinct turns with no overlap do not establish
natural conversation or demonstrate that semantic repetition is solved.

The operator text entered at 25.00s. Elaine's phone delivered it and emitted its
recognizable vibration at 25.20s, then every six seconds while unread (16
notifications). Elaine perceived the notification but never picked up or read
the phone. There was no reply, opened tin, acquired cookie or fresh thought.
An empty pre-read-leak list in this stalled run is not a successful phone test.

## Defect and correction

The new apartment package used its in-flight request map as the validity guard
for a staged decision. `runCognitionCycle` calls the package's `finish()` when
inference returns, before `executeActions` consumes the model proposal. `finish()`
deleted the map entry, so the retained `isCurrent()` closure immediately reported
false at dispatch. Every staged action and thought was cancelled. Deterministic
plan actions bypassed that model envelope, explaining Jerry's two speeches.

This is confirmed by code and an offline production-path regression, not a
reconstructed live rejection histogram: the first runner did not persist the
chronicle's per-request rejection records. Request cleanup must be separate from
durable decision generation. A newer decision, cancellation or package shutdown
still revokes an old proposal; merely finishing inference does not.

The post-trial patch separates those lifetimes, documents the library hook
contract, and tests `runCognitionCycle → executeActions` with a mocked model.
Direct-action fixture tests alone cannot exercise this failure. Subsequent
operator diagnostics correlate exact world-owned request IDs and actor identity,
not names shared by characters in unrelated worlds. Diagnostics do not enter
NPC perception or the public rendering stream.

No second paid simulation was run in this pass. A corrected live trial is still
needed before claiming that the cast naturally talks, investigates and responds.

A subsequent boundary review also caught a speech-start observer race: an
observer could stop/restart the world or settle the utterance synchronously,
after which the executor would still write stale pending activity. The patch
rechecks source, actor, package and exact voice before pending bookkeeping.
Seven new regressions cover stop, restart, actor removal/replacement, package
replacement, interruption and immediate completion. This is an offline-verified
post-trial correction too.

## Speech changes implemented before the trial

- Normal audible speech takes a local conversational turn; denied speech is
  deferred, not queued as a stale future script or recorded as a failed action.
  A 250 ms handoff and 1750 ms same-speaker gap leave response space. Explicit
  urgent interruption remains possible; this is not a global no-overlap rule.
- Body and voice remain separate resources. New meaningful perception can wake
  cognition while both are occupied without freeing the physical reservations.
- A model can deliberately stop its own speech. The command is bound to the
  exact utterance observed at request time; it cannot stop a replacement voice.
  Only emitted words survive an interruption, with no full-turn success credit.
- Coherent heard excerpts can invalidate a stale social decision. An otherwise
  grounded independent physical action may continue without its stale thought.
  Historical partial speech carries its original room and lived age.
- Pending speech callbacks expose no unspoken script; interrupted callbacks
  expose only the emitted prefix. Completion evidence precedes terminal public
  observers, and stop/reload callbacks cannot start replacement work.
- The foreground prompt requests one short conversational beat. There is no
  scenario-specific dialogue script or automatic chopping of spoken sentences.

## The next demo is built, not yet live-validated

[The Last Cookie](../demo/APARTMENT-SITCOM.md) has four distinct private histories,
goals, appearances and personalities; two rooms; an opaque tin and real cookie;
and Elaine's physical phone with delivery, repeat vibration, possession, reading
and typing intervals. Its fourth-wall text is an explicitly labeled operator
intervention, not a narrator manufacturing an NPC decision.

The standalone replay has one latest authored foreground thought per character,
actual emitted words, a phone conversation and simple ECS facts on one source
playhead. Background interpretations and planted thoughts do not masquerade as
a newly authored foreground thought. These private operator artifacts are not
other NPCs' knowledge and should not be published automatically.

## Remaining quality risks

- One background episodic summary in the failed run says guests were “arguing
  over baked goods,” although the trace contains no guest speech. This is an
  inferred dispute being embellished as observed behavior. Source freshness
  guards do not prove semantic entailment of model-authored memories.
- The existing five-second identical-failure cooldown does not clear solely
  because an occluding lid subsequently opens. That can delay an otherwise
  sensible retry; it remains a separate pacing issue.
- The corrected cast still needs a live uptake/naturalness test, including a
  read-before-reply chain and visible changes of mind. Offline scripted model
  responses establish mechanical contracts, not autonomous behavior quality.
- Prompt-to-world generation is next only after these NPC/package contracts
  hold in a successful live episode. This authored testbed does not validate
  continuous generated-system maintenance, God/spirit growth or H3 fidelity.

## Verification

Before the live run: 197 suites passed, 2312 tests passed, and 10 existing opt-in
tests skipped; TypeScript checked cleanly. Final post-trial full verification:
**198 suites passed, 2327 tests passed, 10 existing opt-in tests skipped**, in
109.093 seconds. `npm run typecheck` and `git diff --check` also pass. No H3
credits were spent.

Post-trial focused checks: 20 apartment physics/cognition tests, 38 speech
floor/lifecycle tests, and 80 foreground-admission tests passed. The mocked
production phone path admits four actual authored-thought records and completes
the real move/pickup/read/type/delivery chain with all network access forbidden.

The final source/test snapshot contains 647 TypeScript files. Hash recipe:
SHA-256 over lexically sorted `src/**/*.ts` relative paths, each followed by NUL,
its file bytes, and NUL. Hash:
`9861f727b779068c900636eb63b91b5b4e47484ad34365638142e67f7095cd49`.
