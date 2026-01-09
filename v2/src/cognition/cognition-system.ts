import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext, SystemRegistry } from "../ecs/dynamic-systems";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { query, getRelationTargets, addComponent, removeComponent, hasComponent, entityExists } from "bitecs";
import { Name, Agent, Mind, Room, Description, Portal } from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import {
  processAgentCognition,
  addPerception,
  getAgentMemory,
  type AgentAction
} from "./agent-mind";
import { extractKnowledgeFromInteraction } from "./knowledge-graph";
import { executeAffordance, canUseAffordance, type EffectContext } from "../world/effect-executor";
import { worldSchema, type AffordanceDefinition } from "../world/schema";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import {
  generateStimuliForAgent,
  formatStimuliForPrompt,
  eventToStimulus,
  type SensoryModality,
  type Stimulus,
} from "./sensory-system";
import { setMovementTarget } from "../systems/builtin-systems";

export interface PendingStimulus {
  targetEid: number;
  type: string;
  content: string;
  source: string;
  modality?: SensoryModality;  // Optional for backwards compatibility
  intensity?: number;          // Stimulus intensity (0-1), defaults to 0.7
}

const pendingStimuli: PendingStimulus[] = [];
const pendingActions: Array<{ eid: number; action: AgentAction }> = [];

// Entity registry for name lookups (shared with effect executor)
const entityRegistry = {
  byName: new Map<string, number>(),
  byId: new Map<number, string>(),
};

/**
 * Register an entity in the name lookup system
 */
export function registerEntity(eid: number, name: string): void {
  entityRegistry.byName.set(name, eid);
  entityRegistry.byId.set(eid, name);
}

/**
 * Unregister an entity from the name lookup system
 */
export function unregisterEntity(eid: number): void {
  const name = entityRegistry.byId.get(eid);
  if (name) {
    entityRegistry.byName.delete(name);
    entityRegistry.byId.delete(eid);
  }
}

/**
 * Find an entity by name (with fuzzy matching for natural language)
 */
export function findEntityByName(world: World, name: string): number | undefined {
  // First check registry
  const registered = entityRegistry.byName.get(name);
  if (registered !== undefined) return registered;

  // Fall back to searching all entities with Name component
  const allEntities = Array.from(query(world, []));
  const nameLower = name.toLowerCase().trim();

  // Normalize: remove trailing 's' for plural handling (trees -> tree)
  const singularized = nameLower.endsWith('s') ? nameLower.slice(0, -1) : nameLower;
  // Also handle "ies" -> "y" (berries -> berry)
  const singularizedIes = nameLower.endsWith('ies') ? nameLower.slice(0, -3) + 'y' : singularized;

  // Exact match first
  for (const eid of allEntities) {
    const entityName = Name.value[eid];
    if (entityName?.toLowerCase() === nameLower) {
      return eid;
    }
  }

  // Try partial match (entity name contains search term)
  for (const eid of allEntities) {
    const entityName = Name.value[eid]?.toLowerCase();
    if (!entityName) continue;

    // Check if search term is in entity name OR singularized version matches
    if (entityName.includes(nameLower) ||
        entityName.includes(singularized) ||
        entityName.includes(singularizedIes)) {
      return eid;
    }

    // Also check if entity name starts with search term (tree matches "Tree 1")
    if (entityName.startsWith(singularized) || entityName.startsWith(singularizedIes)) {
      return eid;
    }
  }

  return undefined;
}

/**
 * Get available affordances for a target entity
 */
export function getAvailableAffordances(
  world: World,
  actorEid: number,
  targetEid: number
): AffordanceDefinition[] {
  const available: AffordanceDefinition[] = [];

  for (const affordance of worldSchema.getAllAffordances()) {
    const check = canUseAffordance(affordance, actorEid, targetEid);
    if (check.available) {
      available.push(affordance);
    }
  }

  return available;
}

/**
 * Get the entity registry for effect context
 */
export function getEntityRegistry() {
  return entityRegistry;
}

export function queueStimulus(stimulus: PendingStimulus): void {
  pendingStimuli.push(stimulus);
}

export function queueStimulusForAgent(
  world: World,
  agentName: string,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality }
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (Name.value[eid] === agentName) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
      return;
    }
  }
}

