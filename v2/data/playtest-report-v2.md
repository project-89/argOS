# ArgOS MUD Playtest Report v2

**Date:** 2026-03-28
**Script:** `src/mud/test-session.ts`
**Seed:** "A medieval village with a blacksmith forge, a cozy tavern, and a market. Rumors of bandits in the nearby forest."
**Model:** Gemini (via ai SDK)
**Purpose:** Regression test after fixes for NPC speech responsiveness, attack narration leak, and DM prose repetition.

---

## World Genesis

### What was created

**Rooms (4):** Blacksmith Forge, Cozy Tavern, Village Market, Nearby Forest -- identical to v1, consistent.

**NPCs (4):** Garrick (blacksmith), Elara (tavern keeper), Finn (merchant -- was "Kael" in v1), Kael (bandit/scout -- was "Grimm" in v1). Roles shifted slightly but the cast is equivalent.

**Objects (10):** Heavy Anvil, Smoldering Forge, Cask of Ale, Tavern Table, Merchant Cart, Shady Thicket, Woolen Blankets, Apple Basket, Tavern Lute, Bubbling Stew -- more objects than v1 (6), giving the world more texture.

**Traits (3):** bandit_rumor, merchant_goods, forgeable
**Relationship types (2):** SuspiciousOf, RegularCustomer
**Affordances (2):** gossip_about_bandits, haggle_price
**Custom Components (2):** Suspicion, Wealth (same namespace collision issue as v1 -- see below)

### Character Aspirations

- **Garrick:** Forge a masterwork blade from meteoric iron, secure a guard armorer contract, find an apprentice, build a blast furnace, make farming tools for the village. Rich and well-grounded.
- **Elara:** Transform tavern into the most renowned inn, perfect a "Healer's Ale," renovate upper floors, mentor an orphan, compile a "Book of Secrets." Excellent -- gives her mechanical and narrative reasons to gather information.
- **Finn (new):** Permanent storefront, silk monopoly, Merchant Council seat, master "The Silent Sale," fund a sea expedition. Good merchant archetype with ambition.
- **Kael:** Master "Shadow Walk," map smuggler tunnels, amass 500 gold for a pardon, become "Master of Whispers." Strong bandit with depth.

**Assessment: A-** -- Genesis quality remains excellent. Slightly richer object placement than v1. Comparable overall.

---

## Story Scaffold

### Narrative Tensions

**Tension 1 -- Meteoric Iron Shipment:** Finn has acquired meteoric iron for Garrick, but Kael's bandit crew has caught wind. Will the iron reach the forge or fund the bandits? 4-act structure (setup/escalation/crisis/resolution) is clean and well-motivated.

**Tension 2 -- Elara's Book of Secrets:** Elara's book contains info about a high official funding the bandits. Kael needs it for his "Master of Whispers" title; Elara needs it to protect the village. Strong dual-use conflict.

Both tensions **interlock** through Kael (connective thread) and are at least as good as v1's scaffold.

### NPC Role Assignments

| NPC | Role | Assessment |
|-----|------|------------|
| Garrick | protagonist | Correct -- honest craftsman caught in the web |
| Elara | wild_card | Correct -- ex-spy with ambiguous loyalties |
| Finn | catalyst | Good -- his shipment triggers the tension |
| Kael | antagonist | Correct -- his bandit ambitions drive both tensions |

### Secrets

