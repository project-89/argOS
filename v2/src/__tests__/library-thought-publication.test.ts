/** Exercise the actual library callbacks and native admission/dispatch. The
 * provider is scripted; the runtime wrapper only exposes its owned state so
 * tests can invoke one bounded operation without an autonomous model loop. */
import { jest } from "@jest/globals";
import type { SimulationState } from "../runtime/simulation-loop";
import type { AgentThinkEvent, SimulationEvent } from "../bus/simulation-bus";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const runtime = await import("../runtime/simulation-loop");
let owned: SimulationState;
jest.unstable_mockModule("../runtime/simulation-loop", () => ({ ...runtime,
  createSimulation: (...args: Parameters<typeof runtime.createSimulation>) => (owned = runtime.createSimulation(...args)),
}));
const { createSimulation } = await import("../index");
const { query } = await import("bitecs");
const { Agent, BehaviorPolicy, Name, Thought, WorkingMemoryIdentity } = await import("../ecs/components");
const { addPerception, addThought, getAgentThoughts } = await import("../cognition/agent-mind");
const { wakeForegroundCognition } = await import("../cognition/idle-cognition");
const { queueExperiencedEvent } = await import("../cognition/experience-appraisal");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../runtime/committed-events");
const { withSimulationTask } = await import("../runtime/task-scope");
const { getDirectContainer } = await import("../ecs/location");
const { drainPendingStimuli } = await import("../cognition/stimulus-queue");
const { registerAgentWorldCapabilities } = await import("../cognition/world-capabilities");
const { workingMemoryEntityRef } = await import("../cognition/working-memory");
const { beginTimedSpeech, getSpeakingActivity } = await import("../cognition/timed-speech");
const { advanceSimulationTimeline } = await import("../runtime/simulation-timeline");
const { pollForegroundContinuation } = await import("../cognition/foreground-action-admission");

