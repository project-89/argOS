# Continuity and progression goal

Status: complete (scoped five-stage implementation and validation). Requested
2026-09-06. Stages executed in order, with gates before each next stage. H3 stayed
off and the user's demo server was not restarted. Naturalness is not declared
golden; remaining behavioral and legacy activity-contract limits are documented.

## Invariants

The ECS owns physical truth. NPCs own their choices. Heard words, private messages,
beliefs, interpretations and physical completion remain distinct. Keep continuous
perception; reducing repetitive decisions must not make actors deaf or delay
meaningful interruptions. No compulsory replies, emotional closure, topic quotas,
scripted departures or lexical filtering of inner thoughts. Preserve existing
user edits and all trial artifacts.

## Ordered implementation

1. [x] Continuing listening: explicit typed activity, source/actor-bound to
   actually heard execution; ordinary progress is evidence intake, not another
   decision. Preserve turn completion, interruptions, sensory changes and real
   inspection. Regression-test native integration, then a no-H3 live trial.
2. [x] Optional expressed thought: controller housekeeping need not create inner
   monologue. Retain authored emotional rumination, interpretation and intention
   changes. Verify omitted thought does not prevent actions or publish synthetic
   replacement text; compare real behavior without hiding events.
3. [x] Durable conversation continuity: preserve actor-owned engagement/review
   evidence across individual actions and transient goal selection, and support
   evidenced pause/closure without forcing novelty. Test retention, privacy,
   episode replacement and actual outcome review; run no-H3 behavior trials.
4. [x] Adaptive narrative direction: reconcile pending beats with current
   authoritative/public evidence, retire contradicted premises and propose
   grounded alternatives. Never force actor behavior or turn an advisory plan
   into lived history. Test changed circumstances, stale asynchronous results,
   identity and private/public boundaries; run maintenance with no H3.
5. [x] Executable world alternatives: a small connected set of destinations and
   functioning activities, shared route admission at offer/dispatch/completion,
   preserving legacy world semantics explicitly. Verify obstacles, changes in
   transit and unavailable routes; run an extended no-H3 progression trial.

## Final gates

- [x] Full deterministic suite, TypeScript, targeted regression checks.
- [x] Artifact-backed comparison with the prior final trials (y9M2Vq/gCnpOP),
  distinguishing model latency, repeated decisions, actual completed actions,
  voluntary quiet/deferral and missing capabilities. No statistical claim from
  a handful of stochastic trials.
- [x] Document residual limitations and provider-specific uncertainty. Actual
  H3 synchronization remains a separate controlled provider-contract test.

## Evidence log

Initial baseline: prior repair completed with 245 suites / 3056 tests passing,
10 skipped. The breakup baseline gCnpOP made76 foreground admissions (44 new
stimulus,21 first decision,7 actionable plan,4 state changed),67 foreground
thoughts and14 completed spoken turns. These counts do not classify all thoughts
as redundant. The same-speech listening interruption and repeated short observe
actions are concrete regressions; activity review reset and stale director
pre-date planning are separate later stages.

### Stage 1 — continuing listening (validated)

Implemented explicit `wait.listeningTo`, a bounded current-heard execution
catalog, exact source/owner/payload hearing receipts, and continuous non-decision
intake in both actor and batch control paths. Sentence/end/new-event boundaries
remain interruptible. Explicit listening is capped at 30 simulated seconds;
ordinary unbound wait and real inspection retain their separate semantics.

An initial regression exposed the new identity fence discarding an ordinary
legacy quiet wait during lazy identity allocation. The strict owner/source fence
now applies to the new explicit listening activity, whose actually heard receipt
already establishes identity; legacy quiet waits retain their existing semantics.
Existing speech-flush assertions now check the new typed receipt as well as the
exact words; no assertion of word retention or interruption was removed.

Deterministic gates passed: implementation union 6 suites / 191 tests
(`/tmp/argos-listening-stage1-final.log`); root integration union 6 suites / 92
tests (`/tmp/argos-continuity-stage1-final-union.log`); additional speech/sensory/
asynchronous-boundary union 8 suites / 90 tests
(`/tmp/argos-continuity-stage1-boundaries.log`). These overlapping unions are not
additive. Typecheck passed (`/tmp/argos-listening-stage1-typecheck.log`).
Independent read-only review found no remaining concrete stage-1 safety gap.

