# Coordination memory — 4 September 2026

This follows [working-memory hardening](COGNITION-HARDENING-REVIEW.md).
The target is general: a character undertakes work, encounters a change, and
must decide whether to continue, ask for help, renegotiate or report back.
There are no tea, cupboard, repair or character-name rules in the mechanism.

## Separate accounts, shared cognitive context

An actor-owned ECS component retains three different things:

1. The character's interpretation of an undertaking in their actual prior speech.
2. Their private work account, grounded in owned execution, observations and goals.
3. What they last actually told others, as an attributed report rather than truth.

A material difference between private and reported state is a communication
gap. It is context for a choice, not a mandatory line of dialogue. Progress on
ordinary work does not demand a running commentary. No claim creates objects,
changes physical components or completes a physical objective.

Foreground cognition, background planning, new intentions and reflection consume
the same bounded account. Reviews are optional structured output of the existing
foreground decision; there is no extra inference job for each utterance. Reviews
cite retained speech or physical receipts. Proposed speech is not yet evidence.
New intentions can be linked by their actual created goal ID, not a guessed ID.

## Execution and knowledge boundaries

- Progress comes from an actual executed step with a matched plan or an explicit,
  validated foreground intention link. An unrelated action cannot borrow the
  current highest-priority goal. Native and deferred package
  execution, including asynchronous office tool jobs, share the same admission.
- Issuance captures the concrete goal UUID and contract, existing undertaking IDs
  and actor-local sequence. Pending work is not success. Later promises, same-time
  replacement goals, duplicate callbacks and newer unrelated priorities cannot
  steal old work.
- Blocker reviews cite owned receipts present when the decision started. Their
  stable subject dependencies must still match at admission; a fresh perceived
  correction invalidates a stale review even when its prose omits the object name.
  Unrelated physical changes do not. A private blocker is not automatically
  shared with another character. Speech interpretation is still fallible; source
  validation does not prove the model understood a promise correctly.
- Listeners retain the actual heard undertaking text, never the speaker's private
  semantic task summary. A private interpretation of vague public speech must not
  become an accidental channel for secrets.
- Only an engine-completed goal plus an actor-known native condition can verify
  completion. A spoken completion report is a claim. Remote physical conditions
  require the actor's own evidence, not a fresh hidden ECS scan.
- Goal disappearance or retirement ends its tracked work episode without declaring
  success. Replanning can explicitly link an active undertaking to a new intention.
- Readers are pure. UUID ownership and bounded records survive ECS ID remapping.
  This persists the ledger, not live external jobs or a whole process checkpoint.
- Relevant coordination changes invalidate stale dependent decisions/plans;
  unrelated physical work and the expected progress of a plan's own step survive.
  A real ledger revision wakes idle cognition without duplicate-review churn.

God's existing monitoring summary and the assigned character daemon can inspect
the private account. This is advisory: a claimed blocker is not itself evidence
that a missing capability must be generated. No new automatic engineering request
or world mutation is triggered.

## Verification

Integration regressions exercise fuel retrieval, bandage retrieval and asynchronous
tool work through real executors. They cover unrelated actions, actual handoffs,
private discovery, audible reports, pending/failing/replayed callbacks, later
undertakings, genuine goal completion and remapped save/restore.

Final verification: **144 suites / 1,369 tests passed**, with ten existing opt-in
live tests skipped; typecheck and whitespace checks pass. This pass adds 84
regressions: 23 core ledger, 30 cognitive consumers, 21 actual-execution continuity,
7 persistence, 1 supervisory projection and 2 asynchronous office outcomes.

Revision-only scheduler readers use a constant-time owner-guarded accessor rather
than parsing the full ledger. Records remain capped at 24 undertakings, four
evidence receipts per undertaking and three reviews per model decision.

The testbed records `coordination.jsonl` as an operator-only revision trace alongside
physical events and actor-specific final records. Live runs remain authored Storm
House challenges with God/builders and H3 disabled; they do not establish arbitrary
world generation or long-horizon social quality.

## Deliberate limits

- Retrospective interpretation happens at the next ordinary model decision. A
  deterministic behavior sequence can delay it; not every spoken undertaking will
  be captured. No phrase-based promise detector or forced model call papers over it.
- Free-form physical decisions without a matched plan or explicit intention link
  do not acquire goal progress by priority guessing. An unlinked undertaking can
  remain without verified work even when its actor has made a plausible completion
  report. The new explicit link attributes coordination work; it does not replace
  every legacy goal-learning attribution path.
