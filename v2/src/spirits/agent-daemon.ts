/**
 * Agent Daemon System
 *
 * Personal guardian spirits for individual agents. Each daemon:
 * - Watches their assigned agent's state and behavior
 * - Whispers guidance via cognitive stimuli
 * - Reports to higher spirits about agent struggles/achievements
 * - Helps prevent agents from getting stuck
 * - Maintains personality consistency
 *
 * Daemons are lightweight observers using the flash model for efficiency.
 */

import { generateText } from "ai";
import { query, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Goal, GridPosition, Health, Inventory } from "../ecs/components";
import { OccupiesRoom, HasGoal, HasMemory, HasThought } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { queueStimulus } from "../cognition/cognition-system";
import { daemonModel, THINKING_LEVELS } from "../llm/config";
import type { SpiritRegistry } from "./spirit-registry";
import { sendMessage, reportToSuperior } from "./spirit-registry";
import { recordEvent } from "./consistency-spirit";

// =============================================================================
// DAEMON STATE
// =============================================================================

export interface DaemonState {
  daemonEid: number;
  agentEid: number;
  agentName: string;
  lastObservation: number;
  observationCount: number;
  whisperCount: number;
  reportCount: number;
  lastAgentState: AgentStateSnapshot | null;
  concernLevel: number;  // 0-1, how worried the daemon is about the agent
  lastWhisper: number;
  lastReport: number;
  active: boolean;
}

export interface AgentStateSnapshot {
  timestamp: number;
  position?: { x: number; y: number };
  room?: string;
  arousal: number;
  focus: string;
  mode: string;
  active: boolean;
  health?: number;
  goalCount: number;
  thoughtCount: number;
  lastAction?: string;
  stuckTicks: number;  // How many ticks with no meaningful change
}

export interface DaemonObservation {
  agentName: string;
  currentState: AgentStateSnapshot;
  previousState: AgentStateSnapshot | null;
  concerns: DaemonConcern[];
  growthOpportunities: GrowthOpportunity[];
  achievements: string[];
  timestamp: number;
}

export interface DaemonConcern {
  type: "stuck" | "goal_drift" | "low_arousal" | "high_arousal" | "isolation" | "danger" | "confusion";
  severity: "low" | "medium" | "high";
  description: string;
  suggestedWhisper?: string;
}

/**
 * Growth opportunities - when the daemon sees potential for challenge/development
 */
export interface GrowthOpportunity {
  type: "too_comfortable" | "ready_for_challenge" | "stagnating" | "needs_conflict" | "breakthrough_possible" | "skill_plateau" | "relationship_test";
  description: string;
  suggestedChallenge: string;
  urgency: "low" | "medium" | "high";
}

/**
 * Challenge whispers - provocations to push growth
 */
export interface ChallengeWhisper {
  agentEid: number;
  content: string;
  challengeType: "provocation" | "doubt" | "ambition" | "curiosity" | "restlessness";
  timestamp: number;
}

export interface DaemonWhisper {
  agentEid: number;
  content: string;
  type: "guidance" | "reminder" | "warning" | "encouragement" | "observation";
  timestamp: number;
}

export interface DaemonReport {
  daemonEid: number;
  agentName: string;
  reportType: "status" | "concern" | "achievement" | "intervention_needed" | "growth_opportunity";
  content: string;
  concerns: DaemonConcern[];
  growthOpportunities: GrowthOpportunity[];  // For GodAI/Arbiter to create challenges
  priority: "low" | "normal" | "high";
  timestamp: number;
}

// =============================================================================
// DAEMON REGISTRY
// =============================================================================

export interface DaemonRegistry {
  daemons: Map<number, DaemonState>;  // agentEid -> daemonState
  observationInterval: number;
  whisperCooldown: number;
  reportCooldown: number;
  superiorSpiritEid?: number;  // Usually ConsistencySpirit or GodAI
}

/**
 * Create a daemon registry
 */
export function createDaemonRegistry(
  observationInterval: number = 10000,  // 10 seconds
  whisperCooldown: number = 30000,      // 30 seconds between whispers
  reportCooldown: number = 60000        // 60 seconds between reports
): DaemonRegistry {
  return {
    daemons: new Map(),
    observationInterval,
    whisperCooldown,
    reportCooldown,
  };
}

