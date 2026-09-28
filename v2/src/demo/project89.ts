import type { World } from "../ecs/world";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { sendMessage } from "../spirits/spirit-registry";
import { registerNarrativeOpportunity } from "../spirits/narrative-opportunities";

export const PROJECT89_NARRATIVE = "Jerry and George discuss whether everyday life could be a simulation in a New York apartment. An outside participant can text Jerry's real physical phone. Project 89 is a mystery inside this fictional world, not an established fact either character knows. Let discovered evidence and their own choices change the scene. Preserve privacy: a buzz does not reveal a message; reading does, and a text reply requires actual typing and sending. Spirits can propose grounded opportunities and inhabitants, but may not fabricate character decisions, knowledge, dialogue, or successful outcomes. Preserve existing objects and identities. A requested visitor must exist in the ECS world and travel through real rooms before entering a scene.";

/** Advisory request only. Never execute operator text as a God tool command.
 * The registry is selected by exact world identity. */
export function requestProject89Influence(world: World, text: string) {
  const registry = getSpiritSystemState(world)?.registry;
  if (!registry || registry.world !== world || registry.godAgentEid === undefined)
    throw new Error("This world's spirits are unavailable");
  const narrator = [...registry.spirits.values()].find(s => s.definition.domain === "narrative");
  if (!narrator) throw new Error("This world has no narrator to receive the request");
  const message = sendMessage(registry, registry.godAgentEid, narrator.eid, "request",
    "Outside participant's narrative suggestion", JSON.stringify({suggestion:text,
      boundary:"Advisory in-world opportunity only. Do not override characters or existing facts. Any construction needs normal approval and ECS evidence."}),
    {requiresResponse:true});
  registerNarrativeOpportunity(registry,narrator,message,text);
  return {id:message.id,status:"queued" as const,recipient:narrator.definition.name};
}

/** Operator-only diagnostics. Never pass these reports into the video prompt. */
export function project89SpiritDiagnostics(world: World) {
  const registry=getSpiritSystemState(world)?.registry;
  if(!registry || registry.world!==world)return [];
  return [...registry.spirits.values()].map(spirit=>({
    name:spirit.definition.name,lastObservationTime:spirit.lastObservationTime,
    inbox:spirit.inbox.map(m=>({id:m.id,subject:m.subject})),
    reports:spirit.outbox.slice(-5).map(m=>({id:m.id,subject:m.subject,content:m.content,responseTo:m.responseTo,timestamp:m.timestamp})),
    thoughts:spirit.shortTermMemory.slice(-2),
  }));
}
