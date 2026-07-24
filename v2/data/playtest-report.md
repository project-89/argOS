# ArgOS MUD Playtest Report

**Date:** 2026-03-28
**Script:** `src/mud/test-session.ts`
**Seed:** "A medieval village with a blacksmith forge, a cozy tavern, and a market. Rumors of bandits in the nearby forest."
**Model:** Gemini (via ai SDK)

---

## World Genesis

### What was created

**Rooms (4):** Blacksmith Forge, Cozy Tavern, Village Market, Nearby Forest -- matches the seed well, no unnecessary bloat.

**NPCs (4):** Garrick (blacksmith), Elara (tavern keeper), Kael (merchant/fence), Grimm (bandit/scout)

**Objects (6):** Heavy Anvil, Ale Keg, Tavern Table, Merchant Stall, Suspicious Crate, Fallen Log -- functional scene-dressing, appropriately placed.

**Traits (3):** smithable, intoxicating, hidden_loot
**Relationship types (2):** SuspiciousOf, OwesCoinTo
**Affordances (3):** forge_weapon, drink_beverage, search_loot
**Custom Components (2):** Intoxication, Suspicion

### Character Aspirations

Aspirations were **rich and character-specific** -- this is a clear strength:

- **Garrick:** Forge a masterpiece from star-metal, find an apprentice, earn Royal Armorer title. Well-grounded in his blacksmith identity.
- **Elara:** Expand tavern, perfect a signature ale ("Wit's End"), become the town's information hub. Excellent -- gives her mechanical reasons to pry for information.
- **Kael:** Establish a capital boutique, become the shadow king of bandits, secure a royal pardon. Good duality -- legitimate aspirations covering criminal reality.
- **Grimm:** Map hidden passes, master stealth, amass stolen wealth, find an apprentice. Solid bandit archetype with depth.

**Assessment: A-** -- Genesis produced a coherent, well-populated world with meaningful mechanical affordances and deeply characterized NPCs.

---

## Story Scaffold

### Narrative Tensions

**Tension 1 -- Star-Metal Power Struggle:** Kael offers Garrick access to "celestial ore" in exchange for forging weapons for criminals. Grimm intercepts the shipment. This escalates to Garrick being forced into the forest and Kael trying to frame him.

**Tension 2 -- Elara's Information Game:** Elara's quest for tavern gossip threatens to expose Kael's double-life. She blackmails him; he retaliates by sending Grimm to raid the tavern.

Both tensions are **well-constructed** with clear 4-act structures (setup/escalation/crisis/resolution) and they **interlock** -- Kael is the connective thread between both plots, and Grimm serves as the muscle in both.

### NPC Role Assignments

| NPC | Role | Assessment |
|-----|------|------------|
| Garrick | protagonist | Correct -- he's the honest craftsman caught in the web |
| Elara | wild_card | Good -- she plays both sides (supplies Grimm, blackmails Kael) |
| Kael | antagonist | Correct -- his criminal ambitions drive both tensions |
| Grimm | catalyst | Correct -- he triggers escalation without being the mastermind |

### Secrets

- **Garrick:** Once forged a blade for the bandit leader that broke in battle; fears retribution. **Compelling** -- gives him a reason to be afraid and compliant.
- **Elara:** Grimm's estranged sister; funnels him supplies for safety. **Excellent** -- creates a genuine moral conflict and explains her wild_card status.
- **Kael:** Has no real capital contact; his fine clothes are stolen from a murdered merchant. **Strong** -- his entire identity is a lie.
- **Grimm:** Found a map to a star-metal vein but can't read the ancient script. **Good** -- creates a natural reason to seek allies.

**Assessment: A** -- The scaffold is genuinely interesting. The tensions interlock, secrets create real dramatic potential, and the role assignments make sense. This is the system's strongest area.

---

## Player Interaction Quality

### Turn 1: "I look around carefully"

> The morning sun filters through soot-grimed windows, illuminating dancing sparks and the heavy iron anvil at the room's heart. Garrick wipes a sweat-slicked arm across his brow, his jaw tight with a tension that suggests his mind is on more than just simple smithing. He gestures dismissively at your materials, his voice gravelly and firm: "I cannot fulfill your request with such inferior, peasant-grade iron."

**Atmosphere:** Good -- soot, sparks, morning light, heat. Grounded in real objects (anvil).
**Problem:** "He gestures dismissively at your materials" -- the player has no materials. This is hallucinated. The player just looked around; they didn't present anything.
**Problem:** "I cannot fulfill your request" -- the player made no request. This is Garrick's BT output leaking. He's running his behavior policy (probably a reject-inferior-materials node) and the DM is narrating that policy output as if the player triggered it.
**Rating: C+** -- Atmospheric but the NPC response is contextually wrong.

### Turn 2: "I approach and introduce myself"

