/**
 * Appearance Emitter System
 *
 * Broadcasts visual stimuli to nearby NPCs when character appearances change.
 * This allows NPCs to notice when others change expression, pick up items,
 * change clothes, or have their condition change (muddy, bloody, etc).
 */

import type { World } from "../ecs/world";
import { query, entityExists, hasComponent } from "bitecs";
import { Agent, Mind, Name, Appearance, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { snapshotCharacterAppearance } from "../rendering/character-appearance";
import { addPerception } from "./agent-mind";
import { isAgentVisualEntity } from "./world-capabilities";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { wakeForegroundCognition } from "./idle-cognition";

// Track last broadcasted appearance state per entity
interface AppearanceSnapshot {
  actorKey: string;
  name: string;
  room: number;
  expression: string;
  posture: string;
  condition: string;
  visiblyHolding: string;
  clothing: string;
  lastBroadcast: number;
}

interface WorldState { actors: Map<number, AppearanceSnapshot>; frame: number; sourceId: string | null }
const states = new WeakMap<World, WorldState>();
// Compatibility stats/cleanup retain only weak references to retired worlds.
const worlds = new Set<WeakRef<World>>();
const collected = new FinalizationRegistry<WeakRef<World>>(reference => worlds.delete(reference));

// Configuration
const APPEARANCE_BROADCAST_INTERVAL = 30_000; // in-world milliseconds, never wall time
const MAX_TRACKED_ACTORS = 2048;
const clip = (value: string, max: number) => String(value || "").slice(0, max);
function active(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && !!Agent.active[eid]
    && hasComponent(world, eid, Mind) && hasComponent(world, eid, Appearance);
}
function worldState(world: World): WorldState {
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  let state = states.get(world);
  if (!state) {
    state = { actors: new Map(), frame: -1, sourceId: source.sourceId }; states.set(world, state);
    const reference = new WeakRef(world); worlds.add(reference); collected.register(world, reference);
  }
  if (state.sourceId !== source.sourceId || now < state.frame || source.stopped) {
    state.actors.clear(); state.frame = -1; state.sourceId = source.sourceId;
  }
  return state;
}

/**
 * Get current appearance state for comparison
 */
function getAppearanceSnapshot(world: World, eid: number): AppearanceSnapshot | undefined {
  if (!active(world, eid)) return;
  const room = getRoomForEntity(world, eid), physical = snapshotCharacterAppearance(world, eid);
  if (room === undefined || !physical) return;
  const actorKey = workingMemoryEntityRef(world, eid)?.key; if (!actorKey) return;
  return {
    actorKey, name: clip(physical.name, 96), room,
    expression: clip(physical.expression, 128), posture: clip(physical.posture, 128),
    condition: clip(physical.condition, 256), visiblyHolding: clip(physical.visiblyHolding, 256),
    clothing: clip(physical.clothing, 512), lastBroadcast: readSimulationTime(world),
  };
}

function publicAppearanceDescription(state: AppearanceSnapshot): string {
  return `You notice ${state.name}: ${[state.expression && `expression: ${state.expression}`, state.posture && `posture: ${state.posture}`,
    state.condition && `condition: ${state.condition}`, state.clothing && `clothing: ${state.clothing}`,
    state.visiblyHolding && `holding: ${state.visiblyHolding}`].filter(Boolean).join("; ")}.`;
}

/** Admit this witnessed cue now: the process-global queue cannot bind a delayed
 * item to a particular recipient lifetime. Neither sender nor recipient can
 * become a different actor between source selection and actual perception. */
function deliverVisible(world: World, eid: number, source: AppearanceSnapshot, content: string): void {
  if (getCommittedEvents(world).stopped) return;
  const recipients = [...query(world, [Agent, Mind])].filter(target => target !== eid && Agent.active[target]
    && getRoomForEntity(world, target) === source.room && getAgentSensoryCapabilities(world, target).visual > 0
    && isAgentVisualEntity(world, target, eid)).slice(0, MAX_TRACKED_ACTORS)
    .map(target => ({ eid: target, key: workingMemoryEntityRef(world, target)?.key })).filter(target => !!target.key);
  for (const target of recipients) {
    if (getCommittedEvents(world).stopped || !active(world, eid) || WorkingMemoryIdentity.id[eid] !== source.actorKey
      || clip(Name.value[eid], 96) !== source.name || getRoomForEntity(world, eid) !== source.room) return;
    if (!entityExists(world, target.eid) || !hasComponent(world, target.eid, Agent) || !Agent.active[target.eid]
      || !hasComponent(world, target.eid, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[target.eid] !== target.key
      || getRoomForEntity(world, target.eid) !== source.room || getAgentSensoryCapabilities(world, target.eid).visual <= 0
      || !isAgentVisualEntity(world, target.eid, eid)) continue;
    addPerception(world, target.eid, { type: "action", source: source.name, content, intensity: .8 });
    // Looking up is not a forced social response or knowledge of the cause.
    if (entityExists(world, target.eid) && WorkingMemoryIdentity.id[target.eid] === target.key && !getCommittedEvents(world).stopped)
      wakeForegroundCognition(world, target.eid);
  }
}

/**
 * Check what aspects of appearance have changed
 */
function getAppearanceChanges(
  oldState: AppearanceSnapshot,
  newState: AppearanceSnapshot
): string[] {
  const changes: string[] = [];

  if (oldState.expression !== newState.expression) {
    changes.push(`expression: ${newState.expression}`);
  }
  if (oldState.posture !== newState.posture) {
    changes.push(`posture: ${newState.posture}`);
  }
  if (oldState.condition !== newState.condition) {
    changes.push(`condition: ${newState.condition}`);
  }
  if (oldState.visiblyHolding !== newState.visiblyHolding) {
    if (newState.visiblyHolding) {
      changes.push(`now holding: ${newState.visiblyHolding}`);
    } else {
      changes.push(`no longer holding anything`);
    }
  }
  if (oldState.clothing !== newState.clothing) {
    changes.push(`clothing: ${newState.clothing}`);
  }

  return changes;
}

/**
 * Generate a natural language description of appearance changes
 */
function describeAppearanceChange(
  name: string,
  changes: string[]
): string {
  if (changes.length === 0) return "";

  // Single change - describe it naturally
  if (changes.length === 1) {
    const change = changes[0];

    if (change.startsWith("expression:")) {
      const expr = change.split(": ")[1];
      return `${name}'s expression shifts to ${expr}.`;
    }
    if (change.startsWith("posture:")) {
      const posture = change.split(": ")[1];
      return `${name} shifts to a ${posture} posture.`;
    }
    if (change.startsWith("condition:")) {
      const cond = change.split(": ")[1];
      return `${name} now appears ${cond}.`;
    }
    if (change.startsWith("now holding:")) {
      const item = change.split(": ")[1];
      return `${name} is now holding ${item}.`;
    }
    if (change === "no longer holding anything") {
      return `${name}'s hands no longer visibly hold an item.`;
    }
    if (change.startsWith("clothing:")) {
      const clothes = change.split(": ")[1];
      return `${name} is now wearing ${clothes}.`;
    }
  }

  // Multiple changes - summarize
  return `${name}'s appearance has changed: ${changes.join(", ")}.`;
}

/**
 * Run the appearance emitter system
 * Call this periodically (e.g., every cognition cycle)
 */
export function runAppearanceEmitter(world: World): void {
  const state = worldState(world), now = readSimulationTime(world);
  if (getCommittedEvents(world).stopped || state.frame === now) return;
  state.frame = now;
  const agents = [...query(world, [Agent, Mind, Appearance])].filter(eid => active(world, eid)).slice(0, MAX_TRACKED_ACTORS);
  const present = new Set(agents);
  for (const eid of state.actors.keys()) if (!present.has(eid)) state.actors.delete(eid);
  for (const eid of agents) {
    const current = getAppearanceSnapshot(world, eid);
    if (!current) { state.actors.delete(eid); continue; }
    const previous = state.actors.get(eid);
    // New lifetime/source/room is a baseline, not a witnessed remote transition.
    if (!previous || previous.actorKey !== current.actorKey || previous.name !== current.name || previous.room !== current.room) {
      state.actors.set(eid, current); continue;
    }
    const changes = getAppearanceChanges(previous, current);
    if (changes.length || now - previous.lastBroadcast >= APPEARANCE_BROADCAST_INTERVAL) {
      deliverVisible(world, eid, current, changes.length ? describeAppearanceChange(current.name, changes) : publicAppearanceDescription(current));
      state.actors.set(eid, current);
    }
  }
}

/**
 * Force an immediate appearance broadcast for an entity
 * Useful after major changes (combat wounds, getting wet, etc.)
 */
export function broadcastAppearanceChange(
  world: World,
  eid: number,
  _customMessage?: string
): void {
  const state = worldState(world);
  if (getCommittedEvents(world).stopped) return;
  const current = getAppearanceSnapshot(world, eid); if (!current) return;
  const previous = state.actors.get(eid);
  if (previous?.actorKey === current.actorKey && previous.room === current.room && previous.lastBroadcast === current.lastBroadcast
    && !getAppearanceChanges(previous, current).length) return;
  // A custom string cannot override authoritative physical facts or expose a
  // private cause. Retain the optional parameter for source compatibility only.
  deliverVisible(world, eid, current, publicAppearanceDescription(current));
  if (state.actors.has(eid) || state.actors.size < MAX_TRACKED_ACTORS) state.actors.set(eid, current);
}

/**
 * Broadcast when an NPC's expression changes due to emotional state
 * This creates a more natural "you notice X looking worried" kind of stimulus
 */
export function broadcastExpressionChange(
  world: World,
  eid: number,
  oldExpression: string,
  newExpression: string
): void {
  const state = worldState(world);
  if (getCommittedEvents(world).stopped || oldExpression === newExpression) return;
  const current = getAppearanceSnapshot(world, eid);
  if (!current || current.expression !== newExpression) return;
  const previous = state.actors.get(eid);
  if (!previous || previous.actorKey !== current.actorKey || previous.name !== current.name || previous.room !== current.room) {
    if (state.actors.size < MAX_TRACKED_ACTORS) state.actors.set(eid, current); return;
  }
  if (previous.expression === current.expression) return;
  deliverVisible(world, eid, current, describeAppearanceChange(current.name, [`expression: ${current.expression}`]));
  state.actors.set(eid, current);
}

/**
 * Clean up tracked state for removed entities
 */
function liveWorlds(): World[] {
  const result: World[] = [];
  for (const reference of worlds) { const world = reference.deref(); if (world) result.push(world); else worlds.delete(reference); }
  return result;
}
export function cleanupAppearanceState(eid: number): void;
export function cleanupAppearanceState(world: World, eid?: number): void;
export function cleanupAppearanceState(worldOrEid: World | number, eid?: number): void {
  if (typeof worldOrEid === "number") { for (const world of liveWorlds()) states.get(world)?.actors.delete(worldOrEid); }
  else if (eid === undefined) { const state = states.get(worldOrEid); if (state) { state.actors.clear(); state.frame = -1; } }
  else states.get(worldOrEid)?.actors.delete(eid);
}

/**
 * Get stats about appearance tracking
 */
export function getAppearanceEmitterStats(world?: World): {
  trackedEntities: number;
  avgTimeSinceLastBroadcast: number;
} {
  let totalTime = 0;
  let count = 0;
  for (const current of world ? [world] : liveWorlds()) {
    const now = readSimulationTime(current);
    for (const [eid, state] of states.get(current)?.actors ?? []) {
      if (!active(current, eid) || WorkingMemoryIdentity.id[eid] !== state.actorKey || getCommittedEvents(current).stopped) continue;
      totalTime += Math.max(0, now - state.lastBroadcast); count++;
    }
  }

  return {
    trackedEntities: count,
    avgTimeSinceLastBroadcast: count > 0 ? totalTime / count : 0,
  };
}
