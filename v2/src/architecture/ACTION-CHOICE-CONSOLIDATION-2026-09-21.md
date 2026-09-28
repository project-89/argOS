# Conversation dominance: action-choice consolidation

## Investigation and limits

The user requested a deeper fix after repeated conversation-over-action
failures. No priority experiment, new model, extra controller or H3 run.
Previous evidence: [instruction clarity trial](INSTRUCTION-CLARITY-TRIAL-2026-09-21.md).

In `project89-gate-mNzkcf`, Jerry adopted a concrete test-question goal by 73s,
priority 7, equal to the general investigation. The proposal arrived at 92.5s;
selection waited until 129s. Execution then took 4.55s plus 0.2s delivery. This
is repeated choice of conversation, not one long inference or missing intent.

Read the automatic-plan, activity-resumption, continuation, ongoing-activity,
goal projection and foreground prompt paths. The resumption path precedes normal
choice, but this run had no executable investigation plan to pull Jerry back:
goal 34's saved plan was failed/empty; goal 217 was awaiting a fresh decision.
Neither automatic conversation execution nor a compulsory highest-priority-goal
rule explains the recorded choices. Speech focus mutation in `deliverSpeech`
is on the untimed path and is not evidence of a cause in this timed demo.

The demonstrated interface asymmetry is narrower: the model is required to
assess continuing the current exchange, while concrete alternatives sit in a
separate optional proposal section. It can repeatedly justify a local social
beat without comparing opportunity costs. The same request unconditionally
instructed "Speak one short conversational beat ... then leave space to hear a
response." That supplies a speak/listen routine inside a general action-choice
request, even when the character could do useful non-conversational work.

This is a grounded explanation for a reinforcing bias, not proof that all
conversation dominance comes from one sentence. Personality, available actions,
social context and stochastic generation still influence choice. No deterministic
validator can establish the semantic usefulness of every action from prose.

## Keep / remove / merge

- Keep goals, continuation, ongoing activity, optional planner advice, actual
  speech/body resources, and existing native authority and freshness validation.
- Remove the unconditional speak-then-listen instruction. Speech guidance now
  applies only after selecting speech; ending speech frees the turn, and
  listening remains a separate choice.
- Merge presentation of offered decisions and conversation assessment under
  one **next-action choice** section. Offered decisions precede the review.
  The existing review reason compares the chosen approach with an available
  alternative rather than merely defending continuation of the current topic.
- Keep explicit permission for company and necessary waiting. No useful
  alternative is a valid answer. Proposals remain options, not obligations or
  factual evidence. No new response fields, classifiers, rejection conditions,
  state stores, turn budgets, forced replies or action queues.

Implementation changes only prompt composition in `agent-mind.ts` and
`activity-review.ts`. The primary instruction now asks for the next useful action
across intentions before composing speech. This is a consolidation of the
existing choice interface, not a second deliberation call or a new controller.

## Offline verification

Added a foreground prompt-contract test and extended coverage for the combined
proposal/review order and comparison instruction. Existing integration tests
still select a physical reply while closing another exchange, preserve voluntary
conversation, retain lower-priority choice and reject stale/foreign evidence.

Initial focused run: 157 tests passed, four suites, 8.156s.
`/tmp/argos-action-choice-tests-2026-09-21.log`.
Typecheck passed: `/tmp/argos-action-choice-types-2026-09-21.log`.
Broader safety regressions: **349 passed, 12 suites**, 12.57s:
`/tmp/argos-action-choice-broad-2026-09-21.log`. Includes next-purpose,
ongoing-activity, readiness, native action admission, mental-envelope,
goal-transition and timed-speech/floor coverage. Scoped diff check passed.

## Bounded behavioral gate

After regressions, one unchanged 180s Project 89 cognition trial: formative
history, Gemini 3.8 Flash, high background reasoning, initial card text at 26s,
second message only after actual delivery of the first reply, visitor request
at 120s. No operator nudges or automatic retry. Preserve failures and report
read-to-reply intervals, committed actions and reviews, not just schema success.
## Live result: better second-reply timing, not a clean realism pass

