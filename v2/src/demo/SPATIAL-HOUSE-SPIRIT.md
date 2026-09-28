# Extended Blackout / bounded house spirit — 2026-09-25

Scope: a more involved physical layout and operator experimentation, not another
cognition controller, model change, autonomous growth rollout or H3 pass.

## Implemented

- Separate Apartment, Utility room and Storeroom with real walls, walkable
  permanent passages, remote diagnosis, concealed supplies and cartridge transport.
  Original compact layout retained as a control. Existing goal, timed execution,
  containment and exact-identity/precondition proof paths are reused.
- A distinct house-spirit prompt in the GUI. Four physical operations only:
  light/circuit off, restore power, box open, box close. Exact common phrases are
  immediate; other phrasing is classified by the configured spirit model.
- Interpreter receives only the operator's request. Strict schema, no tool/code
  access, no NPC minds/messages, no arbitrary ECS patch, no generated object powers.
- Source/target freshness, timeout, single logical request, bounded request count,
  physical validation and truthful applied/unchanged/rejected outcomes. Changed
  observer/history failures cannot turn an applied edit into a false rejection.
- Native and operator circuit changes share local sensory feedback. Both the
  switch and lamp can be witnessed in their own rooms; the panel's energized
  indicator is observable. This fixes a missing physical evidence path, not
  behavior by forced intention/goal edits.
- Pending native work still revalidates: closing a box before pickup completion
  preserves its cartridge and yields cancellation, rather than granting possession.

## Offline evidence

Final broad rerun: **248 tests / 13 selected backend suites, 21 client tests and
TypeScript typecheck passed.** Includes native multi-room repair, local-only
circuit observations and 35 world-control boundary tests. Browser inspection
verified the three-room layout and house-spirit form directly below the mind/goal
panel; fresh live GUI remains ready, not started. Evidence and red/green logs:
`recordings/extended-blackout-check-20260925-VmVilU/`.

First extended test iteration failed two assertions: the timed observe path's
diagnosis lives in native episodic memory rather than the generic visual receipt;
in-flight approach cancellation reports `execution_invalidated`, not the later
inaccessible-target message. Tests now assert those actual boundaries plus
physical possession and failure. Original red outputs remain in evidence.

## Live evidence — retain failures

1. `recordings/blackout-extended-intervention-20260925-01/`:
   Ivo inspected at 10.1s, fetched the real amber cartridge, installed at 45.0s and
   restored power at 47.4s. Mara returned and isolated the repaired circuit at 57.8s
   while following her older repair agenda. The requested ten-second stable gate
   was not observed by the sampler before that second outage, so **no operator
   intervention occurred**. The run stopped at the 100-request limit: 116.3 simulated
   seconds / 119.406 wall seconds, 96 successful requests, one provider timeout and
   three shutdown-aborted requests,
   zero active requests at finish, zero system errors. Final power was off.
   **Not a pass.** Failed evidence led to shared circuit-transition feedback and
   the panel energized indicator; it was not deleted or relabelled.
2. `recordings/blackout-extended-intervention-20260925-02/`: post-feedback retry.
   Native repair completed at 51.1s and remained stable for 10s. At 61.1s the single
   operator request actually isolated the circuit, preserving the cartridge.
   Mara said, “Actually, Ivo, look at the panel—the switch just clicked back off.”
   Ivo inspected at 73.6s and found the installed part serviceable with power
   isolated. They then discussed a possible new electrical fault instead of
   restoring power before the bound. 100 calls, 99 successful, one shutdown-aborted,
   104.0 simulated seconds / 106.311 wall seconds, zero active requests at finish,
   zero system errors and slow ticks.
   **Initial repair and intervention perception demonstrated; autonomous recovery
   gate NOT passed.** Do not turn a reasonable observed reaction into a claimed
   repair. No third live run or forced cognition change was made.
3. `recordings/spatial-house-spirit-language-20260925-01/`: exactly two live
   configured-model calls with a manual/no-NPC-AI world. “Could you lift the lid of
   the household supplies box?” → applied/box_open in 1298ms. “Add a dog to the
   apartment” → rejected/unsupported in 1214ms. Same 35 exact entities, no clock
   advance, power unchanged, both calls settled, no retries. Both checks passed.

## Deliberate limits / next steps

- This is an operator-invoked narrow spirit adapter, not God/evolution autopilot.
  Autonomous spatial construction, arbitrary object relocation and adding objects
  through this prompt remain deferred.
- Two-sided closable portals need a shared physical door and local faces before
  they can safely replace fixed passages. Do not bypass room-private sensing.
- NPC cooperation/recurrence is not guaranteed. In particular, the native same-
  description settled-intention cooldown remains unchanged. No new controller or
  hard-coded response was introduced to force the second repair.
- Ten-trial baseline and at least 600 wall AND 600 simulation-second endurance gates
  remain OPEN. Short diagnostics cannot replace them. Complete spatial save/resume
  remains uncertified.
- Timeout denies late effects; an abort-ignoring provider may take longer to
  physically settle. Logical busy is bounded, not a claim of provider-side rollback.
