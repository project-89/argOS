import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Agent, Health, Mind, WorkingMemoryIdentity } = await import("../../ecs/components");
const { addComponent, removeEntity } = await import("bitecs");
const { setLocatedIn } = await import("../../ecs/location");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { drainPendingStimuli, queueStimulus, peekPendingStimuli } = await import("../../cognition/stimulus-queue");
const { normalizeSensoryEvent } = await import("../../cognition/sensory-capabilities");
const { runActorControlStep } = await import("../../cognition/cognition-system");
const { getAgentPerceptions } = await import("../../cognition/agent-mind");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { createDaemonRegistry, createDaemonForAgent, collectAgentState, whisperToAgent, whisperChallenge } = await import("../agent-daemon");
function fixture(kind: "guidance" | "challenge", started = true) {
  const world = createArgosWorld("Independent whisper"); initializePrefabs(world); if (started) startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Hall" }), other = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "My own priorities.", roomId: room });
  addComponent(world, actor, Health); Health.current[actor] = kind === "guidance" ? 20 : 90; Mind.arousal[actor] = 0.55;
  createPersonalIntention(world, actor, "Repair the lamp", 5);
  const registry = createDaemonRegistry(0), daemon = createDaemonForAgent(registry, world, actor)!;
  const observation = { agentName: "Mara", currentState: collectAgentState(world, actor)!, previousState: null,
    concerns: kind === "guidance" ? [{ type: "danger" as const, severity: "medium" as const, description: "Mara is injured." }] : [],
    growthOpportunities: kind === "challenge" ? [{ type: "ready_for_challenge" as const, description: "Mara is well enough to consider her plan.", urgency: "medium" as const, suggestedChallenge: "" }] : [],
    achievements: [], timestamp: Date.now() };
  const run = () => kind === "guidance" ? whisperToAgent(world, daemon, observation, true, registry) : whisperChallenge(world, daemon, observation, registry, true);
  return { world, actor, room, other, registry, daemon, observation, run };
}
beforeEach(() => { generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["guidance", "challenge"] as const)("%s establishes an initial epoch before inference, so mailbox admission retains current advice", async kind => {
  const f = fixture(kind, false); expect(getCommittedEvents(f.world).sourceId).toBeNull();
  let complete!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = f.run(), source = getCommittedEvents(f.world).sourceId;
  complete({ text: "Would a closer look help?" }); const result = await pending;
  expect(source).not.toBeNull(); expect(result).not.toBeNull();
  expect(getCommittedEvents(f.world).sourceId).toBe(source);
  expect(drainPendingStimuli(undefined, f.world)).toMatchObject([{ targetEid: f.actor, content: "Would a closer look help?" }]);
  expect(f.daemon.whisperCount).toBe(1);
});

test.each(["guidance", "challenge"] as const)("%s never restarts a stopped source while capturing a whisper", async kind => {
  const f = fixture(kind, false); stopCommittedEvents(f.world);
  const source = getCommittedEvents(f.world).sourceId;
  expect(await f.run()).toBeNull(); expect(generate).not.toHaveBeenCalled();
  expect(getCommittedEvents(f.world)).toMatchObject({ sourceId: source, stopped: true });
  expect(drainPendingStimuli(undefined, f.world)).toEqual([]); expect(f.daemon.whisperCount).toBe(0);
});

test.each(["guidance", "challenge"] as const)("%s dispatched before the first start cannot cross a stop/restart during inference", async kind => {
  const f = fixture(kind, false); let complete!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = f.run(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  complete({ text: "Old-source advice" }); expect(await pending).toBeNull();
  expect(drainPendingStimuli(undefined, f.world)).toEqual([]); expect(f.daemon.whisperCount).toBe(0);
});

test.each(["guidance", "challenge"] as const)("%s provider failure does not invent fallback guidance", async kind => {
  const f = fixture(kind); generate.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect(await f.run()).toBeNull(); expect(drainPendingStimuli()).toEqual([]); expect(f.daemon.whisperCount).toBe(0);
});

const changes = ["source", "owner", "persona", "room", "inactive", "removed", "condition", "daemon"] as const;
function change(f: ReturnType<typeof fixture>, kind: typeof changes[number], channel: string) {
  if (kind === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (kind === "persona") Agent.systemPrompt[f.actor] = "Another person.";
  if (kind === "room") setLocatedIn(f.world, f.actor, f.other);
  if (kind === "inactive") Agent.active[f.actor] = false;
  if (kind === "removed") removeEntity(f.world, f.actor);
  if (kind === "condition") Health.current[f.actor] = channel === "guidance" ? 100 : 10;
  if (kind === "daemon") f.registry.daemons.set(f.actor, { ...f.daemon });
}
describe.each(["guidance", "challenge"] as const)("%s", channel => {
  test.each(changes)("%s change during inference invalidates the whisper", async kind => {
    const f = fixture(channel); let complete!: (value: { text: string }) => void;
    generate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.run(); change(f, kind, channel); complete({ text: "Would a moment to rest help?" });
    expect(await pending).toBeNull(); expect(drainPendingStimuli()).toEqual([]); expect(f.daemon.whisperCount).toBe(0);
  });
  test.each(changes)("%s change before stimulus intake discards queued advice", async kind => {
    const f = fixture(channel); generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" });
    expect(await f.run()).not.toBeNull(); change(f, kind, channel);
    expect(drainPendingStimuli()).toEqual([]);
  });
  test("current evidence delivers without executing a physical action", async () => {
    const f = fixture(channel), health = Health.current[f.actor]; generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" });
    expect(await f.run()).not.toBeNull(); expect(drainPendingStimuli()).toHaveLength(1);
    expect(Health.current[f.actor]).toBe(health);
  });
  test.each([false, true])("foreground intake respects validity (changed=%s)", async changed => {
    const f = fixture(channel); generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" }); await f.run();
    if (changed) change(f, "condition", channel);
    runActorControlStep(f.world, f.actor, createSystemRegistry(), { deliberating: true });
    expect(getAgentPerceptions(f.world, f.actor)).toHaveLength(changed ? 0 : 1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

test("normalization, pagination requeue and peek copies preserve the validity guard", async () => {
  const f = fixture("guidance"); generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" }); await f.run();
  const [row] = drainPendingStimuli(new Set([f.actor]), f.world); queueStimulus(normalizeSensoryEvent(row));
  expect(peekPendingStimuli(f.actor, f.world)).toHaveLength(1);
  const [copy] = peekPendingStimuli(f.actor, f.world);
  Health.current[f.actor] = 100; queueStimulus(copy);
  expect(peekPendingStimuli(f.actor, f.world)).toEqual([]); expect(drainPendingStimuli()).toEqual([]);
});

test("another world's dequeue cannot consume a valid guarded stimulus", async () => {
  const f = fixture("guidance"); generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" }); await f.run();
  const otherWorld = createArgosWorld("Separate world");
  expect(drainPendingStimuli(new Set([f.actor]), otherWorld)).toEqual([]);
  expect(drainPendingStimuli(new Set([f.actor]), f.world)).toHaveLength(1);
});

test("unrelated arousal movement does not invalidate continuing injury guidance", async () => {
  const f = fixture("guidance"); generate.mockResolvedValueOnce({ text: "Would a moment to rest help?" }); await f.run();
  Mind.arousal[f.actor] = 0.6;
  expect(drainPendingStimuli()).toHaveLength(1);
});

test("a late older whisper cannot supersede a newer accepted one", async () => {
  const f = fixture("guidance"); let complete!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const older = f.run(); generate.mockResolvedValueOnce({ text: "The newer possibility." }); await f.run();
  complete({ text: "The older possibility." }); expect(await older).toBeNull();
  expect(drainPendingStimuli().map(row => row.content)).toEqual(["The newer possibility."]);
});
