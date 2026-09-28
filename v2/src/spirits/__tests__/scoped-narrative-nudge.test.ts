import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { Agent, Name, Perception, WorkingMemoryIdentity, Goal } = await import("../../ecs/components");
const { getRoomForEntity } = await import("../../ecs/location");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, stopCommittedEvents, getCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { buildAgentContext, getAgentPerceptions, getAgentThoughts } = await import("../../cognition/agent-mind");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { registerAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { createDaemonRegistry, createDaemonForAgent, bindDaemonToWorld, queueNarrativeNudge, processPendingNudges, runDaemonSystem } = await import("../agent-daemon");
const { chronicle } = await import("../../cognition/simulation-chronicle");

function fixture() {
  const world = createArgosWorld("Scoped suggestions"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "I choose my own priorities.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "friend", systemPrompt: "A separate person.", roomId: room });
  const goal = createPersonalIntention(world, actor, "Decide what I want to do", 6)!;
  const registry = createDaemonRegistry(0), daemon = createDaemonForAgent(registry, world, actor)!;
  advanceSimulationTime(world, 1, 1_000);
  const nudge = { type: "reflect" as const, action: "Would a quiet moment help?", reason: "An option, not an outcome", source: "narrator" as const, priority: "normal" as const };
  const queue = (action = nudge.action) => queueNarrativeNudge(registry, "Ada", { ...nudge, action }, { world, agentEid: actor });
  const perceptions = () => getAgentPerceptions(world, actor).map(eid => ({ type: Perception.type[eid], content: Perception.content[eid] }));
  return { world, room, actor, peer, goal, registry, daemon, nudge, queue, perceptions };
}
beforeEach(() => {
  generate.mockReset().mockResolvedValue({ text: "" }); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider calls in nudge regressions"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("a scoped receipt converts once without executing a goal, speech or movement", () => {
  const f = fixture(); expect(f.queue()).toBe(true);
  const row = f.daemon.pendingNudges[0]; expect(row.id).toMatch(/^scoped-nudge:/);
  expect(Object.isFrozen(row)).toBe(true);
  expect(processPendingNudges(f.daemon, f.world)).toMatchObject([{ agentEid: f.actor, content: `A question worth considering: ${f.nudge.action}` }]);
  f.daemon.pendingNudges.push(row);
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]); expect(f.daemon.pendingNudges).toEqual([]);
  expect(f.perceptions()).toEqual([]); expect(getAgentThoughts(f.world, f.actor)).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active"); expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
  expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("copied, altered and fabricated scoped rows are discarded, not downgraded to legacy", () => {
  const f = fixture(); f.queue(); const original = f.daemon.pendingNudges[0];
  f.daemon.pendingNudges = [JSON.parse(JSON.stringify(original)), { ...original, action: "Changed command", priority: "high" },
    { ...original, id: "scoped-nudge:invented", priority: "high" }, original, original];
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
  expect(f.daemon.pendingNudges).toEqual([]);
});

test.each(["owner", "persona", "name", "source", "stopped", "inactive", "daemonInactive", "removed", "daemonReplacement", "world", "rewind", "invalidClock"])("%s invalidates queued scope without a whisper", change => {
  const f = fixture(); f.queue(); let world = f.world, daemon = f.daemon;
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement-owner";
  if (change === "persona") Agent.systemPrompt[f.actor] = "A replacement identity";
  if (change === "name") Name.value[f.actor] = "Another person";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "stopped") stopCommittedEvents(f.world);
  if (change === "inactive") Agent.active[f.actor] = false;
  if (change === "daemonInactive") f.daemon.active = false;
  if (change === "removed") f.registry.daemons.delete(f.actor);
  if (change === "daemonReplacement") { daemon = { ...f.daemon }; bindDaemonToWorld(daemon, f.world); f.registry.daemons.set(f.actor, daemon); }
  if (change === "world") world = createArgosWorld("Other source");
  if (change === "rewind") f.world.time.elapsed = 0;
  if (change === "invalidClock") f.world.time.elapsed = Number.POSITIVE_INFINITY;
  expect(processPendingNudges(daemon, world)).toEqual([]); expect(daemon.pendingNudges).toEqual([]);
  expect(f.perceptions()).toEqual([]);
});

test("scoped issuance rejects mismatched world/actor/name, ambiguous daemon registration and stopped source", () => {
  const f = fixture(), scope = { world: f.world, agentEid: f.actor };
  expect(queueNarrativeNudge(f.registry, "Bo", f.nudge, scope)).toBe(false);
  expect(queueNarrativeNudge(f.registry, "Ada", f.nudge, { ...scope, agentEid: f.peer })).toBe(false);
  expect(queueNarrativeNudge(f.registry, "Ada", f.nudge, { ...scope, world: createArgosWorld() })).toBe(false);
  const peerDaemon = createDaemonForAgent(f.registry, f.world, f.peer)!;
  peerDaemon.agentName = "Ada"; expect(f.queue()).toBe(false); peerDaemon.agentName = "Bo";
  stopCommittedEvents(f.world); expect(f.queue()).toBe(false); expect(f.daemon.pendingNudges).toEqual([]);
});

test("native daemon cycle delivers a scoped suggestion exactly once to actual private perception without a model call", async () => {
  const f = fixture(); f.queue();
  const result = await runDaemonSystem(f.world, f.registry);
  expect(result.whispers).toBe(1); expect(f.daemon.whisperCount).toBe(1); expect(generate).not.toHaveBeenCalled();
  expect(f.perceptions()).toEqual([{ type: "daemon_whisper", content: `A question worth considering: ${f.nudge.action}` }]);
  expect(getAgentPerceptions(f.world, f.peer)).toEqual([]); expect(drainPendingStimuli()).toEqual([]);
  await runDaemonSystem(f.world, f.registry);
  expect(f.perceptions()).toHaveLength(1); expect(f.daemon.pendingNudges).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room); expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("already evaluated advice reaches private cognition without waiting for another slow daemon observation", async () => {
  const f = fixture(); f.registry.observationInterval = 30_000; f.daemon.lastObservation = Date.now();
  f.queue("Consider looking outside if that suits your plans.");
  const result = await runDaemonSystem(f.world, f.registry);
  expect(result).toMatchObject({ observations: 0, whispers: 1 });
  expect(f.perceptions()).toEqual([{ type: "daemon_whisper", content: "A question worth considering: Consider looking outside if that suits your plans." }]);
  expect(buildAgentContext(f.world, f.actor)).toContain("A question worth considering: Consider looking outside if that suits your plans.");
  expect(buildAgentContext(f.world, f.peer)).not.toContain("Consider looking outside");
  expect(generate).not.toHaveBeenCalled(); expect(drainPendingStimuli()).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room); expect(getCommittedEvents(f.world).events).toEqual([]);
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(0);
  expect(f.perceptions()).toHaveLength(1);
});

test("fast advice transport retains the ordinary simulated cooldown without accelerating observations", async () => {
  const f = fixture(); jest.spyOn(Date, "now").mockReturnValue(Date.now());
  f.registry.observationInterval = 30_000; f.registry.whisperCooldown = 45_000; f.daemon.lastObservation = Date.now();
  f.queue("First option"); expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(1);
  f.queue("Second option"); expect((await runDaemonSystem(f.world, f.registry))).toMatchObject({ observations: 0, whispers: 0 });
  expect(f.daemon.pendingNudges).toHaveLength(1); expect(f.perceptions()).toHaveLength(1);
  advanceSimulationTime(f.world, 2, 44_999);
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(0);
  advanceSimulationTime(f.world, 3, 1);
  expect((await runDaemonSystem(f.world, f.registry))).toMatchObject({ observations: 0, whispers: 1 });
  expect(f.perceptions()).toHaveLength(2); expect(generate).not.toHaveBeenCalled();
});

test("lifecycle diagnostics distinguish queued, converted and delivered without promoting advice into public facts", async () => {
  const f = fixture(); f.registry.observationInterval = 30_000; f.daemon.lastObservation = Date.now();
  f.queue("PRIVATE_OPTION_BODY"); const nudge = f.daemon.pendingNudges[0];
  const diagnostics = () => chronicle.getByType("narrative_nudge_lifecycle").filter(event => event.data.nudgeId === nudge.id);
  expect(diagnostics().map(event => event.data.stage)).toEqual(["queued"]);
  await runDaemonSystem(f.world, f.registry);
  expect(diagnostics().map(event => event.data.stage)).toEqual(["queued", "converted", "perception_delivered"]);
  expect(diagnostics().at(-1)!.data).toMatchObject({ sourceId: getCommittedEvents(f.world).sourceId,
    actorKey: WorkingMemoryIdentity.id[f.actor], route: "daemon", issuedAtSimMs: 1000, atSimMs: 1000,
    perceptionEid: getAgentPerceptions(f.world, f.actor)[0] });
  expect(JSON.stringify(diagnostics())).not.toContain("PRIVATE_OPTION_BODY");
  f.daemon.pendingNudges.push(nudge); await runDaemonSystem(f.world, f.registry);
  expect(diagnostics()).toHaveLength(3); expect(getCommittedEvents(f.world).events).toEqual([]);
});

test.each(["stale-evidence", "source-stop"])("%s before a fresh observation drops queued advice with an explicit terminal diagnostic", async change => {
  const f = fixture(); f.registry.observationInterval = 30_000; f.daemon.lastObservation = Date.now();
  let valid = true;
  queueNarrativeNudge(f.registry, "Ada", f.nudge, { world: f.world, agentEid: f.actor, isCurrent: () => valid });
  const nudge = f.daemon.pendingNudges[0];
  if (change === "stale-evidence") valid = false;
  else stopCommittedEvents(f.world);
  await runDaemonSystem(f.world, f.registry);
  const diagnostics = chronicle.getByType("narrative_nudge_lifecycle").filter(event => event.data.nudgeId === nudge.id);
  expect(diagnostics.map(event => event.data.stage)).toEqual(["queued", "dropped"]);
  expect(f.perceptions()).toEqual([]); expect(f.daemon.pendingNudges).toEqual([]); expect(generate).not.toHaveBeenCalled();
});

test.each(["source-stop", "identity-change"])("%s from a diagnostic listener cannot invalidate a scope between its check and perception commit", async change => {
  const f = fixture(); f.registry.observationInterval = 30_000; f.daemon.lastObservation = Date.now();
  f.queue("First option"); f.queue("Second option");
  const first = f.daemon.pendingNudges[0];
  let countAtDiagnostic = -1;
  const unsubscribe = chronicle.subscribe(event => {
    if (event.type !== "narrative_nudge_lifecycle" || event.data.nudgeId !== first.id || event.data.stage !== "converted") return;
    countAtDiagnostic = f.perceptions().length;
    if (change === "source-stop") stopCommittedEvents(f.world);
    else WorkingMemoryIdentity.id[f.actor] = "replacement-owner";
  });
  try { await runDaemonSystem(f.world, f.registry); } finally { unsubscribe(); }
  expect(countAtDiagnostic).toBe(1); // Diagnostics run after this native private perception committed.
  expect(f.perceptions()).toHaveLength(1);
  expect(f.perceptions()[0].content).toContain("First option");
  expect(f.daemon.pendingNudges).toEqual([]); expect(generate).not.toHaveBeenCalled();
});

test("cancellation by a diagnostic listener prevents further admission but does not erase the already committed perception", async () => {
  const f = fixture(); f.registry.observationInterval = 30_000; f.daemon.lastObservation = Date.now();
  f.queue("First option"); f.queue("Second option");
  const first = f.daemon.pendingNudges[0], controller = new AbortController();
  let countAtDiagnostic = -1;
  const unsubscribe = chronicle.subscribe(event => {
    if (event.type !== "narrative_nudge_lifecycle" || event.data.nudgeId !== first.id || event.data.stage !== "converted") return;
    countAtDiagnostic = f.perceptions().length; controller.abort();
  });
  try { await expect(withSimulationTask(controller.signal, () => runDaemonSystem(f.world, f.registry))).rejects.toThrow(); }
  finally { unsubscribe(); }
  expect(countAtDiagnostic).toBe(1); expect(f.perceptions()).toHaveLength(1);
  expect(f.perceptions()[0].content).toContain("First option"); expect(generate).not.toHaveBeenCalled();
  expect(chronicle.getByType("narrative_nudge_lifecycle").filter(event => event.data.nudgeId === first.id)
    .map(event => event.data.stage)).toEqual(["queued", "converted", "perception_delivered"]);
});

test("native delivery preserves legacy backlog and ordinary cooldown while admitting at most two eligible scoped suggestions", async () => {
  const f = fixture();
  queueNarrativeNudge(f.registry, "Ada", { ...f.nudge, action: "LEGACY BACKLOG", priority: "high" });
  queueNarrativeNudge(f.registry, "Ada", { ...f.nudge, type: "escalate", priority: "high" }, { world: f.world, agentEid: f.actor });
  f.daemon.narrativeConstraints!.allowConflict = false;
  f.queue("First option"); f.queue("Second option"); f.queue("Third option");
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(2);
  expect(f.perceptions()).toHaveLength(2); expect(f.perceptions().some(p => p.content.includes("LEGACY"))).toBe(false);
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(0);
  expect(f.daemon.pendingNudges.map(n => n.action)).toContain("Third option");
  advanceSimulationTime(f.world, 2, f.registry.whisperCooldown);
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(1);
  expect(f.perceptions()).toHaveLength(3);
  expect(f.daemon.pendingNudges).toHaveLength(2); // blocked scoped + explicit legacy
});

test.each(["owner", "source", "registry"])("native cycle rejects stale %s scoped delivery", async change => {
  const f = fixture(); f.queue(); let registry = f.registry;
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "new-owner";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "registry") { registry = createDaemonRegistry(0); registry.daemons.set(f.actor, f.daemon); }
  await runDaemonSystem(f.world, registry);
  expect(f.perceptions()).toEqual([]); expect(f.daemon.pendingNudges).toEqual([]);
});