let previousKey: string | undefined;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Library handoff tests are offline"));
});
afterEach(() => {
  cleanups.splice(0).reverse().forEach(stop => stop()); drainPendingStimuli();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.useRealTimers(); jest.restoreAllMocks();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
const response = (innerThought?: string, type = "wait", target?: string) => ({ text: JSON.stringify({
  ...(innerThought === undefined ? {} : { innerThought }),
  control: { version: 2, purpose: "Take a quiet moment", goalId: null, localDependencies: [] },
  action: { type, ...(target ? { target } : {}) },
}) });
async function fixture() {
  const sim = await createSimulation({ name: "Private library thought handoff", preset: "minimal", enableAI: true,
    narrativeMind: true, cognitionController: "priority", enablePlanning: false, enableReflection: false,
    enableSpirits: false, evolution: false, godAutopilot: false, codingDaemons: false, enableNarrativeEngine: false,
    hostOfficeTools: false, enableServer: false, dualLoop: true, timedActions: false, ecsTickRate: 2, ecsDeltaMs: 500,
    rooms: [{ name: "Lounge" }], agents: [
      { name: "Ada", role: "visitor", startRoom: "Lounge" }, { name: "Lin", role: "friend", startRoom: "Lounge" }],
    objects: [{ name: "Brass key", room: "Lounge", portable: true, traits: ["takeable"] }] });
  cleanups.push(() => sim.stop());
  const id = (name: string) => [...query(sim.world, [Name])].find(e => Name.value[e] === name)!;
  const actor = id("Ada"), peer = id("Lin"), key = id("Brass key");
  workingMemoryEntityRef(sim.world, actor); workingMemoryEntityRef(sim.world, peer);
  BehaviorPolicy.enabled[actor] = false; BehaviorPolicy.enabled[peer] = false;
  const all: SimulationEvent[] = [], own: SimulationEvent[] = [], other: SimulationEvent[] = [], publicBus: SimulationEvent[] = [];
  cleanups.push(sim.onEvent(e => all.push(e)), sim.onAgent(e => own.push(e), "Ada"), sim.onAgent(e => other.push(e), "Lin"),
    sim.onWorld(e => publicBus.push(e)), sim.onRoom(e => publicBus.push(e), "Lounge"));
  await sim.start(); sim.pause();
  const state = owned;
  const fast = (name: string) => state.fastSystems.find(s => s.name === name)!.execute(sim.world, 0, state.tick);
  fast("CognitionEnrollment");
  const op = (name: string) => state.aiOperations.find(o => o.name === `${name}:${actor}`)!;
  let cue = 0;
  const attend = () => {
    jest.setSystemTime(Date.now() + 1000);
    addPerception(sim.world, actor, { type: "attention", source: "local cue", content: `A quiet moment ${++cue}.` });
    wakeForegroundCognition(sim.world, actor);
  };
  const run = () => withSimulationTask(state.abort.signal, () => op("AgentCognition").execute());
  const thoughts = () => all.filter((e): e is AgentThinkEvent => e.type === "agent:think");
  return { sim, actor, peer, key, state, fast, op, attend, run, thoughts, own, other, publicBus };
}

test("library publishes an admitted foreground thought once, privately, with its original timestamp", async () => {
  const f = await fixture(); f.attend(); const before = Date.now();
  const text = "PRIVATE_NARRATIVE: I miss the way our evenings used to feel.";
  generate.mockResolvedValueOnce(response(text, "pickup", "Brass key"));
  await f.run();
  expect(generate).toHaveBeenCalledTimes(1); expect(getDirectContainer(f.sim.world, f.key)).toBe(f.actor);
  expect(f.thoughts()).toEqual([{ type: "agent:think", agentId: f.actor, agentName: "Ada", thought: text, thoughtType: "decision", timestamp: before }]);
  expect(f.own.filter(e => e.type === "agent:think")).toEqual(f.thoughts());
  expect(JSON.stringify([f.other, f.publicBus, getCommittedEvents(f.sim.world), f.sim.getAgentThoughts("Lin"),
    f.sim.getAgentMemories("Lin")])).not.toContain(text);
  f.attend(); generate.mockResolvedValueOnce(response()); await f.run();
  expect(generate).toHaveBeenCalledTimes(2); expect(f.thoughts()).toHaveLength(1);
});

test("action-only turn does not emit old, edited, injected or controller-note thoughts", async () => {
  const f = await fixture(), old = addThought(f.sim.world, f.actor, { type: "reasoning", content: "Old thought" });
  f.attend(); generate.mockImplementationOnce(async () => {
    Thought.content[old] = "Edited history";
    for (const type of ["injected", "planning", "reflection", "recollection"])
      addThought(f.sim.world, f.actor, { type, content: "Not a current self-authored thought" });
    return response();
  });
  await f.run(); expect(generate).toHaveBeenCalledTimes(1); expect(f.thoughts()).toEqual([]);
});

test.each(["owner", "source", "stopped", "cancelled", "capability", "inactive"])("late foreground response cannot publish across %s invalidation", async boundary => {
  const f = await fixture(); f.attend();
  generate.mockImplementationOnce(async () => {
    if (boundary === "owner") WorkingMemoryIdentity.id[f.actor] = "replaced-actor";
    if (boundary === "source") { stopCommittedEvents(f.sim.world); startCommittedEvents(f.sim.world); }
    if (boundary === "stopped") stopCommittedEvents(f.sim.world);
    if (boundary === "cancelled") f.state.abort.abort();
    if (boundary === "inactive") Agent.active[f.actor] = false;
    if (boundary === "capability") cleanups.push(registerAgentWorldCapabilities(f.sim.world, f.actor,
      { context: () => "Changed actor package", ready: () => true, busy: () => false, execute: () => false }));
    return response("This old situation is peaceful.");
  });
  await f.run().catch(error => { if (boundary !== "cancelled") throw error; });
  expect(generate).toHaveBeenCalledTimes(1); expect(f.thoughts()).toEqual([]);
  expect(getAgentThoughts(f.sim.world, f.actor).map(e => Thought.content[e])).not.toContain("This old situation is peaceful.");
});

test("appraisal completed during foreground inference publishes once on its own path", async () => {
  const f = await fixture(); f.attend();
  expect(queueExperiencedEvent(f.sim.world, f.actor, { id: "personal-receipt", channel: "private", source: "Sam",
    content: "PRIVATE_RECEIPT: I will be home this evening.", atSimMs: f.sim.world.time.elapsed })).toBe(true);
  let release!: (r: { text: string }) => void, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  generate.mockImplementationOnce(() => { began(); return new Promise(resolve => { release = resolve; }); });
  const foreground = f.run(); await started;
  generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "PRIVATE_APPRAISAL: That is good to know." }) });
  let during = 0;
  try {
    await withSimulationTask(f.state.abort.signal, () => f.op("AgentAppraisal").execute());
    during = f.thoughts().filter(e => e.thoughtType === "reflection").length;
  } finally { release(response()); await foreground; }
  expect(during).toBe(1);
  expect(f.thoughts().filter(e => e.thoughtType === "reflection")).toHaveLength(1);
  expect(JSON.stringify([f.other, f.publicBus, getCommittedEvents(f.sim.world)])).not.toContain("PRIVATE_APPRAISAL");
});

