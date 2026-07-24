# ArgOS MUD Playtest Report v3

**Date:** 2026-03-28
**Script:** `src/mud/test-session.ts`
**Seed:** "A medieval village with a blacksmith forge, a cozy tavern, and a market. Rumors of bandits in the nearby forest."
**Model:** Gemini (via ai SDK)
**Purpose:** Assess whether the full cognitive stack is wired into NPC conversations.

---

## World Genesis

### What was created

**Rooms (4):** Blacksmith Forge, Cozy Tavern, Market Square, Nearby Forest -- consistent with v1/v2.

**NPCs (4):** Garret (blacksmith), Elara (tavern keeper), Thorne (bandit/scout), Finn (merchant). Names shifted slightly from prior runs but cast is equivalent.

**Objects (6):** Heavy Anvil, Forge Fire, Ale Keg, Wooden Table, Market Stall, Bandit Campfire -- functional, well-placed.

**Traits (2):** intoxicated, suspicious
**Relationship types (2):** SuspiciousOf, CustomerOf
**Custom Components (2):** Suspicion, Drunkenness

### Character Aspirations

- **Garret:** Forge a 'Masterwork' blade, upgrade to double-bellows furnace, find apprentice, discover star-iron smelting, commission stone house. Well-grounded, mechanically motivated.
- **Elara:** Develop 'Secret-Keeper's Ale', expand to a grand inn, compile hidden archive of secrets for leverage, mentor apprentice in active listening. Excellent -- gives narrative and mechanical reasons to pry.
- **Finn:** Capital boutique, exclusive silk/spice trading rights, broker peace between factions, collect rare pigments. Good merchant with ambition.
- **Thorne:** Amass untraceable gold for retirement under clean identity, perfect 'Invisible Shadow' infiltration, establish informant network, retrieve 'Shadow-Stitcher' daggers. Strong bandit archetype.

**Assessment: A-** -- Genesis quality remains excellent and consistent across all three runs.

---

## Story Scaffold

### Narrative Tensions

**Tension 1 -- Star-Iron Race:** A deposit of star-iron in the forest pits Garret's masterwork aspiration against Thorne's greed and Finn's commercial ambition. 4-act structure with clear setup (Finn arrives with shard), escalation (Thorne offers a deal to Garret), crisis (Finn hires protection), resolution (compromise sharing). Well-constructed and directly tied to character aspirations.

**Tension 2 -- Elara's Secrets Archive:** Elara lets slip to Thorne that she knows his true identity. Thorne attempts to break into her private quarters to destroy her archive. Resolves with Elara recruiting Thorne as her informant. Clever inversion -- the threat becomes an asset.

Both tensions interlock through Thorne (connective thread between both plots). Quality comparable to v1/v2.

### NPC Role Assignments

| NPC | Role | Assessment |
|-----|------|------------|
| Garret | catalyst | Good -- his star-iron need triggers the race |
| Elara | witness | Correct -- she observes and leverages information |
| Thorne | wild_card | Correct -- bandit with hidden family ties, could go either way |
| Finn | ally | Good -- commercial interest aligns with village benefit |

### Secrets

