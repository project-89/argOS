import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { takeControl, releaseControl } = await import("../../ecs/controlled");
const { createDaemonRegistry, createDaemonForAgent, queueNarrativeNudge, runDaemonSystem } = await import("../agent-daemon");

function fixture() {
  const world = createArgosWorld("Possessed daemons"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lantern House" });
  const mara = createAgentEntity(world, { name: "Mara", role: "returning daughter", systemPrompt: "You are Mara.", roomId: room });
  const leon = createAgentEntity(world, { name: "Leon", role: "old clerk", systemPrompt: "You are Leon.", roomId: room });
  const registry = createDaemonRegistry(600_000); registry.innerVoice = true;
  createDaemonForAgent(registry, world, mara); const leonDaemon = createDaemonForAgent(registry, world, leon)!;
  for (const d of registry.daemons.values()) d.lastObservation = Date.now();
  advanceSimulationTime(world, 1, 60_000);
  const whispers = (eid: number) => drainPendingStimuli(undefined, world).filter(s => s.targetEid === eid && s.type === "daemon_whisper");
  return { world, mara, leon, registry, leonDaemon, whispers };
}
beforeEach(() => { generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("a possessed body hears no inner voice and its nudges wait; release restores whispers", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: "You could still tell her." });
  takeControl(f.world, f.leon);
  expect(queueNarrativeNudge(f.registry, "Leon", { type: "interact", action: "Confess to Mara", reason: "pressure", source: "narrator", priority: "high" },
    { world: f.world, agentEid: f.leon })).toBe(true);
  const result = await runDaemonSystem(f.world, f.registry);
  expect(result.whispers).toBe(1); // Mara only
  expect(generate.mock.calls.map(call => String(call[0].prompt)).some(p => p.startsWith("You are Leon's daemon"))).toBe(false);
  expect(f.leonDaemon.pendingNudges).toHaveLength(1);
  const drained = drainPendingStimuli(undefined, f.world);
  expect(drained.filter(s => s.targetEid === f.leon)).toEqual([]);
  expect(drained.filter(s => s.targetEid === f.mara)).toHaveLength(1);
  releaseControl(f.world, f.leon);
  advanceSimulationTime(f.world, 2, 60_000);
  await runDaemonSystem(f.world, f.registry);
  expect(generate.mock.calls.map(call => String(call[0].prompt)).some(p => p.startsWith("You are Leon's daemon"))).toBe(true);
});

test("a whisper already in inference is dropped when the operator takes the body", async () => {
  const f = fixture();
  let finish!: (value: { text: string }) => void;
  generate.mockImplementation(async (input: any) => String(input.prompt).startsWith("You are Mara's daemon")
    ? new Promise(resolve => { finish = resolve; }) : { text: "Leon's own thought." });
  const running = runDaemonSystem(f.world, f.registry);
  await new Promise(resolve => setImmediate(resolve));
  takeControl(f.world, f.mara);
  finish({ text: "Ask him now." });
  await running;
  expect(f.whispers(f.mara)).toEqual([]);
});