test("a failing thought subscriber cannot undo native action admission or prevent other observers", async () => {
  const f = await fixture();
  cleanups.push(f.sim.onAgent(e => { if (e.type === "agent:think") throw Error("Private observer failure"); }, "Ada"));
  f.attend(); generate.mockResolvedValueOnce(response("I will take the key.", "pickup", "Brass key"));
  await f.run(); expect(getDirectContainer(f.sim.world, f.key)).toBe(f.actor);
  expect(f.thoughts()).toHaveLength(1); expect(f.sim.bus.getObserverHealth().failures).toBe(1);
});

test("a deferred voice publishes its already-admitted thought once, not again when the fast controller resumes it", async () => {
  const f = await fixture(); f.attend();
  expect(beginTimedSpeech(f.sim.world, f.peer, "I am taking the next few seconds to finish.", "floor-only", () => {}, () => {},
    { floor: "conversational" })).toBe(true);
  generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "I will wait for a gap to say this.",
    control: { version: 2, purpose: "Offer a greeting", goalId: null, localDependencies: [] },
    action: { type: "speak", content: "It is good to see you." } }) });
  await f.run(); expect(pollForegroundContinuation(f.sim.world, f.actor)).toEqual({ waiting: true });
  expect(f.thoughts()).toHaveLength(1); expect(getSpeakingActivity(f.sim.world, f.actor)).toBeUndefined();
  f.fast("ActorControl"); expect(f.thoughts()).toHaveLength(1);
  advanceSimulationTimeline(f.sim.world, 6000, { integrate: () => {} });
  f.fast("ActorControl"); expect(getSpeakingActivity(f.sim.world, f.actor)).toBeDefined();
  expect(f.thoughts()).toHaveLength(1); expect(generate).toHaveBeenCalledTimes(1);
});

test("manual library step exposes the same admitted thought without a running live scheduler", async () => {
  const f = await fixture(); Agent.active[f.peer] = false; f.attend();
  f.sim.stimulate("Ada", "The key catches your attention.", "attention");
  // Bound the test at its first publication; do not run unrelated background
  // goal generation after the handoff under test has completed.
  cleanups.push(f.sim.onAgent(e => { if (e.type === "agent:think") Agent.active[f.actor] = false; }, "Ada"));
  generate.mockResolvedValue(response("A quiet thought in a manually stepped world.", "pickup", "Brass key"));
  await f.sim.step(500);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(getDirectContainer(f.sim.world, f.key)).toBe(f.actor);
  expect(f.thoughts().filter(e => e.thoughtType === "decision").map(e => e.thought)).toEqual(["A quiet thought in a manually stepped world."]);
});

test("the real dual-loop scheduler delivers the thought to library subscribers", async () => {
  const f = await fixture(); Agent.active[f.peer] = false; f.attend();
  generate.mockResolvedValue(response("The scheduled handoff reached its subscriber.", "pickup", "Brass key"));
  cleanups.push(f.sim.onAgent(e => { if (e.type === "agent:think") Agent.active[f.actor] = false; }, "Ada"));
  f.sim.resume(); await jest.advanceTimersByTimeAsync(1100); f.sim.pause();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(f.thoughts().map(e => e.thought)).toEqual(["The scheduled handoff reached its subscriber."]);
  expect(getDirectContainer(f.sim.world, f.key)).toBe(f.actor);
  expect(f.sim.getRuntimeStatus()?.operations.find(o => o.name === `AgentCognition:${f.actor}`)?.metrics.completed).toBeGreaterThan(0);
});

test.each(["owner", "source", "stopped", "cancelled"])("background appraisal cannot publish across %s invalidation", async boundary => {
  const f = await fixture();
  expect(queueExperiencedEvent(f.sim.world, f.actor, { id: "receipt", channel: "private", source: "Sam",
    content: "A personally received update.", atSimMs: 0 })).toBe(true);
  generate.mockImplementationOnce(async () => {
    if (boundary === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
    if (boundary === "source") { stopCommittedEvents(f.sim.world); startCommittedEvents(f.sim.world); }
    if (boundary === "stopped") stopCommittedEvents(f.sim.world);
    if (boundary === "cancelled") f.state.abort.abort();
    return { text: JSON.stringify({ innerThought: "An obsolete appraisal." }) };
  });
  await withSimulationTask(f.state.abort.signal, () => f.op("AgentAppraisal").execute())
    .catch(error => { if (boundary !== "cancelled") throw error; });
  expect(generate).toHaveBeenCalledTimes(1); expect(f.thoughts()).toEqual([]);
});