- Semantic matching between an undertaking and a chosen goal is model judgment.
  Stable identity prevents accidental reassignment; it does not prove semantic fit.
- Unsupported physical completion conditions remain unverified. Social satisfaction
  follows its separate subjective evidence path.
- This does not implement realistic speech duration, perfect turn-taking or a
  guarantee that fresh model decisions will never repeat themselves.

## First live trial and the integration gap it exposed

`recordings/generative-agents-BcvaxL` ran 178.5 simulated seconds with the configured
`gemini-3.8-flash` model. The lamp first lit at 48s. After the actual fuse was moved
at 120 wall seconds, darkness was perceived at 120.5s and the lamp relit at 148s.
There were two actual key transfers, 38 successful physical actions and two failed
actions; all three characters contributed. Decision p95 was Mara 3,017ms,
Ivo 2,807ms and Sera 3,898ms. These are observations, not a controlled speedup.

The model registered two undertakings: Ivo closing the valve, and Mara slicing
bread. Mara eventually marked the bread work blocked using her own retained
evidence, after challenging invented food/cooking fixtures in public. That does
not establish that the ledger caused the correction: her public challenge preceded
the blocker review. Ivo reported the valve closed, but his foreground action was
not linked to the existing plan, leaving the private work account unverified.
This trace motivated the explicit action-to-intention execution link.

The characters still invented breakfast supplies, made 67 spoken turns and
produced about 3.28 times normal 150-word/minute vocalization load. A low lexical
repeat score does not make that natural. The ledger is a coordination substrate,
not proof that the current model reliably captures every promise or chooses good
next actions. No bread, stove or kitchen was materialized from those claims.

This first trace predates the final listener-projection, held-receipt dependency
and explicit foreground intention-link fixes. It must not be presented as a live
validation of those later changes.

## Final live trial

`recordings/generative-agents-i4JRWt` used the final runtime implementation for
178.5 simulated seconds. First lamp-on was 42s; after the same operator disruption
at 120 wall seconds it relit at 166s. There were 45 successful physical actions,
zero failed actions and one actual fuse handoff. All three characters thought,
spoke and contributed. Decision p95 was Mara 4,797ms, Ivo 2,729ms and Sera 2,821ms.
This was quieter (47 spoken turns versus 67 in the first sample) but recovery was
slower. The 2.4-times ordinary vocalization load and 25 lexical thought-repeat
candidates do not justify a naturalness or latency win. Schedule activity also
differed: dinner goals completed at 2.5s, so aggregate post-first-goal metrics
cannot be compared as though that boundary were the first lamp repair.

Four undertakings were retained. Actual work advanced Mara's relay and Sera's
floor accounts; later spoken completion reports were retained separately. The
run also retained Ivo's morning coffee/rounds and Sera's pantry/inventory promises.
There was no blocker or verified-completion transition in this sample. This is
evidence of live uptake of causal progress tracking, not comprehensive semantic
review coverage or proof that it prevents invented chores.

Two important limits remain visible:

- The authored shared repair contract tests the private boolean
  `Lighting relay.TestbedCircuit.lit`. Physical working memory observes the lamp's
  public state, not arbitrary circuit fields. The ledger correctly refuses to
  equate those without evidence, then releases the link when its original goal is
  cleaned up. That conservative result can still confuse the character after a
  successful repair. General outcome provenance / observable goal contracts need
  to bridge this explicitly; silently reading hidden fields is not the remedy.
- Sera inspected the store room for her pantry promise and later proposed another
  inspection. Morning rounds and coffee involved unmodeled supplies/places. Better
  semantic undertaking capture, feasibility review and lifecycle reconciliation
  remain necessary. This layer does not certify cognition as “golden.”

Neither live run rendered video, generated a new world, ran God/builders or
injected a corrective thought. Each used the real executor and an explicitly
recorded operator relocation of the existing fuse.

## Outcome lifecycle correction — 5 September 2026

The earlier cleanup behavior above was a real cognition bug: losing a Goal ECS
entity was being translated into `released`, even though the character had not
withdrawn the undertaking. Goal tracking now ends independently of the private
work status. A blocker keeps its evidence, a promise stays outstanding, and the
character can link a new intention. Only an explicit release review means
withdrawal. Tracking loss alone is not a communication gap or a fabricated report.