> Garrick turns, wiping his blackened hands on a grease-slicked leather apron. He surveys you with a grimace... Shaking his head, he gestures toward the heavy anvil, his posture stiffening as he prepares to lecture you on why such peasant-grade scrap is unworthy of his hammer.

**Problem:** Same issue. "Peasant-grade iron" again. Garrick is not responding to the player's introduction at all. He's running his autonomous behavior (probably an observe or interact action about his work) and the DM is narrating that as if it's his response.
**Problem:** No actual dialogue in response to the player's greeting. The player explicitly introduced themselves and got zero conversational engagement.
**Rating: D** -- Garrick ignores the player entirely. The DM narrates around this well but the interaction is broken at the cognition level.

### Turn 3: "I ask about bandits"

> "I cannot fulfill your request with such inferior, peasant-grade iron," he rumbles, his voice dropping to a cautious, low tone that betrays a flickering dread of the very outlaws you mention. He casts a wary glance toward the forest exit, his tensed muscles suggesting he is a man haunted by a debt -- or a blade -- that has already begun to rust.

**Problem:** THIRD time with "peasant-grade iron." Garrick's cognition is stuck in a loop. `agentThink()` keeps returning the same smithing-related action regardless of stimulus.
**Partial credit:** The DM is doing its best -- it correctly weaves in Garrick's secret (the broken blade, the fear of retribution) through body language. The "wary glance toward the forest exit" is atmospheric and narratively grounded.
**Problem:** Still no actual dialogue about bandits. The player asked a direct question and got a canned response about iron quality.
**Rating: D+** -- The DM's narrative craft is decent but the underlying NPC cognition is completely non-responsive.

### Turn 4: "I head to the tavern"

> Garrick nods as you depart... You step into the Rusty Boar, where the morning sun cuts through the gloom to highlight the dust motes dancing over the sticky tavern tables. Elara greets you with a sharp, cheerful smile, though her eyes remain keen and calculating as she assesses your travel-worn appearance.

