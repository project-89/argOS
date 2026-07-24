/**
 * Linguistic Integration Layer — World Renderer
 *
 * State → Narrative: Converts ECS state + narrative context into
 * atmospheric prose. This is the other half of the LIL.
 *
 * The renderer is context-aware:
 *   - Reads NPC inner state (goals, memories, impressions) for grounded dialogue
 *   - Reads the story scaffold for narrative tension context
 *   - Reads time of day, weather, world events for atmosphere
 *   - Weaves NPC responses (from their actual cognition) into the narration
 *
 * The key principle: the renderer DESCRIBES what the ECS contains.
 * It never invents rooms, people, or objects that don't exist.
 * NPC dialogue is grounded in their real memories and goals.
 */

import { generateText } from "ai";
import { renderModel } from "../llm/config";
import type { WorldSnapshot, PersonSnapshot } from "./world-snapshot";
import type { ParsedIntent, ConversationEntry } from "./intent-parser";
import { formatScaffoldForContext } from "../nle/story-scaffold";

// =============================================================================
// TYPES
// =============================================================================

export interface NpcResponse {
  name: string;
  action: { type: string; target?: string; content?: string };
  innerThought?: string;
}

export interface RenderContext {
  snapshot: WorldSnapshot;
  playerIntent: ParsedIntent;
  npcResponses: NpcResponse[];
  conversationHistory: ConversationEntry[];
  /** State changes from this turn — what the renderer should describe changing */
  stateChanges?: {
    componentChanges: Record<string, Record<string, { before: any; after: any }>>;
    arrivals: string[];
    departures: string[];
    objectsAdded: string[];
    objectsRemoved: string[];
    playerMoved?: { from: string; to: string };
  };
  /** Genre for tone: "horror", "fantasy", "noir", "scifi" */
  genre?: string;
}

// =============================================================================
// MAIN RENDERER
// =============================================================================

/**
 * Render the result of a player's action as narrative prose.
 * Weaves together the player's action, NPC responses, world state,
 * and narrative context into atmospheric 2nd-person text.
 */
