# Prospective intentions and unanswered questions — bounded pass

## Evidence and scope

The preceding `project89-gate-oUbcV2` trial retained its phone goal but never
authored `control.nextPurpose`. At 63.5s Jerry intended to get George's reaction
before replying; later choices became listening, then questioning Morpheus.
There was no rejected foreground decision or lost unread receipt. A narrative
intention is not an execution grant, and a deliberate refusal remains valid.

Audit also found: reflection's `questionsRaised` were validated but not stored;
the demo had no authored identity anchors; the existing ongoing-activity entry
label was already explicitly historical, not a repeated action instruction.
Late appraisal can preserve memory while withholding obsolete present-tense
goal/affect edits. This pass does not weaken that safety boundary.

## Keep / extend / defer

- Keep the existing foreground selector, actor continuation, wait/listening
  readiness, native outcomes, planning and reflection lanes. No new controller,
  model change, automatic reply, inferred commitment from prose or forced goal.
- Extend `nextPurpose` to an actor-selected wait. Native acknowledgement only
  records that waiting began. Existing readiness admits a later reconsideration
  boundary (heard evidence, interruption or deadline), which requests an explicit
  take/cancel decision. It does not establish that an answer arrived or issue a
  follow-up action. Drafts, foreign callbacks and pending outcomes cannot settle
  a wait. Restored continuation data retains no runtime execution authority.
- Extend the existing actor-owned ECS `ReflectionState` with bounded private
  questions. Foreground and planning can consider them; reflection can explicitly
  leave open, answer or park a question using its exact issued evidence. Answers
  remain the character's interpretation. No new goal or world fact is minted.
- Retain question source excerpts with reviews; guard both generation and storage
  against changed evidence, owner/world/source, output tampering, and newer
  questions. Repeated text does not reopen answered/parked questions. Maximum
  twelve records; new questions cannot evict unresolved ones. Save/reload uses
  the existing ECS serializer and built-in field schema.
- Add opt-in `--formative-history` for the Project 89 scenario. It gives Jerry
  and George original fictional memories, revisable self-beliefs and drives via
  the existing character-past schema. Neither knows the hidden card, sender or
  coming visitor from their backstory. Privacy and the legacy baseline remain.
- Defer a general competing-hypothesis model and fresh review of historical-only
  appraisal proposals. Do not add them while assessing these smaller repairs.

## Verification

New native/mocked regressions cover waiting then taking or cancelling, partial
heard speech versus interruption, no readiness from an unexecuted wait/foreign
callback, private question retention/deduplication, explicit sourced reviews,
stale/tampered/foreign results, bounded storage, ECS round-trip, and private
opt-in character histories. These tests do not establish autonomous behavior.

Retained initial failures:

- `/tmp/argos-wait-followup-before.log`: two new wait-follow-up cases fail, with
  the preceding 35 cases passing. Repair plus listening regressions: 63 pass.
- `/tmp/argos-question-first-tests.log`: restore fixture lacked prefab registry
  reset; cross-world test tried to inspect the previous legacy SoA world after
  creating a replacement. Corrected fixture assertions, not engine boundaries.
  Typecheck also caught the omitted built-in field schema; it is now registered.
- `/tmp/argos-prospective-history-tests.log`: history test inspected only the
  package's physical capability context rather than the full cognition context.
  Changed the assertion to `buildAgentContext`; private anchors were present.
- `/tmp/argos-prospective-broad.log`: 625 pass, 5 skipped, 1 failure due to adding
  an empty optional field to legacy reflection responses. Preserve the old
  response shape when the field is absent; do not relax the equality test.

## Bounded live protocol

After offline checks: exactly one three-minute original-history trial, then one
three-minute formative-history comparison. Same two outside messages, same
visitor opportunity, same models and high background reasoning, no H3. No edits
or heavy tests during the trials. Each harness run caps at 180 simulation seconds
and 190 wall seconds after startup. Preserve every artifact and stop after both.

Inspect native reads and sends, explicit next-purpose choices/reviews, retained
questions, God approval and physical visitor travel. The two runs are stochastic
diagnostics, not a causal ablation or repeatability proof. Changed character
history must not retroactively upgrade any baseline failure. Ten-trial baseline
and ten-minute endurance requirements remain outstanding and are not waived.

## Checkpoint / results

Offline: **626 passed, 5 existing skipped, 23 suites passed** in
`/tmp/argos-prospective-broad-final.log`. Typecheck passed in
`/tmp/argos-prospective-types-final.log`; targeted diff whitespace checks passed.
Existing dirty-worktree changes were preserved; no commit or destructive reset.

Neither planned live trial ran. The first escalation was rejected before process
creation because explicit authorization was required to transmit fictional
simulation state/cognition prompts (including NPC private memories, thoughts,
dialogue and messages) to the configured external model provider. Code uses the
Google Generative AI SDK with its default Google endpoint; custom transport
changes only HTTP connection behavior, not the destination. No retry, alternate
transport or indirect execution was attempted. No H3 request was made.

