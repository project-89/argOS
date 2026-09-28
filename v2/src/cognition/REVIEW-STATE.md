# Cognition, physical state and persistence review — 4 September 2026

This pass follows the prompt review through the state boundary: a thought is an
intention; an executed action is a receipt; a goal needs the right proof; a save
must preserve ownership and references. No live model or H3 calls were used for
this sub-review.

## Repairs

- **Plan continuity:** `HasPlan` is now saved, and `Plan.goalEid` is remapped after
  entities and relationships load. Current step, status and the heard-dialogue
  marker survive. Missing goals fail active plans; missing owner links are not
  reconstructed by display name. A plan cannot become another actor's plan
  merely because that actor is restored at the old numeric ID. A subsequent
  heard reply still retires a stale social step, while physical steps keep their
  ordinary execution-time checks. Legacy saves without owner links cannot safely
  resume those plans automatically.
- **Background faculties:** `HasSchedule` and `HasReflectionState` now preserve
  the actual owner's schedule, reviewed insights and accumulated importance.
  Simulation hour/day/elapsed time is stored with the snapshot; the load frame's
  delta is zero, so no offline interval is replayed. Tick remains backward
  compatible with older saves.
- **Proof continuity:** `ToolResult` was absent from the static component
  registry and its `HasToolResult` ownership link was omitted from saves.
  Both are now preserved. Explicit goal and device references remap; a deleted
  goal becomes invalid evidence (`-1`), not a generic receipt usable by a new
  goal. True legacy unscoped receipts remain legacy. The related last-result
  fallback guard is handled in the goal-evaluation review.
- **Dependent intentions:** `GoalLifecycle.parentGoalEid` remaps only to the
  same saved goal identity (creation time and signature). Missing or changed
  parents retire their still-open child intention, without completing its goal
  or setting progress to 100.
- **Public versus private persona:** `applyPersonaToEntity` no longer copies
  private backstory into the publicly examinable `Description` component. That
  history remains in the actor's own system prompt. Big Five application now
  writes the 0–1 scale actually used by native cognition, instead of converting
  low traits to numbers that every consumer interprets as high.
- **Real rest:** the native `rest` action previously only lowered arousal and
  reported success; it did not change energy. Rest is now an ECS `RestState`,
  admitted separately from its timed effect. `RestRecovery` runs every tick and
  recovers two energy points per simulated second, caps at 100, and emits one
  private body observation per recovery episode. Reaching full energy does not
  end rest or restart energy decay; another admitted action ends rest. Resting does not freeze hunger or
  world evolution. Generic energy decay and passive bedroom recovery do not
  compete with/double-credit active rest; a competing admitted action or combat
  can stop recovery. The state survives saves without granting offline energy.
- **Goal cleanup:** expiration now compares an epoch deadline against epoch
  time, not against `tick * delta`. Terminal outcomes remain available for at
  least one minute; generated paused exploratory episodes have five-minute
  retention. Cleanup never deletes an active/paused plan or a goal still owned
  by an in-flight physical/tool job. Expiration retires unexecuted future plan
  steps without marking them completed. Inactive plan artifacts are removed
  with a settled goal after retention.
- **Idle authority:** periodic random wandering is now explicitly a no-AI
  fallback, not a competing director for a live character. The fallback also
  respects an ongoing rest state, including rest at full energy.

## Checked boundaries

Actual native observation executes before plan advancement; loading a partial
plan does not replay its completed step. Exhausting the resumed plan still does
not complete a custom physical goal. Tool evidence stays attached to its actor
and goal rather than being inferred from speech, plans, or the last-result cache.
The renderer's physical appearance projection reads configured appearance and
actual attached equipment, not another actor's thoughts or system prompt. The
persona examination regression tests the public path itself, not only the
description string.

The existing native knowledge ledger stores source labels for claims and
memories; the dialogue ledger stores committed local speech separately from
model history. Neither utterance recall nor generated reflection transfers an
object, opens a cupboard, completes a repair, or establishes another actor's
private belief. Sensory channel admission is reviewed independently in this
same implementation pass.

## Remaining structural limits

1. **Save coverage is not universal.** Dynamic components lack reference-field
   metadata; blindly remapping every integer would corrupt counts and values.
   Other explicit references still need typed migration, including narrative
   scaffold role IDs inside JSON and optional office/repository artifacts. Some
   office components are not yet in `AllComponents`. Process-local external
   jobs, package-specific timed-action callbacks, and legacy session-memory
   maps are not resumable merely because ECS components were saved. A full live
   world resume needs an explicit package/job rehydration contract.
2. **Loaded core systems remain a host responsibility.** The loader restores
   saved generated code and data; embedders must still register core builtins
   and package hooks. The rest roundtrip test checks that recovery resumes only
   when explicitly ticked, not that an empty registry recreates the whole host.
3. **The clock has multiple consumers.** Native `runWorldTickAt` passes tick and
   delta to systems but does not itself advance every `world.time` field.
   `TimeProgression` owns schedule hour/day; some evals separately populate
   elapsed time. New recovery uses explicit tick delta, not a wall-clock or
   assumed global elapsed-time increment. Unifying these clocks is separate work.
4. **Generic need ecology is still heuristic.** Passive food/rest/social gains
   use room-name keywords; native `rest` is now physical and time-based, but
   simply being in a kitchen can still reduce hunger without consuming food.
   Loaded/generated systems may define their own needs rules and must respect
   the same authority if used together. This pass does not rewrite those rules.
5. **Belief provenance needs a storage-level model.** Enhanced semantic-memory
   confidence still rises on repeated subject/predicate/object matches, even
   when their sources are identical. `quickResearch` may return high-confidence
   cached content before considering newly contradictory context. Source labels
   are visible, but observation/report/inference and independent corroboration
   are not fully represented in that store. These larger changes should be
   separately evaluated, not patched with stronger certainty instructions.
6. **Historical trait scale:** newly applied personas now use 0–1. Existing
   0–100 saves cannot all be safely auto-detected (a stored value of 1 is
   ambiguous), so no silent whole-world trait migration is performed.
7. **World isolation:** shared static SoA arrays and module-level registries
   still require separate processes for simultaneously independent live worlds.
   World-keyed helper state alone does not solve that underlying allocation and
   registration boundary.

## Verification

Offline tests exercise real partial-plan execution/save/restore/continuation,
stale speech after restore, missing goals/plans/addressees/legacy evidence,
foreign ownership, dependent-goal remapping, schedule/reflection context,
goal-scoped tool receipts, persona examination, and elapsed-time rest including
interruption and save/load. See the final combined test run for suite counts;
passing these regressions is not a claim that all long-horizon cognition or all
world-package persistence is solved.
