# Bounded chunk admission and final-playback repair

Follow-up to `recordings/h3-chunk-comparison-2026-09-12/REVIEW.md`.
The failed 5s attempt and incomplete 10s recording remain unchanged. This pass
used no paid model or video calls and does not turn either attempt into a pass.

## Implemented

- Native session duration validation accepts whole seconds 5–15. The selected
  duration is still fixed before issuing immutable performance maps. Both the
  provider's configured receipt and actual chunk duration must match. Default
  behavior and legacy 10.125s/8.5s calibration are unchanged.
- Performance scheduling still prefers complete utterances, then clauses.
  When none fits, a last-resort cut uses actually delivered word receipts and
  an explicit `word_boundary` continuation manifest. Prompts label the text a
  fragment, pause after the supplied words, and forbid replaying earlier words
  or inventing the remainder. Essential physical actions cannot be divided.
  The whole-utterance-only scheduling path retains its overflow refusal.
- A still-unfolding one-word fragment with more than half a packet of ending
  hold, and no duration-bearing action, is not admitted while the bounded
  source horizon remains open. This prevents an isolated “So,” packet without
  suppressing legitimate short completed replies or indefinite waiting.
- Source exhaustion no longer sends WebRTC `stop` on a generation receipt.
  It freezes the intended final media endpoint, drains playback, then stops and
  finalizes both recordings. Extra/repeated metadata cannot move that endpoint.
  Transport errors during final drain remain recorded; buffered playback gets
  a bounded chance to finish. Timeout saves partial coverage explicitly.
- The original spending deadline, safety/provider errors, leases, privacy,
  source-map immutability, and speech/essential gesture budgets remain intact.
  Provider exhaustion without complete source coverage uses a separate stop
  reason instead of claiming the committed source was fully drained.

## Verification

Final targeted regression: **374 tests / 33 suites passed**:

```
npm test -- --runInBand --silent --testPathPattern='(sitcom|focused-apartment|sensory-system|prompt-context|cognitive-boundaries|director-projection|scene-director|performance-compiler|committed-scene).*test.ts'
```

New offline fixtures cover punctuation-sparse speech overlapping one complete
phone read, exact once-only speech evidence, private text exclusion, minimum
speech/gesture durations, one-word opening admission, playback-based final
shutdown, transport error retention, stalled drain, extra repeat metadata,
spending deadline precedence, and 7s configuration through server/client.
The overlap fixture exercises the recorded line and failure class; it is not
a replay of the original stochastic ECS trajectory or verification of H3 pixels.

Intermediate failures were informative and were not hidden: the first focused
run had 88 passes / 2 failures (old immediate-stop expectation; an overbroad
underfill filter changed an existing two-word clause cut). Narrowed the filter
to one-word fragments and corrected the shutdown expectation. The next run
had 91 passes / 1 failure: a new test incorrectly demanded 1.8s for a zero-time
completion receipt as well as the actual phone-read interval. Corrected the
fixture to distinguish receipts from performed intervals. A broader run then
passed 369 tests; additional duration/drain regressions brought it to 374.

## Fal contract and remaining work

Checked September 12, 2026:

- https://fal.ai/h3-max-director advertises configurable 5–15s segments.
- https://fal.ai/models/minimax/h3-max/director/api types `configured.chunk_duration`
  and requested chunk durations as integers 5–15. Script offsets are whole
  seconds and express timed directions, not an arbitrary per-prompt duration.
- The strict configure schema still omits the advertised duration knob. Actual
  earlier trials confirmed 5s and 10s; intermediate settings have offline
  coverage only. Keep explicit opt-in and fail-closed confirmation.

**Not implemented or verified:** changing the provider duration on each prompt,
fractional chunk requests, multi-chunk logical scripts with exact script-offset
mapping, or fresh paid rendering. Argos source intervals can vary with committed
events; that is distinct from adaptive provider transport duration.

Next bounded live check: verify exact speech continuation and visible phone
handling at 5s, and final playback drain. Preserve raw/UI video, prompts, native
events, received chunk metadata, and actual recording endpoint separately.
Do not claim text was rendered merely because a chunk receipt arrived. Keep
the spending cap even if that means the final source cannot all be filmed.

This is not a general repair for two simultaneous essential actions competing
for one camera, nor a naturalness/latency certification. Existing ten-trial and
ten-minute endurance requirements remain outstanding and unchanged.

## Subsequent live capability check

Two short isolated sessions now tested both direct duration-update routes.
`prompt.chunk_duration: 7` was rejected as an extra forbidden input after a
confirmed 5s baseline. A second `configure` was rejected with
`immutable_settings`: reconnect to change settings. Evidence and scope:
`recordings/h3-duration-probe-vjOYSE/REVIEW.md` and `transport.jsonl`.
Thus per-prompt duration changes are not just undocumented: these two routes
are live-rejected. End-image checkpoint timing remains a separate, untested
capability. No extra Elaine or repaired-renderer live run was performed.