- **Garret:** The 'Masterwork' blade he is forging is actually a replica of a bandit lord's sword he broke years ago. Reliably generated across all three runs -- core dramatic hook.
- **Elara:** She knows the exact location of the 'Shadow-Stitcher' daggers (buried beneath the tavern's hearth). Creates a direct tie to Thorne's aspirations.
- **Finn:** His 'rare silks' are clever forgeries made of local wool and cheap dyes. Good dual-life tension.
- **Thorne:** He is the younger brother of the bandit leader and is planning a coup. Strong -- gives the antagonist depth and internal conflict.

**Assessment: A** -- Scaffold remains the strongest area. Comparable to v1/v2 with slightly different (equally good) dramatic configurations.

---

## Player Interaction Quality

### Turn 1: "I look around carefully, taking in every detail of my surroundings."

> The morning sun struggles to pierce the thick haze of the Blacksmith Forge, where the air tastes of soot and salt. Garret stands silhouetted against the roaring Forge Fire, his burly arms glistening with sweat as he works a piece of glowing steel atop the Heavy Anvil. Tools lie in disarray across the workspace, reflecting a mind clearly preoccupied by the mounting pressures of his trade. He looks up at you with a weary, guarded expression, his grip tightening on his hammer as if shielding his current project from prying eyes.

**Atmosphere:** Excellent -- soot, salt, silhouette, haze. Multiple ECS objects referenced (Forge Fire, Heavy Anvil).
**NPC behavior:** Garret is characterized through action (working steel, guarded expression, shielding his project). The "shielding his current project from prying eyes" hints at his secret (the replica blade) without dumping exposition.
**No hallucination:** Player looked around; the DM describes the room and its occupant. No invented materials or actions attributed to the player.
**No NPC dialogue:** Appropriate -- the player didn't address anyone directly.

**Rating: A-** -- Atmospheric, grounded, subtextually rich. No issues.

### Turn 2: "I approach the blacksmith and introduce myself. 'Well met. I'm a traveler -- just arrived. Fine forge you have here.'"

> The Forge Fire roars with a relentless intensity, filling the cramped space with an acrid smog that clings to your skin. Garret pauses his work, leaning his burly frame against the Heavy Anvil as he wipes a soot-stained hand across his strained brow. He offers a heavy but polite nod at your compliment, his voice grumbling with a hint of wariness over the rhythmic crackle of the burning coals. "Aye, it's a fine forge if you don't mind the heat and the soot. Name's Garret. You've picked a noisy morning to arrive -- sounds like Finn's got the whole square riled up about something."

**NPC speech:** Garret speaks directly to the player. He introduces himself, acknowledges the compliment, and references Finn and the Market Square -- advancing the scaffold tension organically.
**Scaffold integration:** "Finn's got the whole square riled up about something" ties to Tension 1 (Finn arriving with the star-iron shard). This is not exposition dumping; it is a natural conversational hook.
**Character voice:** Gruff, practical, slightly wary. "If you don't mind the heat and the soot" is good blacksmith voice.
**No hallucination:** The player introduced themselves; Garret responds to the introduction. Clean.

**v1 comparison:** v1 rated D (Garret ignored the player, repeated "peasant-grade iron"). v2 rated A- (similar quality). v3 matches v2.

**Rating: A-** -- Direct conversational engagement, scaffold-aware, in-character.

### Turn 3: "I ask him what he knows about the bandits people have been whispering about on the road."

> Morning light filters through the thick soot of the Blacksmith Forge, catching dancing sparks as Garret leans over the Heavy Anvil. The burly man wipes a bead of sweat from his brow, his jaw tightening with a hidden weight as he pauses his rhythmic hammering to eye you through the shimmering haze of the Forge Fire. "Bandits are a plague on the roads lately. I'd stay clear of the forest paths if I were you. Now, if you'll excuse me, I need to see why that loudmouth Finn is making such a racket in the square." He sets his tools aside with a weary sigh, his gaze already drifting toward the exit leading to the Market Square.

**NPC speech:** Garret directly addresses the bandit question. "Bandits are a plague on the roads" acknowledges the topic. "Stay clear of the forest paths" is practical, in-character advice from someone with reason to fear bandits (his secret about the broken blade).
**Secret integration:** His "jaw tightening with a hidden weight" and eagerness to change the subject ("if you'll excuse me") suggest he knows more than he's saying. The deflection feels character-motivated, not broken. However -- and this is important -- he does NOT reference the broken blade directly. His secret remains entirely in subtext conveyed by the DM's narration, not through anything the NPC cognition actually surfaced.
**Scaffold consistency:** Third reference to Finn and the Market Square across three turns. While consistent, this is becoming a thematic rut -- same as v2's shipment loop.
**Character voice:** "Loudmouth Finn" is a nice detail that implies a pre-existing relationship between the NPCs.

**v1 comparison:** v1 rated D+ (third "peasant-grade iron" repetition). v2 rated B+ (acknowledged bandits but same shipment loop). v3 is comparable to v2 -- the Finn/square reference replaces v2's Finn/shipment reference.

**Rating: B+** -- Direct response, character-consistent deflection, but the Finn reference is getting repetitive.

### Turn 4: "I thank him and head to the tavern for a drink and to hear the local gossip."

> As you prepare to depart the Blacksmith Forge, Garret calls out over the ring of his tools, "Wait, traveler. Since you've been wanderin', maybe you can help a smith in a bind. I'm lookin' for star-iron -- metal that fell from the sky. I'm all out, and I can't forge what I need to clear my debts without it. You see anythin' strange on your way here? A scorched patch of earth or a rock that didn't belong?" You transition into the amber warmth of the Cozy Tavern, where the savory aroma of roasted meat mingles with the scent of stale ale. Elara looks up from a Wooden Table, her cheerful expression masking a gaze that seems to weigh the value of your presence as she gestures toward the Ale Keg.

**This is the standout turn of the session.** Garret breaks from his guarded pattern and actively engages the player with a quest hook ("I'm lookin' for star-iron"). This draws directly from both the scaffold (Tension 1: star-iron race) and his aspiration (forge a Masterwork blade, discover star-iron smelting). The request is specific ("A scorched patch of earth or a rock that didn't belong?") and gives the player something to actually do.

**"I can't forge what I need to clear my debts without it"** -- this hints at his secret (the broken blade, the debt/retaliation fear) without explicit confession. This is the closest the session comes to an NPC drawing on their inner state to shape dialogue.

**Transition quality:** Natural. The DM narrates departure and arrival smoothly. Elara's introduction ("cheerful expression masking a gaze that seems to weigh the value of your presence") is strong characterization reflecting her witness/information-broker role.

**v1 comparison:** v1 rated B+ (smooth transition but no NPC depth). v2 rated A (Garret's off-screen Finn dialogue). v3 is at least as good -- Garret actively engages the player with a scaffold-grounded quest.

**Rating: A** -- Best turn of the session. NPC initiates meaningful dialogue, integrates scaffold and aspiration, provides player agency.

### Turn 5: "I look around the tavern and see who's here."

> The morning light filters weakly into the Cozy Tavern, illuminating dust motes that dance above a scarred Wooden Table. Elara works near a large Ale Keg, her expression bright yet calculating as she prepares for the hours ahead. She looks toward the door and remarks, "Bring a tray of evening ales to the forge; Garret's forge is always a hub of gossip when the sun goes down." The air remains still, smelling of roasted meat and the lingering scent of last night's spirits.

**Room description:** Atmospheric, grounded in ECS objects (Wooden Table, Ale Keg).
**Who's here:** Only Elara described. Same gap as v1 and v2 -- the DM doesn't explicitly say "It's just you and the innkeeper." This is a persistent minor issue across all three versions.
**Elara's dialogue:** "Bring a tray of evening ales to the forge; Garret's forge is always a hub of gossip when the sun goes down." This is oddly directed -- who is she talking to? It reads as if she is speaking to an employee, not to the player. This may be a leakage of her behavior policy (a "plan the evening" action) being narrated as dialogue directed at the player.
**Minor issue:** "calculating" used again for Elara (also in Turn 4). Mild repetition.

**Rating: B-** -- Atmospheric but the Elara dialogue is contextually off (addressed to no one / wrong target), and the "who's here" question isn't fully answered.

### Turn 6: "I sit at the bar and ask the innkeeper for a drink, and whether she's heard anything about trouble on the roads."

> The worn surface of the Wooden Table greets you as you settle into the shadows of the quiet common room. Elara pauses her cleaning to draw a foaming mug from the Ale Keg, her expression one of practiced warmth that masks a sharp, observant mind. She sets the drink before you and leans against the counter, her voice pitched for your ears alone: "Coming right up, sugar! As for the roads... well, you're right to be cautious. There's been whispers of nasty folk lurking in the treeline lately. Best to stay here where it's warm and safe, don't you think?" She gestures vaguely toward the direction of the Nearby Forest, her smile widening as she invites you to find sanctuary in her hearth's glow.

**THE CRITICAL TEST.** v1: Elara attacked the player (F). v2: Elara responded warmly with road warnings (A). v3: Same quality as v2.

**NPC speech:** Elara responds directly. "Coming right up, sugar!" -- natural, warm tavern-keeper voice. "Whispers of nasty folk lurking in the treeline" -- acknowledges the question with atmospheric detail. "Best to stay here where it's warm and safe" -- subtly serves her aspiration (expand tavern business, gather information from travelers who stay).
**Character voice:** Warm, conspiratorial ("pitched for your ears alone"), strategic. Consistent with her witness/information-broker characterization.
**Secret integration:** Her secret (knowing the location of the Shadow-Stitcher daggers) does not surface at all. Her ex-spy / archive-keeper identity manifests only as the "observant mind" description, which is DM narration rather than NPC cognition.
**No attack:** Completely resolved.

**Rating: A-** -- Strong conversational response, good character voice, well-grounded. Slight miss on not leveraging her deeper secrets or archive aspiration.

---

## Cognitive Stack Integration Assessment

**This is the central question for v3: Is the full cognitive stack wired into conversations?**

### The Architecture Gap

The most significant finding of this assessment is that `test-session.ts` (the script that was run) does NOT use the full cognitive stack. The mature `mud-client.ts` has a 10-step pipeline per NPC interaction:

1. Inject speech as perception
2. Record conversation turn for multi-turn coherence (`addConversationTurn`)
3. Full NPC cognition (`agentThink`)
4. Capture innerThought from Thought entities
5. Execute NPC response
6. Coerce to dialogue with innerThought attached (`coerceToDialogueResponse`)
7. Record NPC response as conversation turn
8. Knowledge extraction -- NPC learns memories and beliefs (`extractKnowledgeFromInteraction`)
9. Accumulate reflection importance
10. Speech impact -- impressions, goals, gossip (`processSpeechImpact`)

Plus: Step 5 in the game loop calls `propagateGossip(world)`.

**`test-session.ts` implements only steps 1, 3, and a partial version of step 6.** It is missing:
- `addConversationTurn` -- no multi-turn conversation memory
- `extractKnowledgeFromInteraction` -- no belief or memory formation
- `processSpeechImpact` -- no impressions, goal influence, or gossip
- `propagateGossip` -- no gossip propagation
- `coerceToDialogueResponse` -- uses an inline version without innerThought capture from Thought entities
- `accumulateImportance` -- no reflection importance tracking

### Per-Turn Cognitive Assessment

| Turn | Inner Thought Visible? | Memories/Secrets Referenced? | Multi-Turn Coherence? | Beliefs Formed? | Knowledge Extraction? | Gossip? | Personality? |
|------|----------------------|----------------------------|---------------------|----------------|---------------------|---------|-------------|
| 1 | No (no dialogue) | Secret hinted via DM subtext only | N/A (first turn) | No | No | No | Yes (guarded blacksmith) |
| 2 | No log output | Aspiration (Finn/shipment) via DM | Some -- Garret refers to "noisy morning" | No | No | No | Yes (gruff, practical) |
| 3 | No log output | Secret hinted (jaw tightening) via DM | Yes -- still on Finn/bandits theme | No | No | No | Yes (evasive) |
| 4 | No log output | Aspiration (star-iron, debts) via NPC speech | Yes -- builds on prior exchanges | No | No | No | Yes (opens up) |
| 5 | No log output | None | Weak -- Elara's line seems off-target | No | No | No | Partial (calculating) |
| 6 | No log output | None specific | No -- Elara treats player as new | No | No | No | Yes (warm, conspiratorial) |

**Inner Thoughts:** The `test-session.ts` code does capture thoughts from the Thought component (lines 106-110), but there are no log lines showing inner reasoning. The `world-renderer.ts` does receive innerThought when available, but the test script's inline coercion (lines 100-116) only passes innerThought for the attack-coercion case (line 99). For speak/think/observe actions, it constructs NpcResponse objects without the `innerThought` field. The renderer therefore has no inner monologue to weave into narration.

**Memories and Secrets:** NPCs reference scaffold information (aspirations, tensions) because this context is baked into their system prompts and the DM's narrative scaffold context. But there is zero evidence of dynamic memory recall or secret integration through the NPC's own cognition. The broken blade secret never surfaces in Garret's dialogue. Elara's archive/daggers secret never appears. All "secret hints" come from the DM layer embellishing NPC responses with scaffold subtext -- not from the NPCs themselves accessing their memory stores.

**Multi-Turn Coherence:** Without `addConversationTurn`, NPCs have no memory of previous exchanges within the session. Garret's thematic consistency across Turns 2-4 (Finn, the square, star-iron) comes from his scaffold and aspiration context being present in every `agentThink` call, not from conversation memory. Elara in Turn 6 treats the player as a new arrival despite Turn 5 already establishing contact -- evidence of no conversation history.

**Belief Formation:** `extractKnowledgeFromInteraction` is never called. Zero beliefs, impressions, or semantic memories are formed from any player conversation. If you told Garret "I found star-iron in the forest," he would not remember this in a subsequent turn.

**Knowledge Extraction:** Not wired. No `extracted: X memories, Y beliefs` log lines appear.

**Gossip Propagation:** `propagateGossip` is never called. No `[Gossip]` log lines. Even if Garret learned something from the player, it would never reach Elara or any other NPC.

**Personality:** This is the one area that works well. Both Garret and Elara have distinct voices. Garret is gruff, practical, guarded. Elara is warm, strategic, conspiratorial. This comes from their system prompts and the DM's characterization, and it is effective.

---

## Issues Found

### Critical

1. **`test-session.ts` is missing the full cognitive stack.** The mature `mud-client.ts` has conversation turns, knowledge extraction, speech impact, gossip propagation, innerThought capture, and importance accumulation. The test script has none of these. The test is evaluating a stripped-down pipeline, not the actual product.

2. **No innerThought passed to renderer for speech/think/observe actions.** Lines 100-116 of `test-session.ts` construct NpcResponse objects but only set `innerThought` for the attack-coercion fallback (line 99). The renderer supports innerThought rendering (line 184-186 of `world-renderer.ts`) but never receives it from this script.

### Major

3. **Garret's thematic repetition (Finn/square loop).** Across Turns 2, 3, and 4, Garret references Finn and the Market Square in every response. While scaffold-consistent, this is the same pattern as v2's shipment loop. Without conversation memory, the NPC cannot modulate disclosure depth across exchanges.

4. **Elara's off-target dialogue in Turn 5.** "Bring a tray of evening ales to the forge" appears directed at an employee, not the player. This suggests BT policy action leakage into narrated dialogue -- a mild form of the v1 "peasant-grade iron" issue.

### Minor

5. **Compile warning persists: "Identifier 'Drunkenness' has already been declared."** Same namespace collision as v1/v2 (previously Suspicion/Intoxication/Wealth). Non-fatal.

6. **"Who's here" gap persists.** Turn 5 does not enumerate room occupants. Present in all three versions.

7. **Mild descriptor repetition.** "Calculating" for Elara (Turns 4, 5). "Soot-stained" for Garret (Turns 2, 3). "Morning light/morning" in multiple turns. Less severe than v1 but still present.

### Resolved (from v1/v2)

- NPC ignores player speech: FIXED (since v2). Both NPCs engage directly.
- Attack narration leak: FIXED (since v2). No hostile actions.
- "Peasant-grade iron" loop: FIXED (since v2). No canned BT output.
- Player materials hallucinated: FIXED (since v2). No invented player actions.
- Hallucinated names: FIXED (since v2). No "Rusty Boar" equivalent.

---

## Quality Comparison

| Metric | v1 (D+) | v2 (B+) | v3 |
|--------|---------|---------|-----|
| Genesis quality | A- | A- | A- |
| Scaffold quality | A | A | A |
| NPC responds to speech | 0/3 | 3/3 | 3/3 |
| Quoted NPC dialogue | 0/6 turns | 4/6 turns | 4/6 turns |
| Attack/violence bugs | 1 (session-ending) | 0 | 0 |
| Inner thought visible in narration | Never | Never | Never |
| Memories/secrets in NPC speech | None | Hinted via DM | Hinted via DM |
| Multi-turn conversation memory | None | None | None |
| Belief/impression formation | None | None | None |
| Knowledge extraction | None | None | None |
| Gossip propagation | None | None | None |
| Personality in voice | Weak | Good | Good |
| Repetition | Severe (3x) | Moderate | Moderate |
| Compile warnings | 2 | 2 | 1 |
| Quest hooks from NPCs | 0 | 0 | 1 (star-iron) |

---

## Overall Grade: B+

**Same grade as v2, but for different reasons.**

v2 earned B+ by fixing critical bugs (attack leak, speech responsiveness, hallucination). v3 maintains all those fixes and adds one genuine improvement -- Garret's Turn 4 quest hook is the first time in three test runs that an NPC proactively engages the player with a scaffold-motivated request. This is a meaningful step toward interactive storytelling.

However, the core question of this assessment -- **is the full cognitive stack wired into conversations?** -- must be answered **no**. The cognitive infrastructure exists in `mud-client.ts` (conversation turns, knowledge extraction, speech impact, gossip propagation, innerThought capture) but `test-session.ts` does not use any of it. The test is evaluating a pipeline that is architecturally identical to v2.

**What would an A require:**
- Wire `test-session.ts` to use the same 10-step pipeline as `mud-client.ts`
- Visible evidence of inner reasoning in narration (innerThought woven into DM prose)
- NPC dialogue that references specific memories formed during the session
- Progressive disclosure: first ask gets deflection, second gets hint, third gets revelation
- At least one gossip propagation event visible in logs
- Belief formation logs showing NPCs updating their model of the player

**Grade breakdown:**
- Genesis: A- (unchanged across all versions)
- Scaffold: A (unchanged across all versions)
- NPC dialogue quality: B+ (functional, in-character, one excellent quest hook)
- Cognitive depth: D (infrastructure exists in mud-client.ts but not wired in test-session.ts)
- DM narration: B+ (atmospheric, grounded, mild repetition)
- Overall experience: B+ (reads as a playable MUD intro, but NPCs are charming surfaces without cognitive depth)

---

## Top 3 Recommendations

### 1. Unify `test-session.ts` with `mud-client.ts` cognitive pipeline

The test script should import and use the same `gameTurn()` function (or equivalent) from `mud-client.ts`. Currently the test has an inline `gameTurn()` that predates the cognitive stack additions. At minimum, add:
- `addConversationTurn` before and after each NPC exchange
- `extractKnowledgeFromInteraction` after each NPC response
- `processSpeechImpact` after each exchange
- `propagateGossip` in the game loop
- `coerceToDialogueResponse` with innerThought capture

This is the single highest-impact change -- it would immediately make the test exercise the full stack and reveal whether the cognitive infrastructure actually improves player-facing quality.

### 2. Pass innerThought to the renderer for all action types

In `test-session.ts` lines 100-116, capture the most recent Thought entity's content and attach it as `innerThought` to every NpcResponse, not just attack coercions. The renderer already supports this (line 184-186 of `world-renderer.ts`) and will weave it into narration as contemplative inner monologue, giving the DM material to show NPC reasoning.

### 3. Add conversation memory for progressive disclosure

With `addConversationTurn` wired in, the NPC's `agentThink()` call should include conversation history in its LLM context. This would enable the pattern: first ask about bandits gets a deflection, second ask gets "between you and me...", third ask gets the secret. This transforms NPCs from stateless responders into characters who build trust over time.
