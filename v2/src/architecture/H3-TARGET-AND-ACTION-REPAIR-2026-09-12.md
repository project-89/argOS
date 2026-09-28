# H3 target and action projection repair — 2026-09-12

Scope: the two compiler defects found in `recordings/h3-bounded-verification-QSeqIf`.
No live simulation/model/H3 calls, cognition changes, or new controller. Prior
recordings, prompts and failed evidence remain unchanged.

## Changes

Reading and typing no longer imply a phone. Public action intervals retain the
executor's target ID and lifetime key, including continuation windows without
a fresh event. Remote terminal receipts cannot import a different target.
The compiler resolves only public recorded target appearance/placement, never
message bodies, hidden inventory, current live ECS or name-based object classes.
Unknown/replaced targets remain unspecified instead of becoming a guessed phone.

The shot is now an `interaction_insert` showing the actual target. A held phone
remains a held phone; paper on a desk remains on the desk. Reading is explicitly
silent and written content remains illegible. Gesture minimums, essential-action
coverage, utterance boundaries, and privacy rules are unchanged. `phone_hands`
is retained only as a saved-script compatibility type, not newly emitted.

`projectScreenActions` reconciles room projections by execution, actor lifetime,
operation, target identity and native start time. It intersects projected
intervals with recorded world presence, unions evidence and merges only
continuous observed coverage. Unseen gaps and separate executions stay separate;
conflicting completion times/verdicts fail explicitly. Legacy local windows
without a full world timeline cannot justify cross-room merging. The starting
shot room comes from actual actor presence, not room iteration order.

## Saved-run verification

Restored the original public scene tape and recompiled all seven original source
windows with their original media duration, speech-slice mode and sound cadence.
Each packet passed exact dialogue-beat and sound-beat comparison, equal evidence
ID coverage, and absence of overlapping duplicate action executions.

- Packet4: two projections of execution397360ff-af65-41de-94f7-5dfd24b225f3 become
  one25720.001–27000ms movement, starting in Kitchen (room8), with all evidence.
- Packet6: Elaine reads “Evening notes” at43500–44700ms, not a phone.
- Packet7: Jerry reads “Evening notes” at52000–53200ms, not a phone.
- Genuine phone pickup/read/type targets survive in packets2,4,5.
- All original speech, sound and source-interval boundaries are retained. All
  seven ending-hold durations match. Do not rewrite previously issued media maps;
  these changes apply only when compiling new prompts.

## Regression coverage

Final result: **392 tests / 34 suites passed**, and `tsc --noEmit` passed.

Added checks for paper, phone, desktop typing, misleading object names, actual
held/supported placement, unknown/replaced targets, continuation through saved
history, room-order independence, continuous room crossing, unseen gaps,
separate executions, actor replacement and failure preservation. Existing real
phone tests additionally verify target identity in event-free continuation.

Initial failures retained here: two existing assertions expected the deliberately
replaced phone-only wording. Updated them to target-specific directions and
finger movement, retaining all behavior/privacy assertions. The new history
fixture initially named a target lifetime absent from its visible prop; the
existing sanitizer correctly removed that target. Fixed the fixture's prop
identity, not the privacy boundary. An ad-hoc saved-replay assertion initially
enabled speech slicing on every packet; corrected it to each recorded packet's
original mode before comparing the exact dialogue beats.

## Remaining gate

These repairs remove contradictory instructions authored by Argos. They do not
prove H3 will stop inventing vocal filler, speaking scene labels, or changing
wardrobe. No additional paid run was launched. Existing ten-trial and endurance
requirements remain unchanged.
