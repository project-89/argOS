# Saltmere stress observation: “The Warning”

Date: 2026-09-27. One live attempt; no live retry or mid-run behavioral tuning.

Follow-up: [offline causal repairs](TOWN-CRISIS-REPAIR.md) address startup
scheduling, exterior inspection evidence, promise follow-through projection and
recorder/inspector defects. The observations below are preserved as recorded;
there has been no live retry or behavioral-gate closure.

## Verdict

The native response → action → memory → spirit-feedback chain worked for one
physical incident. The intended town-wide social crisis did **not** materialize.
This is useful failure evidence, not a successful dramatic-demo gate. Two of
the three recipients never perceived their messages, one recipient read and
replied but then waited, and the Narrator chose not to intervene throughout.

The user's original town on port 51090 was left untouched: a final authenticated
read still showed `ready`, `running=false`, and zero elapsed simulation time.

## Protocol and evidence

- Harness: `src/demo/spatial-town-crisis-check.ts` (`--offline` / `--live`).
- Offline rehearsal: `recordings/town-crisis-offline-U9eDz4`.
- Live evidence: `recordings/town-crisis-live-wVJTYc`.
- Ten residents; existing Saltmere development profile, models, controller and
  spirit cadences unchanged. Five configured town spirits and eight shared
  engineering admission slots. No H3.
- Hard native deadline: 300 wall seconds; outer fallback: 315 seconds;
  at most 900 in-process Google HTTP attempts. Coding subprocess inference is
  separately bounded by the existing eight-job profile and 180 seconds/job.
- Four physical-phone messages carrying unverified claims; two native rain
  changes; two native loose-branch incidents. Every injection is attributed to
  the operator. No forced NPC thought, action, goal, belief or spirit proposal.
- Branch damage does not injure anyone or obstruct a route. Rain is not proof
  of a new wetness/health mechanic. This was social pressure plus real cleanup
  work, not a fully modeled lethal storm or town disaster.

Actual duration: **300.924 wall seconds, 254.2 simulation seconds** (~0.845×).
All eight scheduled injections occurred. 55 native actions succeeded; one
additional action was cancelled at session stop and recorded as failed.
There were 45 distinct speech executions with at least one committed text
slice; the final utterance was unfinished at stop. Speech slices are not
separate lines or proof that an utterance completed.

Primary files include `protocol.json`, `injections.jsonl`, `receipts.jsonl`,
`phone-events.jsonl`, `thoughts.jsonl`, `samples.jsonl`,
`provider-exchanges.jsonl`, `god-reviews.jsonl`, `narrator-reviews.jsonl`,
`architect-diagnostics.json`, `last-running.json`, `result.json`,
`session.json`, `world.json`, `working-memory.json`, and `terminal.log`.
Provider exchanges contain fictional private minds and message contents; keep
the evidence private. Provider headers and API-key query strings were not saved.

## Timeline (simulation seconds)

| Time | Confirmed event |
| --- | --- |
| 0.1 → 1.5 | Mara's first foreground request returns a choice to pick up her phone. No initial pickup receipt follows. |
| 3.6 → 31.6 | Mara instead travels to The Net House after background planning completes. |
| 10.5 | First warning delivered to Mara's physical phone at Lantern House. |
| 20.4 | Operator causes rain and branch damage on Saltmere Common. |
| 65.6 | Warning delivered to Ivo's phone. |
| 95.2 | Second warning delivered to Mara's phone, still at home. |
| 103.0 | Ivo completes his return to Lantern House. |
| 115.3 | Ivo's cognition receives an eight-second-old phone-buzz perception. |
| 119.4 | Ivo completes picking up his phone. |
| 120.8 | Operator causes rain and branch damage in Widow's Garden. |
| 125.3 | Witness message delivered to Bea's phone at Gull House. |
| 128.2 | Ivo completes reading his message (first sampled read state: 128.9). |
| 136.1 | Bea independently clears the damaged garden tree; crown remains pruned. |
| 138.5 | Ivo sends a reply promising to make sure Mara knows. |
| 145.6 | Narrator review includes exact garden damage, cleanup and successful action receipts. |
| 204.4 → 212.5 | Weaver proposes a workshop chair; God rejects it as a duplicate of existing chair 144. |
| 253.0 → 254.2 | Eli begins approaching the other damaged tree, but the deadline cancels his action. The tree remains damaged. |

## What worked

**Physical causality and memory:** Bea selected the real cleanup affordance,
completed it, and received a matching own-action working-memory receipt. The
Narrator subsequently observed the actual outcome. This proves a response and
feedback path, not autonomous creation of the incident.

**Phone privacy and two-way delivery:** Ivo read and replied through native
phone actions. Mara and Bea did not receive remote omniscient knowledge of
texts on phones elsewhere. Ivo did not read Mara's unattended phone.

**Review authority:** God inspected the proposed chair against real inventory
and rejected duplicate creation. No unapproved build or new native action ran.

## Failures and causal distinctions