export function broadcastToRoom(
  world: World,
  roomEid: number,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality; intensity?: number },
  excludeEid?: number
): void {
  if (!entityExists(world, roomEid)) return;

  const agents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  for (const eid of agents) {
    if (eid === excludeEid) continue;
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    if (rooms.includes(roomEid)) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
    }
  }
}

/**
 * Broadcast a sound stimulus to agents in a room
 */
export function broadcastSound(
  world: World,
  roomEid: number,
  content: string,
  source: string,
  excludeEid?: number
): void {
  broadcastToRoom(world, roomEid, {
    type: "sound",
    modality: "auditory",
    content,
    source,
  }, excludeEid);
}

/**
 * Broadcast a visual stimulus to agents in a room
 */
export function broadcastVisual(
  world: World,
  roomEid: number,
  content: string,
  source: string,
  excludeEid?: number
): void {
  broadcastToRoom(world, roomEid, {
    type: "action",
    modality: "visual",
    content,
    source,
  }, excludeEid);
}

export function findRoomByName(world: World, roomName: string): number | undefined {
  const rooms = Array.from(query(world, [Room]));
  const nameLower = roomName.toLowerCase();

  // Try exact match first
  for (const eid of rooms) {
    if (Name.value[eid]?.toLowerCase() === nameLower) {
      return eid;
    }
  }

  // Try partial match
  for (const eid of rooms) {
    if (Name.value[eid]?.toLowerCase().includes(nameLower)) {
      return eid;
    }
  }

  return undefined;
}

/**
 * Generate MUD-style room perception text for an agent
 * This is a simplified version - will be replaced with TextRenderer when WorldSchema integrates
 */
export function renderRoomPerception(
  world: World,
  agentEid: number,
  roomEid: number
): string {
  const lines: string[] = [];

  // Validate entities exist
  if (!entityExists(world, agentEid) || !entityExists(world, roomEid)) {
    return "You are nowhere.";
  }

  // Room header
  const roomName = Name.value[roomEid] || "Unknown Location";
  const roomDesc = Description.value[roomEid] || "";
  const roomAmbience = Room.ambience[roomEid] || "";

  lines.push(`=== ${roomName} ===`);
  lines.push("");

  if (roomDesc) {
    lines.push(roomDesc);
  }

  if (roomAmbience) {
    lines.push("");
    lines.push(roomAmbience);
  }

  // Find other agents in the room
  const allAgents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  const othersInRoom: Array<{ name: string; desc?: string; affordances: string[] }> = [];

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
    if (otherRooms.includes(roomEid)) {
      const otherName = Name.value[otherEid] || "someone";
      const otherDesc = Description.value[otherEid];

      // Get available affordances for interacting with this agent
      const availableAffordances = getAvailableAffordances(world, agentEid, otherEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      othersInRoom.push({
        name: otherName,
        desc: otherDesc?.slice(0, 60),
        affordances: affordanceNames,
      });
    }
  }

  if (othersInRoom.length > 0) {
    lines.push("");
    lines.push("People here:");
    for (const other of othersInRoom) {
      let line = `  - ${other.name}`;
      if (other.desc) {
        line += ` - ${other.desc}`;
      }
      if (other.affordances.length > 0) {
        line += ` [can: ${other.affordances.join(", ")}]`;
      }
      lines.push(line);
    }
  }

  // Find objects/items in room (via Contains relation)
  const contents = safeGetRelationTargets(world, roomEid, Contains);
  const objectEntries: Array<{ name: string; desc?: string; affordances: string[] }> = [];

  for (const contentEid of contents) {
    // Skip non-existent entities
    if (!entityExists(world, contentEid)) continue;
    // Skip agents (already listed)
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (objName) {
      // Get available affordances for this object
      const availableAffordances = getAvailableAffordances(world, agentEid, contentEid);
      const affordanceNames = availableAffordances.map(a => a.name);

      // Get object description/state
      const objMeta = getDynamicComponentValues("ObjectMeta", contentEid);
      const stateDesc = objMeta?.state ? ` (${objMeta.state})` : "";

      objectEntries.push({
        name: objName + stateDesc,
        desc: Description.value[contentEid],
        affordances: affordanceNames,
      });
    }
  }

  if (objectEntries.length > 0) {
    lines.push("");
    lines.push("Objects here:");
    for (const obj of objectEntries) {
      if (obj.affordances.length > 0) {
        lines.push(`  - ${obj.name} [can: ${obj.affordances.join(", ")}]`);
      } else {
        lines.push(`  - ${obj.name}`);
      }
    }
  }

  // Find exits (rooms with portals to this room or other connected rooms)
  const allRooms = Array.from(query(world, [Room]));
  const exits: string[] = [];

  for (const otherRoomEid of allRooms) {
    if (otherRoomEid === roomEid) continue;

    // Check if there's a portal connection
    if (hasComponent(world, otherRoomEid, Portal)) {
      const destRoom = Portal.destinationRoom[otherRoomEid];
      if (destRoom === roomEid) {
        const exitName = Name.value[otherRoomEid];
        if (exitName) exits.push(exitName);
      }
    }
  }

  // Also check for portals IN this room pointing elsewhere
  for (const contentEid of contents) {
    if (hasComponent(world, contentEid, Portal)) {
      const destRoom = Portal.destinationRoom[contentEid];
      if (destRoom !== undefined && destRoom !== roomEid) {
        const destName = Name.value[destRoom];
        const portalName = Name.value[contentEid];
        if (destName) {
          exits.push(`${portalName || "passage"} to ${destName}`);
        }
      }
    }
  }

  if (exits.length > 0) {
    lines.push("");
    lines.push("Exits:");
    for (const exit of exits) {
      lines.push(`  - ${exit}`);
    }
  }

  return lines.join("\n");
}