Resume only after approval for that payload to Google's Gemini API. Run the
two commands below sequentially, preserving both results even if the first fails:

```sh
ARGOS_BACKGROUND_THINKING=high npx tsx src/run-project89-gate.ts --live --visitor --trace-cognition
ARGOS_BACKGROUND_THINKING=high npx tsx src/run-project89-gate.ts --live --visitor --trace-cognition --formative-history
```

The history comparison is opt-in and wired through `sitcomLaunchProfile`; no GUI
default was changed. The harness now records the history condition and question
changes in its local diagnostic artifact. No new autonomous behavior, phone
repeatability or combined demo gate is claimed from offline test success.

## Approved resumption — two live trials completed

The user subsequently explicitly approved these two comparisons and disclosure
of fictional NPC state, memories, thoughts and messages to Google's Gemini API.
Both runs completed at 180,000 simulation milliseconds, without interruption or
harness failure. Exactly two trials ran, sequentially; no H3 request, model
change, source edit, or heavy regression run occurred during them. Both report
`gemini-3.8-flash` and high background thinking. The second message remained
conditional on an actual first reply; neither trial reached that condition.

Artifacts (each preserves `result.json`, `world.json`, `runtime.log`):

| Condition | Artifact | Phone outcome | Visitor outcome |
| --- | --- | --- | --- |
| Legacy history | `recordings/project89-gate-NVhsSF` | Delivered 26.2s; unread at 180s; no reply | God-approved; Street 87.5s, Hallway 94s, Living Room 99s |
| Formative history | `recordings/project89-gate-gw2uYs` | Delivered 26.2s; read 47.2s; no reply by 180s | Pending/admissible 45s; inadmissible 77s; expired without approval or creation |

Console logs: `/tmp/argos-prospective-live-legacy-approved.log` and
`/tmp/argos-prospective-live-formative-approved.log`. The earlier approval block
above remains historical evidence, not the current status.

### What the traces establish

**Legacy:** Jerry perceived his own phone's familiar vibration at 26.2s; the
message body was correctly withheld. He stayed in the conversation. At 82.5s
and 84.5s, selected purposes explicitly mentioned listening before checking the
phone, but no `nextPurpose` was recorded. At 94s he chose more speech while
keeping an ear on the phone; the arriving visitor subsequently took focus.
Jerry had one foreground timeout at 92s (George also had one at 14s). Jerry's
provider latency p50/p95 was 1.437s/2.739s. The genuine God approval records
`proposedBy:10`, `approvedBy:6`, `godEid:6`.

**Formative:** Jerry moved toward the phone at 38.5s, picked it up, read it,
returned to the living room, opened the drawer and picked up the card. He showed
it to George, read it aloud, and gave it to him. At 91.5s his purpose included
listening while deciding how to reply; at 120s he was discussing whether to
answer; at 166s he again waited before deciding what to text. No native reply
was sent. Jerry had zero rejected decisions; provider p50/p95 was
1.520s/3.785s. Neither run chose `nextPurpose`, so neither exercised the new
wait-follow-through mechanism live. These are provider latencies, not total
response latency.

The formative visitor's proposal was no longer admissible by 77s. God's saved
review describes an attempted approval refused by the native handler and then
zero pending proposals; this is not an authorization success. Exact invalidation
dependency is not recorded in this artifact. Do not assume a simple timeout or
relax freshness based on this result.

**Reflection:** Jerry completed one reflection in each run, retaining two
historical insights in legacy and one in formative. His reflection provider
durations were 11.684s and 9.529s respectively. The formative insight explicitly
weighs two explanations for the sender knowing the hiding place while asking
what the card says. This is evidence of interpretation, not an absent mind.
However, Jerry's question trace and saved question store are empty in both runs.
Current diagnostics record admitted insights but not pre-admission question
counts or rejection reasons. They cannot distinguish an empty model question
output from questions discarded by freshness checks. Code requires unchanged
local state/dialogue/knowledge/coordination, source validity and question basis
for questions, while sourced historical insights can survive local changes.
That is a concrete candidate admission bottleneck, not yet a proved cause.

### Conclusion and exact next bounded steps

The formative trial made more investigative progress, but one stochastic run
per condition does not prove a history effect. Both phone gates and both
combined phone-plus-visitor gates failed. Visitor success in one trial is not
repeatability. The ten-trial baseline and ten-minute endurance requirements
remain outstanding; offline regressions have not been upgraded to live passes.

1. Add bounded operator-only admission diagnostics for reflection: generated
   versus retained question counts and exact freshness/rejection categories,
   without injecting diagnostics into cognition or changing admission policy.
