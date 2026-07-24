/**
 * Story Scaffold — The NLE's Narrative Blueprint
 *
 * Generated at genesis from the seed phrase + created world state.
 * Contains narrative tensions, dramatic beats, and NPC role assignments.
 * The NarrativeDirector reads this to proactively shape the story.
 *
 * This is pure ECS data — a StoryScaffold component on a world entity.
 * The God AI, spirits, and NarrativeDirector can all read and modify it.
 */

import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { generateText } from "ai";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { StoryScaffold, Name, Agent, Description, Room } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { addMemory } from "../cognition/knowledge-graph";
import { setAspirations, getAspirations } from "../cognition/goal-learning";
import { chronicle } from "../cognition/simulation-chronicle";

// =============================================================================
// TYPES
// =============================================================================

export interface NarrativeTension {
  id: string;
  description: string;
  status: "active" | "resolved" | "dormant";
  beats: DramaticBeat[];
  involvedNpcs: string[];   // NPC names
}

export interface DramaticBeat {
  id: string;
  description: string;
  act: "setup" | "escalation" | "crisis" | "resolution";
  status: "pending" | "triggered" | "completed";
  triggerCondition: string;  // What needs to happen
  npcActions?: string[];     // What NPCs should do
}

export interface NpcNarrativeRole {
  name: string;
  eid: number;
  role: "protagonist" | "antagonist" | "catalyst" | "witness" | "ally" | "wild_card";
  secrets: string[];         // Things this NPC knows that others don't
  hiddenMotivation?: string; // What drives them beyond their public aspirations
}

export interface StoryScaffoldData {
  tensions: NarrativeTension[];
  npcRoles: NpcNarrativeRole[];
  currentAct: string;
  adaptations: string[];
  seed: string;
}

// =============================================================================
// SCAFFOLD ENTITY MANAGEMENT
// =============================================================================

/** Create the story scaffold entity. Call once after genesis. */
export function createStoryScaffoldEntity(world: World, data: StoryScaffoldData): number {
  const eid = addEntity(world);
  addComponent(world, eid, StoryScaffold as any);
  addComponent(world, eid, Name as any);

  Name.value[eid] = "StoryScaffold";
  StoryScaffold.tensions[eid] = JSON.stringify(data.tensions);
  StoryScaffold.npcRoles[eid] = JSON.stringify(data.npcRoles);
  StoryScaffold.currentAct[eid] = data.currentAct;
  StoryScaffold.adaptations[eid] = JSON.stringify(data.adaptations);
  StoryScaffold.seed[eid] = data.seed;

  return eid;
}

/** Get the current story scaffold data. Returns null if no scaffold exists. */
export function getStoryScaffold(world: World): StoryScaffoldData | null {
  const scaffolds = Array.from(query(world as any, [StoryScaffold as any]));
  if (scaffolds.length === 0) return null;

  const eid = scaffolds[0];
  try {
    return {
      tensions: JSON.parse(StoryScaffold.tensions[eid] || "[]"),
      npcRoles: JSON.parse(StoryScaffold.npcRoles[eid] || "[]"),
      currentAct: StoryScaffold.currentAct[eid] || "setup",
      adaptations: JSON.parse(StoryScaffold.adaptations[eid] || "[]"),
      seed: StoryScaffold.seed[eid] || "",
    };
  } catch { return null; }
}

/** Update the story scaffold data. */
export function updateStoryScaffold(world: World, updates: Partial<StoryScaffoldData>): void {
  const scaffolds = Array.from(query(world as any, [StoryScaffold as any]));
  if (scaffolds.length === 0) return;
  const eid = scaffolds[0];

  if (updates.tensions) StoryScaffold.tensions[eid] = JSON.stringify(updates.tensions);
  if (updates.npcRoles) StoryScaffold.npcRoles[eid] = JSON.stringify(updates.npcRoles);
  if (updates.currentAct) StoryScaffold.currentAct[eid] = updates.currentAct;
  if (updates.adaptations) StoryScaffold.adaptations[eid] = JSON.stringify(updates.adaptations);
}

// =============================================================================
// SCAFFOLD GENERATION — called after genesis
// =============================================================================