/**
 * Set the superior spirit that daemons report to
 */
export function setDaemonSuperior(registry: DaemonRegistry, spiritEid: number): void {
  registry.superiorSpiritEid = spiritEid;
}

// =============================================================================
// DAEMON LIFECYCLE
// =============================================================================

let daemonIdCounter = 0;

/**
 * Create a daemon for an agent
 */
export function createDaemonForAgent(
  registry: DaemonRegistry,
  world: World,
  agentEid: number
): DaemonState | null {
  if (!entityExists(world, agentEid)) return null;
  if (registry.daemons.has(agentEid)) return registry.daemons.get(agentEid)!;

  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;

  const daemon: DaemonState = {
    daemonEid: ++daemonIdCounter + 10000,  // Offset to not conflict with ECS entities
    agentEid,
    agentName,
    lastObservation: 0,
    observationCount: 0,
    whisperCount: 0,
    reportCount: 0,
    lastAgentState: null,
    concernLevel: 0,
    lastWhisper: 0,
    lastReport: 0,
    active: true,
  };

  registry.daemons.set(agentEid, daemon);

  console.log(`[Daemon] Created guardian daemon for ${agentName}`);

  return daemon;
}

/**
 * Create daemons for all agents in the world
 */
export function createDaemonsForAllAgents(registry: DaemonRegistry, world: World): number {
  const agents = Array.from(query(world, [Agent]));
  let created = 0;

  for (const agentEid of agents) {
    if (!registry.daemons.has(agentEid)) {
      createDaemonForAgent(registry, world, agentEid);
      created++;
    }
  }

  return created;
}

/**
 * Remove a daemon
 */
export function removeDaemon(registry: DaemonRegistry, agentEid: number): void {
  const daemon = registry.daemons.get(agentEid);
  if (daemon) {
    console.log(`[Daemon] Removed guardian daemon for ${daemon.agentName}`);
    registry.daemons.delete(agentEid);
  }
}

/**
 * Get daemons that need to run observation
 */
export function getDaemonsNeedingObservation(registry: DaemonRegistry): DaemonState[] {
  const now = Date.now();
  return Array.from(registry.daemons.values()).filter(d =>
    d.active && (now - d.lastObservation >= registry.observationInterval)
  );
}

// =============================================================================
// AGENT STATE COLLECTION
// =============================================================================

/**
 * Collect current state snapshot of an agent
 */
export function collectAgentState(world: World, agentEid: number): AgentStateSnapshot | null {
  if (!entityExists(world, agentEid)) return null;

  const rooms = safeGetRelationTargets(world, agentEid, OccupiesRoom);
  const roomName = rooms.length > 0 ? Name.value[rooms[0]] : undefined;

  const goals = safeGetRelationTargets(world, agentEid, HasGoal);
  const thoughts = safeGetRelationTargets(world, agentEid, HasThought);

  return {
    timestamp: Date.now(),
    position: GridPosition.x[agentEid] !== undefined ? {
      x: GridPosition.x[agentEid],
      y: GridPosition.y[agentEid],
    } : undefined,
    room: roomName,
    arousal: Mind.arousal[agentEid] ?? 0.5,
    focus: Mind.focus[agentEid] || "",
    mode: Mind.mode[agentEid] || "reactive",
    active: Agent.active[agentEid] ?? true,
    health: Health.current[agentEid],
    goalCount: goals.length,
    thoughtCount: thoughts.length,
    stuckTicks: 0,
  };
}

/**
 * Detect concerns by comparing current and previous state
 */
