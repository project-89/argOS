import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets, removeEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { createRoomEntity, createAgentEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { Agent, Goal, Memory, Mind } = await import("../../ecs/components");
const { HasGoal, HasMemory } = await import("../../ecs/relations");
const { addMemory, getKnowledgeSummary } = await import("../../cognition/knowledge-graph");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { createStoryScaffoldEntity, generateStoryScaffold, getStoryScaffold, formatScaffoldForContext } = await import("../story-scaffold");
const { healNarrative } = await import("../narrative-integrity");
const { withSimulationTask } = await import("../../runtime/task-scope");

beforeEach(() => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Scaffold authority regressions must remain offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("Established people"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Living Room" });
  const elaine = createAgentEntity(world, { name: "Elaine", role: "friend", roomId: room,
    systemPrompt: "Alex and I have been together for two years. I choose my own plans." });
  const jerry = createAgentEntity(world, { name: "Jerry", role: "host", roomId: room,
    systemPrompt: "I like my friend and want to enjoy the evening." });
  addMemory(world, elaine, { type: "episodic", content: "Alex and I have been together for two years and have dinner plans tonight.",
    importance: .95, emotionalValence: .7, timestamp: Date.now() });
  addMemory(world, jerry, { type: "episodic", content: "Elaine told me she looks forward to seeing Alex tonight.",
    importance: .8, emotionalValence: .2, timestamp: Date.now() });
  createPersonalIntention(world, elaine, "Get ready for dinner, or revise my own plans", 7);
  createPersonalIntention(world, jerry, "Enjoy Elaine's company without taking over her plans", 7);
  const proposal = { seed: "An evening before dinner", currentAct: "setup", adaptations: [],
    tensions: [{ id: "invented-date", description: "Elaine defends a man she barely knows.", status: "active",
      involvedNpcs: ["Elaine", "Jerry"], beats: [{ id: "force-date", description: "Elaine must keep the date.", act: "setup",
        status: "pending", triggerCondition: "Elaine sees her phone", npcActions: ["Elaine must obey the date plan."] }] }],
    npcRoles: [{ name: "Elaine", eid: elaine, role: "protagonist", secrets: ["Elaine only accepted Alex's first invitation out of fear of a rut."],
      hiddenMotivation: "Keep up appearances rather than genuine attraction" },
    { name: "Jerry", eid: jerry, role: "catalyst", secrets: ["Jerry heard a secret rumor about Alex."],
      hiddenMotivation: "Sabotage the date to solve my empty apartment problem" }] };
  return { world, elaine, jerry, proposal };
}
function ownedState(world: ReturnType<typeof createArgosWorld>, eid: number) {
  return { identity: [Agent.role[eid], Agent.systemPrompt[eid]], mind: [Mind.mode[eid], Mind.focus[eid], Mind.arousal[eid]],
    memories: getRelationTargets(world, eid, HasMemory).map(id => ({ id, type: Memory.type[id], content: Memory.content[id],
      importance: Memory.importance[id], timestamp: Memory.timestamp[id], recalled: Memory.lastRecalled[id], count: Memory.recallCount[id] })),
    goals: getRelationTargets(world, eid, HasGoal).map(id => ({ id, description: Goal.description[id], status: Goal.status[id],
      priority: Goal.priority[id], progress: Goal.progress[id], success: Goal.successJson[id], params: Goal.paramsJson[id] })) };
}

test("starting narrative scaffolding preserves established two-year history and motives despite a conflicting generated proposal", async () => {
  const f = fixture(), before = [ownedState(f.world, f.elaine), ownedState(f.world, f.jerry)];
  generate.mockResolvedValue({ text: JSON.stringify(f.proposal) });
  const scaffold = await generateStoryScaffold(f.world, f.proposal.seed);
  expect(scaffold).not.toBeNull(); expect(getStoryScaffold(f.world)).toEqual(scaffold);
  expect(scaffold?.npcRoles[0].secrets).toEqual(f.proposal.npcRoles[0].secrets); // retained as advisory data
  expect([ownedState(f.world, f.elaine), ownedState(f.world, f.jerry)]).toEqual(before);
  const knowledge = getKnowledgeSummary(f.world, f.elaine, { context: "Alex and dinner" });
  expect(knowledge).toContain("together for two years");
  expect(knowledge).not.toMatch(/barely knows|fear of a rut|appearances/);
  expect(getKnowledgeSummary(f.world, f.jerry, { context: "Alex" })).not.toMatch(/secret rumor|Sabotage|empty apartment/);
  expect(formatScaffoldForContext(f.world)).toContain("not facts, NPC knowledge, or required outcomes");
  expect(formatScaffoldForContext(f.world)).not.toContain("— knows:");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("reassigning a missing narrative role changes only the scaffold, not the survivor's secrets, experiences or goals", async () => {
  const f = fixture(); createStoryScaffoldEntity(f.world, f.proposal as any); removeEntity(f.world, f.jerry);
  const before = ownedState(f.world, f.elaine);
  expect(await healNarrative(f.world)).toBe(1);
  expect(getStoryScaffold(f.world)?.npcRoles.find(r => r.name === "Elaine")?.secrets).toContain("Jerry heard a secret rumor about Alex.");
  expect(ownedState(f.world, f.elaine)).toEqual(before);
  expect(getKnowledgeSummary(f.world, f.elaine, { context: "Alex" })).not.toContain("secret rumor");
  expect(generate).not.toHaveBeenCalled();
});

test("cancelled scaffold generation cannot commit its late advisory output or character state", async () => {
  const f = fixture(), controller = new AbortController(), before = ownedState(f.world, f.elaine);
  generate.mockImplementation(async () => { controller.abort(); return { text: JSON.stringify(f.proposal) }; });
  expect(await withSimulationTask(controller.signal, () => generateStoryScaffold(f.world, f.proposal.seed))).toBeNull();
  expect(getStoryScaffold(f.world)).toBeNull(); expect(ownedState(f.world, f.elaine)).toEqual(before);
});
