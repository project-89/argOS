import { ActionModule } from "../../types";

export interface IActionManager {
  // Action Management
  getAvailableTools(): Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;

  executeAction(tool: string, eid: number, parameters: any): Promise<void>;

  // Action Registration
  registerAction(name: string, action: ActionModule): void;
  hasAction(name: string): boolean;

  // Cleanup
  cleanup(): void;
}
