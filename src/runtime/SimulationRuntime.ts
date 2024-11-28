import { World } from "../types/bitecs";
import { ConversationSystem } from "../systems/ConversationSystem";
import { logger } from "../utils/logger";
import { ThinkingSystem } from "../systems/CognitionSystem";

type Systems = (world: World) => Promise<World>;

export class SimulationRuntime {
  private world: World;
  private isRunning: boolean = false;
  private updateInterval: number = 1000; // 1 second default
  private systems: Systems[] = [];
  constructor(
    world: World,
    config?: { updateInterval?: number; systems: Systems[] }
  ) {
    this.world = world;
    if (config?.updateInterval) {
      this.updateInterval = config.updateInterval;
    }
    this.systems = config?.systems || [];
  }

  async start() {
    this.isRunning = true;
    logger.system("Starting simulation runtime...");
    this.update();
  }

  stop() {
    this.isRunning = false;
    logger.system("Stopping simulation runtime...");
  }

  private async update() {
    if (!this.isRunning) return;

    try {
      // Run systems in order
      for (const system of this.systems) {
        await system(this.world);
      }

      // Schedule next update
      setTimeout(() => this.update(), this.updateInterval);
    } catch (error) {
      logger.error(`Error in simulation update: ${error}`);
      this.stop();
    }
  }
}
