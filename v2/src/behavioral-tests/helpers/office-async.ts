import { entityExists, query } from "bitecs";

import { PendingToolJob } from "../../ecs/components";

export function hasPendingOfficeToolJobs(world: any): boolean {
  return Array.from(query(world as any, [PendingToolJob] as any)).some((eid) => entityExists(world as any, eid));
}

export async function yieldForOfficeToolJobs(world: any, delayMs = 50): Promise<void> {
  if (!hasPendingOfficeToolJobs(world)) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

