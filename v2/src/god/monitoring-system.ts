/**
 * GodAI Monitoring System
 *
 * Provides world state observation, event injection, and narrative steering
 * for the GodAI to monitor and guide simulations.
 */

import { query, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import {
  Name,
  Description,
  Agent,
  Mind,
  Room,
  Goal,
  Impression,
  Belief,
  PhysicalObject,
  GodAgent,
} from "../ecs/components";
import { OccupiesRoom, HasGoal, HasImpression, HasBelief } from "../ecs/relations";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import { broadcastToRoom, queueStimulus } from "../cognition/cognition-system";
import type { SensoryModality } from "../cognition/sensory-system";
import type { EntityRegistry } from "../ecs/tools";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentSummary {
  eid: number;
  name: string;
  location: string;
  mood: string;
  arousal: number;
  focus: string;
  mode: string;
  active: boolean;
  recentActions: string[];
  relationships: Array<{ name: string; attitude: string }>;
  goals: Array<{ description: string; priority: number; status: string }>;
}

export interface RoomSummary {
  eid: number;
  name: string;
  description: string;
  ambience: string;
  agentCount: number;
  agents: string[];
  objects: Array<{ name: string; state: string }>;
}

export interface ConflictSummary {
  parties: string[];
  nature: string;
  intensity: number;
  source: string;
}

export interface NarrativeArc {
  currentPhase: "setup" | "rising" | "climax" | "falling" | "resolution" | "stagnant";
  tension: number;
  recentEvents: string[];
  eventCount: number;
}

export interface WorldStateSummary {
  tick: number;
  timestamp: number;
  agentCount: number;
  roomCount: number;
  agentSummaries: AgentSummary[];
  roomSummaries: RoomSummary[];
  activeConflicts: ConflictSummary[];
  narrativeArc: NarrativeArc;
  stagnationScore: number;
}

export interface InjectedEvent {
  type: string;
  content: string;
  modality: SensoryModality;
  source?: string;
  intensity?: number;
}

export interface EventInjectionTarget {
  room?: number;
  agent?: number;
  broadcast?: boolean;
}

export interface ObservationResult {
  summary: WorldStateSummary;
  recommendations: string[];
  shouldIntervene: boolean;
  suggestedInterventions: string[];
}

export interface MonitoringConfig {
  observationInterval: number;  // ms between observations
  stagnationThreshold: number;  // ticks without significant events
  tensionDecayRate: number;     // how fast tension decreases
  autoIntervene: boolean;       // whether to auto-intervene on stagnation
}

// =============================================================================
// WORLD STATE COLLECTION
// =============================================================================

/**
 * Get a comprehensive summary of the current world state
 */
export function getWorldSummary(
  world: World,
  registry: EntityRegistry,
  recentEvents: string[] = [],
  tick: number = 0
): WorldStateSummary {
  const agentSummaries = getAgentSummaries(world, registry);
  const roomSummaries = getRoomSummaries(world, registry);
  const activeConflicts = detectConflicts(world, registry, agentSummaries);
  const narrativeArc = analyzeNarrativeArc(activeConflicts, recentEvents, agentSummaries);
  const stagnationScore = calculateStagnation(agentSummaries, recentEvents);

  return {
    tick,
    timestamp: Date.now(),
    agentCount: agentSummaries.length,
    roomCount: roomSummaries.length,
    agentSummaries,
    roomSummaries,
    activeConflicts,
    narrativeArc,
    stagnationScore,
  };
}

/**
 * Get detailed summaries of all agents
 */
export function getAgentSummaries(world: World, registry: EntityRegistry): AgentSummary[] {
  const agents = Array.from(query(world, [Agent]));

  return agents.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const arousal = Mind.arousal[eid] ?? 0.5;
    const focus = Mind.focus[eid] || "";
    const mode = Mind.mode[eid] || "reactive";
    const active = Agent.active[eid] ?? true;

    // Get location
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    const location = rooms.length > 0 ? (Name.value[rooms[0]] || "Unknown") : "Nowhere";

    // Derive mood from arousal
    const mood = deriveMood(arousal, mode);

    // Get goals
    const goalEids = getRelationTargets(world, eid, HasGoal);
    const goals = goalEids.map(gid => ({
      description: Goal.description[gid] || "",
      priority: Goal.priority[gid] ?? 5,
      status: Goal.status[gid] || "active",
    })).filter(g => g.status === "active");

    // Get relationships from impressions
    const impressionEids = getRelationTargets(world, eid, HasImpression);
    const relationships = impressionEids.map(iid => ({
      name: Impression.targetName[iid] || "",
      attitude: deriveAttitude(Impression.valence[iid] ?? 0),
    })).filter(r => r.name);

    return {
      eid,
      name,
      location,
      mood,
      arousal,
      focus,
      mode,
      active,
      recentActions: [], // Would need action history tracking
      relationships,
      goals,
    };
  });
}