/**
 * Generate a story scaffold from the seed phrase and the world that was created.
 * Analyzes agents, rooms, objects, and the seed to produce narrative tensions,
 * dramatic beats, and NPC role assignments.
 *
 * Then seeds NPC memories, impressions, and secrets based on the scaffold.
 */
export async function generateStoryScaffold(
  world: World,
  seed: string,
): Promise<StoryScaffoldData | null> {
  // Collect world state for the prompt
  const agents = Array.from(query(world as any, [Agent as any, Name as any]));
  const rooms = Array.from(query(world as any, [Room as any, Name as any]));

  const agentInfo = agents.map(eid => {
    const name = Name.value[eid] || "";
    const role = Agent.role[eid] || "";
    const desc = Description.value[eid] || "";
    const aspirations = getAspirations(eid);
    const room = getRoomForEntity(world, eid);
    const roomName = room !== undefined ? Name.value[room] || "" : "";
    return `${name} (${role}): ${desc}. In ${roomName}. Aspirations: ${aspirations.join("; ") || "none"}`;
  }).join("\n");

  const roomInfo = rooms.map(eid => {
    const name = Name.value[eid] || "";
    const desc = Description.value[eid] || "";
    return `${name}: ${desc}`;
  }).join("\n");

  try {
    const result = await generateText({
      model: agentModel,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: `You are a master storyteller designing the narrative scaffold for a living simulation. You create the hidden structure that makes a world feel alive — the tensions, secrets, and dramatic beats that will unfold as characters interact.

Your scaffold must be grounded in the actual characters and places that exist. Don't invent new ones — work with what's there.`,
        },
        {
          role: "user",
          content: `WORLD SEED: "${seed}"

CHARACTERS:
${agentInfo}

LOCATIONS:
${roomInfo}

Design a narrative scaffold for this world. Create:

1. 2-3 NARRATIVE TENSIONS — ongoing conflicts or mysteries that drive the story. Each tension should involve specific characters from the list above.

2. For each tension, 3-4 DRAMATIC BEATS — events that escalate the tension from setup through crisis to resolution. Each beat should describe what happens and which NPCs are involved.

3. NPC ROLE ASSIGNMENTS — for each character, assign a narrative role (protagonist, antagonist, catalyst, witness, ally, or wild_card) and give them 1-2 SECRETS they know that others don't, plus a hidden motivation that goes beyond their public aspirations.

Respond with JSON:
{
  "tensions": [
    {
      "id": "tension_id",
      "description": "What the tension is about",
      "beats": [
        {
          "id": "beat_id",
          "description": "What happens in this beat",
          "act": "setup|escalation|crisis|resolution",
          "triggerCondition": "What needs to happen for this beat to trigger",
          "npcActions": ["What specific NPCs should do"]
        }
      ],
      "involvedNpcs": ["Name1", "Name2"]
    }
  ],
  "npcRoles": [
    {
      "name": "Character Name",
      "role": "protagonist|antagonist|catalyst|witness|ally|wild_card",
      "secrets": ["Something only they know"],
      "hiddenMotivation": "What really drives them"
    }
  ]
}`,
        },
      ],
    });

    const raw = extractJSON(result.text);
    if (!raw) return null;
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Build the scaffold data
    const tensions: NarrativeTension[] = (json.tensions || []).map((t: any) => ({
      id: String(t.id || ""),
      description: String(t.description || ""),
      status: "active" as const,
      beats: (t.beats || []).map((b: any) => ({
        id: String(b.id || ""),
        description: String(b.description || ""),
        act: String(b.act || "setup"),
        status: "pending" as const,
        triggerCondition: String(b.triggerCondition || ""),
        npcActions: b.npcActions || [],
      })),
      involvedNpcs: t.involvedNpcs || [],
    }));

    const npcRoles: NpcNarrativeRole[] = (json.npcRoles || []).map((r: any) => {
      // Find the NPC's ECS entity ID
      const npcEid = agents.find(eid =>
        (Name.value[eid] || "").toLowerCase() === String(r.name || "").toLowerCase()) || 0;
      return {
        name: String(r.name || ""),
        eid: npcEid,
        role: String(r.role || "witness") as any,
        secrets: (r.secrets || []).map(String),
        hiddenMotivation: r.hiddenMotivation ? String(r.hiddenMotivation) : undefined,
      };
    });

    const scaffold: StoryScaffoldData = {
      tensions,
      npcRoles,
      currentAct: "setup",
      adaptations: [],
      seed,
    };

    // Create the scaffold entity
    createStoryScaffoldEntity(world, scaffold);

    // Seed NPC memories and secrets
    await seedNpcNarrativeState(world, scaffold);

    chronicle.record("world_seed", {
      scaffold: true,
      tensionCount: tensions.length,
      npcRoleCount: npcRoles.length,
      beatCount: tensions.reduce((sum, t) => sum + t.beats.length, 0),
    });

    console.log(`[NLE] Story scaffold generated: ${tensions.length} tensions, ${npcRoles.length} NPC roles`);
    for (const t of tensions) {
      console.log(`  Tension: "${t.description}" (${t.beats.length} beats)`);
    }
    for (const r of npcRoles) {
      console.log(`  ${r.name}: ${r.role}${r.secrets.length > 0 ? ` — knows: "${r.secrets[0]}"` : ""}`);
    }

    return scaffold;
  } catch (err) {
    console.warn(`[NLE] Failed to generate scaffold: ${(err as Error).message}`);
    return null;
  }
}