1. **The primary social trigger did not reach Mara or Bea.** Their phones ended
   unheld at home. All 28 Mara foreground prompts and 25 Bea prompts contained
   no actual phone-notification perception and no personally read test text.
   Do not diagnose this as understanding and ignoring a threat.
2. **An initial action handoff needs tracing.** Both Mara and Ivo initially
   selected phone pickup without committing it. A schedule goal was inserted
   during inference; current goal-basis checks can invalidate an in-flight
   decision when that set changes. This is a strong candidate, not a proven
   rejection reason: the recorder omitted the control/chronicle ledger and the
   terminal log has no corresponding admission diagnostic. Do not bypass stale
   state checks on the strength of this observation alone.
3. **Ivo's post-read waiting was a fresh choice, not stalled inference.** His
   later requests repeatedly chose sitting/resting until Mara returned. He
   promised to tell her, but did not go find her in this trial. The concern did
   not become active follow-through.
4. **Investigation did not reliably progress.** Mara repeatedly inspected the
   same box. Earlier exterior inspections returned only “closed; contents not
   observable”; her biography still said she had not examined the marks.
   Opening replaced the descriptive evidence with “The chest stands open.”
   Later claims about forced damage/splintering were not new physical changes.
   Inspectable evidence, stable descriptions and goal completion need to work
   together; this is not clean evidence that she simply forgot a discovery.
5. **Narrator was active but passive by choice.** Eight accepted real-model
   reviews explicitly returned `intervention.needed=false`. Available native
   weather/tree grants were in the policy; no attempted effect was rejected.
   Existing conversation was repeatedly treated as adequate rising tension.
6. **Growth was not demonstrated.** Weaver eventually submitted one duplicate
   chair proposal. God correctly rejected it. Zero code jobs, builds or repairs
   occurred; all eight job slots remained unused. Four Tinker stage runs
   occurred and three completed reports explicitly found no repairs necessary.
   The test did not establish a genuine missing deterministic capability, so
   no build is not by itself evidence of a broken daemon.

## Performance and shutdown

Foreground operations: 273 completed, median execution 1.747s, p95 4.279s,
maximum 7.147s; maximum foreground queue delay 13.652s. Subconscious operations:
184 completed, p95 execution 8.552s; maximum queue delay 37.514s. Foreground and
subconscious have reserved lanes, but ten residents can still queue within
their respective lanes. Operation success is not proof of behavioral success.

There were 1,974 slow ticks. ActorControl peaked at 558.6ms. Three native
callback health records showed zero failures; that is not a sub-100ms latency
guarantee. Detailed synchronous evidence recording may contribute overhead;
this instrumented observation does not isolate renderer/observer cost from
engine cost.

589 HTTP attempts: 578 HTTP-200 responses, five timeouts during the run and six
shutdown aborts. Final queues/running/settling tasks and active HTTP requests
were zero. Eli's failed action explicitly records `session_stopped`; it is not
a failed branch-repair mechanic. The final Weaver `provider_or_parse` and
stale-observation diagnostics coincide with cancelled shutdown work and remain
preserved rather than being treated as a fresh design failure.

An additional harness/view issue appeared after cancellation: the temporary
UI's `/api/state` returned HTTP 400 despite a successfully saved stopped
snapshot, and the UI displayed “Connection interrupted.” The exact exception
is hidden by the server's generic error handler. The server was created inside
a cancellation scope, which is a candidate cause, not a traced diagnosis. The
saved JSON evidence remains valid; no working replay UI is claimed.

## Changes and validation in this pass

- Added the bounded recorder/injection harness.
- Added explicit operator provenance for native branch incidents and tested
  its projection. Narrator defaults and resident clearing attribution remain.
- Offline rehearsal: eight injections, four native physical effects, ten
  phones, zero provider calls, 300 simulated seconds, zero observer errors.
- Final typecheck passed. The two relevant Jest suites passed **36/36**.
- An initial post-run verification invocation mistakenly used Vitest; both
  suites failed to load because they import `@jest/globals`. No assertions ran
  in that invocation. Re-running through the repository's Jest command passed.
- Existing dirty-worktree work was preserved; no commit, model change or
  cognition tuning was made. No additional live run was launched.

## Smallest next pass

1. Capture the actual action admission/supersession ledger and reproduce the
   startup pickup → schedule/planner handoff offline. Preserve safe physical
   revalidation; do not merely force phone possession or telepathic alerts.
2. Make object inspection retain stable exterior evidence across state changes
   and provide a usable completion outcome. Test repeated investigation against
   those receipts and distinguish authored history from current knowledge.
3. Inspect why an accepted concern/promise turns into indefinite waiting, and
   why Narrator treats repetitive inspection as rising narrative progress.
   Preserve choice; do not script a crisis reaction for a named resident.
4. Measure queue delay and tick cost with/without the heavy recorder. Address
   the demonstrated bottleneck, not models on speculation.
5. Repeat the same bounded social trial only after delivery is demonstrably
   possible. Test genuine missing-capability growth separately with a defined
   need and a native observable outcome.

This does not satisfy the ten-trial baseline or ten-minute endurance gates;
neither requirement has been reduced or marked complete.