export function detectConcerns(
  current: AgentStateSnapshot,
  previous: AgentStateSnapshot | null,
  agentName: string
): DaemonConcern[] {
  const concerns: DaemonConcern[] = [];

  // Check for stuck agent (no position change over multiple observations)
  if (previous) {
    const samePosition = current.position && previous.position &&
      current.position.x === previous.position.x &&
      current.position.y === previous.position.y;
    const sameFocus = current.focus === previous.focus;
    const sameRoom = current.room === previous.room;

    if (samePosition && sameFocus && sameRoom && previous.stuckTicks > 2) {
      concerns.push({
        type: "stuck",
        severity: previous.stuckTicks > 5 ? "high" : "medium",
        description: `${agentName} hasn't moved or changed focus for ${previous.stuckTicks} observations`,
        suggestedWhisper: "Perhaps you should explore or try something different?",
      });
    }
  }

  // Check for low arousal (disengaged)
  if (current.arousal < 0.2) {
    concerns.push({
      type: "low_arousal",
      severity: "low",
      description: `${agentName} seems disengaged (arousal: ${current.arousal.toFixed(2)})`,
      suggestedWhisper: "Something interesting might be happening nearby...",
    });
  }

  // Check for high arousal (overwhelmed)
  if (current.arousal > 0.9) {
    concerns.push({
      type: "high_arousal",
      severity: "medium",
      description: `${agentName} seems overwhelmed (arousal: ${current.arousal.toFixed(2)})`,
      suggestedWhisper: "Take a moment to breathe and assess the situation.",
    });
  }

  // Check for danger (low health)
  if (current.health !== undefined && current.health < 30) {
    concerns.push({
      type: "danger",
      severity: current.health < 10 ? "high" : "medium",
      description: `${agentName} is injured (health: ${current.health})`,
      suggestedWhisper: "You should find safety and rest to recover.",
    });
  }

  // Check for no goals
  if (current.goalCount === 0) {
    concerns.push({
      type: "goal_drift",
      severity: "low",
      description: `${agentName} has no active goals`,
      suggestedWhisper: "What do you want to achieve? Consider setting a goal.",
    });
  }

  // Check for inactive agent
  if (!current.active) {
    concerns.push({
      type: "confusion",
      severity: "high",
      description: `${agentName} has become inactive`,
    });
  }

  return concerns;
}

// =============================================================================
// GROWTH OPPORTUNITY DETECTION
// =============================================================================

/**
 * Detect growth opportunities - when an agent is ready for challenge/development
 * The daemon's job is not just to protect, but to push growth and engagement
 */
export function detectGrowthOpportunities(
  current: AgentStateSnapshot,
  previous: AgentStateSnapshot | null,
  agentName: string,
  concernLevel: number
): GrowthOpportunity[] {
  const opportunities: GrowthOpportunity[] = [];

  // TOO COMFORTABLE: Agent has been stable with no challenges for too long
  if (concernLevel < 0.1 && current.arousal > 0.3 && current.arousal < 0.6) {
    // Mid-range arousal with low concerns = complacency zone
    if (previous && previous.stuckTicks > 1) {
      opportunities.push({
        type: "too_comfortable",
        description: `${agentName} has been in a comfort zone with no challenges`,
        suggestedChallenge: "Introduce a minor conflict or unexpected obstacle",
        urgency: "low",
      });
    }
  }

  // READY FOR CHALLENGE: High health, stable arousal, has goals
  if (current.health && current.health > 80 &&
      current.arousal > 0.4 && current.arousal < 0.7 &&
      current.goalCount >= 1) {
    opportunities.push({
      type: "ready_for_challenge",
      description: `${agentName} is in prime condition for a challenge`,
      suggestedChallenge: "Present a meaningful obstacle to their current goal",
      urgency: "medium",
    });
  }

  // STAGNATING: Same position/focus for too long despite being active
  if (current.stuckTicks > 3 && current.active && current.arousal > 0.2) {
    opportunities.push({
      type: "stagnating",
      description: `${agentName} is stuck in a rut despite being engaged`,
      suggestedChallenge: "Introduce a disruptive event or new character interaction",
      urgency: "medium",
    });
  }

  // NEEDS CONFLICT: No recent emotional peaks, flat arousal history
  if (current.arousal > 0.35 && current.arousal < 0.55 && concernLevel < 0.2) {
    opportunities.push({
      type: "needs_conflict",
      description: `${agentName}'s emotional state is too flat - needs drama`,
      suggestedChallenge: "Create interpersonal tension or moral dilemma",
      urgency: "low",
    });
  }

  // BREAKTHROUGH POSSIBLE: High arousal but productive (not danger)
  if (current.arousal > 0.7 && current.arousal < 0.85 &&
      current.health && current.health > 50 &&
      current.goalCount >= 1) {
    opportunities.push({
      type: "breakthrough_possible",
      description: `${agentName} is in flow state - prime for breakthrough moment`,
      suggestedChallenge: "Escalate stakes or present critical choice",
      urgency: "high",
    });
  }

  // SKILL PLATEAU: Has goals but not progressing (similar state over time)
  if (previous && current.goalCount === previous.goalCount &&
      current.goalCount > 0 && current.stuckTicks > 2) {
    opportunities.push({
      type: "skill_plateau",
      description: `${agentName} may have hit a plateau in pursuing their goals`,
      suggestedChallenge: "Introduce a mentor, rival, or new technique to discover",
      urgency: "medium",
    });
  }

  // RELATIONSHIP TEST: Agent is stable - good time for social challenge
  if (current.health && current.health > 60 &&
      current.arousal > 0.3 && current.arousal < 0.6 &&
      concernLevel < 0.3) {
    // Only add occasionally (not every observation)
    if (Math.random() < 0.3) {
      opportunities.push({
        type: "relationship_test",
        description: `${agentName} is in stable condition for relationship dynamics`,
        suggestedChallenge: "Test loyalty, create jealousy, or introduce romantic tension",
        urgency: "low",
      });
    }
  }

  return opportunities;
}

