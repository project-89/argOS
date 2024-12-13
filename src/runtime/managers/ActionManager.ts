import { World } from "bitecs";
import { ActionModule } from "../../types";
import { IActionManager } from "./IActionManager";
import { SimulationRuntime } from "../SimulationRuntime";
import { EventBus } from "../EventBus";
import { Action, Agent } from "../../components/agent/Agent";
import { logger } from "../../utils/logger";

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

  getEntityTools(eid: number) {
    const tools = Action.availableTools[eid];

    // If no specific tools defined for tools, return all available
    if (!tools || tools.length === 0) {
      return Object.values(this.actions).map((a) => a.action);
    }

    // Filter actions to only those available to this agent
    return Object.values(this.actions)
      .filter((a) => tools.includes(a.action.name))
      .map((a) => a.action);
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
    return await action.execute(
      this.world,
      eid,
      parameters,
      this.eventBus,
      runtime
    );
  }

  // Action Registration
  registerAction(name: string, action: ActionModule) {
    logger.system(`registering action: ${name}`, "ActionManager");
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
