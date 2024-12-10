import { World } from "bitecs";
import { ActionModule } from "../../types";
import { IActionManager } from "./IActionManager";
import { SimulationRuntime } from "../SimulationRuntime";
import { EventBus } from "../EventBus";

export class ActionManager implements IActionManager {
  private actions: Record<string, ActionModule> = {};

  constructor(
    private world: World,
    private runtime: SimulationRuntime,
    private eventBus: EventBus
  ) {}

  // Action Management
  getAvailableTools() {
    return Object.values(this.actions).map((a) => a.action);
  }

  async executeAction(
    tool: string,
    eid: number,
    parameters: any,
    runtime: SimulationRuntime
  ) {
    const action = this.actions[tool];
    if (!action) {
      throw new Error(`Unknown action: ${tool}`);
    }
    await action.execute(this.world, eid, parameters, this.eventBus, runtime);
  }

  // Action Registration
  registerAction(name: string, action: ActionModule) {
    this.actions[name] = action;
  }

  hasAction(name: string): boolean {
    return name in this.actions;
  }

  // Cleanup
  cleanup() {
    this.actions = {};
  }
}
