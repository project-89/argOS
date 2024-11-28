import { World } from "./bitecs";

export interface RuntimeConfig {
  updateInterval?: number;
  systems?: ((world: World) => Promise<World>)[];
}