The 117s-before-118.96s regression uses real native speech/listening dispatch
and both production intake paths: exact heard evidence remains, no model call is
made for ordinary progress, and actual ending wakes the listener. Coverage also
includes sentence boundaries, departures, new voices/attention, critical need,
physical change, forged/stale receipts, rewind, cancellation and the 30s cap.

The focused no-H3 logistics trial `sitcom-logistics-boyfriend-dt1mOW` completed
120 simulated seconds without reported runtime/projection error. Both messages
were read (15.7s, 33.2s) and answered (19.475s, 45.69s). It produced 72 foreground
admissions, 66 reasoning thoughts and 13 completed spoken turns. This is not an
overall repetition improvement over the baseline. Three actual typed listening
selections occurred, but several other requests placed the ID in `content` or
`target` rather than `action.listeningTo`.

The action documentation now gives an exact JSON example using an actually
offered execution. No prose-to-command guessing was added. Two suites / 106
tests and typecheck passed after that correction
(`/tmp/argos-listening-example-tests.log`,
`/tmp/argos-listening-example-typecheck.log`). The 60s focused no-H3 retry
`sitcom-logistics-boyfriend-pMfdZL` completed without reported runtime/projection
error. Jerry made two correctly typed listens (29.5s, 57.5s); no completed wait
misplaced its listening ID in target/content. Both messages were read (11.7s,
35.2s) and answered (16.995s, 43.8s). There were 33 admissions, 29 reasoning
thoughts and six completed turns. The different trial duration and stochastic
behavior do not establish an aggregate quality/speed improvement. Stage 1's
mechanism and live action interface are validated; repetitive authored thoughts
and prolonged banter remain for the ordered subsequent stages.

### Stage 2 — optional expressed thought (validated)

Begin only after the above stage-1 gates. Remove the compulsory thought-shaped
example from the ordinary action response; preserve actual authored inner life,
all decisions/perceptions, and the last genuine thought in the audience state.
No lexical filtering or synthetic replacement thought.

Core producer gates passed: 4 suites / 144 tests and typecheck
(`/tmp/argos-optional-thought-tests.log`,
`/tmp/argos-optional-thought-typecheck.log`). Root publication/duet integration
gate passed 5 suites / 46 tests and typecheck
(`/tmp/argos-continuity-stage2-publication.log`,
`/tmp/argos-continuity-stage2-typecheck.log`). Tests retain exact prior thought
timestamps/sequences through actual movement and pickup, check empty initial
view without synthetic monologue, preserve deliberately repeated thoughts and
verify that private thoughts do not enter public scenes or peer perception.

Core-only no-H3 breakup trial `sitcom-breakup-boyfriend-JkivzO` ran 120s with no
reported runtime/projection error: 85 admissions, 73 integrated decisions, 11
foreground reasoning thoughts (Elaine 8, Jerry 3), 15 completed spoken turns.
Elaine read the first message at 16.7s, reacted privately at 18.5s and disclosed
the breakup at 23.3s. This establishes actual optional expression, not fewer
controller calls or a statistical comparison with differently configured runs.

The second notification was deliberately deferred at 33.5s until 48.5s, but
remained unread at the end. The retained reason/considered timestamp stayed
unchanged while its reconsideration deadline advanced at 50s, 81s and 112s to
80s, 111s and 142s. Treat this as presented-again versus newly-chosen deferral
evidence to inspect with conversation progression, not proof of repeated
deliberate refusal. Dialogue became a prolonged courtroom metaphor. Overall
behavioral progression is not solved by optional thought publication.

Stage 2's final gate additionally covers legacy adapter repairs: the development
server previously replayed old thoughts with fresh timestamps, and LIL could
coerce private thought into public speech. A turn-local owned publication cursor
now emits only newly admitted reasoning/appraisal with its original timestamp,
without replaying prior thought or restarting stopped sources. LIL retains new
thought as private diagnostic data, strips it from narrator responses, and only
describes a spoken response from a new actual completed own dialogue receipt;
pending/rejected scripts are not speech or interaction-learning evidence. The
development server reports goal completion as an action, not an invented thought.

