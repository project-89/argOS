# H3 prompt simplification — 2026-09-12

Scope: simplify rendering instructions only. No live model calls, model changes,
simulation changes, media-budget changes, or timing-map changes in this pass.

## Implemented

- Coalesce adjacent instructions for the same camera framing, location and cast.
  Preserve the fine-grained immutable directed intervals for synchronization.
- Bind the voice once per speech cue/shot instead of reissuing it at each
  sound, action or property boundary. Rebind on genuine shot/speaker changes.
- Remove repeated CONTINUE-cue and HOLD CAMERA directives. Emit each original
  speech/action/state/sound cue once, retaining its complete timing and evidence.
- Replace open-ended natural movement/breathing filler with final pose, unchanged
  objects and quiet room tone. Explicitly stop a performance at its cue end.
- Keep exact quoted dialogue, stable speaker labels, cross-room audio ownership,
  phone gestures, private-text exclusion and eating/drinking mouth exceptions.

## Verification

Restored the saved opening from
`recordings/h3-bounded-verification-1YKKdo/scene-history.json` and recompiled the
same source interval (0–10000ms), version and 10-second media budget. Compared
against the original `screenplay.json`, without modifying recorded evidence.

| Prompt measure | Before | After |
| --- | ---: | ---: |
| Characters | 8492 | 5912 |
| Camera/hold declarations | 9 | 3 |
| Named voice declarations | 6 | 1 |
| CONTINUE-cue reminders | 8 | 0 |

All serialized screenplay fields except prompt match, including beats,
performance/source map and directed intervals. This is a text-authoring change,
not a faster simulation or different packing result.

Regression run: 380 tests / 34 suites passed; TypeScript no-emit check passed.
An additional screenplay regression checks the explicit ending and absence of
open-ended filler. Focused screenplay suite also passed after adding it.

Initial evidence: three older tests failed because they required the deliberately
removed CONTINUE/HOLD wording. Replaced these with assertions for cue-once,
voice rebinding, stable framing and retained continuation metadata. A first
ad-hoc replay check used `.ok` instead of the actual `status: ready` API and
failed before compilation; corrected it. A strict in-memory comparison against
saved JSON found an undefined optional field; normalizing through JSON produced
the correct serialized comparison. Neither required a production behavior fix.

## Still unproven

No new paid H3 run was launched. The prior recording's repeated dialogue and
cast/location drift remain failed evidence. Simplifying instructions removes a
plausible contributing cause, but does not establish that H3 now follows them.
Next verification, when requested: one bounded rendering check using the same
scenario, checking exact dialogue once, silence afterward, speaker identity and
phone-action fidelity against committed evidence. Existing broader cognition and
endurance gates are unchanged.