2. Trace foreground issued context and structured control at the observed
   "before checking/replying" boundaries. Distinguish a conditional possibility
   from a chosen follow-up; verify whether the model was offered the correct
   `nextPurpose` contract. Do not infer execution authority from narrative prose.
3. Trace the formative proposal's exact invalidation dependency and God review
   timing. Reproduce with offline fixtures before another provider trial; keep
   owner/world/source/approval guarantees intact.
4. Only after those diagnoses choose the smallest existing-path repair and
   rerun its regressions. Do not add another controller, force a reply, or claim
   that richer identity alone resolves the failure. Further live runs require a
   new bounded decision; this two-trial authorization is complete.

No source behavior changed during this resumption. The preceding 626-pass,
5-skip offline result still describes that same implementation; it was not
rerun or relabeled as a fresh test result. All failed live evidence is preserved.

## Operator diagnostics pass — completed offline

Scope: instrument the three boundaries above, retaining the existing admission
predicates and short-circuit order. No behavior-policy, model, prompt, controller,
default scenario, world-generation capability or H3 change. No live trial ran.

### What is now recorded

- `src/runtime/control-loop-diagnostics.ts`: explicit per-world opt-in, private
  WeakMap storage, 512-entry ring, 16KB per-entry ceiling, detached snapshots and
  visible dropped counts. An absent ledger does not evaluate diagnostic payloads;
  observer failures cannot throw into control. Nothing enters ECS persistence,
  NPC/spirit prompt context, speech or execution authority.
- Foreground: issued request ID, controller, the exact follow-up instruction
  excerpt already in the prompt, bounded current goals, the precise eligible
  next-purpose goal IDs, and issued continuation/activity. Separately: returned
  structured purpose/action type and next-purpose/review presence, followed by
  integrated/rejected/superseded disposition. No message body, raw inner thought,
  full prompt, arbitrary provider fields or error body is added to this ledger.
  A returned choice is not labeled as an admitted or executed choice.
- Reflection: correlated issued/generated/generation-admission/storage-admission/
  stored records, question/review/insight counts before and after admission, first
  failing short-circuit dependency, and per-insight rejection categories. Parse,
  schema, output-limit, cancellation, provider and storage failures have separate
  dispositions. Cross-world storage attempts cannot copy counts into another
  world's diagnostic ledger. Content of questions and insights is not logged.
- Proposals: native checks remember their first failing binding category and
  cited evidence refs, with acceptance and state-change simulation timestamps.
  Categories distinguish producer/source, narrative opportunity, actor intention,
  materialization/removed identity, room routes, interaction evidence, scope key,
  specification and dependency exceptions. These identify a failing binding, not
  every nested predicate inside it. Existing God queue timing remains available.
  `getObservedProposalDiagnostics` reads only the last observed result; it does
  not call guards, refresh evidence, approve anything or revoke anything.
- `--trace-cognition` on the existing bounded harness enables the ledger and
  saves it in `result.json`; proposal diagnostics join the existing opportunity
  change timeline. Existing mode-0600 artifact handling remains unchanged.

Important implementation review: actor-intention guards can permanently revoke
evidence upon a stale observation. An initial diagnostic-reader draft would have
reevaluated those guards. Replaced that draft before final verification with
passive last-native-check bookkeeping; tests explicitly establish that diagnostic
inspection alone leaves the recorded admission unchanged even after state edits.

### What we learned without another provider run

The previous saved worlds retain ten of Jerry's user/assistant decision pairs
per condition. All ten retained user prompts in **each** world include the actual
`record control.nextPurpose` instruction. All twenty retained assistant decisions
omit that field. In the formative save, the 166s decision explicitly says
"Listen to George finish his thought before deciding what to text back" but
does not select a follow-up. This rules out a missing instruction in those
retained requests; it does not prove that he had already committed to replying,
or explain every earlier request (which has fallen out of the bounded history).

A new offline reproduction delivers actual speech during reflection inference.
Native admission retains a cited historical insight but removes the raised
question with `dialogue_changed`; generated question count is 1 and retained
count is 0. That establishes how this bottleneck can arise under the existing
policy. It cannot retroactively prove why questions were absent in either live
trial, whose pre-admission question output was not recorded.

### Verification and remaining boundary

- Initial adjacent regression check: 216 tests / 5 suites passed.
- Targeted diagnostic check: 73 tests / 4 suites passed; then added the explicit
  speech-during-reflection case and exact eligible-goal assertion.
- Final broad regression: **743 passed, 5 existing skipped, 25 suites passed**,
  `/tmp/argos-admission-diagnostics-broad-loopback.log`.
- Final typecheck: passed, `/tmp/argos-admission-diagnostics-types-final.log`.
- Preserved `/tmp/argos-admission-diagnostics-broad.log`: first broad attempt
  was interrupted, not passed. A separate loopback probe returned `EPERM`; the
  server fixture waits for a listening event. Stopped that exact Jest process
  with approved permissions, then reran with approved local-loopback access.
  External model requests stayed mocked/gated off. No live Gemini/H3 run.
