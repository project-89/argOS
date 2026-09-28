# Instruction clarity: bounded implementation and live comparison

Implements the two wording corrections proposed in
[the decision-handoff audit](DECISION-HANDOFF-AUDIT-2026-09-21.md).
The user authorized improving the instructions and observing the simulation.

## Scope

Two shared prompt formatters changed, with no character-specific rewrites:

- `planner-decision.ts`: replace the blanket cross-goal omission instruction
  with explicit permission to defer/decline a proposal while acting for another
  goal. Selecting still requires the matching action and goal. An independent
  action need not adopt a proposal; reviewing remains optional.
- `activity-review.ts`: define `sustained` as maintaining the ongoing state or
  experience sought by the issued intention, rather than simply continuing its
  topic. An investigation may remain unchanged while conversation is enjoyable;
  uncertainty may remain while the character seeks information another way.

No schema, controller, validator, priority, execution authority, memory,
character identity, timing, or model changes. No automatic reply, banter cutoff,
or semantic classifier. Existing company, uncertainty and waiting choices remain
admissible. Mechanical refactoring is unnecessary and was not mixed in.

## Offline checks

Added two prompt-contract checks and two foreground integration cases for
cross-goal defer/decline. The latter verify both concerns remain active, no
message is sent, deferral returns after ten simulated seconds, and decline does
not return on that deadline.

**138 passed across three suites**, 7.58s:
`activity-review`, `planner-decision-frontier`, `planner-decision-foreground`.
Log: `/tmp/argos-instruction-clarity-tests-2026-09-21.log`.
Typecheck passed: `/tmp/argos-instruction-clarity-types-2026-09-21.log`.
Scoped diff whitespace check passed. No previous failed evidence removed.

## Authorized live comparison

Exactly one 180s trial using the unchanged Project 89 harness: Gemini 3.8 Flash,
high background reasoning, formative character history, visitor request at
120s. First message at 26s asks Jerry to find the card and text its contents;
the second is conditional on an actual delivered outgoing reply and asks for a
question that would test the sender's claim. No H3, manual nudge or automatic
retry. Console: `/tmp/argos-instruction-clarity-live-2026-09-21.log`.

## Result: both exchanges delivered, second still slow

Completed at 180s, exit 0, not interrupted, no run-level failure:
`recordings/project89-gate-mNzkcf`. All three artifacts (`result.json`,
`world.json`, `runtime.log`) retained with mode 0600. No second run launched.

| Event | Simulation time |
| --- | --- |
| Initial message delivered | 26.2s |
| Jerry reads it | 40.2s |
| First reply delivered | 54.085s |
| Conditional follow-up delivered | 54.7s |
| Jerry reads follow-up | 58.2s |
| Second reply delivered | 133.750s |

First reply: **"Project 89 - Who is watching?"**

Second reply: **"If you're outside our world, tell me what George is wearing
right now."** George's Appearance component records "plaid shirt, tan trousers,
glasses", so this is a checkable world-state question rather than the earlier
underspecified cereal-color question. Knowing the clothing would not itself
prove being outside a simulation; ordinary observation remains another possible
explanation. No answer to this second reply was injected by the two-message
harness.

This improves on `project89-gate-3fTOCb` (read at 49.7s, no reply by 180s), but
does not establish causal effect or reliability. Both changed strings were
tested together. Earlier history-only successes already delivered both replies
by about 78s. Here the second delivery took **75.550s after reading**; do not
claim a general latency improvement.

## What happened between reading and replying

At source 27s, the model used `intentionAssessment: unchanged`, explicitly
distinguishing entertaining banter about baldness from factual evidence. It
still chose to hear George. This is the intended distinction without forcing
an action.

After the follow-up, it returned to explaining the card and waiting for George's
reaction. Native card transfer completed at 97.5s. At source 109s, the review
again used `sustained`, this time for joint inspection of physical evidence.
That is not mere imaginary progress, but it still preceded another prolonged
wait and exchange. Integrated speech/give proposals are not counted as separate
completed utterances/transfers.

A test-question proposal was created at 92.5s. At **129s**, Jerry explicitly
selected it under goal 217, with the reason that George's current clothing was
a specific observable fact. Native typing began at 129s, completed at 133.550s,
and delivery followed at 133.750s. The planner proposal was therefore formally
selected, not left pending as in the preceding failure. No defer/decline use
establishes that the cross-goal wording specifically caused this result.

At source 141s, the review credited sending the test as `advanced`, grounded in
an actual sent message. The later review again said `sustained` while waiting
for an outside answer. Since the harness sends only two messages, that last
wait genuinely has no further supplied response; it is distinct from failing
to send the requested question.

## Preserved failures and other gates

- Jerry's 31s `control.nextPurpose` schema rejection remains in the evidence.
  The returned diagnostic shows a cancellation of the old ready choice together
  with a new next purpose in the same response. At 33.5s he instead took the
  existing ready choice, moved, and subsequently read the phone. No rejection
  in `intentionAssessment` or `planDecision` was observed. This turn did not
  change next-purpose admission or attempt another repair.
- 287 diagnostic entries, zero dropped. Jerry foreground latency p50/p95
  **1.562s/2.945s**; George **1.779s/2.846s**. The 76s behavioral delay is not
  one foreground model request taking that long.
- Both actors thought/spoke; phone heard/read, outside reply delivered, no
  observed phone knowledge leak, complete diagnostics. Cookie/tin gates remain
  false and are not achievements of the Project 89 card scenario.
- Morpheus was proposed at 148.5s and remained admissible but unapproved before
  the cap; no visitor arrived. God queue diagnostics retain one expired review
  failure. The combined visitor demo therefore does not pass.
- Two reflection questions were stored as candidates at 122s; their existence
  is not proof they were promoted or caused the later choice.

## Handoff

Keep the bounded wording correction and its tests. The phone portion passed
this one trial, with a remaining conversational delay. Do not add another
mechanism or silently rerun. The next useful comparison is a separately
authorized unchanged repeat measuring both actual delivery and read-to-reply
time; if the delay recurs, inspect the specific dependency being awaited rather
than making all conversation subordinate to action.

Prior successes and failures remain intact. This changed variant is 1/1, not
reliability proof and not pooled with earlier variants. Combined visitor,
ten-trial baseline and ten-minute endurance gates remain open.
