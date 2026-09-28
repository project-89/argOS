/** Turn-local publication of newly stored, self-authored thoughts. A missing
 * thought is not a new empty thought, and equal words are not duplicate events. */
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Thought, WorkingMemoryIdentity } from "../ecs/components";
import { HasThought } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedSource, startCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "./working-memory";
import type { AgentThinkEvent } from "../bus/simulation-bus";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export interface ThoughtPublicationCursor { readonly actorId: number }
type CursorState = { world: World; owner: string; source: string; atSimMs: number; seen: Set<number> };
const cursors = new WeakMap<ThoughtPublicationCursor, CursorState>();

export function captureThoughtPublication(world: World, actorId: number): ThoughtPublicationCursor {
  assertSimulationTaskActive();
  const cursor = Object.freeze({ actorId }), tape = getCommittedSource(world);
  if (!tape.stopped && entityExists(world, actorId) && hasComponent(world, actorId, Agent) && Agent.active[actorId]) {
    const owner = workingMemoryEntityRef(world, actorId); if (!owner) return cursor;
    // This starts an absent source at the host's publication-issuance boundary,
    // just as foreground admission does. It never resurrects a stopped source.
    cursors.set(cursor, { world, owner: owner.key,
      source: tape.sourceId ?? startCommittedEvents(world), atSimMs: readSimulationTime(world),
      seen: new Set(getRelationTargets(world, actorId, HasThought)) });
  }
  return cursor;
}

/** Call after cognition admission/dispatch. Existing/edited rows never become
 * new events. Cursor identity and actor/source ownership are runtime-only. */
export function takeNewAuthoredThoughtEvents(cursor: ThoughtPublicationCursor): AgentThinkEvent[] {
  assertSimulationTaskActive();
  const state = cursors.get(cursor); if (!state) return [];
  const { world } = state, eid = cursor.actorId, tape = getCommittedSource(world);
  if (tape.stopped || tape.sourceId !== state.source || readSimulationTime(world) < state.atSimMs
    || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[eid] !== state.owner) return [];
  const events: AgentThinkEvent[] = [];
  for (const id of getRelationTargets(world, eid, HasThought)) {
    if (state.seen.has(id)) continue;
    state.seen.add(id);
    if (!entityExists(world, id) || !hasComponent(world, id, Thought)
      || !["reasoning", "appraisal"].includes(Thought.type[id]) || !Thought.content[id]?.trim()
      || !Number.isFinite(Thought.timestamp[id])) continue;
    events.push({ type: "agent:think", agentId: eid, agentName: Name.value[eid] || `Agent ${eid}`,
      timestamp: Thought.timestamp[id], thought: Thought.content[id],
      thoughtType: Thought.type[id] === "reasoning" ? "decision" : "reflection" });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
