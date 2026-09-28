import { jest } from "@jest/globals";
import { createDocumentWorkTestbed, INSPECTION_NOTES } from "../document-work-testbed";
import { Goal, WikiDoc } from "../../ecs/components";
import { buildAgentContext } from "../../cognition/agent-mind";
import { executeActions } from "../../cognition/cognition-system";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { evaluateGoalSuccessContract } from "../../systems/goal-evaluation-system";
import { drainPendingStimuli, peekPendingStimuli } from "../../cognition/stimulus-queue";

test("writer starts with an owned task but learns source observations only through native reading", async () => {
  drainPendingStimuli(); const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline writer fixture"));
  const f = await createDocumentWorkTestbed();
  try {
    expect(Goal.status[f.goal]).toBe("active"); expect(WikiDoc.body[f.report]).toBe("");
    expect(evaluateGoalSuccessContract(f.sim.world, f.actor, f.goal).satisfied).toBe(false);
    expect(buildAgentContext(f.sim.world, f.actor)).not.toContain("one loose railing");
    executeActions(f.sim.world, [{ eid: f.actor, action: { type: "interact", target: "Inspection notes", content: "read_document" } }], f.sim.god.systemRegistry);
    advanceSimulationTimeline(f.sim.world, 1200, { integrate: () => {} });
    expect(peekPendingStimuli().some(s => s.targetEid === f.actor && s.content.includes(INSPECTION_NOTES))).toBe(true);
    expect(WikiDoc.body[f.report]).toBe(""); expect(Goal.status[f.goal]).toBe("active");
  } finally { f.sim.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); }
});
