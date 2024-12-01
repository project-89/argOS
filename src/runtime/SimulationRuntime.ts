import { World } from "../types/bitecs";
import { logger } from "../utils/logger";
import { actions as defaultActions } from "../actions";
import { System, SystemFactory } from "../systems/System";

type ActionModule = {
  schema: any;
  action: {
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  };
  execute: (world: World, eid: number, parameters: any) => Promise<void>;
};

export class SimulationRuntime {
  private world: World;
  private isRunning: boolean = false;
  private updateInterval: number = 1000;
  private systems: System[] = [];
  public actions: Record<string, ActionModule>;

  constructor(
    world: World,
    config?: {
      updateInterval?: number;
      systems?: SystemFactory[];
      actions?: Record<string, ActionModule>;
    }
  ) {
    this.world = world;
    this.updateInterval = config?.updateInterval || 1000;
    this.actions = config?.actions || defaultActions;

    // Initialize systems
    if (config?.systems) {
      this.systems = config.systems.map((system) => {
        return system.create(this);
      });
    }

    // Log available actions
    logger.system(`Available actions: ${Object.keys(this.actions).join(", ")}`);
  }

  getAvailableTools() {
    return Object.values(this.actions).map((a) => a.action);
  }

  async executeAction(tool: string, eid: number, parameters: any) {
    const action = this.actions[tool];
    if (action) {
      await action.execute(this.world, eid, parameters);
    } else {
      logger.error(`Unknown action: ${tool}`);
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
      for (const system of this.systems) {
        await system(this.world);
      }
      setTimeout(() => this.update(), this.updateInterval);
    } catch (error) {
      logger.error(`Error in simulation update: ${error}`);
      this.stop();
    }
  }
}
