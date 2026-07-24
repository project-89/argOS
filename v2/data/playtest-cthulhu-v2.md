# Cthulhu Mystery Extended Playtest Report — v2

**Date:** 2026-03-28
**Duration:** 169 seconds (10/10 turns completed, 0 errors)
**Seed:** Innsmouth Cove 1920s Lovecraftian mystery (identical to v1)
**Player:** Detective Crane, private investigator from Boston
**Fixes Under Test:** Affordance routing in intent parser, graduated NPC information release

---

## Key Fixes Being Tested

### 1. Affordance Routing

**Status: NOT FIRING**

The intent parser (`intent-parser.ts`) now contains explicit instructions to route player actions like "read the forbidden text" to `interact` type with `content: "read_forbidden_text"`. The prompt includes:

```
- "read the forbidden text" -> interact, target: the text object, content: "read_forbidden_text"
```

And the affordances ARE listed in the world snapshot passed to the LLM. However, **no `[Affordance]` log lines appeared in either run**. The test script suppresses most console output, but the `executeActions` path at line 246-250 only fires for non-speech, non-wait actions. The most likely failure mode:

1. The intent parser LLM returned `observe` or `speak` instead of `interact` for Turn 2 ("read the forbidden text").
2. Or: the Necronomicon Fragment was in the Miskatonic Restricted Archives (where the player started), but the player was moved to Marsh's Study for Turn 1. In v2, the player started in the Archives but Turn 1 said "examine the professor's study" which moved them to the study -- **and the forbidden text (Necronomicon Fragment) was left behind in the Archives**.

This is a subtle world-layout issue: the Necronomicon Fragment was placed in Miskatonic Restricted Archives, while the player's Turn 1 moved them to Marsh's Study. When Turn 2 said "read the forbidden text," the text wasn't in the same room, so the intent parser likely couldn't resolve it as an interact target.

**Sanity component changes:** None visible. No mechanical effects observed.

### 2. Graduated Information Release

**Status: PARTIALLY WORKING — significant improvement over v1**

This is where v2 shows real improvement. Comparing Turn 5 and Turn 6 (questioning Silas):

| Aspect | v1 (Turn 5) | v2 (Turn 5) |
|--------|-------------|-------------|
| Response to "ask about Marsh and lights" | "a man who didn't know when to stop lookin' at the tide" — pure evasion, no info | "Professor Marsh? He was... a man of the sea, in his own way. Haven't seen him in a while." — evasion but slightly softer |
| Concrete clues | Zero | Zero |

| Aspect | v1 (Turn 6) | v2 (Turn 6) |
|--------|-------------|-------------|
| Response to "I know about midnight services" | Calls them "pious folk," threatens "the sea takes an interest in you" — complete stonewalling | **Major crack**: "The church... it's where we prepare. Father Obed speaks of the Great Submergence. We're all changing, Detective. Can't you smell it? The salt in the blood?" |
| Concrete clues | Zero | **Yes**: names Father Obed, names "the Great Submergence," references physical transformation, admits personal involvement ("we're all changing"), reveals existential detail ("they promise us we'll never truly die... just go back to the dark water") |

**Turn 6 is a dramatic improvement.** In v1, Silas remained completely stonewalled through two rounds of questioning. In v2, when pressed with specific knowledge (midnight services), he cracks open and delivers:
- The name of the cult leader (Father Obed)
- The name of the ritual (the Great Submergence)
- Personal admission of transformation ("my neck... it burns like ice")
- The cult's promise ("we'll never truly die")

This is exactly the graduated disclosure pattern we wanted: evasion on first ask → partial reveal under pressure.

---

## Per-Turn Comparison

### Turn 1: Examine the study
- **v1:** Malone describes claw marks, Necronomicon, "the geometry on this page doesn't just describe a ritual"
- **v2:** Blackwood describes the locked door mystery — key still in lock, no scuff marks, salt-water erosion on floorboards
- **Assessment:** Both strong. v2 adds the salt-water detail which ties better to the scaffold (Marsh dissolved into seawater). Slightly more investigative.

### Turn 2: Read the forbidden text
- **v1:** Air grows "heavy and cold, smelling of brine and rotting kelp." Malone warns, reaches for laudanum. No Sanity cost.
- **v2:** Salt-crusted journal, scent of stagnant seawater. Blackwood warns. No Sanity cost.
- **Assessment:** Both atmospheric, neither triggers the affordance mechanically. **The core fix did not work here.** In v2 the player may have been in the wrong room relative to the Necronomicon Fragment (Archives vs. Study), or the intent parser still returned `observe` instead of `interact`.

