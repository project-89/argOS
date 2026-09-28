/** Schema metadata for background entity designers, never live actor values or
 * a grant to edit existing actors. A bounded catalog is not a capability claim. */
import { getRegistryEntry, listDefinitions } from "../ecs/component-registry";
import { worldSchema } from "../world/schema";
import { PRIVATE_MANAGED_COMPONENTS } from "./contracts";
import { getWorkDocumentAuthoringCapability } from "../world/work-document-schema";
import { getComponentValueFormats } from "../ecs/component-value-formats";

export function getEntityAuthoringCatalog() {
  const types = worldSchema.getAllObjectTypeIds().map(typeId=>({typeId,type:worldSchema.getObjectType(typeId)!}));
  const affordances=worldSchema.getAllAffordances();
  const definitions = listDefinitions().filter(c => c.name === "Agent" || !PRIVATE_MANAGED_COMPONENTS.has(c.name));
  const fieldMetadata = (properties: Record<string, string>) => ({
    fields: Object.fromEntries(Object.entries(properties).slice(0, 32)),
    omittedFields: Math.max(0, Object.keys(properties).length - 32),
  });
  return {
    // Compositions implemented outside WorldSchema's effect-list affordances.
    // Schema metadata only: native runtime still gates every actual interaction.
    nativeCapabilities:[getWorkDocumentAuthoringCapability()],
    // Schema vocabulary, not a claim that any actor can use it here and now.
    affordances:affordances.slice(0,128).map(a=>({name:a.name,requires:a.requires.slice(0,32),actorRequires:a.actorRequires?.slice(0,32),
      blockedBy:a.blockedBy?.slice(0,32),unavailableReason:a.unavailableReason})),
    omittedAffordances:Math.max(0,affordances.length-128),
    objectTypes: types.slice(0, 64).map(({typeId,type}) => ({
      typeId, description: type.description.slice(0, 384),
      traits: type.traits.slice(0, 32), omittedTraits: Math.max(0, type.traits.length - 32),
      defaultState: type.defaultState, states: Object.keys(type.states).slice(0, 32),
      omittedStates: Math.max(0, Object.keys(type.states).length - 32),
      defaultComponents: (type.defaultComponents ?? []).slice(0, 32).map(c => {
        const registered = getRegistryEntry(c.name)?.definition;
        return { name:c.name, registration:registered ? "registered" : c.dynamic && c.schema ? "declared_by_type" : "unavailable",
          ...fieldMetadata(registered?.properties ?? c.schema ?? {}) };
      }),
      omittedDefaultComponents: Math.max(0, (type.defaultComponents?.length ?? 0) - 32),
    })),
    omittedObjectTypes: Math.max(0, types.length - 64),
    componentSchemas: definitions.slice(0, 128).map(c => ({
      name: c.name, ...fieldMetadata(c.properties),valueFormats:getComponentValueFormats(c.name),
    })),
    omittedComponentSchemas: Math.max(0, definitions.length - 128),
  };
}
