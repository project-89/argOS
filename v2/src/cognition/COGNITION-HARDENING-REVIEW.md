# Working-memory and plan hardening — 4 September 2026

The subsequent generalized coordination layer is documented in
[coordination memory](COORDINATION-REVIEW.md). Results below describe this earlier pass.

This pass follows [working memory](WORKING-MEMORY-REVIEW.md) and
[cognitive loop integrity](COGNITIVE-SYSTEM-REVIEW.md). It targets repeated
inspections, stale plans and repeated conversation through shared Argos
cognition. No H3 rendering, UI changes or world-generation run is involved.

## Mechanisms, not extra admonitions

- A completed visual inspection records an actor-owned answer: visible contents,
  visibly empty, or contents not observable. Closed does not mean empty. Inspection
  records have stable entity identity, provenance and a specific question. They
  do not scan other characters' pockets, hidden objects, nested closed containers
  or unread message entities. Bare inspect/examine/observe aliases share one
  question; substantive questions remain distinct.
- Reading this memory performs no world scan and never expires a belief by fiat.
  Actual perception invalidates an old answer when a previously checked visible
  surface changes. Unseen remote edits remain unknown. Deferred inspection
  receipts require matching issued work and the original actor/target identities;
  replayed callbacks and same-name replacements cannot mint a fresh inspection.
- A plan can recognize that its actor is already in the destination room or has
  a current answer to its inspection. These are covered steps, not freshly
  executed actions. They cannot forge LastAction, physical goal completion or a
  learned behavior-tree demonstration. A wholly redundant proposal waits for
  evidence rather than repeatedly replanning. A new question, relevant heard
  statement, actual visible change or a 60-second reinspection allowance can
  justify another look. That allowance is a planning policy, not memory expiry.
- Reconciliation happens after foreground sensing. Background plan admission
  cannot silently consume stale inspection evidence before the actor sees a
  changed surface. Read-only readiness checks do not advance plan cursors.
- Settled social desires retain bounded, actor-owned closure evidence after goal
  cleanup and checkpoint restore. Foreground cognition, background planning and
  new-goal generation see that same compact account. Actual dialogue precedes old
  thoughts; exact perception echoes do not repeat the same speech text again.
- Newly heard relevant dialogue invalidates dependent pending social/quiet
  decisions, not unrelated physical work. Separately, an already-admitted spoken
  plan step is invalidated by intervening independent speech from its actor.
  Matched planned speech advances its own boundary, preserving ask → listen and
  successive planned utterances. Physical steps cannot clear a stale speech
  boundary. This closes a live foreground/background replay race.
- Completion choices no longer borrow alternative states from an incompatible
  prefab state machine. A lamp whose actual system uses dark/lit must not acquire
  an impossible goal to become the generic prefab's normal. Explicit engine
  outcomes and compatible native state machines remain available. Expiration
  retires runnable plans without declaring the objective successful.
- The testbed cupboard is now an explicit Container. Normal physical transfers
  refresh Container/Surface count caches as well as actor inventories; LocatedIn
  remains authoritative. This is not a guarantee that arbitrary raw ECS edits
  maintain every derived cache automatically.

## Live protocol and evidence

Each run uses live configured `gemini-3.8-flash` cognition and the same authored
three-character Storm House challenge: stop a leak, unlock supplies, dry the
floor, coordinate a separate panel holder and a timed fuse installation. At
120 wall seconds the operator relocates the actual fuse to the Common Room.
Physics extinguishes the lamp; agents must perceive and respond without an
injected corrective thought. Runs are sequential and independently sampled.
God/builders, genesis and H3 are disabled to isolate cognition.

```sh
npm run eval:agents:live -- --challenge --seconds=180 --perturb-at=120
```

| Run | Simulated duration | First lamp lit | Recovery after observed darkness | Physical actions | Failed actions | Thoughts / speech |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Earlier working-memory baseline `WvTkem` | 177.5s | 46.5s | 38.5s | See earlier report | 0 | 171 / 51 |
| Initial hardening `9I2vKT` | 179s | 44s | 20s | 42 | 1 | 173 / 65 |
| Same build `kK2450` | 178.5s | 46s | 25.5s | 49 | 0 | 173 / 63 |
| After live-discovered fixes `f26PQ3` | 178s | 44s | 24s | 40 | 2 | 167 / 71 |

These are individual stochastic observations, not controlled evidence that every
latency improved. Successful physical counts exclude wait/rest and observation;
they can still include revisits rather than novel progress. Exact event times
come from `recordings/generative-agents-<run>/events.jsonl` and `result.json`.

The first two runs both completed the repairs, but were **not** socially golden.
In `9I2vKT`, Mara's fast cognition asked about Sera's background at 62s; an
already-stored plan asked again at 63s. Sera answered at 66.5s, then her stored
plan repeated the answer at 67.5s. `kK2450` reproduced the same race at
99.5/100.5s and 103/104s. These traces drove the subsequent own-speech boundary
regressions and fix; they must not be presented as validation of that later fix.

