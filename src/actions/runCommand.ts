import { z } from "zod";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { ActionContent, World } from "../types";
import { ActionResultType, Agent } from "../components";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const schema = z
  .object({
    command: z
      .string()
      .describe("The bash command to execute. Must be a valid shell command."),

    workingDirectory: z
      .string()
      .optional()
      .describe(
        "The directory to execute the command in. Optional - defaults to current directory."
      ),

    timeout: z
      .number()
      .optional()
      .describe(
        "Maximum time in milliseconds to wait for command completion. Optional - defaults to 5000ms."
      ),
  })
  .describe("Configuration for executing a bash command");

export const action = {
  name: "runCommand",
  description:
    "This action allows you to execute a bash command and return its output.  You can use this to explore your code base, understand the system you are running on, and help to execute goals and plans which require the use of a CLI.",
  parameters: ["command", "workingDirectory", "timeout"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus,
  runtime: SimulationRuntime
): Promise<ActionResultType> {
  const {
    command,
    workingDirectory = process.cwd(),
    timeout = 5000,
  } = parameters;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDirectory,
      timeout,
    });

    const result = stdout || stderr;
    logger.agent(eid, `Executed command: ${command}`, Agent.name[eid]);

    const actionContent: ActionContent = {
      action: "runCommand",
      result,
      parameters,
      agentName: Agent.name[eid],
    };

    // Emit event in agent's current room
    const roomId = runtime.getRoomManager().getAgentRoom(eid);
    if (roomId) {
      eventBus.emitRoomEvent(roomId, "action", actionContent, String(eid));
    }

    return {
      success: true,
      action: "runCommand",
      result,
      timestamp: Date.now(),
      data: {
        metadata: {
          stdout,
          stderr,
          command,
          workingDirectory,
          executionTime: Date.now(),
          exitCode: 0,
          queries: [
            `command:${command}`,
            `dir:${workingDirectory}`,
            `output:${result.slice(0, 50)}...`, // Index first part of output
          ],
          context: {
            agentName: Agent.name[eid],
            agentRole: Agent.role[eid],
            roomId,
          },
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Command execution failed: ${errorMessage}`, {
      command,
      error,
    });

    return {
      success: false,
      action: "runCommand",
      result: `Command execution failed: ${errorMessage}`,
      timestamp: Date.now(),
      data: {
        metadata: {
          error: errorMessage,
          command,
          workingDirectory,
          executionTime: Date.now(),
          exitCode: 1,
          queries: [
            `command:${command}`,
            `dir:${workingDirectory}`,
            `error:${errorMessage}`,
          ],
          context: {
            agentName: Agent.name[eid],
            agentRole: Agent.role[eid],
            roomId: runtime.getRoomManager().getAgentRoom(eid),
          },
        },
      },
    };
  }
}
