import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Memory, Needs, Plan } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents } from "../../runtime/committed-events";
import { addBelief, addMemory } from "../knowledge-graph";
import { getCoreDrives, getLongTermAspirations, setAspirations } from "../goal-learning";
import { getCharacterContext, getLocalOpportunityContext } from "../character-context";
import { generateAutonomousGoal, resetAutonomousGoals, shouldGenerateGoal } from "../autonomous-goals";
import { createGeneratedIntention } from "../goal-lifecycle";
import { createPlanEntity } from "../planning-system";
import { recordOngoingActivityChoice, snapshotOngoingActivity } from "../ongoing-activity";
import { recordPersonalConcern } from "../personal-concerns";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { buildAgentContext } from "../agent-mind";

let oldKey: string | undefined;
beforeEach(() => {
  resetAutonomousGoals(); oldKey = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "offline-only";
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline character context tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
});
function fixture() {
  const world = createArgosWorld("Owned character context"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Kitchen", description: "A room with a visible table." });
  const distant = createRoomEntity(world, { name: "PRIVATE_HIDDEN_PLACE", description: "PRIVATE_REMOTE_DESCRIPTION" });
  const actor = createAgentEntity(world, { name: "Ivo", role: "hungry friend", roomId: room,
    systemPrompt: "Choose independently; conversation and practical work can coexist.",
    past: { background: "I promised to leave something for a friend.", drives: ["PRIVATE_DRIVE: Keep promises"],
      memories: [{ recollection: "PRIVATE_ANCHOR: Noor once saved dinner for me", emotionalTone: "gratitude", importance: .9,
        selfBelief: "I want to reciprocate care", meaning: "A promise matters even when inconvenient", cues: ["Noor", "food"],
        period: "last winter", provenance: "authored-history" }] } });
  const other = createAgentEntity(world, { name: "Noor", role: "friend", roomId: room,
    systemPrompt: "PRIVATE_OTHER_CHARACTER" });
  setAspirations(world, actor, ["PRIVATE_AMBITION: Learn to sail"]);
  setAspirations(world, other, ["PRIVATE_OTHER_AMBITION"]);
  Needs.hunger[actor] = 76; Needs.energy[actor] = 88;
  const memory = addMemory(world, actor, { type: "episodic", content: "PRIVATE_MEMORY: I promised Noor the pear", importance: .8, emotionalValence: .5, timestamp: 1 });
  addMemory(world, other, { type: "episodic", content: "PRIVATE_OTHER_MEMORY", importance: 1, emotionalValence: 0, timestamp: 1 });
  addBelief(world, actor, { subject: "Noor", predicate: "may want", object: "PRIVATE_BELIEF: a pear", confidence: .6, source: "testimony", timestamp: 1 });
  addBelief(world, other, { subject: "Ivo", predicate: "suspect", object: "PRIVATE_OTHER_BELIEF", confidence: 1, source: "inference", timestamp: 1 });
  let executions = 0;
  registerAgentWorldCapabilities(world, actor, { context: () => "LOCAL_FACT: The pear is still on the table.",
    ready: () => true, busy: () => true, execute: () => { executions++; return true; } });
  startCommittedEvents(world);
  return { world, actor, other, room, distant, memory, executions: () => executions };
}

test("prefab core drives survive later ambition setup, without becoming tasks or public facts", () => {
  const f = fixture();
  expect(getCoreDrives(f.world, f.actor)).toEqual(["PRIVATE_DRIVE: Keep promises"]);
  expect(getLongTermAspirations(f.world, f.actor)).toEqual(["PRIVATE_AMBITION: Learn to sail"]);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toEqual([]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  const foreground = buildAgentContext(f.world, f.actor);
  expect(foreground).toContain("PRIVATE_DRIVE: Keep promises");
  expect(foreground).toContain('"hunger":76'); expect(foreground).toContain('"energy":88');
});

test.each([false, true])("both background paths receive owned character context and actual opportunities (personal=%s)", async personal => {
  const f = fixture();
  if (personal) expect(recordPersonalConcern(f.world, f.actor, { channel: "phone", evidenceIds: ["read:new"],
    appraisal: "My plans may change", significance: "There is a choice to make", importance: .6, appraisedAtSimMs: 0 })).toBe(true);
  const before = [Memory.recallCount[f.memory], Memory.lastRecalled[f.memory]];
  const infer = jest.fn(async (_request: any) => ({ text: '{"goal":null}' }));
  await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any });
  const prompt = infer.mock.calls[0][0].messages.map((row: any) => row.content).join("\n");
  for (const text of ["PRIVATE_DRIVE", "PRIVATE_AMBITION", "PRIVATE_ANCHOR", "PRIVATE_MEMORY", "PRIVATE_BELIEF", "LOCAL_FACT", '"hunger":76', '"energy":88']) expect(prompt).toContain(text);
  for (const text of ["PRIVATE_OTHER_CHARACTER", "PRIVATE_OTHER_AMBITION", "PRIVATE_OTHER_MEMORY", "PRIVATE_OTHER_BELIEF", "PRIVATE_HIDDEN_PLACE", "PRIVATE_REMOTE_DESCRIPTION"]) expect(prompt).not.toContain(text);
  expect([Memory.recallCount[f.memory], Memory.lastRecalled[f.memory]]).toEqual(before);
  expect(f.executions()).toBe(0); expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("a busy finite undertaking can coexist with another concern without granting actions or replacing its plan", async () => {
  const f = fixture();
  const goal = createGeneratedIntention(f.world, f.actor, { description: "Prepare for our meal", priority: 7, kind: "custom" }, "personal")!;
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "Soon", potentialObstacles: [],
    steps: [{ actionType: "observe", target: "Noor", description: "Inspect the current scene" }] });
  recordOngoingActivityChoice(f.world, f.actor, { goalId: goal, purpose: "Prepare for our meal", actionType: "observe" });
  const before = [Goal.status[goal], Plan.steps[plan], Plan.currentStep[plan], snapshotOngoingActivity(f.world, f.actor)];
  expect(shouldGenerateGoal(f.world, f.actor)).toBe(true);
  const infer = jest.fn(async () => ({ text: JSON.stringify({ goal: "Ask about our sailing plans later", priority: 4, kind: "social",
    motivation: "An unrelated ambition also matters to me", firstAction: { type: "speak", target: "Noor", content: "Shall we sail?" } }) }));
  expect(await generateAutonomousGoal(f.world, f.actor, { generateText: infer as any })).not.toBeNull();
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(2);
  expect([Goal.status[goal], Plan.steps[plan], Plan.currentStep[plan], snapshotOngoingActivity(f.world, f.actor)]).toEqual(before);
  expect(f.executions()).toBe(0); expect(getCommittedEvents(f.world).events).toEqual([]);
  advanceSimulationTime(f.world, 1, 6000); expect(shouldGenerateGoal(f.world, f.actor)).toBe(false);
});