The four-suite root union passed 30 tests
(`/tmp/argos-continuity-stage2-final-union.log`), including mocked-model producer,
native LIL executor, publication helper, and actual duet view boundaries.
Adapter-owned union passed 3 suites / 32 tests (overlapping), with typecheck
(`/tmp/argos-thought-adapters.log`, `/tmp/argos-thought-adapters-typecheck.log`).
Full deterministic gate passed 251 suites / 3114 tests, 10 skipped, in 138.904s
(`/tmp/argos-continuity-stage2-full-suite.log`); final typecheck and diff check
passed (`/tmp/argos-continuity-stage2-final-typecheck.log`). Stage 2 is complete.

### Stage 3 — durable conversation continuity (validated)

Preserve the actor's experienced conversational contributions and outcome
review across transient action/goal changes. Inspect the JkivzO notification
deadline evidence above while doing so: showing a pending matter again must not
be described as a fresh deliberate deferral. Keep genuine continued company,
private grief, refusal and disagreement valid; no imposed topic/speech quota.

The attention cause is confirmed: `markAttentionSignalsPresented` advanced
`reconsiderAtSimMs` without a new review. It now records engine reminder backoff
separately (`nextPresentationAtSimMs`) and preserves the explicit review's
deadline/reason. Incidental prompt inclusions cannot indefinitely slide reminder
eligibility. Actual new review can choose a shorter delay; no read/reply is
forced. Optional `reviewRevision`, immutable prepared values and single-use
commit protect concurrent/same-tick updates. Existing private signalsJson
handles persistence without a new component or schema field. Initial 5-suite
attention/foreground/duet union passed 79 tests and typecheck; final rerun waits
the in-progress conversation-module changes so it tests a coherent source tree.

The coherent-source root rerun passed 5 suites / 80 tests
(`/tmp/argos-continuity-stage3-attention-final.log`). Conversation implementation
gates passed 5 suites / 162 tests and typecheck
(`/tmp/argos-activity-stage3-final.log`, `/tmp/argos-activity-stage3-typecheck.log`);
independent read-only review passed 3 suites / 65 tests
(`/tmp/argos-stage3-independent-review-tests.log`). These unions overlap.
Final root typecheck passed (`/tmp/argos-continuity-stage3-final-typecheck.log`).

The core-only 120s no-H3 breakup gate `sitcom-breakup-boyfriend-qguqXW`
completed with no reported runtime/system/projection error. Elaine read both
texts (15.2s, 54.7s), disclosed the breakup at 35.68s, and sent two actual replies
(delivered 76.785s and 94.04s). The second cue's explicit 30.5s deferral to 45.5s
remained unchanged through later presentations; the 52s engine reminder set its
separate backoff to 82s. Elaine explicitly reconsidered at 53.5s before reading.

There were 70 foreground admissions, 54 integrated decisions, 11 reasoning
thoughts and 12 completed spoken turns. Elaine's measured median/p95 decision
latency was 1720/4722ms; Jerry's was 1405/3168ms. This is behavioral evidence,
not a statistical speed improvement. Conversation review committed five times;
the same actor-owned encounter retained previous expectations across goal/action
changes. Subsequent reviews supplied `previousOutcome` and advanced the expected
exchange from learning the wording, through discussing the logistics, to her
chosen face-to-face demand. All chose continued engagement in this run; actual
pause/closure is regression-tested, not demonstrated by this trace.

Banter and repeated agreement remain, and two replies overlap in meaning.
The trial demonstrates an intact read/reconsider/disclose/reply chain without
forcing it, not a finished naturalistic simulation. The next stages address
stale external direction and the lack of grounded alternatives. Runtime review
cursors/expectations remain intentionally ephemeral across restore; durable
SocialMemory dialogue, contribution purposes and private closures persist.

### Stage 4 — adaptive narrative direction (validated)

