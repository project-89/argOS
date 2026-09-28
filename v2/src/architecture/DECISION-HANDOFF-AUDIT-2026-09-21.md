# Investigation versus conversational momentum: bounded audit

Follow-up to [the intention-progress trial](INTENTION-PROGRESS-REVIEW-2026-09-21.md).
Scope: inspect why a concrete planner suggestion remains pending while Jerry
continues talking. No engine changes, model changes, new controller, live retry,
H3 or world-generation work. Failed evidence remains intact.

## Findings

### 1. No demonstrated execution barrier

`planner-decision.ts` deliberately makes background decisions advisory. The
planner stops at a fresh-choice boundary; a suggestion is neither an accepted
intention nor queued action. `agent-mind.ts` validates `planDecision` if supplied,
but does not require it merely because a proposal exists. The actor may choose
a native action independently, including under another owned goal.

Therefore an empty `PlanningDecision.reviewJson` means **no formal proposal
review was committed**, not that the model never considered replying. In the
failed run Jerry's own reasons explicitly consider replying and repeatedly put
it after George's response. The previous checkpoint's word "unreviewed" refers
to this stored protocol state, not an inference about absent consideration.

Likewise, `intentionAssessment` is an actor-authored interpretation. It cannot
mutate goal progress, complete a goal, or grant execution rights. `sustained`
does not deterministically force `continue`: the model chooses both.

### 2. Two distinct concerns are being evaluated separately

In `project89-gate-3fTOCb`, the activity assessment targets goal 34: find a
concrete explanation for strange events, ask people who could know, and weigh
answers against evidence. The pending reply suggestion belongs to goal 39:
stay in touch through the phone while keeping one's own plans. The supplied
goal text explicitly says George is not the only person worth asking.

The suggestion was created at 74.5s and appears in all ten retained final
foreground input prompts. Late decisions keep selecting goal 34. Review is
mandatory when the encounter reaches its existing review boundary; the
separate planner review remains optional. Nothing requires the actor to
compare these alternatives when explaining the continued conversation.

This is an uneven deliberation interface, not proof that a mandatory review
or another controller is needed. Preserve the distinction between someone
else's suggestion and the actor's own commitment.

### 3. The planner instruction overstates a real safety constraint

`formatPlanDecisions` says:

> When acting for another goal, omit planDecision: your independently validated
> action need not adopt this plan.

That blanket instruction includes `defer` and `decline`, although their
validation does not require selecting the proposal's goal or action. Only
`select` needs the matching goal, target and command. The instruction can
discourage explicit reconsideration of the phone suggestion while Jerry
continues investigating under goal 34. This is a concrete prompt/API mismatch;
the existing validator already permits the more useful behavior.

It is not sufficient evidence to attribute the whole failure to this sentence.
Deferring a proposal explicitly is still not answering a message.

### 4. "Sustained" is too easy to interpret as staying on topic

The activity-review instruction defines it as "maintaining an experience it
values." The intended meaning is a desired ongoing experience, such as company.
In this trial the model labels further speculative discussion `sustained`
investigation, even when it describes George's theories as ungrounded.

The 80s assessment of `advanced` followed real new evidence (the predicted card
was found). At 113.5s and 145.5s it instead credited continued speculation. The
179.5s saved response again expects another reaction to determine whether
George has a concrete scenario. Previous conversational expectations become
`met`, while the wider uncertainty remains.

Do not fix this with a semantic keyword validator. It would misclassify useful
conversation and convert model judgment into arbitrary execution authority.
Nor should a character be forbidden from enjoying company while making no
progress on another concern. The missing distinction is between that preference
and evidence that continued discussion advances the investigation.

## Comparison with existing trials

All four inspected saves have the same Jerry persona and the same two starting
goals (investigation priority 7; communication priority 6). Formative background
already acknowledges that joking can postpone inquiry; memories include having
mistaken George's speculation for asking the person who actually knew.

| Trial | Phone read | Delivered replies | Relevant observation |
| --- | --- | --- | --- |
| `iCfwlG` | 38.7s | 53.015s, 77.835s | Personally closed the opening banter at 31s; later replied under the investigation goal, then a new testing goal. |
| `utyyAI` | 37.7s | 57.380s, 77.750s | No saved personal closure; replies still succeeded. The retained planner proposal was created at 80.5s, after both replies, and declined at 109.5s because he had already sent the question. |
| `bNbvLE` | 56.2s | None by 180s | Three-review history delivered; still awaited George's reaction. |
| `3fTOCb` | 49.7s | None by 180s | New intention assessment delivered; further speculation labeled `sustained`. |

The first three are the unchanged history-only variant; the fourth changes the
assessment contract. Do not pool them into a reliability estimate. The second
success's cereal-color question remains insufficiently grounded in a specific
ECS object's recorded color. Retained final conversation history is only ten
turn pairs; absence of an early raw response is not evidence that it omitted a
field. Integrated proposals also must not be counted as completed speech.

The causal evidence supports a choice-quality problem more strongly than a
missing phone affordance, compulsory higher-priority goal, or absent planner
projection. Identical setup succeeding on other runs rules out a simple claim
that Jerry's identity makes replying impossible; it does not isolate which
prompt wording will improve reliability.

## Verification performed

Existing suites rerun, offline:

- `planner-decision-frontier.test.ts`
- `planner-decision-foreground.test.ts`
- `activity-review.test.ts`

**134 passed, 3 suites, 6.544s**, exit 0. Log:
`/tmp/argos-decision-handoff-audit-2026-09-21.log`.

These include private decline without sending; independent native reply under
another owned goal; lower-priority choice while another concern remains active;
simulation-time deferral; strict stale/owner/target/command/goal validation;
and unchanged intention progress coexisting with voluntary conversation. These
are deterministic/mocked regression tests, not evidence of improved live choice.

## Smallest proposed follow-up — not implemented in this audit

Keep existing responsibilities and authority unchanged:

1. **Clarify the existing planner instructions**, replacing the blanket omission
   sentence: selecting adopts the proposal only with a matching goal/action;
   defer/decline may accompany work on another concern; an independent action
   need not adopt a proposal. Keep review optional, and do not treat omission as
   refusal or automatically schedule a reply.
2. **Tighten the existing intention-assessment wording**, not its schema:
   `sustained` means maintaining the ongoing state/experience sought by the
   issued intention, not merely continuing the same topic. An investigation can
   remain `unchanged` while conversation is enjoyable; uncertainty can remain
   while the actor chooses an available way to seek information.
3. Add focused prompt-contract checks and a cross-goal defer/decline regression;
   retain independent-action, meaningful waiting, company, privacy, simulation
   time and stale-decision tests. No mechanical refactor is needed for this pass.
4. After those offline checks, obtain authorization for one unchanged bounded
   live comparison. Measure actual reply delivery, new information, and native
   actions—not just better self-explanations or populated review metadata.

Remove neither planner advice nor legitimate social choice; merge no authority
paths. No new review fields, forced question generation, character rewrites,
banter timeout, priority override or controller. If this small wording correction
still fails live, return to evidence before adding mechanisms.

The combined visitor demo, ten-trial baseline and ten-minute endurance gates
remain open. Existing safety and behavioral acceptance gates are unchanged.
