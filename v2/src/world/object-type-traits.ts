import type { ObjectTypeDefinition } from "./schema";

/** Shared pure state projection for construction preflight and actual objects. */
export function computeObjectTypeTraits(type: Pick<ObjectTypeDefinition, "traits" | "states">, state: string): string[] {
  const traits = [...type.traits], definition = type.states[state];
  if (definition?.traits) for (const trait of definition.traits) if (!traits.includes(trait)) traits.push(trait);
  if (definition?.blockedTraits) for (const trait of definition.blockedTraits) {
    const index = traits.indexOf(trait); if (index !== -1) traits.splice(index, 1);
  }
  return traits;
}