Begin after the stage-3 gates above. Pending story beats must follow actual
publicly available changes rather than repeatedly steering toward an obsolete
setup. Advisory narrative interpretation must not invent actor knowledge,
actions, agreement or completed history.

Inspection confirmed the director's old prompt only asked how to advance the
next pending beat. It also read private goals/speculative hidden motivations,
accepted unchecked trigger assertions, and could broadcast model-authored
events. Reconciliation will be restricted to future advisory plans and issued
evidence. Separately, the daemon-less nudge fallback could create goals or
episodic memories directly; all nudge kinds now remain optional intentions,
with exact unambiguous recipients and a world-local registry. Initial root
nudge/advisory union passed 2 suites / 15 tests
(`/tmp/argos-continuity-stage4-nudge.log`); queue lifetime/native delivery
hardening and director integration are still in progress.

Scoped nudge delivery gates passed 5 suites / 93 tests and typecheck
(`/tmp/argos-scoped-nudge-final-tests.log`,
`/tmp/argos-scoped-nudge-final-typecheck.log`). Root advisory/attention/native
evidence union passed 5 suites / 72 tests
(`/tmp/argos-continuity-stage4-advisory-union.log`). A runtime-only evidence/plan
lease now survives the daemon cooldown; revoked or throwing leases discard the
queued suggestion. Native cycles admit at most two valid scoped suggestions as
private perceptions, without a global pending-stimulus hop, and do not activate
legacy unscoped backlog. This closes the previously missing queued-to-NPC
delivery path; a queue entry by itself was not evidence of receipt.

Director/evidence/detector integration passed the coherent root 8-suite / 92-test
union and typecheck (`/tmp/argos-continuity-stage4-final-union.log`,
`/tmp/argos-continuity-stage4-final-typecheck.log`). The actual duet tests cover
private inbox/contact/thought exclusion, a completed disclosure replacing a
future date plan without NPC mutation, and an isolated recipient follow-through
that never sees another observer's unshared speech or the global plot. The
detector's own gate passed 3 suites / 27 tests and typecheck
(`/tmp/argos-stage4-beat-detector.log`, `/tmp/argos-stage4-beat-detector-typecheck.log`).
Keyword matches now remain candidate telemetry, not trigger/act/tension state
changes. Legacy occurrence callbacks deliberately do not fire without a verified
predicate; independent God/evolution building remains, but direct director
scenery preparation was removed. See `../nle/ADAPTIVE-NARRATIVE-DIRECTION.md`.

The first 120s maintenance live gate `sitcom-breakup-boyfriend-axS1ql` **did not
pass**. Actual cognition read both messages (14.2s, 52.2s) and delivered replies
(46.265s, 73.325s), with no reported ECS system error. There were 80 admissions,
69 integrated decisions, 19 reasoning thoughts and 14 completed spoken turns;
Elaine median/p95 1387/3563ms, Jerry 1432/2294ms. Repeated metaphor/agreement
remains; this is not a demonstrated narrative-quality improvement.

All post-disclosure director requests were correctly rejected as stale, taking
12.324, 15.962, 18.806 and 10.801 wall seconds. All eight original beats remained
pending; no new-director suggestion was admitted. Its omitted model options
inherited medium thinking, unlike the low-thinking foreground path. A bounded
latency/output-scope repair is required; do not relax freshness checks to accept
obsolete advice. Separately the offline performance compiler stopped at source
36.220s: committed speech/gestures needed 11.360s against an 8.500s budget. Exact
boundary diagnosis is in progress; no H3 was used or claimed successful.

The fast director revision uses the existing low-thinking model configuration,
zero provider retries, 1600 output tokens for reconciliation and 500 for the
separate optional suggestion. It offers up to 32 rotating pending summaries,
but permits changes to only one tension per response (at most six retirements/
changes and one replacement). Rotation advances even on abstention, invalid,
stale or failed requests; within-window prioritization remains a model choice.
Output-limit responses are rejected even if a complete-looking JSON fragment
can be extracted. Safe outcome telemetry records IDs/counts, elapsed time,
finish reason and disposition, not raw prompt/proposal prose. Root coherent
8-suite / 100-test gate and typecheck passed
(`/tmp/argos-continuity-stage4-fast-final-union.log`,
`/tmp/argos-continuity-stage4-fast-final-typecheck.log`). Live retry still pending.