export async function runCognitionCycle(
  world: World,
  registry: SystemRegistry
): Promise<Array<{ eid: number; action: AgentAction }>> {
  // Collect pending event-based stimuli by agent
  const eventsByAgent = new Map<number, PendingStimulus[]>();

  for (const stimulus of pendingStimuli) {
    if (!eventsByAgent.has(stimulus.targetEid)) {
      eventsByAgent.set(stimulus.targetEid, []);
    }
    eventsByAgent.get(stimulus.targetEid)!.push(stimulus);
  }
  pendingStimuli.length = 0;

  const activeAgents = Array.from(query(world, [Agent, Mind])).filter(
    eid => Agent.active[eid]
  );

  const results: Array<{ eid: number; action: AgentAction }> = [];

  for (const eid of activeAgents) {
    // Convert pending events to stimulus format with modalities
    const pendingEvents = (eventsByAgent.get(eid) || []).map(s => {
      // If modality was specified, use it; otherwise infer from type
      if (s.modality) {
        return {
          modality: s.modality,
          type: s.type,
          content: s.content,
          source: s.source,
          intensity: 1,
        };
      }
      return eventToStimulus({ type: s.type, content: s.content, source: s.source });
    });

    // Generate all stimuli for this agent (visual, auditory, cognitive, etc.)
    const allStimuli = generateStimuliForAgent(world, eid, pendingEvents);

    // Format stimuli for the agent prompt
    const perceptionText = formatStimuliForPrompt(allStimuli);

    // Pass formatted perception to cognition
    const action = await processAgentCognition(
      world,
      eid,
      [{ type: "perception", content: perceptionText, source: "senses" }]
    );
    results.push({ eid, action });
  }

  return results;
}