// =============================================================================
// DAEMON OBSERVATION CYCLE
// =============================================================================

/**
 * Run observation cycle for a single daemon
 */
export function observeAgent(
  world: World,
  daemon: DaemonState
): DaemonObservation | null {
  const currentState = collectAgentState(world, daemon.agentEid);
  if (!currentState) return null;

  // Calculate stuck ticks
  if (daemon.lastAgentState) {
    const samePosition = currentState.position && daemon.lastAgentState.position &&
      currentState.position.x === daemon.lastAgentState.position.x &&
      currentState.position.y === daemon.lastAgentState.position.y;
    const sameFocus = currentState.focus === daemon.lastAgentState.focus;

    if (samePosition && sameFocus) {
      currentState.stuckTicks = daemon.lastAgentState.stuckTicks + 1;
    }
  }

  const concerns = detectConcerns(currentState, daemon.lastAgentState, daemon.agentName);
  const achievements: string[] = [];

  // Detect achievements (improvements from previous state)
  if (daemon.lastAgentState) {
    if (currentState.goalCount > daemon.lastAgentState.goalCount) {
      achievements.push(`Set a new goal`);
    }
    if (currentState.health && daemon.lastAgentState.health &&
        currentState.health > daemon.lastAgentState.health) {
      achievements.push(`Recovered health`);
    }
    if (currentState.arousal > 0.3 && daemon.lastAgentState.arousal < 0.3) {
      achievements.push(`Became more engaged`);
    }
  }

  // Update daemon state
  daemon.lastObservation = Date.now();
  daemon.observationCount++;
  daemon.lastAgentState = currentState;
  daemon.concernLevel = Math.min(1, concerns.reduce((sum, c) =>
    sum + (c.severity === "high" ? 0.3 : c.severity === "medium" ? 0.2 : 0.1), 0
  ));

  // Detect growth opportunities (the daemon pushes challenge, not just protects)
  const growthOpportunities = detectGrowthOpportunities(
    currentState,
    daemon.lastAgentState,
    daemon.agentName,
    daemon.concernLevel
  );

  // Record observation event
  recordEvent("daemon_observation", {
    agent: daemon.agentName,
    concerns: concerns.length,
    achievements: achievements.length,
    growthOpportunities: growthOpportunities.length,
    concernLevel: daemon.concernLevel,
  }, `Daemon_${daemon.agentName}`);

  return {
    agentName: daemon.agentName,
    currentState,
    previousState: daemon.lastAgentState,
    concerns,
    growthOpportunities,
    achievements,
    timestamp: Date.now(),
  };
}

// =============================================================================
// WHISPERS (Guidance to Agents)
// =============================================================================

/**
 * Generate and send a whisper to an agent
 */
