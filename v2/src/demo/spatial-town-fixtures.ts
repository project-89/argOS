/** Detached authored seeds for bounded checks. A fixture changes starting
 * circumstances, never the controller, spirit grants or future decisions. */
import type { SpatialScenarioDefinition } from "./spatial-scenario";
import { TOWN_SPATIAL_BLUEPRINT, TOWN_RESIDENTS, TOWN_WORLD_BOUNDS, TOWN_NAVIGATION_CELL_SIZE } from "./spatial-town";

export type TownFixture = "cafe-seat-need";

export function createTownScenario(fixture?: TownFixture): SpatialScenarioDefinition {
  if (fixture !== undefined && fixture !== "cafe-seat-need") throw Error("Unknown authored town fixture");
  const definition: SpatialScenarioDefinition = structuredClone({
    id: "little-town-v1", title: "Argos · A little town", blueprint: TOWN_SPATIAL_BLUEPRINT,
    bounds: TOWN_WORLD_BOUNDS, residents: TOWN_RESIDENTS,
    navigationCellSize: TOWN_NAVIGATION_CELL_SIZE, maxWorldEntities: 400,
  });
  if (!fixture) return definition;
  definition.id = "little-town-cafe-seat-need-v1";
  definition.title = "Argos · Cafe seating need check";
  definition.blueprint.id = definition.id;
  // These objects were never allocated, consumed or removed by an operator.
  // Other seating remains available elsewhere: leaving is a legitimate choice.
  definition.blueprint.props = definition.blueprint.props.filter(p => !["cafe-seat-1", "cafe-seat-2"].includes(p.id));
  const cafe = definition.blueprint.rooms.find(r => r.id === "town-cafe")!;
  // Durable setting is not live inventory. The chair may be constructed and
  // the pastries consumed; present contents come from native entity state.
  cafe.description = "A newly reopened neighborhood meeting place facing Common Square, used for refreshments, company and a quiet break.";
  const tess = definition.residents.find(r => r.id === "tess")!;
  tess.needs = { hunger: 20, energy: 40 };
  tess.initialGoal = { kind: "custom", priority: 7,
    description: "Take a seated break inside Corner Cafe while staying available to welcome today's visitors." };
  tess.initialObservation = "You have been on your feet getting the cafe ready and feel tired. You are in Corner Cafe. At the start of this afternoon there are two tables and four ready-to-eat pastries, but no chairs here.";
  tess.past!.background += " The cafe has just reopened today, and its seating area has not yet been furnished.";
  return definition;
}