test("unchanged no-goal reviews back off 30, 60, then 120 simulated seconds; a new owned belief reopens review", async () => {
  const f = fixture(), infer = jest.fn(async () => ({ text: '{"goal":null}' }));
  const run = () => generateAutonomousGoal(f.world, f.actor, { generateText: infer as any });
  await run();
  for (const interval of [30000, 60000, 120000]) {
    advanceSimulationTime(f.world, f.world.time.tick + 1, interval - 1);
    expect(shouldGenerateGoal(f.world, f.actor)).toBe(false); await run();
    advanceSimulationTime(f.world, f.world.time.tick + 1, 1);
    expect(shouldGenerateGoal(f.world, f.actor)).toBe(true); await run();
  }
  expect(infer).toHaveBeenCalledTimes(4);
  advanceSimulationTime(f.world, f.world.time.tick + 1, 5000);
  expect(shouldGenerateGoal(f.world, f.actor)).toBe(false);
  addBelief(f.world, f.actor, { subject: "Noor", predicate: "may want", object: "She has other dinner plans", confidence: .8, source: "testimony", timestamp: 2 });
  expect(shouldGenerateGoal(f.world, f.actor)).toBe(true);
  expect(getCharacterContext(f.world, f.actor).beliefs[0].object).toBe("She has other dinner plans");
  expect(JSON.stringify(getLocalOpportunityContext(f.world, f.actor))).not.toContain("PRIVATE_OTHER");
});
