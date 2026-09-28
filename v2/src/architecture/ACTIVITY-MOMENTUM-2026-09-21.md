# Activity momentum: bounded offline pass

Follow-up to [the handoff audit](HANDOFF-AND-REPLY-AUDIT-2026-09-21.md).
User approved testing whether ongoing intentions can keep momentum while
conversation remains a voluntary activity. No live model run, H3, model change,
new controller, priority timer or automatic reply in this pass.

## Diagnosis and smallest change

The previous Jerry trace showed a reply decision present in the last ten saved
prompts, never selected/deferred/declined. He repeatedly chose to hear George's
reaction before replying. Existing activity review carried the immediately
previous expectation, but overwrote the earlier sequence of explanations for
continuing. Cumulative encounter time was already present; it was not reset by
each review. This pass does not claim that missing history alone caused the
behavior.

Keep goals, ongoing activity, foreground choice, background plans and native
outcomes in their existing roles. Keep explicit take/cancel for chosen future
purposes. Make two bounded changes:

1. Retain the last **three** committed reviews in the existing private encounter
   state. Expose their actor-authored expectations, assessments, reasons,
   dispositions and simulation timestamps to the next review. Preparation or
   reading does not add history; successful one-shot commit does.
2. Revise the existing shared activity guidance and review instructions:
   carry a chosen intention through its next useful step; when waiting, consider
   which information is actually necessary and whether this person can supply
   it. An opinion or agreement need not be a prerequisite. Deliberate company,
   listening and venting are valid preferences, not obligations to demonstrate
   task progress. Compare earlier expectations against completed receipts.

`activity-situation.ts` supplies the same guidance to foreground cognition and
background experience appraisal. `activity-review.ts` owns the short history
and its prompt projection. No new response fields or admission requirements
were introduced. No classifier decides whether a conversation is useful, and
no count/elapsed-time limit forces a character to stop talking. This does not
add simultaneous speech and motor actions; native execution remains unchanged.

## Authority, privacy and lifecycle

- Historical reviews are the actor's interpretations, not new facts or current
  citation authority. The current review still requires issued completed
  receipts and an own contribution. Earlier receipt IDs outside the current
  window remain inadmissible.
- Existing freshness, owner, source, persona, room and simulation-time fences
  continue to govern commit. No history crosses a replacement encounter.
- The history is bounded runtime encounter state, like its existing cursor;
  it is not a new ECS component or persistent memory mechanism. Save/reload
  cannot restore review execution rights from it. Goals, durable dialogue and
  world outcomes retain their existing ECS ownership.
- Issued history is deeply frozen. Diagnostic snapshots copy nested ID arrays;
  external mutation cannot alter the encounter's stored reviews.
- History does not affect readiness timing, action availability, resource
  arbitration, emotion, goal completion or planner authority.

## Verification and limits

New regressions cover the rolling three-review bound, commit-only insertion,
retained assessed expectations, immutable projections, rejection of historical
citations as current evidence, owner/source/persona/time isolation, snapshot
mutation, and absence of the runtime review reason from world serialization.
Repeated socializing and waiting for information remain valid actor choices.
Existing unilateral pause/close tests continue to pass without agreement from
the other actor or completion of the unresolved concern.

Preserved initial red run: **5 failed, 39 passed**, before implementation:
`/tmp/argos-activity-momentum-before-2026-09-21.log`. The new history assertions
failed because no history was exposed. Focused implementation check: 44 passed
(`/tmp/argos-activity-momentum-after-2026-09-21.log`); one additional snapshot/
serialization case was then included in the broader run.

Final broader set: **977 passed, 5 existing skips, 31 suites passed**, 25.6s
(`/tmp/argos-activity-momentum-broad-2026-09-21.log`). Separate experience-appraisal
and intention-inactivity suites: **105 passed, 2 suites**, 1.182s
(`/tmp/argos-activity-momentum-appraisal-2026-09-21.log`). These sets are disjoint:
**1,082 passing tests across 33 suites**, with five existing skips.
Final typecheck passed (`/tmp/argos-activity-momentum-types-final-2026-09-21.log`)
and scoped diff whitespace check passed.

These are offline mechanism/prompt/safety tests, not proof that a model now
chooses to act more often. A model may still choose conversation, and its
appraisal of necessity may still be poor. Historical review visibility and
revised guidance must be measured in an autonomous trial before claiming a
behavioral improvement.

## Next bounded check

If separately authorized, repeat one 180s run under the same delayed-visitor,
formative-history, high-background configuration as `project89-gate-9Av1yr`,
with the same first message and conditional second message. No manual nudges
or forced replies. Inspect whether the recent-review sequence reaches the
foreground, whether a genuine dependency or voluntary preference is articulated,
and whether Jerry selects and executes a reply after inspecting the card.
Record read/reply times, activity choices, admission failures and non-replies.
Do not infer success from an intention or an improved-sounding explanation.

Full two-round phone/visitor acceptance remains unpassed. Ten-trial baseline
and ten-minute endurance requirements are unchanged. Candidate-review scheduling,
world-generation changes and H3 remain outside this pass.

