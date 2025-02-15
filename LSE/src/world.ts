import { createWorld, addEntity, addComponent, World, query } from "bitecs";
import {
  componentMap,
  ComponentName,
  PositionComponent,
  ValueComponent,
  InventoryComponent,
} from "./components";

export function createLSEWorld(): World {
  return createWorld({
    components: componentMap,
  });
}

export function addEntityToWorld(
  world: World,
  components: Partial<Record<ComponentName, any>>
): number {
  const eid = addEntity(world);
  Object.entries(components).forEach(([componentName, value]) => {
    const component = componentMap[componentName as ComponentName];
    addComponent(world, eid, component);
    Object.entries(value).forEach(([key, val]) => {
      component[key][eid] = val;
    });
  });
  return eid;
}

export function getWorldState(world: World): string {
  let state = "World State:\n";

  // Query all entities that have any component
  const allComponents = Object.values(componentMap);
  const entities = query(world, [allComponents[0]]); // Start with first component

  entities.forEach((eid) => {
    state += `\nEntity ${eid}:\n`;
    Object.entries(componentMap).forEach(([name, component]) => {
      switch (name) {
        case "Position": {
          const pos = component as PositionComponent;
          state += `  Position: (${pos.x[eid]}, ${pos.y[eid]})\n`;
          break;
        }
        case "Name":
        case "Description":
        case "Goal": {
          const val = component as ValueComponent;
          state += `  ${name}: ${val.value[eid]}\n`;
          break;
        }
        case "Inventory": {
          const inv = component as InventoryComponent;
          state += `  Inventory: [${inv.items[eid]?.join(", ")}]\n`;
          break;
        }
      }
    });
  });

  return state;
}
