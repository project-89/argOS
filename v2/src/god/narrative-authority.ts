import { tool } from "ai";
import { z } from "zod/v3";
import { query } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Room } from "../ecs/components";
import { assertSimulationTaskActive } from "../runtime/task-scope";

/**
 * Narrative preparation is a capability, not an instruction to an omnipotent God.
 * Keep this a positive allowlist: new tools added to God must not inherit authority.
 * In particular, managed code builds do not yet have per-entity write isolation.
 */
export const NARRATIVE_READ_TOOLS = [
  "listEntities", "queryEntities", "getComponentValues", "getEntityLocation", "listSystems",
  "listObjectTypes", "listVocabulary", "getCodingJobs",
  "getRuntimeServices",
  "getRuntimeHealth",
] as const;

type ToolSet = Record<string, any>;

/** A host-installed catalogue of real narrative events (sounds, arrivals,
 * lights, phone messages...). The Narrator and God share one budget. The host
 * owns resolution, native effects and receipts; callers only describe intent. */
export type NarrativeEventOrigin = "narrator" | "god" | "operator";
export type NarrativeEventReceipt = { status: "applied" | "rejected"; operation: string; detail: string; atSimMs: number;
  roomId?: number; entityId?: number; origin: NarrativeEventOrigin };
export interface NarrativeHost {
  /** The one spirit entitled to stage events directly, by identity. */
  narrator?: object;
  /** Short catalogue with exact target names, budget and cooldown. */
  describe(): string;
  stage(command: unknown, origin: NarrativeEventOrigin): NarrativeEventReceipt;
  /** Operations this host implements (e.g. "sound", "arrival"). */
  operations: readonly string[];
  /** Builder context for requested mechanics, when coding daemons exist. */
  mechanicGuidance?: string;
}
const narrativeHosts = new WeakMap<World, NarrativeHost>();
export function registerNarrativeHost(world: World, host: NarrativeHost): () => void {
  narrativeHosts.set(world, host);
  return () => { if (narrativeHosts.get(world) === host) narrativeHosts.delete(world); };
}
export function getNarrativeHost(world: World): NarrativeHost | undefined { return narrativeHosts.get(world); }

function normalizedName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function nameConflict(world: World, proposed: string): string | undefined {
  const candidate = normalizedName(proposed);
  if (!candidate) return "A nonempty unique name is required";
  for (const eid of query(world, [Name])) {
    const existing = normalizedName(Name.value[eid] || "");
    // Also reject attempts such as "replacement Mara's phone". Scenery growth
    // may be conservative; the independent God/operator can explicitly author it.
    if (existing && (` ${candidate} `.includes(` ${existing} `)
      || ` ${existing} `.includes(` ${candidate} `))) {
      return `Existing entity identity is protected: ${Name.value[eid]}. Adapt to its live state; do not recreate it.`;
    }
  }
  return undefined;
}

/** Build a fresh command-local view. The original tool objects remain untouched. */
export function buildNarrativeGrowthTools(world: World, tools: ToolSet): ToolSet {
  const allowed: ToolSet = {};
  for (const name of NARRATIVE_READ_TOOLS) {
    if (tools[name]) allowed[name] = tools[name];
  }

  allowed.createScenery = tool({
    description: "Add ONE genuinely new inert scenery detail. Cannot create devices, actors, movable/usable props, stimuli, messages, or replacements for existing entities. Existing state always wins over the proposed story beat.",
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      kind: z.enum(["marking", "debris", "vegetation", "decoration"]),
      description: z.string().max(1500),
      roomName: z.string().min(1),
    }),
    execute: async (params, context) => {
      assertSimulationTaskActive();
      const conflict = nameConflict(world, params.name);
      if (conflict) return { success: false, result: null, error: conflict };
      // Resolve at execution, not at LLM prompt capture; the world keeps moving.
      const room = Array.from(query(world, [Room, Name]))
        .find(eid => Name.value[eid] === params.roomName);
      if (room === undefined) return { success: false, result: null, error: "The destination must be an existing room with its exact current name" };
      // Never forward arbitrary properties/traits even if an SDK caller bypasses
      // schema validation. These prefabs only write the newly allocated entity.
      return tools.createObject.execute({
        name: `${params.name} (${params.kind})`,
        description: `${params.kind} scenery: ${params.description}`,
        roomName: Name.value[room],
        portable: false,
        traits: ["examinable"],
      }, context);
    },
  });

  allowed.createRoom = {
    ...tools.createRoom,
    description: "Create ONE genuinely new EMPTY room. Cannot replace an existing room, connect or move existing entities, or ask a Steward to populate it.",
    execute: async (params: { name: string; description?: string; capacity?: number; ambience?: string }, context: unknown) => {
      assertSimulationTaskActive();
      const conflict = nameConflict(world, params.name);
      if (conflict) return { success: false, result: null, error: conflict };
      return tools.createRoom.execute({ name: params.name, description: params.description,
        capacity: params.capacity, ambience: params.ambience }, context);
    },
  };
  return allowed;
}

export const NARRATIVE_GROWTH_SYSTEM_PROMPT = `You are preparing optional scenery for a living world, NOT executing a player or operator command.
Read the LIVE world using tools before deciding anything. A narrative beat is a possibility, never an authoritative fact.
Existing entities, their locations, possession, messages, decisions, memories and conditions are authoritative. A player intervention is NOT damage to repair.
If an existing object is moved, missing, consumed, locked, unavailable or already used, adapt or skip the beat. NEVER restore its old state or fabricate a replacement to force the story.
Your only mutation tools create new EMPTY rooms or inert scenery (markings, debris, vegetation, decoration). No existing-state edits, functional props/devices, agents, notifications, NPC cognition, system/rule/code creation or delegated builds are available.
You may discover that nothing should be created. That is a successful decision; report it briefly. Tool errors must not be worked around with renamed duplicate entities.
New mechanics and world manipulation belong to the independent God/evolution/operator authority, not this narrative preparation command.`;