## Authorized live comparison — `project89-gate-iCfwlG`

Completed at 180s, exit 0, no harness failure or interruption. Same formative
history, Gemini 3.8 Flash configuration, high background reasoning, first text
at 26s, conditional follow-up and visitor opportunity request at 120s as
`project89-gate-9Av1yr`. One run only, no edits during execution, manual nudges,
automatic retry or H3. Saved `result.json`, `world.json`, `runtime.log` in
`recordings/project89-gate-iCfwlG`, each mode 0600. Console log:
`/tmp/argos-activity-momentum-live-2026-09-21.log`.

### Two native phone exchanges succeeded in this trial

- 31s: Jerry personally closed the earlier encounter, citing his completed
  contribution: "The banter with George about his four-alarm life is complete
  for now, and my phone just vibrated in the kitchen." No agreement from George
  was required. This is an actual saved personal social closure, not merely
  a proposed purpose.
- Reached Kitchen 34s, picked up phone 36.3s, read first message **38.7s**.
  Returned to Living Room 43.5s, opened the drawer 45.3s, picked up the now
  visible Project 89 card 47.8s. This run used visible card information; do not
  invent a separate observe/inspection action that did not occur.
- First reply began 49.5s, native typing completed 52.815s, delivered
  **53.015s**: "It says: PROJECT 89 — WHO IS WATCHING? Who is this?"
- Conditional follow-up sent 53.5s, delivered 53.7s, read **57.7s**.
- At 59.5s an actor-generated intention appeared: "Reply to the anonymous
  sender with a specific question to test their claim of being outside my
  world." Priority 7. The harness did not author this intention or its reply.
- After a brief conversational response, Jerry's completed speech at 70.760s
  was: "Someone's texting me about things hidden in my couch, George. Give me
  a second." He then began native typing at 72.5s, completed 77.635s, and his
  second reply delivered **77.835s**: "If you're outside my world, tell me:
  what is George Costanza holding right now?"
- Actual outgoing messages link to the correct incoming IDs (195 -> 133,
  158 -> 70). Repeated foreground proposals during typing did not produce
  duplicate delivered messages. The harness deliberately sends no third text;
  later waiting for an outside answer is not an unanswered incoming message.

First delivery-to-read latency: 12.5s; read-to-outgoing-delivery: 14.315s.
Second: 4s and 20.135s respectively. Previous delayed-visitor trial read at
62.7s and delivered neither reply. This is a successful two-round phone trial,
not a repeatability result or an isolated estimate of a prompt change's effect.

### Which repairs were exercised, and which were not

The new guidance was available and the 31s review chose to leave banter. Later
saved prompts do contain recentReviews: the review at 126s consideration has
one earlier record (92s), and the later review has both the 92s and 126s records.
Thus history delivery works live. Both replies precede that retained-history
sequence; **their success cannot be specifically credited to review history**.
There is no ablation separating prompt guidance, the earlier handoff-format
repair, or ordinary model variation.

A next-purpose proposal returned at 29s but was superseded by `voice_changed`.
The next fresh choice moved to the kitchen without consuming a ready handoff.
There was no ready-review rejection, but this run does not demonstrate a fresh
take/cancel repair on an admitted next-purpose record.

George reflection issued 127.5s and stored 142s: one historical insight and two
candidate questions survive `local_view_changed`. Jerry reflection issued 174s
with no returned/stored result before stop. No fresh candidate promotion was
demonstrated. Reflection did not cause the earlier phone replies.

### Preserved failures and remaining acceptance

- Jerry rejected an `affectUpdate` with `invalid_schema` at **81s**, and had a
  foreground timeout at **170.5s**. No fix or repeat run was attempted here.
- Foreground provider p50/p95: Jerry 1.553s/3.307s; George 1.731s/2.806s. These
  exclude the rest of the end-to-end action/reply chain.
- 274 diagnostic entries, zero dropped. Evaluator reports authored thoughts
  and speech for both actors, phone heard/read/reply delivery, complete
  diagnostics and no observed phone-knowledge leak. Legacy cookie/tin booleans
  remain false; this is the Project 89 card scenario, not a cookie-object gate.
- Visitor request 120s, reviewed 133.5s, proposal issued 176.5s and observed
  pending/admissible 177s. No approval or construction before the cap; God
  review failure counter 0. Final post-stop opportunity status is expired.
  Do not attribute that to an unrecorded dependency failure or claim a visit.

The **phone portion passed once**. The combined phone-plus-native-visitor demo,
ten-trial baseline and ten-minute endurance requirements remain unpassed. No
H3 readiness or reliable-behavior claim follows from this result. Next bounded
work should preserve this evidence, inspect the isolated malformed affect
update offline if its exact payload remains available, and seek a separately
authorized repeatability check before changing the scenario or rendering it.

## Two authorized unchanged repeats

