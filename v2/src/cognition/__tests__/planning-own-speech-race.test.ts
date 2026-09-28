import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { createIntentGoal, executeActions } from "../cognition-system";
import { addConversationTurn, addThought, agentThink, getAgentThoughts } from "../agent-mind";
import { drainPendingStimuli } from "../stimulus-queue";
import { recordCommittedSpeech } from "../social-memory";
import { createPlanEntity, formatPlansForContext, getNextPlannedAction, type PlanStep } from "../planning-system";

function fixture() {
  const world = createArgosWorld("Own speech arbitration"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const utility = createRoomEntity(world, { name: "Utility Room" });
  const mara = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Curious.", roomId: room });
  const sera = createAgentEntity(world, { name: "Sera", role: "resident", systemPrompt: "Practical.", roomId: room });
  const goal = createIntentGoal(world, mara, "Get to know Sera", 4); Goal.kind[goal] = "social";
  const registry = createSystemRegistry();
  const plan = (steps: PlanStep[]) => createPlanEntity(world, mara, goal, { goalDescription: "Get to know Sera", steps, estimatedCompletion: "brief", potentialObstacles: [] });
  const speak = (content: string) => executeActions(world, [{ eid: mara, action: { type: "speak", target: "Sera", content } }], registry);
  return { world, room, utility, mara, sera, goal, plan, speak, registry };
}

const question: PlanStep = { description: "PLANNED_BACKGROUND_QUESTION", actionType: "speak", target: "Sera", content: "How long have you been living here, Sera? What brought you to this house?" };
const listen: PlanStep = { description: "Listen to Sera.", actionType: "wait" };

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid model calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each([
  { stored: question, foreground: "How long have you lived here, Sera? You seem to know your way around this place." },
  { stored: { ...question, description: "PLANNED_BACKGROUND_ANSWER", content: "I came here last year for quiet work. What about you?" }, foreground: "A little over a year now. Came looking for quiet work, and stayed." },
])("an independent committed foreground turn supersedes $stored.description admitted moments earlier", ({ stored, foreground }) => {
  const f = fixture(), id = f.plan([stored, listen]);
  f.speak(foreground);
  expect(Plan.currentStep[id]).toBe(0); // A paraphrase is not execution proof for a different planned utterance.
  expect(formatPlansForContext(f.world, f.mara)).not.toContain(stored.description);
  expect(Plan.status[id]).toBe("active"); // Formatting is read-only.
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
  expect(Goal.status[f.goal]).toBe("active"); // Retiring a draft is not social satisfaction.
});

test("confirmed planned speech advances its own cursor without invalidating the following listening step", () => {
  const f = fixture(), id = f.plan([question, listen]);
  f.speak(question.content!);
  expect(Plan.currentStep[id]).toBe(1);
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull(); // Listening is a pending evidence boundary, not an executable one-turn wait.
  expect(Plan.currentStep[id]).toBe(1);
  expect(Plan.status[id]).toBe("active");
});

test("confirmed planned speech refreshes the remaining speech dependency, but another independent turn does not", () => {
  const f = fixture();
  const next: PlanStep = { description: "Offer my own background.", actionType: "speak", target: "Sera", content: "I came here to focus on tinkering." };
  const id = f.plan([question, next]); f.speak(question.content!);
  expect(Plan.currentStep[id]).toBe(1);
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "speak", content: next.content });
  f.speak("Actually, I will let you get back to your own routine.");
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
});

test("an unrelated physical step remains executable, while a later stale speech draft does not", () => {
  const f = fixture();
  const id = f.plan([{ description: "Check this room.", actionType: "observe", target: "Common Room" }, question]);
  f.speak("I should let you get on with your morning, Sera.");
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "observe", target: "Common Room" });
  executeActions(f.world, [{ eid: f.mara, action: { type: "observe", target: "Common Room" } }], f.registry);
  expect(Plan.currentStep[id]).toBe(1);
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
});

test("private unexecuted thoughts and model output do not count as a committed own turn", () => {
  const f = fixture(); f.plan([question]);
  addThought(f.world, f.mara, { content: "Maybe I already asked Sera about her background." });
  addConversationTurn(f.world, f.mara, "assistant", '{"action":{"type":"speak","content":"Unexecuted reply"}}');
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "speak", content: question.content });
});

test("model-supplied own speech dependency cannot manufacture permission for a future duplicate", () => {
  const f = fixture();
  const future = recordCommittedSpeech(f.world, f.mara, "An earlier turn.", "Sera")!;
  const id = f.plan([{ ...question, ownSpeechDependency: "MODEL_MARKER" } as PlanStep]);
  expect(JSON.parse(Plan.steps[id])[0].ownSpeechDependency).not.toBe("MODEL_MARKER");
  expect(getNextPlannedAction(f.world, f.mara)).not.toBeNull();
  recordCommittedSpeech(f.world, f.mara, "An independent newer turn.", "Sera", future.atMs + 1);
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
});

test("a still-valid stored physical step executes without republishing its outdated premise as a fresh thought", async () => {
  const f = fixture();
  Goal.kind[f.goal] = "custom";
  Goal.description[f.goal] = "Collect the brass spool";
  const item = createObjectEntity(f.world, { name: "Brass spool", roomId: f.room, portable: true });
  const description = "Sera is still beside me. I will collect the brass spool.";
  const id = f.plan([
    { description, actionType: "pickup", target: "Brass spool" },
    { description: "Set down the spool.", actionType: "drop", target: "Brass spool" },
  ]);
  setLocatedIn(f.world, f.sera, f.utility);
  const thought = addThought(f.world, f.mara, { content: "I want to finish this task.", type: "reasoning" });

  const action = await agentThink(f.world, f.mara);
  expect(action).toMatchObject({ type: "pickup", target: "Brass spool" });
  expect(getAgentThoughts(f.world, f.mara)).toEqual([thought]);
  expect(getDirectContainer(f.world, item)).toBe(f.room);
  expect(Plan.currentStep[id]).toBe(0);

  executeActions(f.world, [{ eid: f.mara, action }], f.registry);
  expect(getDirectContainer(f.world, item)).toBe(f.mara);
  expect(Plan.currentStep[id]).toBe(1);
  expect(Plan.status[id]).toBe("active");
  expect(JSON.parse(Plan.steps[id])[0].description).toBe(description);
  expect(getAgentThoughts(f.world, f.mara)).toEqual([thought]);
});