- Targeted diff whitespace checks passed. Existing dirty-worktree work and
  both failed live artifacts remain untouched. No commit/reset performed.

Next decision: one newly authorized bounded diagnostic trial can distinguish
model omission from actual reflection-admission loss and identify the visitor's
failing native binding. Inspect these records before selecting a behavioral
repair. The two failed combined gates, ten-trial baseline and ten-minute
endurance requirements remain outstanding and unchanged.

## September 21 — single instrumented formative trial

User authorized the proposed bounded trial. Artifact:
`recordings/project89-gate-HWJ0Kr` (`result.json`, `world.json`, `runtime.log`).
Console: `/tmp/argos-instrumented-formative-2026-09-21.log`.
Completed at 180,000 simulation ms, no interruption or harness failure. Same
formative history, original outside message/conditional follow-up and visitor
request; configured `gemini-3.8-flash`, high background reasoning. No H3,
code edits during execution, additional trial, or automatic retry.

### Native outcomes and observed causes

- Text delivered 26.2s, read **70.2s**, no outgoing reply by 180s. The conditional
  second message was not injected. Phone and combined gates fail.
- **Follow-through worked once.** At 50s Jerry chose `nextPurpose` for the phone
  goal while finishing a spoken retort. Native speech completion settled it at
  55.620s. At 58s he selected `nextPurposeReview:take` and moved to the kitchen;
  he picked up the phone, read it, returned and opened the couch drawer. This
  is a speech-to-phone success, not proof of the wait extension or reply reliability.
- All 45 issued Jerry requests offered the follow-up instruction; the phone goal
  remained eligible alongside investigation. Of 44 returned decisions, one chose
  a next purpose; 36 integrated and 8 were superseded. One request issued at the
  180s boundary has no returned result in the saved ledger: not a completed action.
  Jerry had zero rejected foreground decisions; provider p50/p95 **1.823s/5.301s**,
  not end-to-end action latency. George had one foreground timeout at 115.5s.
- **Question admission loss confirmed.** Jerry's reflection issued 121.5s,
  returned 135s with 3 insights and **3 questions**. First failing admission check:
  `local_view_changed`. Two historical insights survived; one current insight
  and all three questions were removed. Storage retained two insights and zero
  questions. This distinguishes generated-but-rejected questions from omission.
  The trace does not preserve question wording or the specific changed local-view
  field; do not invent either or retroactively assign this cause to earlier runs.
- George's reflection issued 143.5s, returned 162s with 3 insights/3 questions,
  but failed `invalid_schema` before admission. The exact invalid field is not
  recorded. This separate failure remains unresolved.
- **Visitor succeeded.** Pending 55s, God-approved 66s (`approvedBy:6`, actual
  `godEid:6`, proposer 10), built on Street 67.5s, Hallway 72.5s, Living Room
  77.5s. Admission remained valid throughout the recorded proposal timeline.
  No invalidation occurred to diagnose; the prior expiry is not repaired/proven
  explained by this success.
- After the card/visitor encounter Jerry chose to question Morpheus about entry,
  the card and whether he sent the message. No later reply commitment was chosen.
  His private narratives consider a staged encounter and Morpheus's knowledge of
  the sender's intention. This is attention directed at the visitor, not an unread
  receipt bug or failed execution of a selected reply. Retained questions alone
  are not proven to produce a reply.

317 diagnostic entries saved, **0 dropped**. Prior artifacts unchanged. No
regression suite rerun or source behavior changed; the prior 743-pass offline
result remains historical validation, not new live acceptance.

### Smallest next repair to consider

Separate source-grounded historical question candidates from current-state
claims. Investigate retaining a private timestamped candidate from still-valid
owned evidence, with fresh review before treating it as a current question,
answer, goal or action. Preserve owner/world/source/output integrity; do not
broadly disable freshness or automatically turn questions into tasks. Reproduce
and test that separation offline first. Also identify George's exact invalid
schema field without logging raw private provider output. No new controller or
forced reply: explicit follow-through now has a live success, while post-read
attention remains a behavioral question.

Stopped after one trial. Combined demo, ten-trial baseline and ten-minute
endurance requirements remain outstanding.

### Follow-up repair: historical question candidates

Implemented and offline-verified in
[Historical question candidates](HISTORICAL-QUESTION-CANDIDATES-2026-09-21.md).
Sourced stale questions can persist as historical candidates, hidden from
foreground/planning until a fresh existing-lane review admits them. Source,
owner, output, temporal and action-authority checks remain. 764 tests passed,
5 existing skips, 25 suites; typecheck passed. No subsequent live run or H3.
