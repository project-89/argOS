import { ActionModule } from "../../types";
import { ActionResult } from "../../types/actions";
import { SimulationRuntime } from "../SimulationRuntime";

export interface IActionManager {
  // Action Management
  getAvailableTools(): Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;

  getEntityTools(eid: number): Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;

  executeAction(
    tool: string,
    eid: number,
    parameters: any,
    runtime: SimulationRuntime
  ): Promise<ActionResult>;

  // Action Registration
  registerAction(name: string, action: ActionModule): void;
  hasAction(name: string): boolean;

  // Cleanup
  cleanup(): void;
}
