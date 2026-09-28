# Intention progress versus conversational expectation

Bounded offline follow-up to the unchanged repeatability trials documented in
[activity momentum](ACTIVITY-MOMENTUM-2026-09-21.md). No live model run, H3,
model change, new controller, mandatory reply or automatic conversation cutoff.

## Counterexample and scope

In `project89-gate-bNbvLE`, Jerry read the text and obtained the card but did
not reply by 180s. A reply decision was available. At 165.5s he received three
previous activity reviews and again chose to hear George's reaction. His
`previousOutcome: met` referred to a conversational expectation, not a verified
advance toward the organizing intention. The existing schema distinguished
past expectations from future ones, but did not separately record intention
progress. A different reaction could therefore keep satisfying the metric
that review explicitly requested.

This is a representational gap, not proof that every choice of company is
incorrect or that the model has no reason to remain in the conversation.
Structured separation does not itself guarantee better judgments.

## Keep / change decisions

- Keep goals, ongoing activity, planner proposals, foreground choice, native
  outcomes, and the three-review encounter history in their existing roles.
- Keep `previousOutcome` and `previousAssessment` as assessments of the last
  local expectation. Do not reinterpret historical `met` values as goal progress.
- Add one separate `intentionAssessment` within the **existing** activity
  review: `{outcome, reason}`. It assesses the currently issued owned intention,
  not a model-supplied goal ID or whichever conversational beat just happened.
  Outcomes are `advanced`, `sustained`, `unchanged`, `blocked`.
- Require that assessment only when the review has a current owned intention;
  independent conversation has none to assess and omits the field. New retry
  feedback identifies a malformed/missing assessment without copying its prose.
- Save the assessment with its engine-supplied `assessedIntention` identity and
  description in the existing bounded history and operator review summary.
  This adds no persistent agenda, new ECS component or competing action queue.

`advanced` means the character interprets the evidence as moving closer to the
intention; `sustained` accommodates company and other desired ongoing experiences;
`unchanged` permits acknowledging no advance while still choosing to socialize;
`blocked` names a missing prerequisite, not an engine-imposed wait. Disposition
remains independently `continue`, `pause` or `close`.

## Safety and implementation

Implementation is confined to `src/cognition/activity-review.ts`. Native action
selection, task timing, goal priority/progress, goal lifecycle, planning and
execution authority are unchanged. No language classifier or scenario-specific
rule forces an assessment or a phone action. The same existing receipt list
grounds both interpretations; schemas cannot prove that a semantic judgment is
correct.

The target is read from the valid ongoing activity, falling back to the current
continuation, and checked against the actor's owned current goals. Its existing
coordination identity and definition/contract/status bind issuance to commit.
A replaced, retired or rewritten goal invalidates the pending interpretation.
Goal progress bookkeeping is not itself a dependency. No identity allocation
or write occurs while capturing this target.

The response may not substitute a goal ID, claim `complete`, or smuggle fields
into the assessment. Prose is one bounded line, at most 400 characters. History
copies the nested assessment and intention identity; issued projections remain
deeply frozen and diagnostic mutations cannot alter stored history. Existing
owner/source/room/time/citation/one-shot checks remain. Historical interpretations
do not become fresh evidence or restored execution rights.

## Offline evidence

New tests demonstrate:

- A conversational expectation can be `met` while intention progress is
  `unchanged`, without completing or retiring the goal.
- Useful new information, desired companionship, intentional socializing
  despite no task advance, and waiting for necessary information all remain
  admissible. No outcome forces a disposition or native action.
- Required/malformed assessments yield the bounded
  `control.activityReview.intentionAssessment` diagnostic.
- Changed goal identity, description, status or contract fences a prepared
  review; independent/foreign-goal contexts cannot invent an assessment target.
- Nested diagnostic-history edits do not mutate the controller's stored record.
- Existing foreground close/release/switch-to-reply integration still works.

Retained initial red log:
`/tmp/argos-intention-progress-before-2026-09-21.log` — 54 failed / 7 passed.
The test helper had been updated to supply the new field before implementation,
so existing valid-review tests also rejected the unsupported field. This is a
test-first contract transition, not 54 pre-existing engine failures.

Focused post-change run: **217 passed, 3 suites**
(`/tmp/argos-intention-progress-after-2026-09-21.log`). After additional ownership
and projection checks, broader run: **1,100 passed, 5 existing skips, 33 suites
passed**, 26.377s (`/tmp/argos-intention-progress-broad-2026-09-21.log`).
Final typecheck passed (`/tmp/argos-intention-progress-types-final-2026-09-21.log`),
as did the scoped diff whitespace check.
Only the central activity-review test helper and two existing mocked controller
review responses were updated for the new response contract; safety assertions
were retained. No historical artifacts or unrelated worktree changes removed.

## Limits and next gate

These tests exercise mocked interpretations, native review admission and
existing execution integration. They do **not** show that a real model now
recognizes unproductive banter, chooses action, or satisfies the new required
field reliably. A model can still misjudge `advanced` or prefer conversation.
The new field may also introduce schema failures; measure those rather than
weakening authority or hiding rejected evidence.

