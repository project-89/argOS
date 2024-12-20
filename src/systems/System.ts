import { World } from "bitecs";
import { SimulationRuntime } from "../runtime/SimulationRuntime";

export interface SystemConfig {
  updateInterval?: number;
}

export interface System {
  (world: World): Promise<World>;
  setRuntime: (runtime: SimulationRuntime) => void;
}

export type SystemFactory<T extends SystemConfig = SystemConfig> = {
  create: (runtime: SimulationRuntime, config?: T) => System;
};

export const createSystem = <T extends SystemConfig>(
  factory: (
    runtime: SimulationRuntime,
    config?: T
  ) => (world: World) => Promise<World>
): SystemFactory<T> => {
  return {
    create: (runtime: SimulationRuntime, config?: T): System => {
      const systemFn = async (world: World) => {
        return factory(runtime, config)(world);
      };

      (systemFn as System).setRuntime = () => {};

      return systemFn as System;
    },
  };
};