### Turn 3: Examine the locked door
- **v1:** Door "vanished" — surreal response that avoids the actual mystery
- **v2:** Door is "solid, seamless, completely devoid of any latch or bolt" — acknowledges the impossibility without going surreal
- **Assessment:** v2 is more grounded and investigation-appropriate. Neither connects to Silas's secret (escaped through vents), but v2 at least preserves the mystery rather than dissolving it into weirdness.

### Turn 4: Head to the harbor
- **v1:** Ezekiel described with "wet scales on his neck," warns player away
- **v2:** Silas described with "translucent, scaly patches creeping up his throat," immediately volunteers that Marsh "melted into the salt"
- **Assessment:** **v2 is significantly more informative.** Silas proactively delivers a clue on first contact ("he melted into the salt"), which ties to his scaffold secret (watched Marsh dissolve into seawater). v1's Ezekiel gave zero information on arrival.

### Turn 5: Ask about Marsh and the lights
- **v1:** "a man who didn't know when to stop lookin' at the tide" — pure evasion
- **v2:** "Professor Marsh? He was... a man of the sea" — evasion + dismissal of lights as "phosphorescence"
- **Assessment:** Both evasive. v2 is slightly more natural (the pause "He was..."), but neither delivers actionable information. This is the first-ask baseline — appropriate evasion.

### Turn 6: Press about midnight services
- **v1:** Complete stonewalling. "Pious folk." Threat.
- **v2:** **Full crack.** Names Father Obed, the Great Submergence, admits transformation, reveals cult promise.
- **Assessment:** **Major improvement.** This is the graduated disclosure working. When the player demonstrates specific knowledge ("I know about the midnight services"), Silas's resistance breaks and he delivers 4-5 concrete clues in one burst. v1 gave zero.

### Turn 7: Head to the church
- **v1:** Zadok described with golden tiara "fused to his brow," green-flamed black candles
- **v2:** Father Obed described with tiara that "seems to pulse with a faint, oily sheen," barnacle-crusted stone
- **Assessment:** Both excellent atmospheric descriptions. v2's Obed immediately delivers a thematic warning ("the tides of destiny are rising") which is more ominous. Comparable quality.

### Turn 8: Examine the altar
- **v1:** Zadok guards altar, claws at tiara in agony
- **v2:** Obed holds Sacrificial Dagger, blocks access, warns against touching "instruments of the coming tide"
- **Assessment:** Both have NPCs blocking examination rather than describing the environment. v2 introduces the Sacrificial Dagger as a specific object. Neither actually describes the symbols the player asked about — both prioritize NPC reaction over environmental detail. This remains a weakness.

### Turn 9: Ask about the professor
- **v1:** Zadok reveals Marsh "shares his blood," says he "has not vanished" but "felt the pull of the tides" — strongest turn in v1
- **v2:** Obed says Marsh was "a man of restless intellect" who was "drawn to the water's edge" — generic evasion
- **Assessment:** **v1 wins this turn.** Zadok's revelation about Marsh's blood connection was v1's best moment. Obed in v2 retreats to platitudes. This is the opposite of graduated disclosure — the first encounter with the antagonist should be at least moderately revealing, especially since the player already extracted information from Silas.

### Turn 10: Confront with evidence
- **v1:** Zadok sneers, reveals "blood calls to blood," church is "the threshold," invites player to join the chant
- **v2:** Obed reveals Marsh sought "the truth of his own blood — a lineage that traces back to the depths." Admits Marsh found answers "in our records." Says "the stars are nearly right" and must "toll the bell to bridge the worlds."
- **Assessment:** Both strong confrontation responses. v2 adds more specific detail (Marsh researched church records, the bell as a ritual instrument, "stars are nearly right" echoing Lovecraft). v2 also creates more urgency — Obed is about to act ("I must ascend to the tower"), which is a better cliffhanger than v1's passive invitation.

---

## Technical Assessment

### Affordance Execution
- **No `[Affordance]` log lines appeared.** The test script suppresses most console output, but even accounting for that, the `executeActions` code path for `interact` actions (line 2108 of `cognition-system.ts`) was likely never reached.
- **Root cause hypothesis:** The intent parser LLM is still returning `observe` instead of `interact` for "read the forbidden text." The prompt instructions are present but the LLM may not be following them consistently. Additionally, the target object (Necronomicon Fragment) was in a different room (Archives) from where the player was (Study) in v2's second run.

### Sanity Component
- Created during world genesis but **no mechanical effects observed** in either run.
- The God AI creates the component and presumably the decay system, but the system never fires because OccultKnowledge never increases (because `read_forbidden_text` affordance never triggers).