Next, if separately authorized: one unchanged 180s delayed-visitor/formative
trial, same models and two-message protocol. Check exact reply deliveries and
review outcomes against the organizing intention, including any missing-field
rejections. A more sophisticated explanation without actual follow-through is
not a pass. Preserve `bNbvLE` as the failed comparison; no automatic retry.

The prior result remains two successful phone exchanges in three unchanged
post-momentum trials, with one underspecified cereal-color question. Combined
visitor demo, ten-trial baseline and ten-minute endurance gates remain open.
No world-generation, candidate scheduling or H3 changes in this pass.

## Authorized bounded live trial — failed phone follow-through

Subsequently authorized and completed exactly one unchanged 180s trial:
`recordings/project89-gate-3fTOCb` (exit 0). Console retained at
`/tmp/argos-intention-progress-live-2026-09-21.log`; `result.json`, `world.json`
and `runtime.log` are retained with mode 0600. Same Gemini 3.8 Flash models,
high background reasoning, formative history, visitor opportunity at 120s,
and conditional two-message protocol. No H3, extra nudge or retry.

The initial message was sent at 26s, delivered at 26.2s and read at **49.7s**.
Jerry acquired the card (native pickup outcome at 59.3s), but **sent no reply
by 180s**. The conditional second message was therefore never sent. This is
not a pass: valid new assessments did not produce the desired follow-through.

### What the review actually assessed

The issued intention was the owned goal to find a concrete explanation for
strange events, seek information from whoever could know, and weigh answers
against evidence. Its text explicitly says George is not the only person worth
asking. It was not a specific accepted commitment to reply.

- At source 80s, Jerry assessed `advanced`: finding the predicted physical card
  was genuine new evidence. He chose to hear George's reaction.
- At 113.5s, he assessed `sustained`: sharing details supposedly kept the inquiry
  moving, although his previous assessment already said George did not know
  what Project 89 was.
- At source 145.5s (saved response at 147.5s), he again assessed `sustained`:
  George's suspicions supposedly mapped possibilities, while admitting his take
  was "typically ungrounded." He continued to await elaboration.
- The saved 179.5s response again chose `continue` and `sustained`, describing
  George's immediate theories as "purely paranoid" while expecting another
  reaction to establish whether he had a specific scenario in mind.

Thus local expectations remained `met`, and the new intention assessment
recast further speculation as maintenance of a broad investigative purpose.
The schema distinguished the concepts but the model did not use that distinction
to reconsider its behavior. This is evidence of evaluative permissiveness,
not missing review history or proof that every discussion should be cut short.

A background decision to decide whether/how to reply was created at 74.5s.
It appeared in all ten retained final foreground input prompts and still had
an empty review at save. Reflection also stored two question candidates at
136.5s, including what would happen if he texted back. They remained candidates;
background relevance did not become a foreground choice in this trial.

### Safety, performance and other gates

296 diagnostic entries, zero dropped. No rejected Jerry decision and no
`intentionAssessment` schema rejection. Preserve George's 10.5s invalid-schema
`affectUpdate`; successful schema use here is not general reliability proof.
Foreground latency p50/p95: Jerry 1.378s/2.432s, George 1.647s/2.612s.
Both actors authored thoughts and spoke; owner heard/read phone and no phone
knowledge leak was observed. The outside-reply gate failed. Cookie/tin gates
are not applicable achievements for this card scenario and remained false.

The visitor request was reviewed at 140.5s; no Morpheus arrival or construction
was recorded by the cap, and God review failures were zero. The opportunity
assessment also suggested allowing the pair to debate whether to reply. This
is another possible reinforcing input, not an isolated causal finding. Do not
equate that narrative assessment with completed entity creation or proof that
an intervention was delivered to either actor.

### Next bounded investigation, not yet implemented

Inspect the existing review and planner-decision handoff together: why can an
available concrete decision remain unreviewed while a broad inquiry is repeatedly
classified as `sustained`? Compare the issued instructions and evidence against
the successful trials. Distinguish maintaining a desired ongoing experience
from making or deferring an information-seeking decision, preserving legitimate
company, uncertainty and necessary waiting. Do not introduce a mandatory reply,
arbitrary banter cutoff, another controller or a scenario-specific priority.

The prior unchanged history-only variant remains two phone successes in three
trials; this changed assessment variant is **zero of one**, not a fourth sample
of the same configuration. No reliability claim or acceptance-gate promotion.
Combined visitor demo, ten-trial baseline and ten-minute endurance remain open.

## Subsequent bounded audit

[Decision-handoff audit](DECISION-HANDOFF-AUDIT-2026-09-21.md) compares the saved
successes and failures with the actual foreground protocol. Empty proposal-review
metadata is not proof that the actor never considered replying: reviews are
optional, and independent native replies are allowed. The audit identifies a
blanket cross-goal omission instruction that is broader than the validator and
an overly permissive interpretation of `sustained`. It proposes two bounded
wording corrections, not a new mechanism. Existing focused regressions rerun:
134 passed across three suites. No engine changes or live retry in that audit.