/**
 * Get summaries of all rooms
 */
export function getRoomSummaries(world: World, registry: EntityRegistry): RoomSummary[] {
  const rooms = Array.from(query(world, [Room]));

  return rooms.map(eid => {
    const name = Name.value[eid] || "Unknown Room";
    const description = Description.value[eid] || "";
    const ambience = Room.ambience[eid] || "neutral";

    // Find agents in this room
    const allAgents = Array.from(query(world, [Agent]));
    const agentsHere = allAgents.filter(aid => {
      const agentRooms = getRelationTargets(world, aid, OccupiesRoom);
      return agentRooms.includes(eid);
    });

    const agentNames = agentsHere.map(aid => Name.value[aid] || "Unknown");

    // Find objects in this room
    const allObjects = Array.from(query(world, [PhysicalObject]));
    const objectsHere = allObjects.filter(oid => {
      const objRooms = getRelationTargets(world, oid, OccupiesRoom);
      return objRooms.includes(eid);
    });

    const objects = objectsHere.map(oid => {
      const objName = Name.value[oid] || "object";
      const meta = getDynamicComponentValues("ObjectMeta", oid);
      const state = meta?.state || "normal";
      return { name: objName, state };
    });

    return {
      eid,
      name,
      description,
      ambience,
      agentCount: agentsHere.length,
      agents: agentNames,
      objects,
    };
  });
}

// =============================================================================
// CONFLICT & NARRATIVE ANALYSIS
// =============================================================================

/**
 * Detect active conflicts between agents
 */