// =============================================================================
// NPC NARRATIVE SEEDING — plant memories and secrets
// =============================================================================

async function seedNpcNarrativeState(world: World, scaffold: StoryScaffoldData): Promise<void> {
  for (const role of scaffold.npcRoles) {
    if (role.eid <= 0) continue;

    // Plant secrets as private memories
    for (const secret of role.secrets) {
      addMemory(world, role.eid, {
        type: "episodic",
        content: secret,
        importance: 85,
        emotionalValence: role.role === "antagonist" ? -0.3 : 0.2,
        timestamp: Date.now(),
      });
    }

    // Plant hidden motivation as a deep belief/memory
    if (role.hiddenMotivation) {
      addMemory(world, role.eid, {
        type: "semantic",
        content: `Deep down, what really drives me is: ${role.hiddenMotivation}`,
        importance: 90,
        emotionalValence: 0.5,
        timestamp: Date.now(),
      });
    }

    // Plant tension-awareness as memories
    for (const tension of scaffold.tensions) {
      if (!tension.involvedNpcs.some(n => n.toLowerCase() === role.name.toLowerCase())) continue;

      // NPCs involved in a tension know about it
      const setupBeat = tension.beats.find(b => b.act === "setup");
      if (setupBeat) {
        addMemory(world, role.eid, {
          type: "episodic",
          content: `I'm aware that ${tension.description}`,
          importance: 75,
          emotionalValence: role.role === "antagonist" ? 0.1 : -0.4,
          timestamp: Date.now(),
        });
      }
    }
  }
}

// =============================================================================
// CONTEXT FORMATTING — for LIL world renderer
// =============================================================================

/** Format the story scaffold into context for the DM LLM. */
export function formatScaffoldForContext(world: World): string {
  const scaffold = getStoryScaffold(world);
  if (!scaffold) return "";

  const activeTensions = scaffold.tensions.filter(t => t.status === "active");
  if (activeTensions.length === 0) return "";

  let context = "\nNARRATIVE CONTEXT (hidden from player — for DM use only):";
  context += `\nCurrent act: ${scaffold.currentAct}`;

  for (const t of activeTensions) {
    context += `\n\nTension: ${t.description}`;
    const nextBeat = t.beats.find(b => b.status === "pending");
    if (nextBeat) {
      context += `\n  Next beat (${nextBeat.act}): ${nextBeat.description}`;
      context += `\n  Trigger: ${nextBeat.triggerCondition}`;
    }
  }

  context += "\n\nNPC roles:";
  for (const r of scaffold.npcRoles) {
    context += `\n  ${r.name}: ${r.role}`;
    if (r.secrets.length > 0) context += ` — knows: ${r.secrets[0]}`;
  }

  return context;
}
