# Unsupported opening cue and unchanged repeatability checks

Follow-up to [action-choice consolidation](ACTION-CHOICE-CONSOLIDATION-2026-09-21.md).
User requested investigating the unsupported perception and repeatability.
Bound: two serial 180s trials, same model, prompt implementation, scenario,
formative history, high background reasoning, conditional two-message protocol
and visitor request at 120s. No H3, extra nudges, engine changes or automatic
retry beyond those two checks. Prior failed outcomes remain intact.

## What the earlier run actually shows

In `project89-gate-VoRvAs`, the earliest phone-related thought at 2.5s was
conditional: "If my phone's buzzing on the counter, I'd rather just look at it
than wonder who's texting." It is not a native perception or an explicit
statement of hearing. However, the subsequent 10s examination purpose asks why
it buzzed or whether George was hearing things. Neither the recorded auditory
input nor George's preceding speech establishes such a buzz. His first speech
was about his hairline. The first actual text arrives only at 26.2s.

The model's unsupported premise led to an early phone check, which is itself a
valid voluntary action. It found no unread messages. There is no evidence that
the thought created a real vibration, revealed future message contents, or
caused the phone executor to fabricate a read. Do not classify every voluntary
phone check as hallucinated perception.

## Source trace

- The phone initializes with unread=0, buzzCount=0, no displayed message.
- `buzz()` returns when there are no unread messages. Actual incoming delivery
  increments unread, emits the physical buzz and supplies a hearing-scoped
  attention perception; only then can communication motivation rise to 8.
- Project 89's authored episodic setup says Jerry recognizes his phone's
  familiar double vibration. The communication motivation adds a separate
  episodic memory: "I usually check my phone when it keeps buzzing ...".
- The scenario operation context labels itself "rules, not events" and uses
  conditional "If it vibrates within hearing" language. Initial local perception
  says no auditory events were supplied.

Those memories/rules offer plausible textual sources for an imagined buzzing
premise. This is an inference, not a proven token-level causal explanation.
The original first full model input is no longer in the last-ten-pair saved
conversation history; source inspection and a fresh offline setup establish
what the current setup supplies, not an exact reconstruction of every byte of
that historical call. The raw saved event stream establishes the missing
physical cue. Do not rewrite a memory or reject voluntary checking merely to
make these repeats pass.

## Offline check

Added a regression in `src/demo/__tests__/project89.test.ts` using the formative
Project 89 scenario, no automatic outside text and no network/model calls.
It verifies the recognition memory and conditional operation instructions are
present while, through the opening 26 simulated seconds, there are no messages,
unread notifications, buzzes or phone-vibration perceptions and communication
priority remains 6. A real text remains quiet through the 199ms delivery delay;
at 200ms it creates one buzz, an unread indicator and priority 8. Contents remain
unavailable to both characters before reading.

37 tests passed across four suites (Project 89, perception admission,
perception boundaries, communication memory), 2.884s.
Log: `/tmp/argos-unsupported-cue-check-2026-09-21.log`.
Typecheck passed: `/tmp/argos-unsupported-cue-types-2026-09-21.log`.
Only a test and these notes changed in this pass; production behavior and the
live harness remain unchanged between the prior variant and these repeats.

## Repeat outcomes

Both completed at 180s, exit 0, not interrupted, no run-level failure. Console logs:

- `/tmp/argos-action-choice-repeat-1-2026-09-21.log`
- `/tmp/argos-action-choice-repeat-2-2026-09-21.log`

| Trial | First read | First reply delivered | Follow-up read | Second reply delivered | Follow-up read-to-delivery |
| --- | --- | --- | --- | --- | --- |
| Preceding `VoRvAs` | 29.7s | 45.315s | 49.2s | 84.775s | 35.575s |
| Repeat 1 `uxJGKO` | 37.2s | 52.170s | 56.2s | 84.860s | 28.660s |
| Repeat 2 `V7PdVt` | 30.7s | 62.450s | 67.7s | 82.905s | 15.205s |

