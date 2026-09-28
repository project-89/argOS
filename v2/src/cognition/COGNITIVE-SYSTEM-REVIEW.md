# Cognitive loop integrity — 4 September 2026

Later implementation and live findings are recorded in
[working memory](WORKING-MEMORY-REVIEW.md) and
[working-memory/plan hardening](COGNITION-HARDENING-REVIEW.md).
The results and remaining-work list below describe this earlier pass.

This implementation follows the prompt review. The target is an inhabited world:
foreground decisions are responsive; planning, reflection and world maintenance
continue independently; thoughts and plans never substitute for physical truth.

## Mechanisms changed

| Boundary | Change |
| --- | --- |
| World event → perception → memory | One modality filter now runs before memory, busy-agent admission and structured perception. Emission time and intensity survive queueing. Direct visual inspection and public context obey the same sight boundary. |
| World capabilities → action menu | Public movement targets can come from the physical package. Storm House now uses the same adjacent-route source for its action menu and executor, instead of advertising every known room as a one-step move. Action-menu perception must be filtered as carefully as narrative context. |
| Perception → foreground decision | Successful quiet actions establish a 2/5/10/20/30-second bounded backoff. Relevant input, local observable changes and actionable plans wake it. Unchanged observations and private thought bookkeeping do not. |
| Foreground ↔ subconscious planning | A background social plan is discarded if the character has already spoken while it was being generated. Executing a committed plan's own speech does not invalidate its next listening step. |
| Intention → world proof | A generated intention can select an engine-published completion condition. The model cannot supply arbitrary predicate JSON or rewrite an authored objective. Duplicate active conditions and already-satisfied new work are rejected. |
| Supporting intention → parent objective | An explicit owned parent link includes its identity and contract. Completing, removing or changing that parent retires supporting work without claiming independent physical success. |
| Exploratory plan → outcome | An unverified exploration pauses after its attempted plan, or after a bounded inactive review window. It does not become a successful macro. Personal social satisfaction remains a distinct source-grounded subjective path. |
| Proven objective → remaining plans | Native proof retires unfinished plan instructions without advancing their cursors. Cleanup retains recent outcomes, uses the correct deadline clock, and protects live callbacks/resumable plans. |
| Rest → body state | Rest persists as an ECS activity. Energy recovers over simulated time; full recovery does not order the character to stand up. One recovery notice per episode avoids fatigue/recovery self-wake loops. |
| Idle fallback → deliberate autonomy | Random wandering is a no-AI fallback, not an override of a live character's decision to rest. |
| Saved ECS → resumed cognition | Plan, schedule, reflection and tool-evidence ownership/reference links are restored. Missing goal references fail closed. Private persona history stays private; new Big Five values use the consumers' 0–1 scale. |

Background goal generation now receives the same actor-specific package context
and recent goal outcomes as foreground cognition. The catalog describes possible
completion conditions, not secret current truth. Old memories are not a current
world snapshot. Explicit “no new goal” is a legitimate result rather than a duty
to manufacture new chores.

Implementation detail and remaining edge cases are recorded in
[pacing](REVIEW-IDLE.md), [perception](REVIEW-PERCEPTION.md), and
[state/persistence](REVIEW-STATE.md).

## Verification protocol

Offline tests cover native execution and the real scheduler, not only prompt
snapshots: held model requests with continuing physics, perception admission for
available/busy actors, interrupted work, native proof, goal retirement, no-op
planning, independent rest recovery and remapped save/restore evidence. Existing
no-AI, phone, generative-agent, sustained-cognition and engineering suites remain
part of the regression run.

The full regression run passed **127 suites / 1,126 tests**, with ten explicitly
opt-in live tests skipped. Subsequent action-menu/route hardening passed its
15-suite / 168-test focused regression run. Typecheck and whitespace checks pass.

The live test is the authored three-character Storm House challenge: stop a leak,
obtain locked supplies, dry a floor, and coordinate a separate panel holder with
a timed fuse installation. God/builders and H3 are disabled to isolate cognition.
This does not establish prompt-to-world generation or arbitrary-world correctness.

Reproduce the disruption variant:

```sh
npm run eval:agents:live -- --challenge --seconds=180 --perturb-at=120
```

