import { ActionResultType } from "../../components";
import { ActionModule } from "../../types";
import { FullToolType } from "../../types/actions";
import { SimulationRuntime } from "../SimulationRuntime";

export interface IActionManager {
  // Action Management
  getAvailableTools(): Array<FullToolType>;

  getEntityTools(eid: number): Array<FullToolType>;

  executeAction(
    tool: string,
    eid: number,
    parameters: any,
    runtime: SimulationRuntime
  ): Promise<ActionResultType>;

  // Action Registration
  registerAction(name: string, action: ActionModule): void;
  hasAction(name: string): boolean;

  // Cleanup
  cleanup(): void;
}
