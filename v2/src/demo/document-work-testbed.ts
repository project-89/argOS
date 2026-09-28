/** Authored task/observations; all planning and execution remain native. */
import { query } from "bitecs";
import { createSimulation, initializeWorkDocument } from "../index";
import { Goal, Name, ObjectState, WikiDoc, WorkDocument } from "../ecs/components";
import { createGeneratedIntention, getGoalCompletionOptions } from "../cognition/goal-lifecycle";

export const INSPECTION_NOTES = "Today's inspection: the east footbridge has one loose railing. The north footbridge railing is intact. No other structural assessment was made.";
export async function createDocumentWorkTestbed(live = false) {
  const sim = await createSimulation({ name: "Field report — native productive work", preset: "minimal", enableAI: live,
    hostOfficeTools: false, cognitionController: "priority", experienceReconsideration: true, narrativeMind: true,
    enablePlanning: live, enableReflection: live, enableSpirits: false, enableNarrativeEngine: false,
    evolution: false, godAutopilot: false, enableServer: false, dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500,
    rooms: [{ name: "Writing room", description: "A quiet room with two paper documents and pens. No other people are present." }],
    agents: [{ name: "Wren", role: "field inspector", startRoom: "Writing room",
      systemPrompt: "You are Wren, a thoughtful field inspector. You have promised a concise, accurate field report based on the recorded inspection notes. You care about distinguishing observations from assumptions and finishing a useful piece of work. Choose your own actions using what you actually know." }],
    objects: [
      { name: "Inspection notes", room: "Writing room", description: "The original written observations from today's inspection. Read this document to learn what was recorded.", portable: true, traits: ["takeable"] },
      { name: "Field report", room: "Writing room", description: "A blank report with a pen. Its text can be written, reviewed and finalized.", portable: true, traits: ["takeable"] },
    ] });
  const find = (name: string) => [...query(sim.world, [Name])].find(eid => Name.value[eid] === name)!;
  const actor = find("Wren"), source = find("Inspection notes"), report = find("Field report");
  initializeWorkDocument(sim.world, source); initializeWorkDocument(sim.world, report);
  // Initial source artifact, not a claimed NPC action or newly delivered memory.
  WikiDoc.body[source] = INSPECTION_NOTES; WikiDoc.status[source] = "finished";
  ObjectState.current[source] = "finished";
  WorkDocument.reviewedRevision[source] = 0; WorkDocument.completedAtSimMs[source] = 0;
  const option = getGoalCompletionOptions(sim.world, actor).find(o => o.description === "Finalize Field report")!;
  const goal = createGeneratedIntention(sim.world, actor, { description: option.description, completionId: option.id, priority: 9 }, "personal")!;
  if (!Number.isSafeInteger(goal) || Goal.status[goal] !== "active") throw new Error("Writer task could not be initialized");
  // No probabilistic GoalProgress writer may certify the artifact by elapsed time.
  for (const name of ["GoalProgress", "TimeProgression"]) {
    const system = sim.god.systemRegistry.systems.get(name); if (system) system.active = false;
  }
  return { sim, actor, source, report, goal };
}
