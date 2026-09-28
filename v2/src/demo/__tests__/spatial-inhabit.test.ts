import { jest } from "@jest/globals";
import { hasComponent, getRelationTargets } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { Agent, Controlled, Mind, Name, Position } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { SittingOn } from "../../ecs/relations";
import { getControlledBodies, isOperatorControlled } from "../../ecs/controlled";
import { getSocialDialogue } from "../../cognition/social-memory";
import { getForegroundCognitionReadiness } from "../../cognition/idle-cognition";
import { runActorControlStep } from "../../cognition/cognition-system";
import { queueStimulus, peekPendingStimuli } from "../../cognition/stimulus-queue";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { getAgentWorldCapabilities, getAgentVisualEntities } from "../../cognition/world-capabilities";
import { getCommittedEvents } from "../../runtime/committed-events";
import { serializeWorld } from "../../persistence/world-persistence";

let d: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Inhabit checks are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  d = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false });
  await d.start();
});
afterEach(() => { d?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const w = () => d.sim.world;
const named = (name: string) => d.actors.find(id => Name.value[id] === name)!;
const key = (eid: number) => d.snapshot().actors.find(a => a.id === eid)!.key;

test("possession is an ECS component that suspends the resident's own mind but keeps perception, and release resumes it", () => {
  const leon = named("Leon"), world = w();
  expect(getForegroundCognitionReadiness(world, leon).reason).not.toBe("controlled");
  expect(d.takeControl(key(leon))).toEqual({ actorKey: key(leon) });
  expect(hasComponent(world, leon, Controlled)).toBe(true);
  expect(Controlled.controller[leon]).toBe("operator");
  expect(getForegroundCognitionReadiness(world, leon)).toMatchObject({ ready: false, reason: "controlled" });
  // A decision already in flight can no longer commit.
  const decision = getAgentWorldCapabilities(world, leon)!.beginDecision!();
  expect(decision.isCurrent()).toBe(false);
  // Perception intake continues; the body's own control step selects nothing.
  const before = getAgentPerceptions(world, leon).length;
  expect(queueStimulus(world, { targetEid: leon, type: "attention", content: "A gull shrieks overhead.", source: "the sky", modality: "auditory" })).toBe(true);
  expect(runActorControlStep(world, leon, d.sim.god.systemRegistry)).toBe(false);
  expect(peekPendingStimuli(leon, world)).toHaveLength(0);
  expect(getAgentPerceptions(world, leon).length).toBeGreaterThan(before);
  // One operator body at a time: taking another releases the first.
  const mara = named("Mara");
  d.takeControl(key(mara));
  expect(getControlledBodies(world)).toEqual([mara]);
  expect(getForegroundCognitionReadiness(world, leon).reason).not.toBe("controlled");
  expect(d.releaseControl()).toEqual({ released: [key(mara)] });
  expect(isOperatorControlled(world, mara)).toBe(false);
  expect(getForegroundCognitionReadiness(world, mara).reason).not.toBe("controlled");
  expect(getAgentWorldCapabilities(world, mara)!.beginDecision!().isCurrent()).toBe(true);
});

test("control is session state: saves never carry it and a restore cannot grant it", () => {
  const leon = named("Leon");
  d.takeControl(key(leon));
  const saved = serializeWorld(w(), d.sim.god.systemRegistry);
  const entity = saved.entities.find(e => e.components.Name?.value === "Leon")!;
  expect(entity.components.Agent).toBeDefined();
  expect(entity.components.Controlled).toBeUndefined();
});

// Daemon whisper suspension is covered in spirits/__tests__/daemon-possession.test.ts.

test("a visitor is a native mindless body at the town entry that residents see and hear", () => {
  const { actorKey } = d.spawnVisitor({ name: "Wren", persona: "A quiet cartographer passing through." });
  const world = w(), visitor = d.actors.find(id => Name.value[id] === "Wren")!;
  expect(hasComponent(world, visitor, Agent)).toBe(true);
  expect(hasComponent(world, visitor, Mind)).toBe(false);
  expect(Agent.systemPrompt[visitor]).toContain("cartographer");
  expect(getRoomForEntity(world, visitor)).toBe(d.byId.get("common-square"));
  expect(getControlledBodies(world)).toEqual([visitor]);
  const view = d.snapshot();
  expect(view.control).toMatchObject({ actorKey, name: "Wren", visitor: true, heard: [] });
  expect(view.entities.find(e => e.key === actorKey)).toMatchObject({ kind: "actor", asset: "actor-a" });
  // Eli stands in the square: he can see the stranger and is told of the arrival.
  const eli = named("Eli");
  expect(getAgentVisualEntities(world, eli)).toContain(visitor);
  d.say({ text: "Good evening. Is there somewhere to eat around here?" });
  d.advance(8000);
  const heard = getSocialDialogue(world, eli).filter(turn => turn.speaker === "Wren");
  expect(heard.map(turn => turn.content)).toEqual(["Good evening. Is there somewhere to eat around here?"]);
  expect(getCommittedEvents(world).events.some(e => e.kind === "speech" && e.actorId === visitor && e.status === "succeeded")).toBe(true);
  // Released, the visitor stays: idle, still without a mind.
  d.releaseControl();
  expect(d.snapshot().control).toBeUndefined();
  expect(hasComponent(world, visitor, Mind)).toBe(false);
  expect(d.snapshot().actors.some(a => a.name === "Wren")).toBe(true);
});

test("a human waits for a gap in the conversation, then cuts in, and is never silently dropped", () => {
  d.spawnVisitor({ name: "Wren" });
  const world = w(), visitor = d.actors.find(id => Name.value[id] === "Wren")!, eli = named("Eli");
  d.dispatch(key(eli), "speak", undefined, "I was just saying how cold it gets on the common when the wind turns off the water at night.");
  d.advance(300);
  expect(d.say({ text: "Sorry to interrupt, but what happened to the Marrow Star?" })).toEqual({ ok: true, queued: true });
  d.advance(12000);
  const spoken = getSocialDialogue(world, eli).filter(turn => turn.speaker === "Wren").map(turn => turn.content);
  expect(spoken).toEqual(["Sorry to interrupt, but what happened to the Marrow Star?"]);
  expect(getCommittedEvents(world).events.some(e => e.kind === "speech" && e.actorId === visitor && e.status === "succeeded")).toBe(true);
});

test("the control block reports nearby things with usable verbs and what the body heard", () => {
  d.spawnVisitor({});
  const world = w(), visitor = d.actors.find(id => Name.value[id] === "Visitor")!, eli = named("Eli");
  const control = d.snapshot().control!;
  expect(control.nearby.every(row => row.distance <= 3)).toBe(true);
  expect(control.nearby.find(row => row.name === "Eli")).toMatchObject({ kind: "actor", verbs: expect.arrayContaining(["speak"]) });
  d.dispatch(key(eli), "speak", undefined, "Welcome to Saltmere, stranger.");
  d.advance(6000);
  expect(d.snapshot().control!.heard).toEqual([expect.objectContaining({ speaker: "Eli", text: "Welcome to Saltmere, stranger." })]);
  expect(Position.x[visitor]).toBeGreaterThan(0);
  // The visitor has no mind, but its body still perceived Eli's words.
  expect(getAgentPerceptions(world, visitor).length).toBeGreaterThan(0);
});

test("walking moves along a planned path, respects walls and changes rooms", () => {
  d.spawnVisitor({});
  const world = w(), visitor = d.actors.find(id => Name.value[id] === "Visitor")!;
  const start = { x: Position.x[visitor], y: Position.y[visitor] };
  expect(d.walk({ dx: 1, dy: 0 })).toEqual({ ok: true });
  d.advance(500);
  const mid = Position.x[visitor];
  expect(mid).toBeGreaterThan(start.x); expect(mid).toBeLessThan(start.x + 1.21);
  // A new walk replaces the previous one.
  expect(d.walk({ dx: 0, dy: 1 })).toEqual({ ok: true });
  d.advance(3000);
  expect(Position.x[visitor]).toBeCloseTo(mid, 5);
  expect(Position.y[visitor]).toBeGreaterThan(start.y);
  // A point inside a wall/outside the floor is refused, not teleported into.
  expect(d.walk({ x: -5, y: -5 })).toMatchObject({ ok: false });
  // Walk into the Corner Cafe: room membership follows the body.
  const cafe = d.byId.get("town-cafe")!;
  expect(d.walk({ x: 6.5, y: 29.5 })).toEqual({ ok: true });
  d.advance(40_000);
  expect(getRoomForEntity(world, visitor)).toBe(cafe);
  expect(Math.hypot(Position.x[visitor] - 6.5, Position.y[visitor] - 29.5)).toBeLessThan(.05);
});

test("act goes through the native executor: sitting on a nearby chair commits", () => {
  d.spawnVisitor({});
  const world = w(), visitor = d.actors.find(id => Name.value[id] === "Visitor")!;
  const seat = d.byId.get("square-seat-1")!, seatKey = d.snapshot().entities.find(e => e.id === seat)!.key;
  expect(() => d.act({ type: "levitate", targetKey: seatKey })).toThrow(/Unknown action/);
  d.act({ type: "sit", targetKey: seatKey });
  d.advance(60_000);
  expect(getRelationTargets(world, visitor, SittingOn)).toEqual([seat]);
  expect(getCommittedEvents(world).events.some(e => e.kind === "action" && e.actorId === visitor && e.status === "succeeded")).toBe(true);
});

test("pause freezes simulation time and refuses world changes; resume continues", () => {
  d.spawnVisitor({});
  const t0 = d.atSimMs;
  expect(d.pause()).toEqual({ paused: true });
  expect(d.snapshot().paused).toBe(true);
  expect(() => d.advance(1000)).toThrow(/paused/);
  expect(d.walk({ dx: 1, dy: 0 })).toEqual({ ok: false, reason: "paused" });
  expect(() => d.say({ text: "Hello?" })).toThrow(/paused/);
  expect(d.atSimMs).toBe(t0);
  expect(d.sim.paused).toBe(true);
  expect(d.resume()).toEqual({ paused: false });
  d.advance(1000);
  expect(d.atSimMs).toBe(t0 + 1000);
  expect(d.snapshot().paused).toBe(false);
});

test("God's omniscient read tools expose private minds to the operator only", async () => {
  const { createSpatialGodConsole } = await import("../spatial-god-console");
  const consoleRuns: Array<{ tools: Record<string, any>; prompt: string }> = [];
  const god = createSpatialGodConsole({ sim: d.sim, running: () => d.running, atSimMs: () => d.atSimMs, profile: "operator",
    omniscience: d.omniscience, guidance: () => "", publicWorld: () => ({}), weather: () => ({ status: "rejected", detail: "" }),
    execute: async (_prompt, scope) => {
      consoleRuns.push({ tools: scope.surface!.tools, prompt: scope.surface!.systemPrompt });
      const leon = await scope.surface!.tools.inspectResident.execute({ name: "Leon" }, {});
      return { text: `Leon hides this: ${leon.result.secret}` };
    } });
  const answer = await god.ask({ requestId: "20000000-0000-4000-8000-000000000001", text: "What is Leon hiding?" });
  expect(Object.keys(consoleRuns[0].tools).sort()).toEqual(["inspectResident", "recentEvents", "storyLedger", "whereIsEveryone"]);
  expect(consoleRuns[0].prompt).toMatch(/author and its caretaker/);
  expect(answer.reply).toMatch(/Marrow Star|smuggl/i);
  expect(answer.receipts).toEqual([{ tool: "inspectResident", args: { name: "Leon" }, ok: true }]);
  const everyone = await consoleRuns[0].tools.whereIsEveryone.execute({}, {});
  expect(everyone.result.map((row: any) => row.name)).toContain("Mara");
  // None of it reaches a resident or the public scene.
  expect(JSON.stringify(d.snapshot().actors)).not.toMatch(/smuggl/i);
  god.close();
});

test("God's ask is unavailable without live AI", async () => {
  await expect(d.askGod({ requestId: "20000000-0000-4000-8000-000000000002", text: "Hello" })).rejects.toThrow(/live sessions/);
});