Before cleanup removes a completed linked goal, each owner can retain a bounded
native completion condition and a private evidence gate. The engine verdict is
not presented as character knowledge. A later personally observed condition can
verify the retained outcome even after Goal deletion and save/restore. Conditions
that require unsupported hidden fields remain unverified; an arbitrary hidden
boolean is never mapped to a visible object label. This does not establish that a
model-selected broad goal is semantically equivalent to a narrower undertaking.

The evidence gate fences the actor's existing evidence clock. Old matching facts,
including fractionally ordered facts from the same wall millisecond, cannot
certify a later outcome. A current-perception snapshot from the existing sensing
pass supplies fresh local evidence without serializing redundant observations.
It is immutable, actor/world scoped, single-use, timestamp-preserving and expires
after the synchronous pass. This avoids the previous thirty-second unchanged-
observation refresh delay: a continuously visible condition can be verified on
the next ordinary perception frame. It adds no inference request.

Twenty new offline regressions cover actual evaluator/cleanup integration,
private evidence and listener boundaries, delayed personal verification, same-time
state cycles, current-perception refresh without memory churn, old/foreign/forged
tokens, conflicting newer/equal-time receipts, relinking, explicit release versus
retirement, dependency isolation, bounded conditions and remapped persistence.
Room placement also requires the personally observed destination's room kind and
stable identity: a person or container sharing a room's name cannot counterfeit
placement. Old untyped location evidence stays unverified rather than being
filled in by a remote world scan. Nested containment is not newly inferred.
The focused run passed 149 tests across nine suites; typecheck and whitespace checks passed. These results are
structural verification, not a new live naturalness claim.

## Undertaking attribution correction — 5 September 2026

The second escape-room trial exposed a separate attribution bug. Sera actually
routed power at 85s, but an unrelated keypad failure at 90s marked that router
undertaking blocked. Both actions supported the same broad escape goal. Sharing
that goal did not make them the same piece of promised work.

Actions now name one actor-owned undertaking explicitly, independently of their
planning goal. The captured work reference includes its owner, original committed
speech identity and a durable generation. Only that undertaking receives the
actual terminal result. No goal-priority or goal-membership fan-out remains.
Ordinary progress preserves the generation; changing the linked goal, its
relationship or the completion declaration rotates it, so relinking away and
back cannot revive an old callback. Generations and replay ordering survive
save/restore. A supporting goal's deletion does not invalidate otherwise real,
explicitly attributed work or make the character withdraw it.

Goal relationships are now explicit: `supports` is the default, including for
legacy untyped links. Completing a broad supporting goal never completes a
narrower promise. An explicit `fulfills` link retains the native goal-verdict and
personally known condition path described above. This relation is still a
semantic declaration: the runtime does not infer equivalence from task wording.

Simple promises can instead declare a future terminal-action criterion:

```json
{"type":"action","actionType":"interact","target":"Valve","content":"open"}
```

The target must resolve uniquely from the actor's already admitted physical
evidence. It may be remote and not yet actionable: declaring an objective does
not grant present execution authority. The stored criterion binds its stable
entity identity. Completion requires a later explicitly attributed successful
terminal action, the matching known identity and the executor's actual target
identity, plus identical action type and command content. Missing identity,
pending work, success on a same-named replacement or different arguments cannot
certify completion. Command strings, JSON and paths are not case-folded or
whitespace-normalized. Giving currently records progress only: recipient identity
plus an item label is insufficient to prove both entities of a transfer.

An action criterion cannot retroactively claim earlier success. Declaring or
changing it rotates the work generation; an actual subsequent execution must
meet it. Private criteria, generation, native outcome gates and physical evidence
do not cross to listeners. Other characters still know only the speech they
actually heard, and a private verified result still requires a real spoken report.

Dependencies now select supporting undertakings explicitly rather than dragging
every sibling promise into a broad goal's physical plan. A fulfilling goal may
still supply a direct dependency. Open-to-in-progress updates do not invalidate
the next ordinary step; changed declarations, blockers and completion do.

The focused core run passed 67 tests across three suites, including 24 new
attribution regressions. Existing actor-private native outcome tests remain
positive through explicit `fulfills` links. Typecheck passed. These are offline
structural checks; subsequent live trials must separately establish whether the
model reliably registers promises, declares appropriate completion criteria and
chooses the correct undertaking for each action. This correction does not by
itself certify natural conversation, planning quality or comprehensive uptake.