Exact recorded-event replay confirmed a missed legal compiler cut at
46,065.001ms: the phone typing action has actually completed and all crossing
speech is between clauses. The next ordinary punctuation candidate overflows.
The legal cut fits 8500ms with exact spoken words, the complete typing gesture,
buzz and final silence; no speech truncation/speedup is needed. A narrowly
scoped boundary repair/regression is in progress before the live retry.

The boundary repair is frozen after 5 suites / 67 tests and typecheck
(`/tmp/argos-stage4-phrase-boundary-final.log`,
`/tmp/argos-stage4-phrase-boundary-typecheck.log`). Both the exact recorded
receipts and native ApartmentSitcom → SitcomDirector auto-selection preserve
every speech receipt exactly once and the full typing action. A new word after
punctuation, another voice mid-clause, and an expected-only action end cannot
authorize the new cut. This fixes the missed cut, not arbitrary performance
capacity or any provider behavior. The maintenance retry g5ctqT is running.

The 120s maintenance retry `sitcom-breakup-boyfriend-g5ctqT` finished with no
reported system error and complete offline projection: 15 versions, source
cursor 120000ms, reason/error null and no unfilmed tail. Root compiler/director
union passed 4 suites / 83 tests and final typecheck
(`/tmp/argos-continuity-stage4-compiler-union.log`,
`/tmp/argos-continuity-stage4-gate-typecheck.log`).

Initial review abstained in 906ms. Four subsequent reviews took 2.530–3.023s
and were correctly rejected after evidence changed. At 80s a 3.327s review
retired all four obsolete pre-date/departure beats, preserving their evidence
and making that tension dormant, not resolved. This run chose retirement only;
replacement/advisoryDescription and recipient privacy remain demonstrated by
the native integration regressions, not claimed as live events here. The
separate recipient-local suggestion took 870ms and was queued for Jerry;
queueing alone is not proof of later receipt.

Elaine actually read at 16.7s and 45.2s and disclosed at 25.9s. She did not send
a reply in this run. There were 88 admissions, 75 integrated decisions, 10
reasoning thoughts and 14 completed spoken turns. Elaine median/p95 was
1194/2929ms; Jerry 1301/3364ms. Dialogue remained a repeated word-count /
punctuation / execution metaphor. Faster reviews and actual premise retirement
are validated; natural progression is not established by this trace. Continue
with the ordered stage 5: real alternatives to standing and talking.

Independent final g5ctqT audits confirm all 161 actual word receipts appear
exactly once across 15 contiguous packets, all five buzzes retained, and one
whole pickup plus each of the two reads. No typing or reply existed to render.
The local suggestion is absent from final perception/delivery evidence; do not
claim receipt. Planned media contains 39.225s of ending holds out of 129.125s
(30.38%); complete compilation is not proof of good film pacing. All six actual
conversation reviews chose continuation. No non-wait physical action followed
the second read, and no explicit refusal-to-reply was evidenced.

### Stage 5 — executable world alternatives (validated)

Begin after stage 4's deterministic and live gates above. The focused seed now
has real Hallway and Street destinations, plus finite brewed coffee and two
portable mugs. Implement the shared explicit one-step route predicate through
menus, dispatch and actual arrival; connect new rooms explicitly. Pouring and
drinking require real objects and timed completion, not dialogue about doing it.
Do not manufacture a departure, a phone answer, emotional recovery, or a work
goal completion. See `../demo/WORLD-ALTERNATIVES.md` for the implementation
contract and the retained initial-room-set renderer limitation.

Stage-5 deterministic gates: route/native/planner/legacy union 11 suites / 233
tests; coffee/phone/persistence fixture 22 tests; expanded-scene union 4 suites /
48 tests. These overlap, not additive. A frozen-capability-object Proxy adapter
fix was included in the final route union. Root independently reviewed core
route/dispatch/completion and coffee authority. Initial legacy phone gate passed
30 tests; focused narrative/duet integration passed 3 suites / 12 tests.

