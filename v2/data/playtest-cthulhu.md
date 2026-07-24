# Cthulhu Mystery Extended Playtest Report

**Date:** 2026-03-28
**Duration:** 155 seconds (10/10 turns completed, 0 fatal errors)
**Seed:** Innsmouth Cove 1920s Lovecraftian mystery
**Player:** Detective Crane, private investigator from Boston

---

## World Genesis

### Rooms Created (3)
1. **Marsh's Study** -- the locked-room crime scene
2. **Innsmouth Harbor** -- docks with the secretive fishermen
3. **Ancient Stone Church** -- cult headquarters on the cliff

Three rooms is the minimum viable set for this scenario. A fourth (e.g., Miskatonic University Library, a Boarding House, the Town Square) would have added investigative depth and prevented the feeling that the whole town is three buildings.

### NPCs Created (3)
| Name | Role | Room | Notable Aspirations |
|------|------|------|---------------------|
| Detective Thomas Malone | Private Investigator | Marsh's Study | Solve partner's cold case, expose municipal corruption |
| Ezekiel | Secretive Fisherman | Innsmouth Harbor | Catch the Abyssal Maw, build a tide-pool shrine to the Deep Voices |
| High Priest Zadok | Cult Leader | Ancient Stone Church | Recruit followers, decipher eldritch inscriptions on his tiara |

**Assessment:** NPC aspirations are excellent for the genre. Ezekiel wanting to build a "tide-pool shrine to the Deep Voices using salvaged shipwrecks and rare black pearls" is pure Lovecraft. Zadok's golden tiara being "fused to his skull and slowly eating his brain" is a great body-horror detail. Malone's partner's cold case creates good dramatic parallels with the current investigation.