The explicit operator edit moves the actual fuse into the Common Room at 120
seconds. It does not inject a corrective thought, reopen a goal by fiat, or
pretend the characters heard a remote change. The native world derives the new
lamp state; characters must notice and decide. Each run records `events.jsonl`,
`world.json`, `evaluation.json`, and `readiness.json`. Readiness samples are
diagnostics, not a narrative-quality score.

## Live findings

The preceding baseline `generative-agents-YRABVL` completed the first repair at
41 seconds, with 223 thoughts, 41 observation actions and 96 wait/rest actions in
179 seconds. The first integration run `generative-agents-9WXj7b` completed at
56.5 seconds with a real item handoff, 162 thoughts, 8 observations and 60
wait/rest actions. It was quieter but slower to repair, and still churned after
success. That run exposed the random-wander override, near-full-energy rest
self-wake, and missing background package context. Those mechanisms were then
fixed; the initial comparison is not a claim that all latency improved.

The disruption run `generative-agents-obBRAe` lasted 178.5 simulated seconds.
The first repair took **95.5 seconds**, slower than either preceding sample:
handoff confusion consumed time even though the ECS inventory stayed correct.
It recorded two actual transfers: Mara gave Sera the cloth at 23s, and Ivo gave
Mara the fuse at 41s. Later speech incorrectly lost track of that second transfer.

At 119.5s the explicit operator edit relocated the installed fuse. Physics made
the lamp dark at 120s and admitted that visible event to all three local actors.
Sera noticed and spoke about it at **121s**; Ivo picked up the real fuse at
124.5s. They isolated power, coordinated the panel again, installed the fuse and
restored light at **148s**. New generated lamp goals completed through native
world proof. No corrective thought, H3 call or scripted NPC action was injected.

That run produced 169 thoughts (19 lexical-repeat candidates), 53 spoken turns
and nine failed actions. Actor decision p95 was **2.07–3.44 seconds**. One
information-recheck-after-hearing candidate remains. These are individual run
observations, not a controlled performance benchmark; the disruption variant is
not directly comparable with an undisturbed baseline.

Readiness samples reached only one or two quiet decisions before new inputs in
this busy run. The 30-second quiet cadence is established by scheduler/executor
regressions, **not** by claiming this scene achieved sustained idle behavior.
Foreground responsiveness was demonstrated; natural long-horizon cognition was
not certified. Late no-op retry and action-menu projection hardening are covered
by offline tests, not by an additional paid run.

## Remaining work, deliberately not papered over

- Goal dependencies are explicit. Semantic obsolescence of arbitrary generated
  prose is not solved. Paused explorations need new evidence/a concrete intention;
  they are not magically successful or guaranteed to resume appropriately.
- Memory needs stronger storage-level separation of observation, reported claim,
  inference and independent corroboration. Repeated semantic derivation can still
  inflate confidence; older research-cache paths can miss contradictory evidence.
- Concurrent choices can race for the same physical object. Execution fails closed,
  but avoiding every awkward duplicate intention requires stronger action/plan
  reconciliation, not descriptions that pretend the race never happened.
- A completed handoff must update a compact, actor-owned working account of
  possessions and commitments. The live fuse confusion is a specific regression
  target: own action receipts and observed transfers should outweigh an older
  “I picked it up” recollection without granting knowledge of hidden remote edits.
- Speech is still instantaneous text. Natural spoken timing, turn-taking and
  believable long-horizon conversation need further evaluation.
- Generic need ecology still includes room-name heuristics. Real rest is now
  grounded, but food consumption and all other needs are not uniformly grounded.
- ECS saves are not full process checkpoints: package callbacks, external jobs,
  arbitrary dynamic references and some legacy stores need rehydration contracts.
  Static SoA storage also limits simultaneous independent worlds in one process.
- Generic worlds retain an authored room-name catalog unless a package supplies
  movement targets. A full discovery/known-map model is not implemented here.
- Legacy 0–100 personality saves are not silently migrated to 0–1, and world
  clock ownership still needs consolidation. New recovery uses explicit tick delta.
- H3 timing/fidelity, automatic world building, and daemon/spirit story quality
  were not live-tested here. These changes strengthen their substrate; they do
  not certify the whole open-ended generative system.