export function executeActions(
  world: World,
  actions: Array<{ eid: number; action: AgentAction }>,
  registry: SystemRegistry
): void {
  for (const { eid, action } of actions) {
    // Skip if entity no longer exists
    if (!entityExists(world, eid)) continue;

    const name = Name.value[eid];
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    const roomEid = rooms[0];

    switch (action.type) {
      case "speak":
        if (action.content && roomEid !== undefined) {
          // Speech is an auditory stimulus
          broadcastSound(world, roomEid, `${name} says: "${action.content}"`, name, eid);
          console.log(`💬 ${name}: "${action.content}"`);

          extractKnowledgeFromInteraction(world, eid, {
            type: "speech",
            content: action.content,
            context: `Speaking in ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "observe":
        if (action.target) {
          Mind.focus[eid] = action.target;
          console.log(`👁️ ${name} observes ${action.target}`);

          // Find the target and provide detailed observation
          const observeTargetEid = findEntityByName(world, action.target);
          if (observeTargetEid !== undefined) {
            // Set movement target so agent moves towards what they're observing
            setMovementTarget(eid, observeTargetEid);
            const targetName = Name.value[observeTargetEid] || action.target;
            const targetDesc = Description.value[observeTargetEid] || "You see nothing special.";
            const targetMeta = getDynamicComponentValues("ObjectMeta", observeTargetEid);

            // Build detailed observation
            const observationParts: string[] = [];
            observationParts.push(`You examine ${targetName} closely.`);
            observationParts.push(targetDesc);

            if (targetMeta?.state && targetMeta.state !== "normal") {
              observationParts.push(`It appears to be ${targetMeta.state}.`);
            }

            // Get available affordances - examining reveals what you can do
            const affordances = getAvailableAffordances(world, eid, observeTargetEid);
            if (affordances.length > 0) {
              observationParts.push(`You could: ${affordances.map(a => a.name).join(", ")}.`);
            }

            // Send detailed observation as cognitive stimulus
            queueStimulus({
              targetEid: eid,
              type: "observation",
              modality: "cognitive",
              content: observationParts.join(" "),
              source: "observation",
            });
          }

          extractKnowledgeFromInteraction(world, eid, {
            type: "observation",
            content: `Observing ${action.target}`,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "think":
        if (action.content) {
          console.log(`💭 ${name} thinks: "${action.content}"`);
        }
        break;

      case "interact":
        if (action.target && action.content) {
          // Find the target entity
          const targetEid = findEntityByName(world, action.target);

          if (targetEid === undefined) {
            console.log(`❓ ${name} tried to interact with "${action.target}" but couldn't find it`);
            break;
          }

          // Set movement target so agent moves towards the object they're interacting with
          setMovementTarget(eid, targetEid);

          // Parse affordance name from content (e.g., "eat the apple" -> "eat")
          const affordanceName = action.content.split(" ")[0].toLowerCase();

          // Create effect context
          const ctx: EffectContext = {
            world,
            actorEid: eid,
            targetEid,
            worldSchema,
            registry: entityRegistry,
          };

          // Execute the affordance
          const result = executeAffordance(affordanceName, ctx);

          if (result.success) {
            // Broadcast to room (description already sent by executeAffordance)
            const targetName = Name.value[targetEid] || action.target;
            console.log(`🎯 ${name} ${affordanceName}s ${targetName}: ${result.changes.join(", ") || "success"}`);

            // Give feedback to actor about what happened (cognitive stimulus)
            if (result.changes.length > 0) {
              queueStimulus({
                targetEid: eid,
                type: "action_result",
                modality: "cognitive",
                content: `You ${affordanceName} ${targetName}. ${result.changes.join(". ")}`,
                source: "self",
              });
            }
          } else {
            // Action failed - notify actor (cognitive stimulus)
            console.log(`❌ ${name} failed to ${affordanceName} ${action.target}: ${result.message}`);
            queueStimulus({
              targetEid: eid,
              type: "action_failed",
              modality: "cognitive",
              content: `You cannot ${affordanceName} ${action.target}: ${result.message}`,
              source: "self",
            });
          }

          extractKnowledgeFromInteraction(world, eid, {
            type: "interaction",
            content: action.content,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "move":
        if (action.target) {
          const destRoom = findRoomByName(world, action.target);
          if (destRoom !== undefined && destRoom !== roomEid) {
            const destName = Name.value[destRoom] || action.target;
            const sourceName = roomEid !== undefined ? Name.value[roomEid] : "somewhere";

            // Broadcast departure to current room (visual stimulus)
            if (roomEid !== undefined) {
              broadcastVisual(world, roomEid, `${name} leaves toward ${destName}`, name, eid);
              // Remove from current room
              removeComponent(world, eid, OccupiesRoom(roomEid));
            }

            // Add to new room
            addComponent(world, eid, OccupiesRoom(destRoom));

            // Broadcast arrival to new room (visual stimulus)
            broadcastVisual(world, destRoom, `${name} arrives from ${sourceName}`, name, eid);

            console.log(`🚶 ${name} moves from ${sourceName} to ${destName}`);

            extractKnowledgeFromInteraction(world, eid, {
              type: "movement",
              content: `Traveled from ${sourceName} to ${destName}`,
              context: `Now in ${destName}`,
            }).catch(() => {});
          } else if (destRoom === undefined) {
            console.log(`❓ ${name} tried to move to "${action.target}" but couldn't find it`);
          }
        }
        break;

      case "wait":
        break;
    }
  }
}

export function createCognitionSystem(): SystemDefinition {
  return {
    name: "AgentCognition",
    description: "Processes agent perception, thinking, and action selection",
    pseudocode: "For each active agent with stimuli or high arousal: think and act",
    frequency: 10000,
    active: true,
    lastRun: 0,
    compiledFn: undefined,
  };
}