User approved an offline check of the malformed affect update, then two more
180s comparisons. Inspection of `iCfwlG` finds only the `affectUpdate` category,
not its rejected JSON: Jerry's final ten conversation pairs start at 120.5s,
after the 81s rejection, and the runtime log does not retain that payload.
The 22 existing affect-state tests pass
(`/tmp/argos-affect-repeat-check-2026-09-21.log`). That does not diagnose the
specific failure. **No speculative repair or engine change was made.**

Both runs used the exact same formative-history / Gemini 3.8 Flash / high
background / visitor-at-120s settings and message protocol as `iCfwlG`.
Sequential execution, 180s each, exit 0, no failure/interruption, no H3, extra
nudges, retry beyond the two authorized trials, or code changes between trials.

| Trial | First read | First reply delivered | Follow-up read | Second reply delivered |
| --- | --- | --- | --- | --- |
| Prior `iCfwlG` | 38.7s | 53.015s | 57.7s | 77.835s |
| Repeat 1 `utyyAI` | 37.7s | 57.380s | 62.2s | 77.750s |
| Repeat 2 `bNbvLE` | 56.2s | None by 180s | Not sent | None |

### Repeat 1: two replies, but an underspecified test question

First outgoing: "It says: PROJECT 89 — WHO IS WATCHING? with a white rabbit.
Who is this?" Second outgoing: "If you're outside, what color is the cereal
box on my kitchen counter?" Both delivered, linked to the correct incoming
messages; exactly two outgoing rows, not duplicated deliveries.

The kitchen description really mentions cereal boxes. However, there is no
separate cereal-box entity, color value or authoritative counter-placement
fact for a specific box. This is not a wholly invented object category, but
the proposed verification question cannot currently be checked against ECS
state. Count successful autonomous phone follow-through, not a fully grounded
outside-world verification test.

Jerry had a rejected `goalReview.conflict` at 105s, after both deliveries; no
affect rejection occurred. Provider p50/p95: Jerry 1.564s/2.534s, George
1.723s/3.664s. 267 diagnostics, zero dropped. Visitor request 120s, reviewed
158.5s; no proposal/approval/construction observed before stop. God failure
counter 0. Jerry and George each stored two historical question candidates
(106.5s and 124.5s respectively); no fresh review/promotion demonstrated.

Artifacts (all mode 0600):
`recordings/project89-gate-utyyAI/{result.json,world.json,runtime.log}`.
Console: `/tmp/argos-momentum-repeat-1-2026-09-21.log`.

### Repeat 2: no reply; review history did not prevent renewed postponement

Jerry read at 56.2s, opened the drawer and picked up the card, then repeatedly
chose to show/discuss it with George. No outgoing reply, so the harness correctly
never sent the conditional second message. No rejected Jerry foreground
decisions occurred. George had a timeout at 117s. Thus an affect/schema failure
in Jerry cannot explain this particular non-reply. Provider p50/p95: Jerry
1.524s/2.459s, George 1.594s/3.595s; provider response speed is not end-to-end
follow-through. 277 diagnostics, zero dropped.

Background planning created a reply decision at 95.5s, still saved with empty
review at the end. At the 165.5s saved review, Jerry received all three prior
records (considered at 37.5s, 82s, 116s). Their expectations move from finishing
the conversational volley to getting George's perspective to letting him
counter a ratings joke. Jerry again chose `continue`:

"I want to hear George's reaction to the Kramer explanation before deciding
whether to check the phone or do something else."

His stated expected progress was to see whether George calms down or escalates
further. The new history was delivered and he could refer to earlier exchanges,
but another reaction continued to count as a reason to postpone. This supports
a selection/appraisal problem rather than absent memory, unavailable reply
capability or missing history. It does not prove a particular internal motive.

Visitor requested 120s, reviewed 139s, proposal pending/admissible at 166s;
no approval/construction before stop. God failure counter 0. Both actors stored
two historical question candidates (George 111s, Jerry 138s), no fresh promotion.
The evaluator reports no observed phone knowledge leak in either repeat.

Artifacts (all mode 0600):
`recordings/project89-gate-bNbvLE/{result.json,world.json,runtime.log}`.
Console: `/tmp/argos-momentum-repeat-2-2026-09-21.log`.

### Assessment and stopping point

Two out of the three unchanged post-momentum trials delivered both phone
replies. This is a small descriptive count, **not a reliable success-rate
estimate**. The cereal-box question is a separate grounding weakness. History
and guidance alone are demonstrably insufficient to prevent the conversation
trap. Retain the failed run; do not add automatic retries or call the system
golden based on the two successes.

Next bounded investigation: compare how the existing activity assessment
evaluates progress toward the organizing intention versus success at eliciting
one more reaction. Use the failed 165.5s input as the counterexample and preserve
voluntary company/real-information-dependency controls. Any proposed correction
should target that distinction, not increase prompt pressure, force replies,
or add another controller. Separately, later demo questions need observable
ECS facts rather than decorative description details with no checkable value.

No additional visitor-only run was authorized/performed here. Combined native
visitor demo, ten-trial baseline and ten-minute endurance gates remain open.