**Good:** Smooth room transition. The DM narrates departure and arrival naturally.
**Good:** "Rusty Boar" -- the DM invented a name for the tavern that fits. (The room is called "Cozy Tavern" in ECS; the DM dressed it up.)
**Good:** Elara is characterized through her aspiration (information hub) -- "keen and calculating" reflects her role.
**Problem:** No actual NPC cognition was triggered here (it's a move action). But the DM fills in well.
**Rating: B+** -- Best turn so far. No NPC cognition to break things.

### Turn 5: "I look around the tavern and see who's here"

> Elara stands behind the bar, her sharp eyes tracking your movement with a calculating intensity that contrasts with her practiced, cheerful smile. She pauses her polishing of a wooden flagon...

**Problem:** Only Elara is described. The player asked "who's here" and only got Elara. If other NPCs are in other rooms, the DM should say "just the innkeeper." It doesn't explicitly confirm she's the only one present.
**Minor:** Repetitive phrasing -- "calculating" and "sharp eyes" used again from previous turn.
**Rating: B-** -- Atmospheric but repetitive, and doesn't fully answer the player's question.

### Turn 6: "I ask about trouble on the roads"

> Elara's quick smile vanishes, her gaze hardening into a look of pure, territorial aggression as she perceives your curiosity as a threat to her hidden designs. Instead of reaching for a flagon, she lunges across the bar with a snarl, her hands reaching to strike you in a sudden, unprovoked assault.

**CRITICAL BUG:** Elara physically attacks the player for asking about road trouble. This is completely immersion-breaking. Her cognition returned an "attack" action. Looking at the code in `test-session.ts` lines 93-94, there's a filter: `if (npcAction.type !== "attack" && npcAction.type !== "defend")` -- but this only prevents *executing* the action. The NPC response still gets passed to the renderer, which narrates the attack.

Wait -- actually examining the code more carefully: if the action is "attack", it skips execution but falls through to the NPC response section (lines 97-112). Since attack isn't "speak" or "think", it hits the else branch (line 102) which tries to find a recent thought. If no thought is found, it pushes the raw action: `npcResponses.push({ name: npcName, action: npcAction })`. So the attack action gets sent to the DM as an NPC response, and the DM narrates it faithfully.

**This is the worst outcome in the session.** A tavern keeper lunging at a customer for asking about road conditions is absurd and destroys any narrative credibility built up.

**Rating: F** -- Session-ending bug. The attack filter in test-session.ts prevents execution but not narration.

---

## Narrative Grounding

### Consistency with scaffold roles

- **Garrick (protagonist):** His fear of bandits (broken blade secret) comes through in body language, but he never actually engages with the player. His scaffold role is wasted because his cognition is stuck on smithing concerns.
- **Elara (wild_card):** Her calculating nature comes through initially, but the attack at the end is wildly inconsistent with someone who wants to be the town's information broker. A wild_card should be unpredictable in *allegiance*, not randomly violent.
- **Kael and Grimm:** Never encountered during the session, so their scaffold roles are untested.

### Secrets and hidden motivations

The DM does incorporate secret knowledge through **subtext rather than exposition**, which is the correct approach:
- Garrick's "wary glance toward the forest" hints at his bandit connection
- Elara's "calculating" demeanor reflects her information-broker aspirations

However, no secrets ever surface through actual dialogue because NPC cognition never produces relevant speech responses.

### Time of day and atmosphere

Consistently "morning" throughout. The DM uses this well -- morning light, forge fire against dawn, dust motes. However, the world clock advances 3 ticks per turn (18 total across 6 turns with ticksPerPeriod=30), so it should still be morning. No issues here.

---

## Issues Found

### Critical

1. **NPC cognition ignores player speech stimulus.** `agentThink()` returns behavior-policy actions (smithing, observing) regardless of the `directed_speech` perception injected. The BT policy dominates over speech handling. This is the root cause of Garrick's "peasant iron" loop and Elara's attack.

2. **Attack action narrated despite being filtered from execution.** The code at lines 93-94 of `test-session.ts` prevents executing attack/defend actions but still passes them to the renderer. The attack action should be caught and replaced with a fallback (e.g., hostile silence) before reaching the DM prompt.

3. **Compile error: "Identifier 'Suspicion' has already been declared" and "Identifier 'Intoxication' has already been declared."** These appear twice in the output. The custom components created during genesis conflict with identically-named imports or globals. This doesn't crash the session but suggests a namespace collision in the component registry.

### Major

4. **No actual NPC dialogue in any turn.** Across 6 player turns with 3 direct speech attempts, zero turns produced NPC dialogue in quotes. Every NPC "response" was narrated as body language or internal state. The system is functioning as a solo narration engine, not a conversational MUD.

5. **Repetitive DM prose.** "Peasant-grade iron" appears 3 times. "Calculating" appears in 3 consecutive Elara turns. "Morning sun" appears in nearly every response. The DM prompt doesn't include enough anti-repetition guidance or the conversation history isn't weighted heavily enough.

### Minor

6. **"Rusty Boar" hallucination.** The room is called "Cozy Tavern" in ECS but the DM invents "Rusty Boar." This is minor (it's atmospheric) but violates the system's core principle of only describing what exists in the world state.

7. **Player materials hallucinated.** Turn 1 describes the player presenting materials to Garrick, which never happened.

---

## Overall Grade: D+

**Justification:**

The system has genuinely impressive **infrastructure** -- the genesis pipeline produces a rich, well-characterized world; the story scaffold is sophisticated with interlocking tensions and meaningful secrets; the DM prompt engineering shows craft and care. The architecture is sound.

But the **runtime experience** is broken at the most fundamental level: NPCs do not respond to player speech. In a MUD, conversational interaction is the core loop. When every NPC ignores what you say and either repeats canned behavior-policy actions or attacks you, the system fails at its primary purpose.

The scaffold (A grade) is wasted because NPC cognition (F grade) never draws on it during interaction. The DM layer (B- grade) does impressive work papering over bad NPC responses but cannot compensate for an attack action or a 3x repeated canned line.

---

## Top 3 Recommendations

### 1. Fix speech-response priority in `agentThink()`

When `directed_speech` perception is present, it must override the behavior policy. The cognition priority chain in `agent-mind.ts` should check for pending speech stimuli *before* falling into the BT policy. This is the single highest-impact fix -- without it, the MUD is non-functional as an interactive experience.

**Suggested approach:** In `processAgentCognition()`, before evaluating the behavior policy, check if the agent has a `directed_speech` perception. If so, force an LLM think/speak cycle that incorporates the speech content, the NPC's memories/secrets, and the scaffold context. Only fall back to BT policy if no speech is pending.

### 2. Fix the attack-action narration leak

In `test-session.ts` (and in `mud-client.ts` if it has similar logic), when an NPC returns an attack/defend action in response to speech, replace it with a hostile-but-narrative-safe response before sending to the renderer. Options:
- Coerce to `{ type: "speak", content: "Get out." }` or similar hostile dialogue
- Generate a brief LLM response with the NPC's hostile intent expressed verbally
- At minimum, filter attack actions from `npcResponses` entirely and let the DM narrate silence

### 3. Add anti-repetition to the DM prompt

The DM system prompt should include an explicit instruction: "Never repeat phrases from your previous responses. Check the conversation history and avoid reusing descriptions, adjectives, or NPC lines." The conversation history is already passed (last 3 entries) but the prompt doesn't emphasize novelty strongly enough. Consider also passing a "do not use these phrases" list extracted from recent DM outputs.