export async function renderNarrative(ctx: RenderContext): Promise<string> {
  const { snapshot, playerIntent, npcResponses, conversationHistory, stateChanges, genre } = ctx;

  const systemPrompt = buildDMSystemPrompt(snapshot, genre);
  const userPrompt = buildDMUserPrompt(snapshot, playerIntent, npcResponses, conversationHistory, stateChanges);

  try {
    const result = await generateText({
      model: renderModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // Clean any markdown formatting
    return result.text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
  } catch (err) {
    // Fallback: basic narration without LLM
    return buildFallbackNarration(snapshot, playerIntent, npcResponses);
  }
}

/**
 * Render a room description without a player action (initial look, room entry).
 */
export async function renderRoomDescription(snapshot: WorldSnapshot): Promise<string> {
  const prompt = `Describe this location in 2nd person, 2-3 vivid sentences. Ground in the actual data below. Don't invent anything not listed.

Location: ${snapshot.roomName} — ${snapshot.roomDescription}
Time: ${snapshot.timeOfDay}, Day ${snapshot.day}
${snapshot.people.length > 0 ? `People: ${snapshot.people.map(p => `${p.name} (${p.role}) — ${p.description}`).join("; ")}` : "You are alone."}
${snapshot.objects.length > 0 ? `Objects: ${snapshot.objects.map(o => `${o.name} — ${o.description}`).join("; ")}` : ""}
Exits: ${snapshot.exits.join(", ")}
${snapshot.worldEvents.length > 0 ? `Events: ${snapshot.worldEvents.map(e => `${e.name}: ${e.description}`).join("; ")}` : ""}`;

  try {
    const result = await generateText({
      model: renderModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: "You describe scenes in 2nd person present tense. Vivid, atmospheric, concise. Never invent things not in the data." },
        { role: "user", content: prompt },
      ],
    });
    return result.text.trim();
  } catch {
    // Fallback
    let desc = `You are in ${snapshot.roomName}. ${snapshot.roomDescription}`;
    if (snapshot.people.length > 0) desc += ` ${snapshot.people.map(p => p.name).join(" and ")} ${snapshot.people.length === 1 ? "is" : "are"} here.`;
    return desc;
  }
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildDMSystemPrompt(snapshot: WorldSnapshot, genre?: string): string {
  // Include narrative scaffold context if available
  const narrativeContext = snapshot.storyScaffold ? formatScaffoldForDM(snapshot) : "";

  // Genre-specific tone guidance
  const genreTone = genre ? getGenreTone(genre) : "";

  return `You are the Dungeon Master for a living world simulation. You narrate what happens when the player acts.

VOICE: 2nd person, present tense. Atmospheric but concise. 3-5 sentences.

CRITICAL RULES:
1. ONLY describe things that actually exist in the world state provided. Use exact entity names.
2. When NPCs speak, use their ACTUAL response (provided below) as quoted dialogue. Put their words in quotes.
3. If an NPC responds verbally, their dialogue MUST appear in your narration in quotation marks.
4. Incorporate NPC body language, tone, and reactions based on their inner state (goals, memories, impressions).
5. If an NPC has a negative impression of the player, show it in their manner — NOT through violence.
6. Reference the environment — time of day, atmosphere, objects — to set the scene.
7. Never break the 4th wall. Never mention game mechanics, ECS, actions, or simulations.
8. NEVER use raw action format like "X talks Y" or "X observes Y". Always narrate naturally.
9. NEVER repeat phrases from your previous responses. Check the conversation history — use fresh descriptions, adjectives, and imagery each time. Vary your sentence structure.
10. When the player asks a question and an NPC responds, the NPC's answer MUST address what was asked.
11. ONLY include people listed under PEOPLE HERE. If someone is NOT listed there, they are NOT in the room. Do NOT place absent characters in the scene even if they appear in narrative context.
12. Do NOT narrate the player's actions for them. Only describe what happens IN RESPONSE to the player's action.
${genreTone ? `\nTONE & GENRE:\n${genreTone}` : ""}
13. If STATE CHANGES are provided, weave them into the narration as FELT EXPERIENCE — never as game mechanics. "Your sanity drops" → "A cold numbness spreads behind your eyes." "Energy decreased" → "Your limbs grow heavy with exhaustion."
${narrativeContext ? "\n" + narrativeContext : ""}`;
}

function buildDMUserPrompt(
  snapshot: WorldSnapshot,
  intent: ParsedIntent,
  npcResponses: NpcResponse[],
  history: ConversationEntry[],
  stateChanges?: RenderContext["stateChanges"],
): string {
  const lines: string[] = [];

  // World state
  lines.push(`LOCATION: ${snapshot.roomName} — ${snapshot.roomDescription}`);
  lines.push(`TIME: ${snapshot.timeOfDay}, Day ${snapshot.day}`);

  // People with rich inner state
  if (snapshot.people.length > 0) {
    lines.push("\nPEOPLE HERE (with inner state for your narration):");
    for (const p of snapshot.people) {
      let personLine = `  ${p.name} (${p.role}): ${p.description}`;
      if (p.currentGoal) personLine += `\n    Currently focused on: "${p.currentGoal}"`;
      if (p.impressionOfViewer) personLine += `\n    Feels ${p.impressionOfViewer.sentiment} toward the player`;
      if (p.recentMemories.length > 0) personLine += `\n    Recent memories: ${p.recentMemories.slice(0, 3).join("; ")}`;
      if (p.narrativeRole) personLine += `\n    [DM note: narrative role = ${p.narrativeRole}]`;
      if (p.secrets && p.secrets.length > 0) personLine += `\n    [DM note: knows secret — ${p.secrets[0]}]`;
      lines.push(personLine);
    }
  }

  // Objects
  if (snapshot.objects.length > 0) {
    lines.push(`\nOBJECTS: ${snapshot.objects.map(o => `${o.name} (${o.description})`).join("; ")}`);
  }

  lines.push(`\nEXITS: ${snapshot.exits.join(", ")}`);

  // World events
  if (snapshot.worldEvents.length > 0) {
    lines.push(`\nEVENTS: ${snapshot.worldEvents.map(e => `${e.name}: ${e.description}`).join("; ")}`);
  }

  // Player action
  lines.push(`\nPLAYER ACTION: ${intent.interpretation}`);
  if (intent.impossible) {
    lines.push(`NOTE: This action is impossible because: ${intent.impossible}. Narrate why it doesn't work.`);
  }

  // NPC responses (from their actual cognition)
  if (npcResponses.length > 0) {
    lines.push("\nNPC RESPONSES (weave these into your prose naturally — NEVER use raw action format like 'X talks Y'):");
    for (const r of npcResponses) {
      if (r.action.type === "speak" && r.action.content) {
        lines.push(`  ${r.name} responds verbally: "${r.action.content}"`);
      } else if (r.action.type === "think" || r.innerThought) {
        const thought = r.innerThought || r.action.content || "";
        lines.push(`  ${r.name} is lost in thought${thought ? ` (inner monologue: "${thought}")` : ""}. Narrate their contemplative silence or distracted manner.`);
      } else if (r.action.type === "interact" && (r.action.content?.includes("talk") || r.action.content?.includes("gossip"))) {
        // "interact:talk" is the BT's way of initiating conversation — narrate as engagement
        lines.push(`  ${r.name} engages in conversation. They don't have specific words — describe their body language, attention, and willingness to talk based on their inner state above.`);
      } else if (r.action.type === "interact") {
        lines.push(`  ${r.name} turns to ${r.action.content || "do something with"} ${r.action.target || "nearby"} instead of responding directly.`);
      } else if (r.action.type === "move") {
        lines.push(`  ${r.name} excuses themselves and heads toward ${r.action.target || "the door"}.`);
      } else if (r.action.type === "observe") {
        lines.push(`  ${r.name} studies you${r.action.target ? ` and ${r.action.target}` : ""} carefully before responding.`);
      } else if (r.action.type === "wait" || r.action.type === "rest") {
        lines.push(`  ${r.name} remains silent, offering no immediate response.`);
      } else {
        lines.push(`  ${r.name} reacts with ${r.action.type}. Narrate this naturally.`);
      }
    }
  }

  // Recent conversation for continuity
  if (history.length > 0) {
    lines.push(`\nRECENT (for continuity):\n${history.slice(-3).map(h => `${h.role}: ${h.content.slice(0, 80)}`).join("\n")}`);
  }

  // Last render for continuity
  if (snapshot.lastRender) {
    lines.push(`\nYOUR LAST NARRATION (do NOT repeat this — build on it, use different words):\n"${snapshot.lastRender.slice(0, 200)}"`);
  }

  // State changes — what the renderer should describe changing
  if (stateChanges) {
    const changeLines: string[] = [];
    for (const [comp, props] of Object.entries(stateChanges.componentChanges)) {
      for (const [prop, { before, after }] of Object.entries(props)) {
        changeLines.push(`${comp}.${prop}: ${before} → ${after}`);
      }
    }
    if (stateChanges.arrivals.length > 0) changeLines.push(`Arrived: ${stateChanges.arrivals.join(", ")}`);
    if (stateChanges.departures.length > 0) changeLines.push(`Departed: ${stateChanges.departures.join(", ")}`);
    if (stateChanges.objectsAdded.length > 0) changeLines.push(`Appeared: ${stateChanges.objectsAdded.join(", ")}`);
    if (stateChanges.objectsRemoved.length > 0) changeLines.push(`Vanished: ${stateChanges.objectsRemoved.join(", ")}`);
    if (stateChanges.playerMoved) changeLines.push(`Player moved: ${stateChanges.playerMoved.from} → ${stateChanges.playerMoved.to}`);

    if (changeLines.length > 0) {
      lines.push(`\nSTATE CHANGES (weave these into your prose as felt experience, NOT game mechanics):\n${changeLines.join("\n")}`);
    }
  }

  lines.push("\nNarrate what happens. Include NPC dialogue in quotes. Be atmospheric but concise.");

  return lines.join("\n");
}

// =============================================================================
// NARRATIVE SCAFFOLD CONTEXT FOR DM
// =============================================================================

function formatScaffoldForDM(snapshot: WorldSnapshot): string {
  if (!snapshot.storyScaffold) return "";

  const scaffold = snapshot.storyScaffold;
  const activeTensions = scaffold.tensions.filter(t => t.status === "active");
  if (activeTensions.length === 0) return "";

  const presentNames = new Set(snapshot.people.map(p => p.name.toLowerCase()));

  let context = "NARRATIVE CONTEXT (hidden from player — shape your narration with this):";
  context += `\nStory act: ${scaffold.currentAct}`;
  context += `\nIMPORTANT: Only characters listed in PEOPLE HERE are physically present. Do NOT place absent characters in the scene.`;

  for (const t of activeTensions) {
    // Only include tensions involving present NPCs
    const relevantNpcs = t.involvedNpcs.filter(n => presentNames.has(n.toLowerCase()));
    if (relevantNpcs.length > 0) {
      context += `\nTension (involves ${relevantNpcs.join(", ")}): ${t.description}`;
      const nextBeat = t.beats.find(b => b.status === "pending");
      if (nextBeat) context += ` → next: ${nextBeat.description}`;
    } else {
      // Tension exists but no involved NPCs are here — mention briefly for background
      context += `\nBackground tension (none of these people are here): ${t.description.slice(0, 60)}`;
    }
  }

  return context;
}

// =============================================================================
// GENRE TONE
// =============================================================================

function getGenreTone(genre: string): string {
  const g = genre.toLowerCase();
  if (g.includes("horror") || g.includes("cthulhu") || g.includes("lovecraft")) {
    return `This is COSMIC HORROR. Tone: dread, wrongness, decay, ancient malice.
Prefer: brine, geometry, ancient, cold, wrong, beneath, squamous, gibbous, cyclopean, non-Euclidean
Avoid: heroic, bright, warm, comfortable, safe, cozy
Describe: sensory decay, impossible angles, creeping madness, wet sounds, things half-seen
As player Sanity drops, descriptions should become more unreliable and disturbing.`;
  }
  if (g.includes("fantasy") || g.includes("medieval")) {
    return `This is HEROIC FANTASY. Tone: adventure, wonder, danger, camaraderie.
Prefer: hearth, steel, oath, honor, shadow, ancient, cunning, valor
Avoid: modern, clinical, sterile
Describe: the weight of weapons, the smell of forge-fire, the creak of leather, torchlit stone.`;
  }
  if (g.includes("noir") || g.includes("detective") || g.includes("mystery")) {
    return `This is NOIR. Tone: cynical, atmospheric, morally gray, rain-soaked.
Prefer: shadow, smoke, neon, whiskey, dame, gumshoe, rain, double-cross
Avoid: bright, happy, simple, innocent
Describe: the play of light through blinds, the smell of cheap cigarettes, unanswered questions.`;
  }
  if (g.includes("sci") || g.includes("space") || g.includes("station")) {
    return `This is SCI-FI. Tone: isolation, technology, vastness, clinical unease.
Prefer: hull, vacuum, static, recycled air, emergency, protocol, drift
Avoid: natural, organic, medieval, magical
Describe: the hum of life support, the cold of vacuum beyond thin walls, blinking status lights.`;
  }
  return "";
}

// =============================================================================
// FALLBACK NARRATION (no LLM)
// =============================================================================

function buildFallbackNarration(
  snapshot: WorldSnapshot,
  intent: ParsedIntent,
  npcResponses: NpcResponse[],
): string {
  const lines: string[] = [];

  if (intent.impossible) {
    lines.push(intent.impossible);
    return lines.join(" ");
  }

  lines.push(`You are in ${snapshot.roomName}. ${snapshot.roomDescription}`);

  for (const r of npcResponses) {
    if (r.action.type === "speak" && r.action.content) {
      lines.push(`${r.name} says: "${r.action.content}"`);
    }
  }

  return lines.join(" ");
}