### Objects Created (5)
- Necronomicon Fragment (Marsh's Study)
- Overturned Desk (Marsh's Study)
- Slimy Fishing Net (Innsmouth Harbor)
- Golden Idol (Ancient Stone Church)
- Black Candles (Ancient Stone Church)

Good thematic spread. Every object reinforces the setting.

### Custom Components Created (2)
- **Sanity** -- created as requested
- **OccultKnowledge** -- created as requested

Both were created, but there was **no visible evidence** of the sanity-decay system firing during gameplay. The seed asked for "a system that decays Sanity when OccultKnowledge exceeds 30" -- the God AI appears to have created the components but the system's runtime effect was not observable (no log line showing sanity loss when reading the forbidden text). This is the biggest mechanical gap.

### Custom Affordances Created (3)
- **investigate_clue** (requires: clue)
- **read_forbidden_text** (requires: forbidden_text)
- **interrogate_witness** (requires: witness)

All three were created as requested. However, they were never visibly triggered during gameplay -- the LIL intent parser likely mapped player actions to generic observe/speak/move actions rather than these custom affordances. The affordances exist in the registry but the pipeline doesn't route player commands to them.

---

## Story Scaffold

### Tensions (2)

**Tension 1: The Marsh Disappearance**
A four-beat arc from discovery to moral choice:
1. Setup: Malone finds a ledger of payments to "The Esoteric Order of Dagon"
2. Escalation: Ezekiel caught sinking a crate with Marsh's bloodstained notes
3. Crisis: Zadok reveals Marsh "ascended" -- shows a breathing mass in the basement
4. Resolution: Player chooses to burn or leak the evidence

**Tension 2: Ezekiel's Transformation**
A three-beat horror arc:
1. Setup: Malone notices Ezekiel's skin is no longer human
2. Escalation: Zadok's chant causes harbor water to boil, Ezekiel enters frenzy
3. Crisis: Ezekiel fully transforms, tries to drag Malone into the harbor

**Assessment:** Both tensions are genuinely Lovecraftian. The first tension follows a classic investigation-to-revelation structure. The second tension adds stakes and body horror. The moral choice in Tension 1's resolution is strong. All beat statuses remained "pending" throughout -- the narrative director did not advance them, suggesting the beat trigger conditions were too specific or the detection system did not fire.

### NPC Secrets
| NPC | Role | Secret |
|-----|------|--------|
| Malone | Protagonist | Found his partner's severed finger in Marsh's study years ago, suppressed the memory |
| Ezekiel | Witness | He locked Marsh's study door from the inside before escaping through the vents |
| Zadok | Antagonist | The golden tiara is fused to his skull and slowly eating his brain |

These secrets are excellent. Ezekiel's secret directly answers the locked-room mystery. Malone's secret creates a personal stake. Zadok's secret makes him simultaneously villain and victim.

---

## Investigation Quality (Per Turn)

### Turn 1: Examine the professor's study
**Input:** "I carefully examine the professor's study, looking for any clues about what happened."
**Result:** Malone describes the claw marks on the desk and the Necronomicon fragment. He says "the geometry on this page doesn't just describe a ritual, it maps a descent." He warns about "scratching behind the walls."
**Assessment:** Strong opening. Malone acts as a genre-appropriate exposition partner. The claw marks and non-Euclidean geometry are good Lovecraftian details. However, the player's examine action was routed through Malone's speech rather than a pure environmental description -- Detective Crane asked to examine, but Malone answered. This is a mild framing issue.

### Turn 2: Read the forbidden text
**Input:** "I pick up the forbidden text and read the first few pages, steeling myself."
**Result:** The air grows "heavy and cold, smelling of brine and rotting kelp." Malone panics and warns the player to stop. He reaches for laudanum.
**Assessment:** Atmospheric and genre-perfect. Malone's drug dependency adds character depth. However, **no Sanity cost was applied** despite the seed requesting it. The text's content was not described -- we're told about the reaction but not what was read.

### Turn 3: Examine the locked door
**Input:** "I examine the locked door -- how is it locked from the inside if the professor is gone?"
**Result:** The renderer describes "blank, peeling wallpaper where a door should be" and says "the walls have been shifting." Malone deflects to the claw marks.
**Assessment:** Interesting but problematic. The response implies the door has vanished, which is atmospheric but avoids the actual mystery (Ezekiel's secret is that he locked it from inside and escaped through vents). This should have been a clue-delivery moment. Instead the narrative went surreal. The mystery mechanics need tighter integration between scaffold secrets and room descriptions.

### Turn 4: Head to the harbor
**Input:** "I leave the study and head to the harbor to question the fishermen."
**Result:** Successfully moves to the harbor. Ezekiel is described with "wet scales on his neck." He warns the player away.
**Assessment:** Excellent transition. The movement worked cleanly. Ezekiel's description immediately signals his transformation (scales, webbed fingers, unblinking watery eyes). His dialogue is evasive and threatening in the right way. The sensory details (salt, brine, rot) are consistent.

### Turn 5: Ask about Marsh and the lights
**Input:** "I approach the nearest fisherman and ask about Professor Marsh and the strange lights."
**Result:** Ezekiel says Marsh "was a man who didn't know when to stop lookin' at the tide" and dismisses the lights as "the sea playin' tricks." Tells the player to go back to Boston.
**Assessment:** Good evasion that hints at deeper knowledge. Ezekiel's dialect is consistent. The warning "the air here don't suit your kind" implies the Deep Ones' territorial nature. However, no actual information was revealed -- a real investigation game needs some bread crumbs mixed with the stonewalling.

### Turn 6: Press about midnight services
**Input:** "I press harder -- I tell him I know about the midnight services at the church."
**Result:** Ezekiel tightens his grip, his skin glistens with "translucent sheen." He calls them "pious folk" and threatens that "the sea takes an interest in you."
**Assessment:** The pressure escalation works -- Ezekiel becomes more defensive and threatening. His physical transformation is subtly advancing (the translucent sheen). But again, no actual information breaks through. In a well-paced investigation, this is where the witness should crack slightly -- maybe let slip a name, a time, a detail. The NPC cognition is too uniformly evasive.
**Technical note:** A `SyntaxError` in knowledge extraction fired here (JSON parse failure in `knowledge-graph.ts:336`). Non-fatal but worth fixing.

### Turn 7: Head to the church
**Input:** "I head to the old church on the cliff."
**Result:** Successfully moves. Zadok is described with the golden tiara "fused to his brow" and green-flamed black candles. He immediately challenges the player.
**Assessment:** Excellent atmospheric transition. Zadok's description perfectly incorporates his secret (the fused tiara). The green flames are a nice touch. His opening line "you bring only the stench of the surface world" immediately establishes him as alien.

### Turn 8: Examine the altar and symbols
**Input:** "I look around the church carefully, examining the altar and any symbols."
**Result:** Zadok guards the altar protectively. He warns against touching the relics. He claws at the base of his golden crown in visible agony.
**Assessment:** The physical detail of Zadok clawing at the tiara that's eating his brain is a superb callback to his secret. The renderer chose to focus on Zadok's reaction rather than describing the symbols themselves, which limits the player's ability to gather information independently. The altar and symbols should have been described even if Zadok tried to block access.

### Turn 9: Ask about the professor
**Input:** "I ask the priest what he knows about the professor's disappearance."
**Result:** Zadok reveals Marsh "shares his blood" and says he "has not vanished" but "felt the pull of the tides." The Great Ones "reclaim" what is theirs.
**Assessment:** This is the strongest turn. Zadok directly references the scaffold's crisis beat ("Marsh didn't disappear, he ascended"). The blood relation detail is new and compelling. The question "do you hear the singing from the depths?" is classic Call of Cthulhu. This is where the investigation pays off.

### Turn 10: Confront with evidence
**Input:** "I confront him -- I tell him I found evidence linking the church to Marsh's research."
**Result:** Zadok sneers. He says "Marsh understood what you do not -- that the blood calls to the blood." He reveals the church is "the threshold" and invites the player to "join us in the chant."
**Assessment:** Good escalation. Zadok shifts from defensive to recruiting, which is a natural arc for a cult leader. "We do not research the deep; we prepare for its return" is a strong line. The invitation to join the chant creates a genuine player choice moment. The session ends on a cliffhanger, which is dramatically satisfying.

---

## Ambient World

**No ambient narration ticks were observed.** This is expected -- the test script uses the scripted (non-continuous) pipeline from `test-session.ts` rather than the dual-loop runtime with event collector. The world does not tick between player actions. NPCs do not act autonomously. The world clock advances 3 ticks per turn but no autonomous NPC cognition fires.

To get ambient narration, the test would need `dualLoop: true` and the chronicle subscriber from `mud-client.ts`. This was a deliberate tradeoff for test reliability.

---

## Technical Issues

1. **Knowledge extraction JSON parse error** (Turn 6): `SyntaxError: Expected ':' after property name in JSON at position 714` in `knowledge-graph.ts:336`. The LLM returned malformed JSON during knowledge extraction for Ezekiel. Non-fatal (caught by `.catch()`).

2. **No affordance routing**: The custom affordances (investigate_clue, read_forbidden_text, interrogate_witness) were created but never triggered. The LIL intent parser maps player input to generic action types (observe, speak, move) rather than custom affordances. This means the Sanity-cost system for reading forbidden texts never fires.

3. **No Sanity/OccultKnowledge gameplay effects**: Components were created but no mechanical effects were observed. Reading the Necronomicon should have cost Sanity. This is the system gap -- the God AI created the decay system definition but the ECS runtime didn't execute it during this session.

4. **No raw action format leaks**: All output was clean narrative prose. No JSON, no action type names, no ECS entity IDs leaked into player-facing text.

5. **No NPC location errors**: Malone stayed in the study, Ezekiel at the harbor, Zadok in the church. Player movement worked correctly. NPCs appeared only in their assigned rooms.

6. **No crashes or hangs**: All 10 turns completed. Total runtime 155 seconds (~15.5s per turn average including LLM calls).

---

## Overall Grade and Genre Assessment

### Does this feel like a Call of Cthulhu investigation?

**Yes, strongly.** The atmosphere is consistently Lovecraftian -- brine, decay, non-Euclidean geometry, body horror, forbidden knowledge, and an alien priesthood. The NPC voices are distinct and genre-appropriate. The escalation from academic mystery to cosmic horror follows the correct genre arc. Zadok's revelation about Marsh's "ascension" is a satisfying payoff.

### Would a player find this engaging?

**Mostly yes.** The prose quality is high. The NPCs feel like characters with interior lives. The setting is vivid. However, a player would become frustrated by two things: (1) the inability to gather concrete clues -- every turn produces atmosphere but few actionable leads, and (2) the lack of mechanical feedback (Sanity loss, OccultKnowledge tracking, affordance use). The investigation feels like reading a novel rather than solving a puzzle.

### Grade: B+

**Justification:**
- **Prose and atmosphere**: A (consistently excellent, genre-perfect)
- **NPC characterization**: A (distinct voices, secrets leak through behavior, inner thoughts visible)
- **Story scaffold quality**: A (compelling tensions, satisfying beats, strong secrets)
- **Investigation mechanics**: C (no clue objects found, no affordances triggered, no Sanity tracking)
- **Player agency**: B- (actions feel acknowledged but rarely produce new information)
- **World completeness**: B (3 rooms is thin, 3 NPCs is sufficient but tight)

### Top 3 Recommendations

1. **Wire affordances into intent parsing.** The custom affordances (investigate_clue, read_forbidden_text, interrogate_witness) exist but the LIL intent parser does not route player actions to them. When a player says "I examine the clue" or "I read the forbidden text," the parser should emit the corresponding affordance action, not a generic observe. This would activate the Sanity-cost mechanics and make the investigation feel like a game, not just a story.

2. **Add clue-delivery mechanics.** NPCs are uniformly evasive. After 2-3 turns of pressure, or when specific scaffold beats trigger, NPCs should crack and deliver concrete information (names, locations, objects, partial truths). The scaffold already has beat descriptions with specific revelations -- these need to flow into NPC speech when trigger conditions are met. Consider a "pressure threshold" system where repeated interrogation lowers an NPC's resistance score.

3. **Increase world density.** Add 1-2 more rooms (a boarding house for the player's base, a library or university annex for research). Add 1-2 more NPCs (a terrified townswoman, a university colleague). More rooms and NPCs create more paths through the mystery and reduce the feeling of a linear corridor. The seed material supports at least 5 locations.