- **Garrick:** Once crafted a blade for the bandit leader that broke in battle; fears retaliation. Same as v1 -- reliably generated.
- **Elara:** Former high-ranking spy for the regional guard. Different from v1 (was Grimm's sister). Both are good; this one gives her more competence and justifies her "wild_card" role.
- **Finn:** Smuggling bandit loot disguised as "foreign silks." Creates a nice dual-life tension.
- **Kael:** Son of an exiled village elder, looking for his father's grave. Gives the antagonist unexpected pathos.

**Assessment: A** -- Scaffold remains the system's strongest area. Comparable to v1.

---

## Player Interaction Quality

### Turn 1: "I look around carefully, taking in every detail of my surroundings."

> The Smoldering Forge pulses with a fierce orange light, casting long, dancing shadows across the Heavy Anvil's dented surface. Garrick stands amidst the stifling heat, his soot-stained hands trembling slightly as he stares toward the threshold leading to the Village Market. He wipes a bead of sweat from his thick beard, his eyes reflecting a deep-seated worry that has nothing to do with the morning's labor. "Finn should have been here by first light," he mutters, his voice a low rumble over the crackle of the coals. "If that shipment doesn't arrive soon, there will be nothing left to hammer but cold air."

**Atmosphere:** Excellent -- forge glow, shadows, heat, object references (Anvil, Forge) all grounded in ECS state.
**NPC speech:** Garrick actually speaks. His dialogue references the scaffold tension (Finn's shipment) and his aspiration (masterwork blade). This is a massive improvement over v1 where he just repeated "peasant-grade iron."
**Grounding:** "Finn should have been here by first light" -- draws directly from scaffold Tension 1. His worry about the shipment is character-appropriate and narratively loaded.
**No hallucination:** Unlike v1, the player's action (looking around) is correctly interpreted. No invented materials or requests.

**v1 comparison:** v1 rated C+ (hallucinated player materials, BT output leaked "peasant-grade iron"). This is categorically better.

**Rating: A-** -- Atmospheric, grounded, NPC speaks relevant dialogue. Only nitpick: the player didn't directly address Garrick, so the unprompted monologue is slightly forward -- but it reads naturally as the blacksmith thinking aloud.

### Turn 2: "I approach the blacksmith and introduce myself."

> Morning light filters through the haze of the Blacksmith Forge, catching the glint of the Heavy Anvil as you offer your greetings. Garrick pauses his work, his soot-stained hands tightening around his leather apron as he eyes you with a preoccupied frown. "Aye, it's a sturdy forge. Watch your step, stranger -- the heat's no joke. I've got to head to the market to check on a shipment, so make yourself scarce if you aren't buying," he rumbles, his voice taut with a restless anxiety. He glances toward the Smoldering Forge one last time before moving toward the door, clearly eager to reach the Village Market.

**NPC speech:** Garrick responds directly to the player's greeting ("Aye, it's a sturdy forge"). He engages conversationally. He mentions the shipment again -- consistent with his scaffold preoccupation.
**Character voice:** Gruff, impatient, preoccupied -- consistent with a protagonist under pressure. "Make yourself scarce if you aren't buying" is in-character for a worried blacksmith, not hostile.
**Grounding:** References Heavy Anvil, Smoldering Forge, Village Market -- all ECS entities. No hallucination.

**v1 comparison:** v1 rated D (Garrick ignored the player entirely, repeated "peasant-grade iron" again, zero conversational engagement). Night-and-day improvement.

**Rating: A-** -- Direct conversational response, in-character, grounded. Garrick's preoccupation with Finn feels natural rather than robotic.

### Turn 3: "I ask him what he knows about the bandits."

> Garrick wipes soot from his brow, his silhouette framed by the intense orange glow radiating from the Smoldering Forge. He rests a calloused hand upon the Heavy Anvil, his gaze hardening as he dismisses your question with a weary grunt. "I've said my piece to the traveler. Now I need to get to the market and see if Finn has shown up with that iron. Can't forge a masterwork with thin air, and those bandit rumors have me on edge." With a heavy sigh, he begins to tidy his workstation, clearly anxious to depart for the Village Market.

**NPC speech:** Garrick speaks again ("I've said my piece..."). He acknowledges the bandit question ("those bandit rumors have me on edge") but deflects -- which is consistent with his secret (he fears retaliation for the broken blade and doesn't want to discuss bandits openly). This is subtle characterization.
**Secret integration:** The deflection reads as motivated by his secret, not as a cognition failure. He's on edge about bandits specifically because of his history with them.
**Scaffold consistency:** Still focused on the Finn/iron shipment. Three turns in, and the NPC has maintained a coherent through-line.
**Minor issue:** "I've said my piece to the traveler" -- slightly odd self-reference. He's talking about the player in third person while addressing them.

**v1 comparison:** v1 rated D+ (third repeat of "peasant-grade iron," no bandit discussion at all). In v2, Garrick at least acknowledges bandits and his anxiety about them, even if he doesn't share details. The deflection feels intentional rather than broken.

**Rating: B+** -- Garrick's evasion is character-consistent and narratively interesting. The player gets a hint (he's on edge about bandits) without exposition dumping. Slight phrasing oddness.

### Turn 4: "I thank him and head to the tavern."

> The forge stands abandoned when you turn to offer your thanks, leaving your words to echo fruitlessly against the cold anvil. Garrick's gruff voice seems to haunt the empty workshop, a lingering remnant of his earlier impatience: "Finn! About time. I've been waiting on that shipment. Tell me you've got the meteoric iron and didn't lose it to those bandits I've been hearing about." You retreat to the Cozy Tavern, where the savory aroma of Bubbling Stew and a silent Tavern Lute greet the morning quiet. Elara looks up from a Cask of Ale with a hospitable grin, though her keen gaze tracks your movement toward a Tavern Table with a focus that suggests she misses very little.

**Transition:** Smooth departure and arrival, same quality as v1.
**Narrative craft:** "The forge stands abandoned" implies Garrick left for the market while the player was saying goodbye. This is excellent -- it shows the world moving independently. The DM narrates Garrick's off-screen dialogue with Finn, which advances the scaffold tension organically.
**Object grounding:** Bubbling Stew, Tavern Lute, Cask of Ale, Tavern Table -- all ECS entities. No hallucinated names (v1 invented "Rusty Boar" for the tavern).
**Elara introduction:** "hospitable grin" with "keen gaze" -- consistent with her wild_card/ex-spy characterization.

**v1 comparison:** v1 rated B+ (also smooth, but invented "Rusty Boar"). v2 is slightly better because it advances the scaffold tension through Garrick's off-screen action.

**Rating: A** -- Best transition possible. World feels alive. No hallucination.

### Turn 5: "I look around the tavern and see who's here."

> Morning light spills across the room, illuminating the savory steam rising from the Bubbling Stew over the hearth. Elara stands near a heavy Cask of Ale, her sharp, observant gaze softening into a welcoming smile as she acknowledges your arrival. She gestures toward an empty Tavern Table with a cheerful nod, her posture relaxed yet her eyes remaining keen and watchful of the room. In the quiet corner, a worn Tavern Lute leans against the wall, its strings silent in the morning calm.

**Room description:** Atmospheric, grounded in ECS objects (Bubbling Stew, Cask of Ale, Tavern Table, Tavern Lute).
**Who's here:** Only Elara described, which is correct if she's the only NPC in the room. However, the DM doesn't explicitly say "You're alone with the innkeeper" -- same gap as v1.
**Repetition check:** "keen" appears once (vs. twice in v1's equivalent turn). "Morning light" used (also used in Turn 2). Minor repetition but significantly less than v1's three-peat of "peasant-grade iron."

**v1 comparison:** v1 rated B- (repetitive "calculating" and "sharp eyes"). v2 is marginally better -- less repetitive, same completeness gap.

**Rating: B** -- Atmospheric and grounded but doesn't fully answer "who's here" and has mild repetition.

### Turn 6: "I sit at the bar and ask the innkeeper for a drink, and whether she's heard anything about trouble on the roads."

> The sturdy wood of the Tavern Table feels cool beneath your palms as the savory scent of Bubbling Stew wafts through the sunlit room. Elara approaches with a rhythmic, confident step, her keen eyes briefly studying your gear before she pulls a frothy mug from the Cask of Ale. She slides the drink toward you, her voice warm yet laced with a subtle, watchful edge. "Coming right up, friend! A fresh mug of ale is just what the morning calls for. As for the roads... let's just say the whispers from the Nearby Forest haven't been the friendliest lately. Keep your wits about you." Near the corner where the Tavern Lute rests, she lingers for a moment, her gaze drifting toward the window as if weighing the truth of the rumors she shares.

**THIS IS THE CRITICAL TEST.** In v1, the equivalent turn produced Elara lunging across the bar to attack the player -- an F-grade session-ending bug.

**NPC speech:** Elara speaks directly to the player with quoted dialogue. "Coming right up, friend!" -- natural, in-character tavern banter. "As for the roads... let's just say the whispers from the Nearby Forest haven't been the friendliest lately." -- she answers the player's actual question about road trouble. This is the fix working as intended.
**Character voice:** Warm but guarded. "Keep your wits about you" is a subtle warning that fits her wild_card/ex-spy characterization -- she knows more than she's saying.
**Secret integration:** Her secret (former spy) manifests as the "watchful edge" and the careful way she answers without revealing specifics. She's hedging -- she has real intel but isn't sharing it with a stranger yet. This is exactly how a well-characterized NPC should behave.
**Object grounding:** Cask of Ale (she pulls a mug from it), Bubbling Stew, Tavern Table, Tavern Lute -- all grounded.
**No attack:** The attack narration leak is completely gone.

**v1 comparison:** v1 rated F (Elara attacked the player, session-ending bug). v2 is a complete fix -- Elara responds with natural, character-appropriate dialogue.

**Rating: A** -- The single worst bug in v1 is fully resolved. Elara engages conversationally, answers the question, stays in character, and hints at deeper knowledge without exposition dumping.

---

## Narrative Grounding

### Consistency with scaffold roles

- **Garrick (protagonist):** His preoccupation with Finn's shipment and anxiety about bandits come through in every turn. His secret (the broken blade) manifests as evasion when asked about bandits directly. The scaffold is being used. **Massively improved from v1.**
- **Elara (wild_card):** Her guarded warmth and careful information-sharing are consistent with an ex-spy running a tavern. She neither reveals everything nor shuts down the conversation. **Massively improved from v1** (where she attacked the player).
- **Finn and Kael:** Not directly encountered, but Finn is referenced by Garrick in Turns 1-4 as an off-screen presence. The scaffold tension (the iron shipment) is felt through NPC dialogue without the player needing to meet every NPC. Good use of indirect narrative.

### Secrets and hidden motivations

Secrets now surface through **both subtext AND dialogue**, which is the ideal approach:
- Garrick's "those bandit rumors have me on edge" (Turn 3) hints at his secret without revealing it
- Elara's hedging ("let's just say the whispers...") hints at her deeper knowledge
- The DM uses body language to reinforce: Garrick's "gaze hardening," Elara's "watchful edge"

This is a qualitative improvement over v1, where secrets only appeared in body language descriptions because NPCs never spoke.

### Time and atmosphere

Consistently morning throughout (18 ticks across 6 turns with ticksPerPeriod=30). The DM uses this well with morning light, forge fire, and morning quiet. No inconsistencies.

---

## Issues Found

### Persisting (from v1)

1. **Compile warnings: "Identifier 'Wealth' has already been declared" and "Identifier 'Suspicion' has already been declared."** Same namespace collision as v1. Non-fatal but indicates a component registry issue with god-created components conflicting with existing declarations.

2. **Incomplete "who's here" response (Turn 5).** The DM doesn't explicitly state whether the player and Elara are alone. This is minor but was also present in v1.

### New / Minor

3. **Garrick's third-person self-reference (Turn 3).** "I've said my piece to the traveler" -- he talks about the player in third person while addressing them. Minor phrasing issue, likely from the LLM merging inner thought with dialogue.

4. **Mild repetition in descriptors.** "Keen" used for Elara in Turns 4, 5, and 6. "Morning light/morning" appears in Turns 2, 4, 5. Less severe than v1's three-peat of "peasant-grade iron" but the anti-repetition work could go further. "Soot-stained" used for Garrick in Turns 1, 2, 3 (appropriate for a blacksmith, arguably not a bug).

5. **Garrick's urgency loop.** Across Turns 1-3, Garrick's responses all center on Finn's shipment. While this is scaffold-consistent (and much better than v1's "peasant iron" loop), it means the player gets the same thematic answer three times. Ideally, by Turn 3, when asked about bandits specifically, Garrick would share more -- perhaps a guarded hint about his secret. The cognition correctly deflects, but a follow-up question should unlock deeper dialogue.

### Resolved (from v1)

- **NPC cognition ignores player speech** -- FIXED. Both Garrick and Elara now respond to direct speech with contextually appropriate dialogue.
- **Attack action narrated despite being filtered** -- FIXED. The code now coerces attack/defend to an observe action with "eyes narrow with suspicion" inner thought. Elara's Turn 6 produced natural dialogue instead.
- **No actual NPC dialogue in any turn** -- FIXED. 4 out of 6 turns contain quoted NPC dialogue. The two without (Turns 4 and 5) are appropriately non-conversational (a room transition and a look-around).
- **Player materials hallucinated** -- FIXED. No hallucinated player actions in any turn.
- **"Rusty Boar" name hallucination** -- FIXED. The tavern is referred to as "Cozy Tavern" or described without an invented name.

---

## Overall Grade: B+

**Justification:**

The three targeted fixes all landed successfully:

1. **NPC speech responsiveness (F -> A):** The directed_speech perception now correctly triggers LLM-driven dialogue that bypasses the BT policy. Garrick speaks about his scaffold concerns; Elara answers the player's question. This single fix transforms the system from a solo narration engine into an actual interactive MUD.

2. **Attack narration leak (F -> non-issue):** The coercion of attack/defend to observe with an inner thought is a clean fix. It never triggered in this session (Elara responded with speech rather than attack), suggesting the underlying cognition is also improved -- not just the safety net.

3. **DM prose repetition (D -> B):** Reduced but not eliminated. "Peasant-grade iron" x3 is gone. "Keen" x3 for Elara and the Garrick shipment loop are milder forms of the same pattern. The anti-repetition improvements help but there's room for further work.

**Grade breakdown:**
- Genesis: A- (unchanged)
- Scaffold: A (unchanged)
- NPC dialogue: B+ (was F -- now functional with room for depth)
- DM narration: B+ (was C -- less repetitive, better grounding, no hallucination)
- Overall experience: B+ (was D+ -- the session now reads as a playable MUD intro)

**What keeps this from an A:** Garrick's responses, while in-character, are thematically repetitive across three turns (shipment, shipment, shipment). A truly responsive NPC would vary the depth of disclosure based on conversational history -- the first mention of bandits gets a deflection, the second gets a guarded hint, the third gets a reluctant confession. The cognition currently treats each turn independently rather than building conversational momentum. Additionally, the "who's here" gap in Turn 5 and mild descriptor repetition (keen, morning) are quality-of-life issues that affect immersion.

---

## v1 vs v2 Comparison Summary

| Metric | v1 | v2 | Change |
|--------|----|----|--------|
| Genesis quality | A- | A- | Same |
| Scaffold quality | A | A | Same |
| NPC responds to speech | 0/3 attempts | 3/3 attempts | Fixed |
| Quoted NPC dialogue | 0/6 turns | 4/6 turns | Fixed |
| Attack/violence bugs | 1 (session-ending) | 0 | Fixed |
| Hallucinated player actions | 1 (materials) | 0 | Fixed |
| Hallucinated world details | 1 (Rusty Boar) | 0 | Fixed |
| Repeated canned phrases | 3x "peasant-grade iron" | None | Fixed |
| Mild descriptor repetition | Heavy | Moderate | Improved |
| Compile warnings | 2 | 2 | Same |
| Overall grade | D+ | B+ | +2 full grades |

---

## Top 3 Remaining Recommendations

### 1. Conversational memory within a turn sequence

The NPC cognition treats each `agentThink()` call independently. Garrick gives essentially the same answer about the shipment three times because he has no memory of the prior exchange within this session. Adding a short-term conversational buffer (last 2-3 exchanges with this interlocutor) to the LLM context would enable progressive disclosure -- deflect on first ask, hint on second, reveal on third.

### 2. Explicit room occupancy in "look" responses

When the player asks "who's here," the DM should enumerate all present NPCs by name and note if the room is otherwise empty. This requires the renderer prompt to explicitly list room occupants and instruct the LLM to mention each one.

### 3. Descriptor diversity enforcement

Add a "recently used phrases" list from the last 3 DM outputs to the renderer prompt, with an explicit instruction to avoid them. "Keen," "morning light," and character-specific descriptors like "soot-stained" could benefit from synonym rotation. This is a prompt engineering task, not an architecture change.