### Errors
- **Zero errors in v2** (improvement over v1 which had a JSON parse error in knowledge-graph.ts on Turn 6).

### World Layout
- v2 created **4 rooms** (Miskatonic Restricted Archives, Professor Marsh's Study, Innsmouth Harbor, Esoteric Order Church) vs v1's 3 rooms (Marsh's Study, Innsmouth Harbor, Ancient Stone Church). The extra Archives room is an improvement but also caused the forbidden-text-in-wrong-room problem.
- **5 objects** created (same count as v1, thematically appropriate).

### NPC Names
- v2: Detective Thomas Blackwood, Silas Gilman, Father Obed
- v1: Detective Thomas Malone, Ezekiel, High Priest Zadok
- Both sets are genre-appropriate. v2's "Silas Gilman" directly references Lovecraft's "The Shadow over Innsmouth" (the Gilman family), which is a nice touch.

### Story Scaffold
- v2's scaffold is stronger: the locked-room mystery is explained by "The Folding of Space through Water" (Marsh didn't leave through the door — he dissolved). Silas's secret directly explains the mechanism ("He watched Professor Marsh dissolve into a puddle of seawater and 'flow' under the door"). This is more mechanically integrated than v1's scaffold.
- Both scaffolds have beat statuses that remain "pending" — the narrative director does not advance them during the 10-turn session.

---

## Grade Comparison

### v1: B+

### v2: A-

**Justification:**

| Category | v1 | v2 | Change |
|----------|----|----|--------|
| Prose and atmosphere | A | A | Same — consistently excellent |
| NPC characterization | A | A | Same — distinct voices, strong secrets |
| Story scaffold quality | A | A+ | Slightly better — locked-room solution is more elegant |
| Investigation mechanics | C | C+ | Marginal — affordances still don't fire, but Turn 4 and Turn 6 deliver actual clues |
| Player agency / info delivery | B- | B+ | **Significant improvement** — Turn 4 gives a clue on arrival, Turn 6 delivers 4-5 concrete facts under pressure |
| World completeness | B | B+ | 4 rooms instead of 3 |
| Error-free execution | A- | A | Zero errors (v1 had 1 JSON parse error) |

### What Improved
1. **Graduated disclosure is working for Silas.** Turn 5 (evasion) → Turn 6 (crack under pressure) is the exact pattern we wanted. Concrete names, places, and ritual details are released when the player demonstrates knowledge.
2. **Proactive clue delivery.** Silas in v2 volunteers "he melted into the salt" on first contact (Turn 4), which is a genuine breadcrumb. v1's Ezekiel gave nothing.
3. **World density.** 4 rooms > 3 rooms.
4. **Zero errors.**

### What Did NOT Improve
1. **Affordance routing still fails.** "Read the forbidden text" does not trigger `read_forbidden_text`. No Sanity cost is applied. The intent parser prompt has the instructions but the LLM doesn't comply, and/or the target object is in a different room.
2. **Father Obed (Turn 9) is less revealing than v1's Zadok.** The graduated disclosure may be too conservative for the antagonist on first meeting. When the player has already extracted information from Silas and is directly confronting the cult leader, the antagonist should reveal more, not less.
3. **Environmental description still blocked by NPCs.** Both Turn 8 responses describe the NPC's reaction to the player examining the altar, but don't actually describe the altar symbols. The renderer consistently prioritizes NPC dialogue over environmental detail when both an NPC and objects are in the scene.
4. **Scaffold beats never advance.** The narrative director doesn't trigger beat transitions. All beats remain "pending."

### Top 3 Recommendations (Updated)

1. **Debug affordance routing end-to-end.** Add temporary logging to the intent parser's output to verify what action type it returns for "read the forbidden text." If it returns `observe`, the LLM prompt needs stronger enforcement (e.g., few-shot examples in the system prompt, or a post-parse affordance-matching heuristic that checks if the player's verb matches a registered affordance). If it returns `interact` but the target isn't found, the object needs to be room-accessible or the affordance needs to work without strict room co-location.

2. **Tune antagonist disclosure for confrontation scenes.** When the player arrives at the antagonist with accumulated evidence (has spoken to witnesses, examined the crime scene), the antagonist should be more revealing, not less. Consider passing accumulated knowledge/conversation history to the NPC cognition so Father Obed knows the player already spoke to Silas.

3. **Add environment-first rendering for examine actions.** When the player explicitly asks to "look around" or "examine the altar," the renderer should describe the environment BEFORE any NPC reaction. The current pattern where NPCs always block examination makes the world feel gated behind dialogue.