test("source stopping during first admission prevents a second suggestion in the same cycle", async () => {
  const f = fixture(); f.queue("First option"); f.queue("Second option");
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    onPerception: () => stopCommittedEvents(f.world) });
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(1);
  expect(f.perceptions()).toHaveLength(1); expect(f.daemon.pendingNudges).toEqual([]); expect(generate).not.toHaveBeenCalled();
});

test("canceled work cannot queue, discard, consume or deliver pending scope", async () => {
  const f = fixture(); f.queue(); const before = [...f.daemon.pendingNudges];
  const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => f.queue("Canceled option")).toThrow();
    expect(() => processPendingNudges(f.daemon, f.world)).toThrow();
    await expect(runDaemonSystem(f.world, f.registry)).rejects.toThrow();
  });
  expect(f.daemon.pendingNudges).toEqual(before); expect(f.perceptions()).toEqual([]);
});

test("legacy unscoped helper remains explicitly compatible without obtaining scoped authority", () => {
  const f = fixture();
  expect(queueNarrativeNudge(f.registry, "Ada", f.nudge)).toBe(true);
  expect(f.daemon.pendingNudges[0].id).toMatch(/^nudge_/);
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
});

test.each(["revoked", "throws"])("a %s trusted validity guard denies issuance and later consumption without becoming serialized authority", change => {
  const f = fixture(); let valid = true;
  const isCurrent = () => { if (valid) return true; if (change === "throws") throw new Error("Expired evidence"); return false; };
  const scope = { world: f.world, agentEid: f.actor, isCurrent };
  expect(queueNarrativeNudge(f.registry, "Ada", f.nudge, scope)).toBe(true);
  expect(JSON.parse(JSON.stringify(f.daemon.pendingNudges[0]))).not.toHaveProperty("isCurrent");
  valid = false;
  expect(queueNarrativeNudge(f.registry, "Ada", f.nudge, scope)).toBe(false);
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
  expect(f.daemon.pendingNudges).toEqual([]); expect(f.perceptions()).toEqual([]);
});

test("a suggestion held by cooldown cannot deliver after its captured circumstances change", async () => {
  const f = fixture(); f.queue("An earlier valid suggestion");
  await runDaemonSystem(f.world, f.registry);
  let valid = true;
  expect(queueNarrativeNudge(f.registry, "Ada", { ...f.nudge, action: "The now-obsolete option" },
    { world: f.world, agentEid: f.actor, isCurrent: () => valid })).toBe(true);
  expect((await runDaemonSystem(f.world, f.registry)).whispers).toBe(0);
  expect(f.daemon.pendingNudges).toHaveLength(1);
  valid = false; advanceSimulationTime(f.world, 2, f.registry.whisperCooldown);
  await runDaemonSystem(f.world, f.registry);
  expect(f.daemon.pendingNudges).toEqual([]); expect(f.perceptions()).toHaveLength(1);
  expect(f.perceptions()[0].content).not.toContain("obsolete");
});
