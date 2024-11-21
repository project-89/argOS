import { World } from "../types/bitecs";
import { PerceptionSystem } from "../systems/PerceptionSystem";
import { ConversationSystem } from "../systems/ConversationSystem";
import { logger } from "../utils/logger";

export class SimulationRuntime {
  private world: World;
  private isRunning: boolean = false;
  private updateInterval: number = 1000; // 1 second default

  constructor(world: World, config?: { updateInterval?: number }) {
    this.world = world;
    if (config?.updateInterval) {
      this.updateInterval = config.updateInterval;
    }
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
      await PerceptionSystem(this.world);
      await ConversationSystem(this.world);

      // Schedule next update
      setTimeout(() => this.update(), this.updateInterval);
    } catch (error) {
      logger.error(`Error in simulation update: ${error}`);
      this.stop();
    }
  }
}