`recordings/project89-gate-VoRvAs`, completed at 180s, exit 0, no run-level
failure/interruption. All three artifacts retained with mode 0600. Console:
`/tmp/argos-action-choice-live-2026-09-21.log`. Same model, background reasoning,
scenario, formative history and message protocol. No H3 or second run.

| Event | Previous instruction-clarity run | Action-choice run |
| --- | --- | --- |
| Initial message read | 40.2s | 29.7s |
| First reply delivered | 54.085s | 45.315s |
| Follow-up read | 58.2s | 49.2s |
| Second reply delivered | 133.750s | 84.775s |
| Follow-up read to delivered reply | 75.550s | 35.575s |

First reply: "It says PROJECT 89 — WHO IS WATCHING? with a white rabbit.
Who is this?" Second: "What color is the couch I'm standing next to right now?"

The card answer matches the physical card. The couch is blue in the Living
Room's Description component and the storage drawer's description. Unlike the
earlier cereal-color test, the color is actually recorded. However, there is no
separate couch entity with a typed color field here, and precise "standing next
to" adjacency was not established. Neither knowing a color nor ordinary visual
access proves being outside the world. Preserve those grounding limits.

### What changed, and what cannot be credited

Jerry selected other work rather than taking the first speaking turn, and later
chose the reply after fewer conversational exchanges. A concrete test-question
goal appeared by 69.5s at priority 7. At 81s he chose the reply; native typing
completed at 84.575s and delivery at 84.775s. There was no retained
PlanningDecision in the final save; the observed success is native action,
not proof of using the optional proposal review.

The initial improvement has an important confound. At 2.5s he thought, "If my
phone's buzzing on the counter, I'd rather just look at it than wonder who's
texting." His recorded sensory input contained no auditory events; the first
message was not sent until 26s. He fetched/read the phone early, found no unread
notifications, then returned toward George. That is a permissible phone check
with an unsupported buzzing premise, not evidence of better grounded perception.
It left him holding the phone when the real message arrived. Do not credit the
29.7s read purely to improved arbitration or call this a clean realism pass.

Conversation still occupied part of the follow-up interval: acknowledge George,
explain the message, give him the card, hear his reaction, explain further, then
send the question. After sending, waiting for the outside participant was a real
unresolved dependency: the harness supplies no third incoming answer. Later
reviews also acknowledge being drawn back into hairline banter despite intending
to await the phone. Do not report that conversation dominance is eliminated.

The two relevant prompt changes were bundled, and initial/model/background
choices differed stochastically. Communication priority briefly reached 8 via
the existing background process and returned to 6; no operator changed it.
There is no isolated causal estimate or reliability claim from this one sample.

### Failures and integration evidence

- Jerry: `motorPlan` invalid schema at 33s; preserved, not bypassed.
- George: timeout at 122.5s, then `control.activityReview.unissued_evidence` at
  135s. Fresh evidence validation rejected it. The exact rejected payload is
  not present in the retained final conversation pairs; do not invent a cause
  or attribute it to section reordering without evidence.
- 288 diagnostic entries, zero dropped. Foreground latency p50/p95:
  Jerry 1.497s/2.487s, George 1.802s/2.959s.
- Both actors thought/spoke, heard/read phone and delivered outside replies.
  No phone knowledge leak observed. Cookie/tin gates remain false and are not
  achievements of the card scenario. A knowledge-leak gate passing does not
  validate every thought's claimed sensory premise.
- Morpheus proposal issued at 164s, approved by 175.5s, constructed on the
  existing Street at 178s. God review failures: zero. No arrival into the
  apartment or interaction with Jerry/George before the cap. The full visitor
  demo is therefore not complete.

## Handoff

Retain this bounded choice-interface correction and tests. It removes an actual
contradictory default and comparative-choice omission without granting authority
to background advice. It is not a solved-cognition claim.

Next bounded work should distinguish the unsupported initial buzzing premise
from legitimate voluntary phone checking, then assess repeatability of
follow-through. Use saved inputs/receipts before touching perception, personality
or weights; do not turn an unsupported thought into a fabricated stimulus or
use a global speech penalty. No automatic retry in this pass.

Prior variants remain separate evidence; this variant has one phone success
with grounding caveats. Ten-trial baseline, ten-minute endurance and combined
visitor demo gates remain open.