The new tests exposed bare scalar identity slots surviving numeric entity-ID
reuse in package completion/publication. Requiring the actual identity component
as well as matching key prevents a recycled mug or feedback entity inheriting
the removed object's operation. Source-epoch checks also prevent old package
work consuming resources after source stop/restart.

Full deterministic gate passed 260 suites / 3279 tests, 10 skipped, in 153.119s
(`/tmp/argos-continuity-final-full-suite.log`), with final typecheck
(`/tmp/argos-continuity-final-typecheck.log`). Final route union/typecheck logs:
`/tmp/argos-room-routes-final.log`, `/tmp/argos-room-routes-typecheck.log`.
Physical/camera logs: `/tmp/argos-stage5-world-alternatives-final.log`,
`/tmp/argos-stage5-expanded-scenes.log`. Explicit evaluation duration bounds reject
121s without --extended and 301s with it; default maximum remains 120s. A 240s
maintenance breakup trial with --extended is now running, with all source frozen
and no H3 calls.

The 240s maintenance trial `sitcom-breakup-boyfriend-Fx4yPS` finished at 480 ticks
with 12.5ms mean tick time, zero slow ticks or reported system/operation failures.
There were 148 foreground admissions, 124 integrated decisions, 12 expressed
reasoning thoughts and 29 completed turns. Median/p95: Elaine 1368/3472ms,
Jerry 1314/2482ms. Actual reads occurred at 12.7/34.2s; later spoken declarations
and a 206s actor-chosen communication pause substantiate her decision not to
reply. Elaine closed conversation three times, but reopened through new actual
speech twice. Repeated banter continued. Jerry fetched an empty Blue mug but
did not pour/drink or visit Hallway/Street. Full autonomous coffee follow-through
is not demonstrated; its mechanics are native-executor tested.

Offline projection covered all 240s, 34 contiguous packets, reason/error null,
no unfilmed tail; all 342 spoken-word receipts exactly once. Actual reads/buzzes/
pickups/movement were retained. No nonexistent replies or coffee gestures were
invented. Planned media remains conservative: 290.625s total, 102.67s ending
holds (35.33%). Maintenance made 44 entities across three rooms, no new coding
jobs/systems/components. Four director reconciliations applied, with seven
retirements and two advisory replacements later retired against newer evidence.
Two local suggestions were queued but their receipt is not evidenced; five
separate native daemon whispers did reach actors.

The extended trial also retained important failures: repeated generic laptop
interactions produced no actual report/email; an old scheduled work predicate
accepted power-on as completion. One private recollection embellished the
timing of cookie possession. These are not canonical facts or productive output.
The new Hallway exposed a substring room classifier (hall → tavern). The bounded
repair now matches whole words and preserves the actual authored description as
primary function in both population prompts. Two suites / 11 tests and typecheck
pass (`/tmp/argos-stage5-steward-authored.log`,
`/tmp/argos-stage5-steward-typecheck.log`). No prior artifact was rewritten.

A final 120s core logistics control `sitcom-logistics-boyfriend-W04xMz` actually
read at 15.7/42.7s and delivered replies at 28.885/46.975s. It had 68 admissions,
56 integrated decisions, four expressed thoughts and 12 completed spoken turns;
median/p95 Elaine 1591/4162ms, Jerry 1273/2569ms. It compiled through 120000ms,
16 packets, with no reported system/projection error. It still continued dinner
banter, without coffee completion or departure. This is a separate maintenance-
off condition, not a statistical comparison with Fx4yPS.

Artifact-backed comparison and residual limitations are recorded in
`CONTINUITY-AND-PROGRESSION-VALIDATION.md`. All five implementation stages are
validated; this is not a claim that autonomous social behavior is now golden.
Final post-Steward regression rerun passed **261 suites / 3288 tests, 10 skipped**
in 151.022s (`/tmp/argos-continuity-final-full-suite-post-steward.log`). Final
TypeScript and diff check passed
(`/tmp/argos-continuity-final-typecheck-post-steward.log`). All implementation
and validation gates are complete. No H3 calls or demo-server restart occurred.
