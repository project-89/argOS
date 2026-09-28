import type { World } from "../ecs/world";

export interface NativeRuntimeService {
  id: string;
  enabled: boolean;
  provider: "library-runtime";
  description: string;
}
const installed = new WeakMap<World, readonly NativeRuntimeService[]>();

/** These services live outside the generated-system registry. Record what the
 * library actually installed, not what an LLM inferred from system names.
 * This is configuration, not a claim that a callback ran or an actor acted.
 * It is deliberately not restored from a serialized world's assertions. */
export function registerNativeRuntimeServices(world: World, config: {
  ai: boolean; planning: boolean; reflection: boolean; timedSpeech: boolean; timedActions: boolean;
}): void {
  installed.set(world, Object.freeze([
    { id: "npc-cognition", enabled: config.ai, description: "Actor-owned foreground decisions, inner monologue, goals and memory retrieval. Native execution admits actual choices; generated world systems do not replace the actor controller." },
    { id: "npc-dialogue", enabled: config.ai, description: "Cognition already authors speech. Native speech execution delivers audible words and social memories to actual listeners. Do not infer missing dialogue from its absence in the generated-system list." },
    { id: "npc-planning", enabled: config.ai && config.planning, description: "Background goal planning and grounded deterministic plan execution for the actor's selected purpose." },
    { id: "npc-reflection", enabled: config.ai && config.reflection, description: "Background reflection, narrative memory and learning from experienced events." },
    { id: "timed-speech", enabled: config.timedSpeech, description: "Finite-duration voice resources, turn admission, exact delivered words, interruption and completion receipts. A proposed utterance is not audible speech." },
    { id: "timed-actions", enabled: config.timedActions, description: "Finite-duration movement, pickup and physical package actions with ownership and completion receipts. New mechanics supply affordances and world effects; they do not fabricate NPC actions or private memories." },
  ].map(service => Object.freeze({ ...service, provider: "library-runtime" as const }))));
}
export function getNativeRuntimeServices(world: World): NativeRuntimeService[] {
  return (installed.get(world) ?? []).map(service => ({ ...service }));
}
export function formatNativeRuntimeServices(world: World): string {
  const services = getNativeRuntimeServices(world);
  return services.length ? `NATIVE LIBRARY SERVICES (outside generated-system registry; configured, not execution evidence):\n`
    + services.map(s => `- ${s.id} [${s.enabled ? "enabled" : "disabled"}]: ${s.description}`).join("\n")
    : "NATIVE LIBRARY SERVICES: no installation manifest is available for this world; do not infer missing capabilities from that absence.";
}