export async function whisperToAgent(
  world: World,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceWhisper: boolean = false
): Promise<DaemonWhisper | null> {
  const now = Date.now();

  // Check cooldown
  if (!forceWhisper && now - daemon.lastWhisper < 30000) { // 30 second cooldown
    return null;
  }

  // Only whisper if there are concerns or it's time for encouragement
  if (observation.concerns.length === 0 && daemon.observationCount % 10 !== 0) {
    return null;
  }

  // Determine whisper type and content
  let whisperType: DaemonWhisper["type"] = "guidance";
  let whisperContent = "";

  if (observation.concerns.length > 0) {
    const topConcern = observation.concerns.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })[0];

    if (topConcern.suggestedWhisper) {
      whisperContent = topConcern.suggestedWhisper;
      whisperType = topConcern.type === "danger" ? "warning" :
                    topConcern.type === "stuck" ? "guidance" : "observation";
    } else {
      // Generate whisper with LLM
      try {
        const result = await generateText({
          model: daemonModel,
          prompt: `You are a daemon (guardian spirit) watching over ${observation.agentName}.
You've observed a concern: ${topConcern.description}

Generate a short, subtle whisper (1 sentence, under 20 words) to gently guide them.
The whisper should feel like an inner voice or intuition, not a direct command.
Do not use quotes. Just output the whisper text.`,
          maxTokens: 50,
        });
        whisperContent = result.text.trim().replace(/^["']|["']$/g, '');
        whisperType = "guidance";
      } catch (error) {
        // Fallback to generic whisper
        whisperContent = "Something feels off. Perhaps a change is needed.";
      }
    }
  } else if (observation.achievements.length > 0) {
    whisperType = "encouragement";
    whisperContent = "You're doing well. Keep going.";
  }

  if (!whisperContent) return null;

  // Send whisper as cognitive stimulus
  queueStimulus({
    targetEid: daemon.agentEid,
    type: "daemon_whisper",
    modality: "cognitive",
    content: whisperContent,
    source: "inner_voice",
    intensity: 0.3,  // Subtle, not overwhelming
  });

  daemon.lastWhisper = now;
  daemon.whisperCount++;

  const whisper: DaemonWhisper = {
    agentEid: daemon.agentEid,
    content: whisperContent,
    type: whisperType,
    timestamp: now,
  };

  console.log(`[Daemon] Whisper to ${daemon.agentName}: "${whisperContent}"`);

  // Record whisper event
  recordEvent("daemon_whisper", {
    agent: daemon.agentName,
    type: whisperType,
    content: whisperContent,
  }, `Daemon_${daemon.agentName}`, daemon.agentName);

  return whisper;
}

/**
 * Generate and send a CHALLENGE whisper to push agent growth
 * Unlike protective whispers, these provocations encourage risk, ambition, curiosity
 */
export async function whisperChallenge(
  world: World,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceWhisper: boolean = false
): Promise<ChallengeWhisper | null> {
  const now = Date.now();

  // Use longer cooldown for challenge whispers (they should be rarer)
  if (!forceWhisper && now - daemon.lastWhisper < 60000) { // 60 second cooldown
    return null;
  }

  // Only challenge if there are growth opportunities
  if (observation.growthOpportunities.length === 0) {
    return null;
  }

  // Pick the highest urgency growth opportunity
  const topOpportunity = observation.growthOpportunities.sort((a, b) => {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  })[0];

  // Map opportunity types to challenge types
  const challengeTypeMap: Record<GrowthOpportunity["type"], ChallengeWhisper["challengeType"]> = {
    "too_comfortable": "restlessness",
    "ready_for_challenge": "ambition",
    "stagnating": "curiosity",
    "needs_conflict": "provocation",
    "breakthrough_possible": "ambition",
    "skill_plateau": "doubt",
    "relationship_test": "provocation",
  };

  const challengeType = challengeTypeMap[topOpportunity.type];

  // Generate challenge whisper with LLM
  let challengeContent = "";
  try {
    const result = await generateText({
      model: daemonModel,
      prompt: `You are a daemon (guardian spirit) watching over ${observation.agentName}.
Your role is NOT just to protect, but to push growth, challenge, and development.

You've noticed: ${topOpportunity.description}
Challenge type you should use: ${challengeType}

Generate a short, provocative whisper (1 sentence, under 20 words) that:
- If "provocation": Plants doubt, stirs jealousy, or questions their choices
- If "doubt": Questions their abilities or complacency
- If "ambition": Whispers of greater things they could achieve
- If "curiosity": Hints at mysteries or unexplored paths
- If "restlessness": Makes them feel the need to change or move

The whisper should feel like a nagging inner voice that won't let them rest easy.
Be subtle but unsettling. Do not use quotes. Just output the whisper text.`,
      maxTokens: 50,
    });
    challengeContent = result.text.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    // Fallback challenge whispers by type
    const fallbackWhispers: Record<ChallengeWhisper["challengeType"], string> = {
      provocation: "Are you truly content with this? Others achieve so much more.",
      doubt: "Is this really the best you can do?",
      ambition: "You were meant for greater things than this.",
      curiosity: "What lies beyond? You'll never know if you stay here.",
      restlessness: "Something is wrong. You can feel it. You need to move.",
    };
    challengeContent = fallbackWhispers[challengeType];
  }

  if (!challengeContent) return null;

  // Send challenge whisper as cognitive stimulus (higher intensity than guidance)
  queueStimulus({
    targetEid: daemon.agentEid,
    type: "daemon_challenge",
    modality: "cognitive",
    content: challengeContent,
    source: "inner_voice",
    intensity: 0.5,  // Stronger than guidance whispers
  });

  daemon.lastWhisper = now;
  daemon.whisperCount++;

  const challenge: ChallengeWhisper = {
    agentEid: daemon.agentEid,
    content: challengeContent,
    challengeType,
    timestamp: now,
  };

  console.log(`[Daemon] Challenge to ${daemon.agentName}: "${challengeContent}" (${challengeType})`);

  // Record challenge event
  recordEvent("daemon_challenge", {
    agent: daemon.agentName,
    challengeType,
    opportunity: topOpportunity.type,
    content: challengeContent,
  }, `Daemon_${daemon.agentName}`, daemon.agentName);

  return challenge;
}