`9I2vKT` also exposed inspection alias duplication (lamp examined at 151s, then
observed with content "examine" at 154s) and impossible "normal" goals for the
relay/lamp. Both now have targeted regressions. Its one failed action was Sera
trying to hold a panel Ivo was already holding; the executor rejected it and she
recognized Ivo's role in her next thought. `kK2450` had no actual item handoff:
the characters completed the repair through a different division of labor.
Do not describe every testbed gate as passed in that run.

There is a concrete belief-versus-world result in `kK2450`: Ivo claimed the
cupboard contained oats, beans and broth at 160.5s. Sera and Mara actually
inspected it at 169.5/170s and found it empty. Mara explicitly corrected the
claim at 172s. No fictional food became ECS state. Sera's later suggestion to
ask where Ivo "moved" the food was still an unsupported causal inference;
the engine did not promote it to physical evidence.

The final trial `f26PQ3` ran with the own-speech race, inspection alias,
foreground sensing-order, expiration and completion-catalog fixes. Its first
repair committed at 42.5s. After darkness at 119.5s, repair committed at 142.5s
and the lamp relit at 143.5s. Actor decision p95 was Mara 2,272ms, Ivo 2,850ms,
Sera 2,965ms. No actual give/handoff occurred in this trial either; the actors
coordinated through separate physical jobs. The two failed actions were Mara
trying `interact take` on the raincoat at 122s and 153s. She then selected the
supported pickup action. The failed affordance never moved the coat.

Physical and goal integrity are stronger; conversational naturalness is **not
yet established**. Final speech increased to 71 turns, with extensive
tea/teamwork appreciation despite remembered closures. The estimated speech
load was 3.249× ordinary 150-word/minute speech. Low lexical-repeat flags do not
override that trace. No impossible normal lamp/relay objective remained active
at the end, but new breakfast and hunger intentions still lacked a real food
capability in the static fixture.

The identified foreground → stored-plan speech replay did **not** recur in
`f26PQ3`: all 71 utterances were checked against runtime provenance. Seventy
came from fresh foreground decisions; the one stored-plan question (Mara at
174.5s) had no preceding duplicate. That is evidence for the specific race fix,
not a general no-repetition claim.

A stronger next target is shared commitment follow-through. At 78.5s Mara
recognizes that the promised mugs/sideboard are not actually modeled, then waits
without telling her housemates. They continue assuming tea preparation is under
way. Eight social closures do not resolve this mismatch. The next layer should
retain who undertook which work, whether it actually started, and what blocked
it—without turning a verbal promise into an executed action or shared knowledge
until the relevant outcome is communicated/perceived. Unmet physical capability
could then reach world maintenance through a real request, not invented props.

Two small final audit safeguards were verified offline after that trial, not
through another paid live run: a deferred callback cannot relabel the original
inspection question, and episode-specific memory/speech markers must not change
the signature of an otherwise identical learned procedure.

## Offline verification

Final full suite: **139 suites / 1,285 tests passed**, with ten opt-in live tests
skipped. Typecheck (`npx tsc --noEmit`) and whitespace checks pass. This final
suite includes the two post-live safeguards described above.

Regressions exercise real native/deferred execution, actual perception admission,
held background planning requests, remapped checkpoints and procedural learning.
They cover closed versus empty containers, hidden changes, replayed callbacks,
replacement identities, distinct questions, plan coverage without forged action
proof, fresh sensing before reconciliation, social closure persistence, arriving
answers, admitted-plan speech races, incompatible state catalogs and expiration.
No provider calls occur in those regressions; the ten existing opt-in live tests
remain separate from the explicitly recorded live trials above.

## Boundaries

- Closure context is not a semantic ban on a conversation topic. New generated
  goals can still revisit substantially the same subject with different wording.
  An absent repeat flag in the lexical evaluator does not establish naturalness:
  that evaluator missed obvious adjacent paraphrases in these traces.
- Speech is instantaneous text. The two initial runs request more than three
  times ordinary speaking capacity at 150 words/minute. Audio turn-taking and
  conversational pacing are not solved by memory storage.
- This small, static fixture has no real dinner ingredients or kitchen activity.
  Characters can want or talk about dinner, but cannot create provisions through
  dialogue. God/builders must eventually handle unmet capabilities through real
  world changes; that integration was deliberately outside these live trials.
- Inspection answers describe accessible physical evidence, not semantic answers
  to every arbitrary question. Knowledge is bounded and name ambiguity fails
  closed. Legacy perception and persistence limitations in the earlier review
  still apply outside the specifically tested boundaries.
- A checkpoint is ECS state, not a resumable external-job/testbed process.
  Previously saved incompatible completion contracts are not silently rewritten.
  Deterministic regression success and a few short live runs do not certify
  arbitrary worlds, long-horizon behavior, prompt-to-simulation or H3 fidelity.
