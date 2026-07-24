/**
 * Orchestrator Tree — The Behavior Tree that drives the Swarm-BT agent.
 *
 * Defines the fallback chain:
 *   1. Fast Path (Single Shot)
 *   2. Divergent Planning (Swarm)
 *   3. Fallback (Single Flash model)
 */

import type { BehaviorNode } from "../bt/types.js";

export const swarmOrchestratorTree: BehaviorNode = {
  type: "selector",
  children: [
    // 1. Divergent Planning — Spawn swarm, cluster, execute
    {
      type: "sequence",
      children: [
        // Step 1: Generate plan via swarm
        {
          type: "swarm_plan",
          instanceCount: 5,
          convergenceThreshold: 3,
        },
        // Step 2: Execute the converged plan
        {
          type: "execute_plan",
          maxDepth: 2,
          stepSwarmSize: 3,
        }
      ]
    } as any,
    
    // 2. Fallback — if planning failed to converge, use big model
    {
      type: "llm_escalate"
    }
  ]
};
