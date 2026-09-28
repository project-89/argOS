# Narrative mind — implementation and live observations

## What changed

An opt-in actor-owned emotional/narrative layer, separate from executable goals.
Appraisal can keep mixed feelings, conflicting desires and revised personal
meaning without creating a task to “process” the experience. Admitted foreground
reasoning, experience monologues, recollections and learning have a separate ECS
archive with source excerpts and ownership. Ordinary 50-memory / 10-thought
pruning does not delete that archive. Reflection and action selection recall a
bounded selection of it. Full world saves restore it across entity remapping.

Activation relaxes using simulation time, without mechanically resolving a
relationship, changing a visible expression or completing a goal. Tick recovery
does not invalidate in-flight cognition; semantic episode changes do.

Existing interaction-memory extraction now authors narrative recollections or
learning, validates the whole result before writes, retains zero-valued fields,
and cancels at stop/runtime replacement with an eight-second deadline. Source
identity, character identity, mode and owner must still match on return.

See [design and API](../cognition/NARRATIVE-MIND.md).

## Trials

All were real production cognition with no H3, no director intervention, and no
forced reads, reactions, goals or speech. Each ran 120 simulated seconds with
fixed messages at 8 and 28 seconds. The neutral condition preserves the same
boyfriend relationship but sends dinner logistics. Each artifact directory
contains configuration/model IDs, source hashes, transcript, private cognitive
frames and a saved world. Times below are absolute simulation seconds.

| Trial | First read / reply delivered | Second read / reply delivered |
| --- | --- | --- |
| Initial coupled selector, breakup (`H54PYY`) | 93.2 / 104.055 | 112.7 / none |
| Initial coupled selector, neutral (`G5bTP3`) | 24.7 / none | unread / none |
| Decoupled, existing priority controller, breakup (`5k7Mug`) | 24.7 / 45.685 | 48.2 / 57.445 |
| Decoupled, existing priority controller, neutral (`QctCKI`) | 33.7 / none | 40.7 / none |
| With interaction archive/lifetime guards, breakup (`6xnMtW`) | 18.7 / 37.815 | 41.7 / 55.090 |

Directories are under `recordings/sitcom-breakup-boyfriend-<suffix>` or
`recordings/sitcom-neutral-boyfriend-<suffix>`. The initial implementation coupled
`narrativeMind` to situated action selection even with a priority configuration
label; those source hashes preserve that rejected implementation. Narration no
longer changes the controller. These are single stochastic trials at each
configuration, not a controlled statistical estimate of improvement.

The last live trial preceded two final contract refinements: explicit speaker /
own-speech provenance in extraction and a journal sequence independent of recycled
EIDs. Those are covered by the subsequent focused tests, not another live episode.

## Actual behavior and inner life

In `5k7Mug`, Elaine disclosed the breakup to the room at 35.8 seconds:
“It's David. He just dumped me. By text message!” Both messages were read and
answered. Her two appraisals revised one emotional thread rather than creating
separate device/channel concerns. The saved desires included wanting to confront
David and refusing to give him an audience. Her initial appraisal included:

> I don't know whether to scream at him or pretend I don't care, but a stupid bakery cookie suddenly doesn't matter at all.

In `6xnMtW`, both messages were again read and answered. The second appraisal
contained:

> Part of me wants to scream into the phone until he breaks, and another part doesn't even want to give him the satisfaction of knowing he rattled me.

The saved archive held 4 recollections and 2 experience monologues for Elaine,
plus 21 foreground thoughts. Kramer held 6 learning entries, 6 recollections,
2 experience monologues and 22 foreground thoughts. His attributed recollections
and reflections are character interpretations, not verified knowledge: a belief
such as “a refined palate can always be trusted” is clearly not a world law.

Elaine's foreground task wall latency was median 1.469s / p95 2.963s in `5k7Mug`,
and median 1.683s / p95 5.923s in `6xnMtW`. Those include controller-task effects;
they are not pure provider latency or end-to-end phone response time.

## Failures retained, not explained away

- The initial looser selector let the cookie argument dominate for over a minute.
  That coupling was removed rather than shipping richer prose with worse attention.
- Even with the existing controller, Elaine later returned to the cookie dispute.
  The breakup thread was still stored and sometimes recalled, but that did not
  reliably produce sustained episode-level reorientation. Storage is not the
  same as behavioral prioritization.
- Neutral messages were read but not answered in the decoupled control. No reply
  alone does not prove she deliberately chose not to reply.
- Live extraction occasionally confused her own speech with “someone” speaking.
  The engine now passes explicit own-speech provenance and speaker identity.
- “Learning” can be a biased interpretation or an overgeneralization. A grounded
  source record is necessary but does not certify the prose as true, useful or
  natural. The typed data layer is stronger than the behavioral guarantee.

No golden-cognition claim, H3 run, UI restart or main-branch commit was made.
The feature remains opt-in through `narrativeMind: true`; the text trial also
uses `experienceReconsideration: true`.

## Verification

- Full suite after interaction archival/lifetime changes: **219 suites, 2,782
  passing tests, 10 skipped** (`/tmp/argos-narrative-verified-tests.log`).
- After the final ordering/provenance refinements: **106 focused tests passing**
  (`/tmp/argos-narrative-final-contracts.log`).
- Typecheck clean (`/tmp/argos-narrative-typecheck.log`).
- New narrative tests cover owner/source replacement, stop/restart, malformed
  extraction atomicity, source immutability, private retrieval, mixed desires,
  no appraisal-generated task, cross-channel continuity, simulation-time
  recovery, stale semantic admission, memory pruning, chronology/pagination,
  save/remapping and sourced recollection/learning.