export function detectConflicts(
  world: World,
  registry: EntityRegistry,
  agentSummaries: AgentSummary[]
): ConflictSummary[] {
  const conflicts: ConflictSummary[] = [];

  // Look for negative impressions between agents
  for (const agent of agentSummaries) {
    const negativeRelations = agent.relationships.filter(r =>
      r.attitude === "hostile" || r.attitude === "unfriendly"
    );

    for (const rel of negativeRelations) {
      // Check if the other agent also has negative feelings
      const otherAgent = agentSummaries.find(a => a.name === rel.name);
      if (otherAgent) {
        const reverseRel = otherAgent.relationships.find(r => r.name === agent.name);
        if (reverseRel && (reverseRel.attitude === "hostile" || reverseRel.attitude === "unfriendly")) {
          // Mutual conflict
          const existingConflict = conflicts.find(c =>
            c.parties.includes(agent.name) && c.parties.includes(otherAgent.name)
          );

          if (!existingConflict) {
            conflicts.push({
              parties: [agent.name, otherAgent.name],
              nature: "mutual hostility",
              intensity: calculateConflictIntensity(agent, otherAgent, rel.attitude, reverseRel.attitude),
              source: "impressions",
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Calculate conflict intensity between two agents
 */
function calculateConflictIntensity(
  agent1: AgentSummary,
  agent2: AgentSummary,
  attitude1: string,
  attitude2: string
): number {
  let intensity = 0;

  // Base intensity from attitudes
  if (attitude1 === "hostile") intensity += 0.4;
  else if (attitude1 === "unfriendly") intensity += 0.2;

  if (attitude2 === "hostile") intensity += 0.4;
  else if (attitude2 === "unfriendly") intensity += 0.2;

  // Proximity increases intensity
  if (agent1.location === agent2.location) {
    intensity += 0.2;
  }

  // High arousal increases intensity
  intensity += (agent1.arousal + agent2.arousal) * 0.1;

  return Math.min(1, intensity);
}

/**
 * Analyze the current narrative arc
 */
export function analyzeNarrativeArc(
  conflicts: ConflictSummary[],
  recentEvents: string[],
  agentSummaries: AgentSummary[]
): NarrativeArc {
  const eventCount = recentEvents.length;
  const avgConflictIntensity = conflicts.length > 0
    ? conflicts.reduce((sum, c) => sum + c.intensity, 0) / conflicts.length
    : 0;

  // Calculate overall tension
  let tension = avgConflictIntensity;

  // High arousal agents contribute to tension
  const avgArousal = agentSummaries.length > 0
    ? agentSummaries.reduce((sum, a) => sum + a.arousal, 0) / agentSummaries.length
    : 0.5;
  tension = (tension + avgArousal) / 2;

  // Determine narrative phase
  let currentPhase: NarrativeArc["currentPhase"];

  if (eventCount < 5) {
    currentPhase = "setup";
  } else if (tension > 0.7) {
    currentPhase = "climax";
  } else if (tension > 0.4) {
    currentPhase = "rising";
  } else if (conflicts.length === 0 && eventCount > 20) {
    currentPhase = "resolution";
  } else if (eventCount > 30 && tension < 0.2) {
    currentPhase = "stagnant";
  } else {
    currentPhase = "falling";
  }

  return {
    currentPhase,
    tension,
    recentEvents: recentEvents.slice(-10),
    eventCount,
  };
}

/**
 * Calculate stagnation score (how "stuck" the simulation is)
 */
export function calculateStagnation(
  agentSummaries: AgentSummary[],
  recentEvents: string[]
): number {
  let stagnation = 0;

  // Few recent events = stagnation
  if (recentEvents.length < 3) stagnation += 0.4;
  else if (recentEvents.length < 10) stagnation += 0.2;

  // All agents inactive = stagnation
  const inactiveAgents = agentSummaries.filter(a => !a.active || a.mode === "waiting");
  if (inactiveAgents.length === agentSummaries.length) {
    stagnation += 0.4;
  } else {
    stagnation += (inactiveAgents.length / Math.max(agentSummaries.length, 1)) * 0.2;
  }

  // Low average arousal = stagnation
  const avgArousal = agentSummaries.length > 0
    ? agentSummaries.reduce((sum, a) => sum + a.arousal, 0) / agentSummaries.length
    : 0.5;
  if (avgArousal < 0.3) stagnation += 0.2;

  return Math.min(1, stagnation);
}

// =============================================================================
// NARRATIVE TENSION CALCULATION
// =============================================================================

/**
 * Calculate the current narrative tension level
 */
export function getNarrativeTension(
  world: World,
  registry: EntityRegistry,
  recentEvents: string[] = []
): number {
  const agentSummaries = getAgentSummaries(world, registry);
  const conflicts = detectConflicts(world, registry, agentSummaries);
  const arc = analyzeNarrativeArc(conflicts, recentEvents, agentSummaries);
  return arc.tension;
}

// =============================================================================
// EVENT INJECTION
// =============================================================================

/**
 * Inject an event into the simulation
 */
export function injectEvent(
  world: World,
  registry: EntityRegistry,
  event: InjectedEvent,
  target: EventInjectionTarget
): { success: boolean; message: string } {
  const source = event.source || "the world";
  const intensity = event.intensity ?? 0.8;

  if (target.broadcast) {
    // Broadcast to all agents
    const agents = Array.from(query(world, [Agent]));
    for (const eid of agents) {
      queueStimulus({
        targetEid: eid,
        type: event.type,
        modality: event.modality,
        content: event.content,
        source,
        intensity,
      });
    }
    return { success: true, message: `Broadcast event to ${agents.length} agents` };
  }

  if (target.room !== undefined) {
    // Broadcast to room
    broadcastToRoom(world, target.room, {
      type: event.type,
      modality: event.modality,
      content: event.content,
      source,
      intensity,
    });
    const roomName = Name.value[target.room] || "room";
    return { success: true, message: `Injected event into ${roomName}` };
  }

  if (target.agent !== undefined) {
    // Send to specific agent
    queueStimulus({
      targetEid: target.agent,
      type: event.type,
      modality: event.modality,
      content: event.content,
      source,
      intensity,
    });
    const agentName = Name.value[target.agent] || "agent";
    return { success: true, message: `Injected event to ${agentName}` };
  }

  return { success: false, message: "No valid target specified" };
}

/**
 * Inject an environmental event to a room
 */
export function injectEnvironmentalEvent(
  world: World,
  registry: EntityRegistry,
  roomName: string,
  content: string,
  modality: SensoryModality = "visual"
): { success: boolean; message: string } {
  const roomEid = registry.byName.get(roomName);
  if (roomEid === undefined) {
    return { success: false, message: `Room "${roomName}" not found` };
  }

  return injectEvent(world, registry, {
    type: "environmental",
    content,
    modality,
    source: "environment",
  }, { room: roomEid });
}

/**
 * Inject an intuition/cognitive sense event to a specific agent
 */
export function injectIntuition(
  world: World,
  registry: EntityRegistry,
  agentName: string,
  content: string
): { success: boolean; message: string } {
  const agentEid = registry.byName.get(agentName);
  if (agentEid === undefined) {
    return { success: false, message: `Agent "${agentName}" not found` };
  }

  return injectEvent(world, registry, {
    type: "intuition",
    content,
    modality: "cognitive",
    source: "inner sense",
    intensity: 0.9,
  }, { agent: agentEid });
}

/**
 * Broadcast an announcement to all agents
 */
export function broadcastAnnouncement(
  world: World,
  registry: EntityRegistry,
  content: string,
  modality: SensoryModality = "auditory"
): { success: boolean; message: string } {
  return injectEvent(world, registry, {
    type: "announcement",
    content,
    modality,
    source: "world",
    intensity: 1.0,
  }, { broadcast: true });
}

// =============================================================================
// STEERING PATTERNS
// =============================================================================

export interface SteeringRecommendation {
  pattern: "nudge" | "catalyst" | "escalation" | "resolution";
  description: string;
  suggestedAction: string;
  priority: number;
}

/**
 * Analyze the simulation and suggest steering interventions
 */
export function getSteeringRecommendations(
  summary: WorldStateSummary
): SteeringRecommendation[] {
  const recommendations: SteeringRecommendation[] = [];

  // Pattern 1: Gentle Nudges (for stagnation)
  if (summary.stagnationScore > 0.5) {
    recommendations.push({
      pattern: "nudge",
      description: "Simulation appears stagnant - agents are inactive or repetitive",
      suggestedAction: "Inject environmental stimulus to spark interaction",
      priority: summary.stagnationScore,
    });
  }

  // Pattern 2: Catalyst Introduction (no conflicts, low tension)
  if (summary.activeConflicts.length === 0 && summary.narrativeArc.tension < 0.3) {
    recommendations.push({
      pattern: "catalyst",
      description: "No active conflicts and low tension - story lacks drama",
      suggestedAction: "Introduce new NPC with conflicting goals or trigger a crisis",
      priority: 0.6,
    });
  }

  // Pattern 3: Escalation (conflict exists but tension is low)
  if (summary.activeConflicts.length > 0 && summary.narrativeArc.tension < 0.5) {
    recommendations.push({
      pattern: "escalation",
      description: "Conflicts exist but tension is low - stakes aren't high enough",
      suggestedAction: "Raise stakes via environmental pressure or deadline",
      priority: 0.5,
    });
  }

  // Pattern 4: Resolution Facilitation (tension too high for too long)
  if (summary.narrativeArc.tension > 0.8 && summary.narrativeArc.eventCount > 30) {
    recommendations.push({
      pattern: "resolution",
      description: "Tension has been high for extended period - risk of narrative exhaustion",
      suggestedAction: "Create opportunity for resolution (mediator, common threat)",
      priority: 0.7,
    });
  }

  // Sort by priority
  recommendations.sort((a, b) => b.priority - a.priority);

  return recommendations;
}

// =============================================================================
// OBSERVATION LOOP
// =============================================================================

export interface ObservationState {
  lastObservation: number;
  recentEvents: string[];
  interventionCount: number;
  config: MonitoringConfig;
}

/**
 * Create initial observation state
 */
export function createObservationState(config?: Partial<MonitoringConfig>): ObservationState {
  return {
    lastObservation: 0,
    recentEvents: [],
    interventionCount: 0,
    config: {
      observationInterval: 30000, // 30 seconds
      stagnationThreshold: 10,
      tensionDecayRate: 0.01,
      autoIntervene: false,
      ...config,
    },
  };
}

/**
 * Record an event in the observation state
 */
export function recordEvent(state: ObservationState, event: string): void {
  state.recentEvents.push(event);
  // Keep only last 100 events
  if (state.recentEvents.length > 100) {
    state.recentEvents = state.recentEvents.slice(-100);
  }
}

/**
 * Run the observation loop - call this periodically
 */
export function runObservation(
  world: World,
  registry: EntityRegistry,
  state: ObservationState,
  tick: number
): ObservationResult {
  const now = Date.now();
  state.lastObservation = now;

  const summary = getWorldSummary(world, registry, state.recentEvents, tick);
  const recommendations = getSteeringRecommendations(summary);

  const shouldIntervene = summary.stagnationScore > 0.6 ||
    (summary.narrativeArc.currentPhase === "stagnant");

  const suggestedInterventions = recommendations.map(r => r.suggestedAction);

  return {
    summary,
    recommendations: recommendations.map(r => r.description),
    shouldIntervene,
    suggestedInterventions,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Derive a mood string from arousal level and mode
 */
function deriveMood(arousal: number, mode: string): string {
  if (mode === "reflective") return "contemplative";
  if (mode === "creative") return "inspired";

  if (arousal > 0.8) return "agitated";
  if (arousal > 0.6) return "excited";
  if (arousal > 0.4) return "alert";
  if (arousal > 0.2) return "calm";
  return "drowsy";
}

/**
 * Derive an attitude string from valence
 */
function deriveAttitude(valence: number): string {
  if (valence > 0.6) return "friendly";
  if (valence > 0.2) return "neutral";
  if (valence > -0.2) return "cautious";
  if (valence > -0.6) return "unfriendly";
  return "hostile";
}

/**
 * Get a text-based summary suitable for LLM context
 */
export function getWorldSummaryText(summary: WorldStateSummary): string {
  const lines: string[] = [];

  lines.push(`=== WORLD STATE (Tick ${summary.tick}) ===`);
  lines.push(`Narrative Phase: ${summary.narrativeArc.currentPhase}`);
  lines.push(`Tension: ${(summary.narrativeArc.tension * 100).toFixed(0)}%`);
  lines.push(`Stagnation: ${(summary.stagnationScore * 100).toFixed(0)}%`);
  lines.push("");

  lines.push(`--- AGENTS (${summary.agentCount}) ---`);
  for (const agent of summary.agentSummaries) {
    lines.push(`${agent.name} [${agent.mood}] @ ${agent.location}`);
    if (agent.goals.length > 0) {
      lines.push(`  Goals: ${agent.goals.map(g => g.description).join(", ")}`);
    }
    if (agent.relationships.length > 0) {
      const rels = agent.relationships.map(r => `${r.name}(${r.attitude})`).join(", ");
      lines.push(`  Relationships: ${rels}`);
    }
  }
  lines.push("");

  if (summary.activeConflicts.length > 0) {
    lines.push(`--- CONFLICTS ---`);
    for (const conflict of summary.activeConflicts) {
      lines.push(`${conflict.parties.join(" vs ")} (${(conflict.intensity * 100).toFixed(0)}% intensity)`);
    }
    lines.push("");
  }

  lines.push(`--- LOCATIONS (${summary.roomCount}) ---`);
  for (const room of summary.roomSummaries) {
    const occupants = room.agents.length > 0 ? `[${room.agents.join(", ")}]` : "[empty]";
    lines.push(`${room.name}: ${occupants}`);
  }

  return lines.join("\n");
}
