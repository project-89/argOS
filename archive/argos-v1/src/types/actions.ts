import { z } from "zod";
import { World } from "bitecs";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventBus } from "../runtime/EventBus";

export type FullToolType = {
  name: string;
  description: string;
  parameters: string[];
  schema: any;
};

export interface ActionModule {
  action: FullToolType;
  execute: (
    world: World,
    eid: number,
    parameters: any,
    eventBus: EventBus,
    runtime: SimulationRuntime
  ) => Promise<any>;
}