// =============================================================================
// REPORTS (To Higher Spirits)
// =============================================================================

/**
 * Generate and send a report to superior spirit
 * Reports include both concerns (protection) and growth opportunities (challenge)
 * The Arbiter/GodAI can use growth opportunities to create interesting challenges
 */
export function reportToSuperiorSpirit(
  registry: DaemonRegistry,
  spiritRegistry: SpiritRegistry,
  daemon: DaemonState,
  observation: DaemonObservation,
  forceReport: boolean = false
): DaemonReport | null {
  const now = Date.now();

  // Check cooldown
  if (!forceReport && now - daemon.lastReport < registry.reportCooldown) {
    return null;
  }

  // Report if there are significant concerns OR high-urgency growth opportunities
  const highConcerns = observation.concerns.filter(c => c.severity === "high");
  const urgentGrowth = observation.growthOpportunities.filter(g => g.urgency === "high" || g.urgency === "medium");

  if (highConcerns.length === 0 && urgentGrowth.length === 0 && !forceReport) {
    return null;
  }

  // Determine report type - growth opportunities are important too!
  const reportType: DaemonReport["reportType"] =
    highConcerns.length > 0 ? "concern" :
    urgentGrowth.length > 0 ? "growth_opportunity" :
    observation.achievements.length > 0 ? "achievement" : "status";

  // Priority considers both concerns AND growth opportunities
  const priority: DaemonReport["priority"] =
    highConcerns.length > 1 ? "high" :
    (highConcerns.length === 1 || urgentGrowth.filter(g => g.urgency === "high").length > 0) ? "normal" : "low";

  // Build report content
  const lines: string[] = [
    `## Daemon Report: ${daemon.agentName}`,
    "",
  ];

  if (observation.concerns.length > 0) {
    lines.push("### Concerns (Protection Needed):");
    for (const concern of observation.concerns) {
      lines.push(`- [${concern.severity.toUpperCase()}] ${concern.type}: ${concern.description}`);
    }
    lines.push("");
  }

  // IMPORTANT: Include growth opportunities for the Arbiter/GodAI to act on
  if (observation.growthOpportunities.length > 0) {
    lines.push("### Growth Opportunities (Challenge Recommended):");
    for (const opportunity of observation.growthOpportunities) {
      lines.push(`- [${opportunity.urgency.toUpperCase()}] ${opportunity.type}: ${opportunity.description}`);
      lines.push(`  → Suggested: ${opportunity.suggestedChallenge}`);
    }
    lines.push("");
  }

  if (observation.achievements.length > 0) {
    lines.push("### Achievements:");
    for (const achievement of observation.achievements) {
      lines.push(`- ${achievement}`);
    }
    lines.push("");
  }

  lines.push(`### Agent State:`);
  lines.push(`- Arousal: ${observation.currentState.arousal.toFixed(2)}`);
  lines.push(`- Focus: ${observation.currentState.focus || "none"}`);
  lines.push(`- Goals: ${observation.currentState.goalCount}`);
  if (observation.currentState.health !== undefined) {
    lines.push(`- Health: ${observation.currentState.health}`);
  }

  const report: DaemonReport = {
    daemonEid: daemon.daemonEid,
    agentName: daemon.agentName,
    reportType,
    content: lines.join("\n"),
    concerns: observation.concerns,
    growthOpportunities: observation.growthOpportunities,
    priority,
    timestamp: now,
  };

  // Send to superior if available
  if (registry.superiorSpiritEid && spiritRegistry) {
    reportToSuperior(
      spiritRegistry,
      daemon.daemonEid as any, // Daemon IDs are virtual, not ECS entities
      `Daemon Report: ${daemon.agentName}`,
      report.content,
      priority,
      { report }
    );
  }

  daemon.lastReport = now;
  daemon.reportCount++;

  console.log(`[Daemon] Report sent for ${daemon.agentName} (${reportType}, ${priority})`);

  // Record report event
  recordEvent("daemon_report", {
    agent: daemon.agentName,
    type: reportType,
    priority,
    concerns: observation.concerns.length,
    growthOpportunities: observation.growthOpportunities.length,
  }, `Daemon_${daemon.agentName}`);

  return report;
}

