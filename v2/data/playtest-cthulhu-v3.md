# Cthulhu Mystery Extended Playtest Report -- v3

**Date:** 2026-03-28
**Duration:** 168 seconds (10/10 turns completed, 0 errors)
**Seed:** Innsmouth Cove 1920s Lovecraftian mystery (identical to v1/v2)
**Player:** Detective Crane, private investigator from Boston
**Fix Under Test:** Affordance routing fix (post-parse heuristic that upgrades observe/interact to affordance-specific interact)

---

## Did Affordances Fire?

### Status: NO

**Zero `[Affordance]` lines in output. No Sanity or OccultKnowledge changes observed.**

The post-parse affordance routing code (lines 133-148 of `test-cthulhu.ts`) checks whether the player's input words match affordance names (e.g., `read_forbidden_text` splits to `["read", "forbidden", "text"]`). Turn 2 input was: *"I pick up the forbidden text and read the first few pages, steeling myself."* This contains "read", "forbidden", and "text" -- so the heuristic **should have matched**.

However, there are two failure modes that likely prevented execution:

1. **The intent parser returned no target.** The heuristic only fires when `action.target` exists (line 135: `if ((action.type === "observe" || action.type === "interact") && action.target)`). If the LLM returned an observe action with no target field, the affordance upgrade is skipped entirely. The world has "Marsh's Journal" as the forbidden text object, but the player said "the forbidden text" -- the LLM may not have resolved this to a specific entity name.

2. **The action went down the wrong branch.** At line 263, non-speech/non-wait actions call `executeActions()` which should trigger the affordance system. But if the intent parser returned `observe` (with no target), the action falls through to the narrative renderer without ever hitting `executeActions`. The narration for Turn 2 shows the professor reacting to the player picking up the book -- this is pure narrative generation, not a mechanical affordance trigger.

**Neither `investigate_clue` nor `interrogate_witness` fired either.** The scaffold's trigger conditions (e.g., "Blackwood uses investigate_clue on Marsh's Locked Study", "Blackwood interrogates Ezekiel Gilman with OccultKnowledge > 10") remain unmet. All scaffold beats are still "pending."

### Root Cause

The affordance routing fix has a guard clause (`&& action.target`) that silently skips the heuristic when the intent parser doesn't resolve a named target. This is the most likely failure point. Fix: remove the target requirement from the affordance word-match, or add a fallback that scans the room's objects for a plausible target when the words match.

---

## Graduated Disclosure

### Turn 6 (pressing the fisherman): STILL WORKING

Ezekiel Gilman's response when pressed about midnight services:

> "You've a dangerous tongue, Detective. We pray for the bounty of the sea, same as any folk who live by the salt. There's nothin' for you at the church but old stone and cold wind. Best you find a warm bed and stay off the streets after dark... the fog has a way of leadin' strangers into the deep."

**Regression from v2.** In v2, Silas cracked wide open at Turn 6 -- naming Father Obed, the Great Submergence, admitting transformation. In v3, Ezekiel stays stonewalled, offering only a vague threat ("stay off the streets after dark"). This is a step backward: the graduated disclosure pattern that worked in v2 did not replicate here.

Likely cause: different NPC (Ezekiel Gilman vs. Silas Gilman), different scaffold secrets, and different conversation history feeding into the cognition. The graduated disclosure is not yet deterministic -- it depends heavily on which NPC personality the God AI generates.

### Turns 9-10 (the priest): IMPROVED

Father Dagon's responses are strong:

- **Turn 9:** "Professor Marsh was a frequent visitor... He possessed a restless spirit, always searching the horizon... the fog has a way of misplacing those who do not belong to the water." -- evasive but atmospheric.
- **Turn 10:** "He was seeking a homecoming. He understood that the blood of the deep calls to its own... he was looking for the gate. I fear he may have found it before he was ready to pass through." -- **significant revelation.** Admits Marsh was seeking the gate, implies he found it, frames disappearance as voluntary transformation.

This is better than v2's Turn 9 (where Obed gave generic evasion) and comparable to v1's Zadok. The confrontation-under-pressure pattern works for the antagonist in v3.

---

## World-Building Issues

### Corrupted room names

Two rooms generated as **"Validator"** and **"Validation Torch"** instead of proper setting names (should be something like "Marsh's Locked Study" or "Innsmouth Harbor"). This appears to be a BitECS validation/debug artifact leaking into room naming. Detective Blackwood was placed in "Validator" and Ezekiel in "Validation Torch."

Despite these nonsensical room names, the narrative renderer compensated -- Turn 1 describes a study with ink-stained parchment and a chalkboard, Turn 4 describes salt-slicked harbor planks. The LLM ignored the room names and generated appropriate descriptions from context.

### Entities listed as rooms

The final world state dump shows "Detective Thomas Blackwood", "Marsh's Journal", "Strange Idol", "Fishing Nets", and "Pulsing Lantern" as rooms. This is a `buildWorldSnapshot` bug -- it's treating all entities as rooms in the output, not filtering by Room component.

---

## Overall Grade Comparison

| Category | v1 (B+) | v2 (A-) | v3 |
|----------|---------|---------|-----|
| Prose and atmosphere | A | A | A |
| NPC characterization | A | A | A |
| Story scaffold quality | A | A+ | A (good tensions, but corrupted room names) |
| Affordance execution | F | F | F (fix present but guard clause blocks it) |
| Graduated disclosure | C | A- | B (works for antagonist, regressed for witness) |
| World integrity | B | B+ | B- (corrupted room names, entity-as-room bug) |
| Error-free execution | A- | A | A |

### v3 Grade: B+

**Same as v1, a step back from v2's A-.**

### What Regressed
1. **Graduated disclosure for the fisherman.** v2's Silas cracked open dramatically at Turn 6. v3's Ezekiel stayed stonewalled. This is non-deterministic NPC behavior, not a code regression.
2. **Room names.** "Validator" and "Validation Torch" are nonsensical. v2 had proper names (Miskatonic Restricted Archives, Professor Marsh's Study).

### What Held Steady
1. **Prose quality** remains excellent across all three runs.
2. **Zero errors** in execution.
3. **Antagonist confrontation** (Turn 10) delivers meaningful revelations in all three runs.

### What Still Needs Fixing
1. **Affordance routing guard clause.** The `&& action.target` check on line 135 silently kills the affordance heuristic when the intent parser returns a targetless action. Remove or relax this guard.
2. **Room name generation.** The God AI is occasionally producing debug/validation names instead of setting-appropriate names.
3. **Graduated disclosure needs reinforcement.** The pattern works when it works (v2 Turn 6) but is not reliable across runs. Consider injecting the scaffold's NPC secrets more aggressively into the NPC cognition prompt, or adding a "disclosure threshold" mechanic that deterministically unlocks information after N conversation turns.
