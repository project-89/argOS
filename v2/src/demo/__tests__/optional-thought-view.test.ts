/** Omitted expression must not hide decisions, reset the current thought, or
 * turn a private thought into material for the renderer or another character. */
import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../apartment-sitcom");
const { addPerception, addThought, getAgentPerceptions, getAgentThoughts } = await import("../../cognition/agent-mind");
const { executeActions, runCognitionCycle } = await import("../../cognition/cognition-system");
const { wakeForegroundCognition } = await import("../../cognition/idle-cognition");
const { getWorldNarrativeEvidence } = await import("../../cognition/world-capabilities");
const { getDirectContainer, getRoomForEntity } = await import("../../ecs/location");
const { Perception } = await import("../../ecs/components");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { summarizeContinuityEvidence } = await import("../continuity-evidence");

let t: Awaited<ReturnType<typeof ApartmentSitcom.create>>, previousKey: string | undefined, pulse = 0;
beforeEach(async () => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline optional-thought view regression"));
  t = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" });
  await t.start(); t.sim.world.meta.aiEnabled = true;
});
afterEach(() => {
  t?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
async function decide(action: Record<string, unknown>, innerThought?: string) {
  const eid = t.ids.Elaine, world = t.sim.world;
  generate.mockResolvedValue({ text: JSON.stringify({ ...(innerThought === undefined ? {} : { innerThought }),
    control: { version: 2, purpose: "Attend to the current situation", goalId: null, localDependencies: [] }, action }) });
  addPerception(world, eid, { type: "attention", source: "offline fixture", content: `Consider the current situation ${++pulse}.` });
  wakeForegroundCognition(world, eid);
  const count = generate.mock.calls.length;
  const actions = await runCognitionCycle(world, t.sim.god.systemRegistry, { agentEids: [eid], enablePlanning: false });
  expect(generate.mock.calls.length).toBe(count + 1); expect(actions).toHaveLength(1);
  executeActions(world, actions, t.sim.god.systemRegistry);
}

test.each([undefined, "", " \n "])("unexpressed %p decision is visible but has no synthetic first thought", async innerThought => {
  await decide({ type: "wait" }, innerThought);
  const snapshot = t.snapshot();
  expect(snapshot.actors.find(a => a.name === "Elaine")!.latestThought).toBeNull();
  expect(getAgentThoughts(t.sim.world, t.ids.Elaine)).toHaveLength(0);
  expect(snapshot.events.filter(e => e.kind === "thought")).toHaveLength(0);
  expect(snapshot.events.some(e => e.kind === "action" && e.action?.type === "wait" && e.status === "succeeded")).toBe(true);
  expect(summarizeContinuityEvidence(snapshot.events, [{ atSimMs: snapshot.atSimMs, actors: snapshot.actors }]).actors
    .find(a => a.name === "Elaine")).toMatchObject({ integratedDecisions: 1, expressedReasoningThoughts: 0 });
});

test("action-only physical progress retains the exact last genuine thought without replaying or exposing it", async () => {
  const secret = "PRIVATE_RUMINATION: that last message still hurts.", world = t.sim.world;
  addThought(world, t.ids.Elaine, { content: secret, type: "reasoning" });
  const original = t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought;
  const thoughtEvents = t.snapshot().events.filter(e => e.kind === "thought");
  await decide({ type: "move", target: "Kitchen" }); t.advance(3000);
  expect(getRoomForEntity(world, t.ids.Elaine)).toBe(t.ids.kitchen);
  await decide({ type: "pickup", target: "Elaine's phone" }, ""); t.advance(800);
  expect(getDirectContainer(world, t.ids.phone)).toBe(t.ids.Elaine);
  expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought).toEqual(original);
  expect(t.snapshot().events.filter(e => e.kind === "thought")).toEqual(thoughtEvents);
  expect(thoughtEvents[0].visibility).toBe("private");
  expect(JSON.stringify(t.snapshot().events.filter(e => e.visibility === "public"))).not.toContain(secret);
  expect(JSON.stringify(t.scenes())).not.toContain(secret);
  expect(JSON.stringify(getWorldNarrativeEvidence(world))).not.toContain(secret);
  expect(getAgentPerceptions(world, t.ids.Jerry).map(id => Perception.content[id]).join("\n")).not.toContain(secret);
});