// =============================================================================
// DAEMON SYSTEM RUNNER
// =============================================================================

/**
 * Run all daemons that need observation
 * Daemons now serve dual purpose: protection (guidance whispers) AND growth (challenge whispers)
 */
export async function runDaemonSystem(
  world: World,
  registry: DaemonRegistry,
  spiritRegistry?: SpiritRegistry
): Promise<{
  observations: number;
  whispers: number;
  challenges: number;
  reports: number;
}> {
  const daemonsToRun = getDaemonsNeedingObservation(registry);

  let observations = 0;
  let whispers = 0;
  let challenges = 0;
  let reports = 0;

  for (const daemon of daemonsToRun) {
    // Check if agent still exists
    if (!entityExists(world, daemon.agentEid)) {
      removeDaemon(registry, daemon.agentEid);
      continue;
    }

    // Observe
    const observation = observeAgent(world, daemon);
    if (!observation) continue;
    observations++;

    // Priority: concerns get guidance whispers, growth gets challenge whispers
    // If there are concerns, prioritize protective guidance
    if (observation.concerns.length > 0) {
      const whisper = await whisperToAgent(world, daemon, observation);
      if (whisper) whispers++;
    }
    // If no concerns but growth opportunities, push with challenge whispers
    else if (observation.growthOpportunities.length > 0) {
      const challenge = await whisperChallenge(world, daemon, observation);
      if (challenge) challenges++;
    }

    // Maybe report (includes both concerns AND growth opportunities for GodAI)
    if (spiritRegistry) {
      const report = reportToSuperiorSpirit(registry, spiritRegistry, daemon, observation);
      if (report) reports++;
    }
  }

  return { observations, whispers, challenges, reports };
}

// =============================================================================
// DAEMON SUMMARY
// =============================================================================

/**
 * Get summary of all daemons
 */
export function getDaemonSummary(registry: DaemonRegistry): string {
  const lines: string[] = [
    "=== Daemon Registry ===",
    `Total daemons: ${registry.daemons.size}`,
    `Observation interval: ${registry.observationInterval}ms`,
    `Whisper cooldown: ${registry.whisperCooldown}ms`,
    `Report cooldown: ${registry.reportCooldown}ms`,
    "",
  ];

  for (const daemon of registry.daemons.values()) {
    const status = daemon.active ? "✓" : "✗";
    lines.push(`${status} ${daemon.agentName}:`);
    lines.push(`   Observations: ${daemon.observationCount}, Whispers: ${daemon.whisperCount}, Reports: ${daemon.reportCount}`);
    lines.push(`   Concern level: ${(daemon.concernLevel * 100).toFixed(0)}%`);
  }

  return lines.join("\n");
}
