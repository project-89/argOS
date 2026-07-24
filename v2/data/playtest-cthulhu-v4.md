# Cthulhu Playtest v4 — 2026-03-28

## Did affordances fire? NO

**Evidence**: Zero `[Affordance]` lines in output. Zero `interact:` lines. Zero Sanity/OccultKnowledge value changes. Components were registered (`+ component: Sanity`, `+ component: OccultKnowledge`) and affordances were created (`+ affordance: read_forbidden_text`, `+ affordance: investigate_clue`, `+ affordance: interrogate_witness`) but none executed.

## Turn 2 Analysis ("read the forbidden text")

Raw output saved only `{ input, narration }` — no parsed intent was logged. The test does not emit the parser's return value. However, we can deduce what happened:

1. `parsePlayerIntent()` likely returned action type `observe` or `interact` (unknown — no diagnostic).
2. The affordance matcher (lines 133–156) should have upgraded it: `read_forbidden_text` words (`read`, `forbidden`, `text`) appear in the input. But `action.target` fallback picks from `snapshot.objects` by trait match — whether "The Forbidden Text" entity matched depends on its traits array containing `occult_source` or words like `forbidden`/`text`.
3. Even if upgraded to `{ type: "interact", content: "read_forbidden_text", target: "The Forbidden Text" }`, it hits the `else if (action.type !== "wait" && action.type !== "speak")` branch (line 271), which calls `executeActions()` with the **player eid**.
4. `executeActions` → interact case requires `validatedAction.target && validatedAction.content` (line 2109). If either is missing, nothing happens — no log, no error, silent skip.

**Root cause**: The test has no diagnostic logging for parsed intents or action execution results. The narrative is generated purely by the LLM renderer, completely independent of whether any affordance actually executed. The LLM produces beautiful Lovecraftian prose regardless.

## Grade: C+

- **Narrative quality**: A+ (atmospheric, coherent across 10 turns, NPCs stay in character, tension escalates)
- **Mechanical integration**: F (affordances are decoration — zero game-mechanical effect on the world)
- **The narration is a hallucination**: The LLM describes reading the text, sanity effects, etc., but no ECS state changed. Sanity stayed at default. OccultKnowledge stayed at 0.

## What's still broken

1. **No diagnostic output**: `gameTurn` doesn't log the parsed intent or affordance match result. Impossible to debug without adding logging.
2. **Silent failure path**: If `executeActions` skips an action (missing target, missing content), there's no output — it just falls through.
3. **Player eid has `Agent.active = false`**: May cause `executeActions` to skip processing (needs verification).
4. **Object trait matching is fragile**: The affordance matcher in test-cthulhu.ts (line 144) checks `o.traits.some(t => affName.includes(t))`. If "The Forbidden Text" entity has no `occult_source` trait, `action.target` stays undefined, and the interact case silently skips.
5. **Narrative completely decoupled from mechanics**: `renderNarrative()` produces text with zero awareness of whether affordances fired. It should receive affordance results and reflect actual state changes.
