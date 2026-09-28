# H3 stage direction pass — 2026-09-14

## Contract

The ECS owns what happened. The performance ledger owns evidence, timing,
speaker identity and execution boundaries. The renderer presents that evidence
as concise direction to actors and a camera crew. Packet boundaries are not
dramatic events.

Fal's guide establishes visual continuation plus bounded prior-prompt memory:
https://fal.ai/learn/tools/what-is-minimax-h3-max-director
Establish the world initially; direct the next moment afterward. Keep sparse
context refreshes for the bounded memory horizon and genuinely new identities.

## Implemented, presentation only

- Removed direct-channel “continues the same utterance” instructions across cuts.
  An offscreen voice still gets a short attribution; onscreen returns do not
  reissue the speaking instruction.
- Packet-spanning dialogue uses the same named-speaker form as other dialogue.
  Removed artificial mid-sentence-pause instructions. Exact supplied words and
  actual interruption cues remain intact.
- Speech-time public expression remains available as acting direction. Default
  neutral/attentive expressions and repeated posture/condition lists are omitted
  from speech lines; actual public appearance changes remain in state beats.
- Simplified reading/typing boilerplate and removed “continues the same action”
  wording from direct prose. Quoted data remains opaque and unchanged.
- Native beats, source/media mapping, intervals, privacy, action authority and
  the legacy timed output are unchanged.

## Boundaries and next work

This is not evidence that generated audio repetition is solved. No paid video
comparison was run. Fragmented words can still cross transport windows; this
pass does not silently regroup them into another simulation-time interval.
Granular object outcomes still need a separate evidence-preserving presentation
pass, especially pickup start/completion/ownership descriptions.

A future director spirit could choose grounded framing and performance emphasis.
It should consume public committed events and return constrained presentation
choices, never invent dialogue, actions, emotions or completed outcomes. First
validate the deterministic compiler; no additional controller or model call was
introduced here.

## Evidence

- Targeted server/client/screenplay/shot-direction tests: 132 passed.
  `/tmp/argos-stage-directions-tests.log`
- First typecheck found a missing executionId in the newly added test fixture;
  fixed the fixture, retaining that failed log:
  `/tmp/argos-stage-directions-types.log`
- Final typecheck passed: `/tmp/argos-stage-directions-types-final.log`
- Broader demo/rendering regression: 722 tests passed across 73 suites.
  `/tmp/argos-stage-directions-regression.log`

Existing running servers retain their loaded compiler. Start a new episode/server
to use this change; no active session was interrupted or silently upgraded.

## Second cleanup

- Direct prose uses character names, with stable labels only to distinguish
  same-name characters. Internal speaker tokens and identity-sensitive camera
  cache keys remain intact.
- Wide/two-shot directions name their subjects once. Removed the redundant
  Location/Visible/cast-label list and repeated camera-axis instructions.
- Public expressions use short acting parentheticals on dialogue. Appearance
  changes use plain stage wording rather than ECS field separators.
- A successful completion with a matching action execution, actor, operation
  and ending time in the same performance is not another acting instruction.
  Both cues/evidence remain in the ledger. Unmatched completions, different
  executions/lifetimes and failed attempts remain explicit.

Offline reprojection of all 17 NOWCpn performance ledgers completed without
paid generation. Version 2 stage output:

```text
"George" walks through the room toward the connecting doorway.
"Elaine" says: "George, where is the black-and-white cookie I specifically asked you to save?"
Camera: Wide shot of "Jerry", "Elaine", "Kramer". In "Living Room".
"Elaine" walks through the room toward the connecting doorway.
```

Version 8 still contains two distinct tin-support snapshots (in Kitchen, then
at Kitchen counter). These were not silently merged: they represent different
recorded states, unlike the matched action/completion pair. Investigate source
snapshot atomicity before suppressing meaningful location transitions.

Validation logs (first failing assertion retained; it expected the old S2 label):
- `/tmp/argos-stage-cleanup-2-tests.log`
- `/tmp/argos-stage-cleanup-2-regression.log`
- `/tmp/argos-stage-cleanup-2-types.log`
- `/tmp/argos-stage-cleanup-2-final.log`
