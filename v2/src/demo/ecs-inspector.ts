import { getAllEntities, hasComponent, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import { Name } from "../ecs/components";
import { getMergedComponents } from "../ecs/component-registry";
import { getDirectContainer } from "../ecs/location";
/** Omniscient debugging projection. Never pass this view to NPC cognition. */
export function inspectEcs(world: World) {
    const components = Object.entries(getMergedComponents());
    return [...getAllEntities(world)].filter(eid => !hasComponent(world, eid, Prefab)).map(eid => ({
        id: eid, name: Name.value[eid] || `Entity ${eid}`, container: getDirectContainer(world, eid) ?? null,
        components: Object.fromEntries(components.filter(([, soa]) => hasComponent(world, eid, soa)).map(([name, soa]) => [name,
            Object.fromEntries(Object.entries(soa).flatMap(([field, values]) => {
                const value = (values as any)?.[eid];
                return value === null || ["string", "number", "boolean"].includes(typeof value) ? [[field, value]] : [];
            })),
        ])),
    }));
}
