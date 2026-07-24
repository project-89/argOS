# Cthulhu Playtest - Final Affordance Diagnostic

**Date**: 2026-03-28
**Test**: `test-cthulhu.ts` (10 turns, scripted investigation)

## Did the full chain work?

**Partial.** The chain breaks between step 2 and 3:

1. **Genesis created affordances**: `read_forbidden_text` (requires `forbidden_text`), `investigate_clue` (requires `clue`), `interrogate_witness` (requires `witness`). Components `Sanity` and `OccultKnowledge` also created. PASS.
2. **LIL post-processor matched affordance**: Turn 2 input "I pick up the forbidden text and read..." matched `read_forbidden_text` (logged twice, once per parsed action). Action rewritten to `type: "interact"`, `content: "read_forbidden_text"`. PASS.
3. **Affordance EXECUTION**: No evidence of `executeAffordance` succeeding. No `[Affordance]` logs, no Sanity/OccultKnowledge value changes in output. The narrative response was pure LLM generation, not driven by mechanical state change. **FAIL.**

## Where it breaks

The most likely failure point: **objects lack required traits**. Genesis created the Necronomicon Ex-Mortis but probably did not pass `traits: ["forbidden_text"]` in the `createObject` call. Without that trait on the target, `canUseAffordance` returns `{available: false, reason: "Target lacks trait: forbidden_text"}`, and `executeAffordance` silently fails (the error is swallowed by try/catch at line 277 of test-cthulhu.ts).

A secondary gap: no `[LIL] Auto-resolved target` line appeared, meaning the intent parser either (a) already had a target that didn't match an entity name, or (b) no objects were in the snapshot. Either way the interact action may have had no valid `targetEid`.

## What traits did genesis create?

The test log does NOT display `[Tool] createTrait` calls (the console.log filter omits them). Traits may have been registered in the schema, but the critical issue is whether they were **assigned to objects** at creation. There is no `addTraitToObject` god-agent tool -- traits can only be set via `createObject(..., traits: [...])`.

## Root cause

The LLM (GodAI) creates affordances with custom trait requirements but does not reliably assign those same traits to the objects it creates. The `createObject` tool's trait parameter defaults to `["examinable", "takeable"]`. The affordance system is wired correctly but starved of matching trait data.

## Grade

**C+** -- Affordance matching works (LIL layer). Affordance execution pipeline is wired. But the genesis-to-trait assignment gap means no affordance actually fires. Fix: either prompt-engineer the GodAI to always assign matching traits, or add an `addTraitToEntity` god-agent tool.
