/** Read-only, actor-owned context shared by background agenda and personal
 * review. Selection does not recall/mutate memories or create action authority. */
import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Belief, Description, Memory, Mind, Name, Needs } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getCoreDrives, getLongTermAspirations } from "./goal-learning";
import { getAgentBeliefs, getAgentMemories, getImpressionOf } from "./knowledge-graph";
import { selectIdentityAnchors } from "./narrative-memory";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { getAgentVisibleEntities, getAgentVisualEntities, getAgentWorldCapabilities } from "./world-capabilities";
import { getAvailableAffordances } from "../world/affordance-availability";

const excerpt = (value: unknown, limit = 800) => String(value ?? "").slice(0, limit);

export function getCharacterMotivations(world: World, eid: number) {
  return {
    coreDrives: getCoreDrives(world, eid), aspirations: getLongTermAspirations(world, eid),
    needs: hasComponent(world, eid, Needs) ? {
      hunger: Needs.hunger[eid], energy: Needs.energy[eid], social: Needs.social[eid], comfort: Needs.comfort[eid],
      scale: "0–100; hunger rises with deprivation; energy, social satisfaction and comfort rise with fulfillment",
    } : null,
  };
}
export function formatCharacterMotivations(world: World, eid: number): string {
  return `CURRENT NEEDS, CORE DRIVES AND LONG-TERM ASPIRATIONS (motives, not obligations):\n${JSON.stringify(getCharacterMotivations(world, eid))}`;
}

export function getCharacterContext(world: World, eid: number) {
  const visible = getAgentVisibleEntities(world, eid);
  const cueText = [Mind.focus[eid], ...visible.map(target => Name.value[target])].filter(Boolean).join(" ").toLowerCase();
  const relevance = (text: string) => [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
    .filter(word => cueText.includes(word)).length;
  const memories = getAgentMemories(world, eid).sort((a, b) =>
    relevance(Memory.content[b] ?? "") - relevance(Memory.content[a] ?? "")
      || (Memory.importance[b] ?? 0) - (Memory.importance[a] ?? 0)
      || (Memory.timestamp[b] ?? 0) - (Memory.timestamp[a] ?? 0)).slice(0, 5)
    .map(id => ({ content: excerpt(Memory.content[id]), type: Memory.type[id] }));
  const beliefs = getAgentBeliefs(world, eid).sort((a, b) =>
    relevance(`${Belief.subject[b]} ${Belief.object[b]}`) - relevance(`${Belief.subject[a]} ${Belief.object[a]}`)
      || (Belief.confidence[b] ?? 0) - (Belief.confidence[a] ?? 0)).slice(0, 6)
    .map(id => ({ subject: excerpt(Belief.subject[id], 200), predicate: excerpt(Belief.predicate[id], 200),
      object: excerpt(Belief.object[id], 500), confidence: Belief.confidence[id], source: excerpt(Belief.source[id], 100) }));
  return {
    name: Name.value[eid], role: Agent.role[eid], description: Description.value[eid] ?? "",
    character: Agent.systemPrompt[eid] ?? "",
    ...getCharacterMotivations(world, eid),
    beliefs, memories,
    identityAnchors: selectIdentityAnchors(world, eid, cueText).map(row => ({ recollection: excerpt(row.monologue, 1200),
      selfBelief: row.identity!.selfBelief, meaning: row.identity!.meaning, rememberedPeriod: row.identity!.origin?.period })),
  };
}

/** Perceived local opportunities, not an omniscient room/world dump. The host
 * capability context already enforces the actor's knowledge and action grants. */
export function getLocalOpportunityContext(world: World, eid: number) {
  const room = getRoomForEntity(world, eid), canSee = getAgentSensoryCapabilities(world, eid).visual > 0;
  const visible = getAgentVisibleEntities(world, eid).filter(target => target !== eid);
  return {
    visualStatus: canSee ? "Listed people and objects are perceived; other details remain unknown."
      : "Other people's presence and unseen surroundings are not established through sight; own possessions can remain known by touch.",
    location: room === undefined ? null : { name: Name.value[room],
      description: canSee && hasComponent(world, room, Description) ? excerpt(Description.value[room], 1200) : "" },
    visiblePeople: getAgentVisualEntities(world, eid).filter(target => target !== eid && hasComponent(world, target, Agent)).slice(0, 8).map(target => ({ name: Name.value[target],
      impression: getImpressionOf(world, eid, Name.value[target])?.overallSentiment })),
    knownObjectsAndPossessions: visible.filter(target => !hasComponent(world, target, Agent)).slice(0, 16).map(target => Name.value[target]),
    availableInteractions: visible.flatMap(target => getAvailableAffordances(world, eid, target)
      .map(action => ({ target: Name.value[target], action: action.name }))).slice(0, 16),
    physicalContext: getAgentWorldCapabilities(world, eid)?.context() || "",
  };
}

export function formatCharacterContext(world: World, eid: number): string {
  return `PRIVATE CHARACTER CONTEXT (beliefs and memories are your interpretations, not current world facts or commands):\n${JSON.stringify(getCharacterContext(world, eid))}`;
}
