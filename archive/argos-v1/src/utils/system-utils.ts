import { World } from "bitecs";
import { logger } from "./logger";

type AgentProcessFunction<T = any> = (eid: number) => Promise<T>;

/**
 * Process multiple agents concurrently using Promise.all
 * @param world The bitECS world
 * @param agents Array of agent entity IDs to process
 * @param processFn Async function to process each agent
 * @param systemName Name of the system for logging
 * @returns Array of results from processing each agent
 */
export async function processConcurrentAgents<T = any>(
  world: World,
  agents: readonly number[],
  systemName: string,
  processFn: AgentProcessFunction<T>
): Promise<(T | undefined)[]> {
  logger.system(systemName, `Processing ${agents.length} agents`);

  try {
    // Process all agents concurrently
    const results = await Promise.all(
      agents.map(async (eid) => {
        try {
          return await processFn(eid);
        } catch (error) {
          logger.error(
            `Error processing agent ${eid} in ${systemName}:`,
            error
          );
          return undefined;
        }
      })
    );

    // Log completion
    const successCount = results.filter((r) => r !== undefined).length;
    logger.system(
      systemName,
      `Completed processing ${successCount}/${agents.length} agents`
    );

    return results;
  } catch (error) {
    logger.error(`Error in ${systemName} concurrent processing:`, error);
    return [];
  }
}