All three used the unchanged action-choice implementation. This is **3/3
two-way phone exchanges**, not three fully grounded demos, an isolated causal
effect, or a reliability estimate. First read-to-reply varied, and no monotonic
overall speed improvement should be claimed. Earlier prompt variants remain
separate evidence. No third repeat was launched.

### Repeat 1: `recordings/project89-gate-uxJGKO`

Replies:

1. "It says: PROJECT 89 — WHO IS WATCHING?"
2. "If you're outside, what color shirt is George wearing right now?"

No recorded pre-message buzz claim. Opening thoughts/speech concerned simulation
banter. Jerry considered checking his phone in choice purposes at 8s/17s, but
did not assert a notification. Voluntary checking/considering is not a perception
failure. Both messages were actually read and replies delivered natively.

**Grounding limitation:** George's Appearance component and Jerry's perception
say "plaid shirt, tan trousers, glasses". There is no established shirt color.
The question presupposes a verifiable detail the simulator has not supplied;
do not grade it as an ECS-checkable test or silently invent a color. The card
reply itself is grounded.

At source 78s the review says the next useful step is to test the texter; actual
reply follows. Later waiting is for an outside response the harness intentionally
does not supply. No rejected foreground decisions; 315 diagnostic entries,
zero dropped. Jerry p50/p95 1.547s/2.472s; George 1.777s/2.872s.

Morpheus was constructed on Street at 176.5s, not yet in the apartment. God
review failures zero. Full visitor interaction remains untested at this cap.

### Repeat 2: `recordings/project89-gate-V7PdVt`

Replies:

1. "It says Project 89 - Who is watching. Who is this?"
2. "If you're outside my world, what did I eat for breakfast?"

No recorded unsupported pre-message buzz claim. Jerry voluntarily went to check
his phone at 1.5s, found no messages, and chose to return to George. Unlike the
earlier conditional buzzing premise, these purposes make no claim that a cue
occurred. His 26s thought about a discovered card is grounded: the drawer really
opened at 24.8s and the card was visually supplied at 25s, before the operator
message. Independent discovery is valid, not evidence of unread-message access.

**Grounding limitation:** no authored or simulated breakfast event was found
before the question. At 107.54s Jerry said, "It's the ultimate test! Nobody guesses
Cheerios with skim milk." Subsequent speech and memories repeat that account.
The retained memories describe what he said and how George reacted; those are
real conversational events, not proof he actually ate that breakfast. This is
not a verified private-memory test. Do not backfill a breakfast event from the
later speech, or treat asking a plausible personal question as proof the answer
already exists in the world.

No rejected foreground decisions; 280 diagnostic entries, zero dropped. Jerry
p50/p95 1.568s/3.548s; George 1.631s/3.003s. The visitor request was reviewed at
142.5s, but no Morpheus proposal/construction/arrival was recorded. Preserve
five expired God review failures (59.5, 82.5, 108.5, 138 and 167s) as a separate
world-growth failure; do not let the successful phone exchange hide them.

### Artifact integrity and gates

Both runs retain `result.json`, `world.json`, `runtime.log` at mode 0600. Both
pass actor thought/speech, heard/read phone, outside reply, complete diagnostics,
and no observed phone-knowledge leak gates. The latter does not certify every
question or invented autobiographical claim. Cookie/tin gates remain false and
are not achievements of this card scenario.

## Conclusion and next scope

No deterministic false-notification source was found. The early unsupported
buzz premise did not recur in either repeat; habitual/recognition text remains
a plausible influence, not an established causal explanation. Leave production
behavior unchanged rather than patch a suspected source without evidence.

The repeatable improvement is completing both exchanges. The remaining evidence
gap is **question answerability and provenance**: an observable property must
actually have a recorded value; a personal-memory test needs a pre-existing
grounded memory or event. A later spoken claim cannot establish that earlier
event. Next work should inspect how the existing choice context distinguishes
known facts, attributed claims, history and possibilities, using these two saved
counterexamples. Do not introduce scenario answers, compulsory response rules,
or another controller.

Ten-trial baseline, ten-minute endurance and full visitor interaction gates
remain open. No H3, model changes, engine changes or further live retries.
