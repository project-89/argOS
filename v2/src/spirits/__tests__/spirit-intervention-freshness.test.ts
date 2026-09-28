import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createEntityRegistry, createEcsTools } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit, sendMessage } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { Agent, Description, Mind, Name, ObjectState, Perception, PhysicalObject, WorkingMemoryIdentity } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createDaemonRegistry, createDaemonForAgent, processPendingNudges, runDaemonSystem } = await import("../agent-daemon");
const { getAgentPerceptions } = await import("../../cognition/agent-mind");
const { setNudgeDaemonRegistry } = await import("../../nle/npc-nudge");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { addComponent, addEntity, removeComponent, removeEntity } = await import("bitecs");

function fixture() {
  const world = createArgosWorld("Delayed spirit advice"); initializePrefabs(world); startCommittedEvents(world);
  const entities = createEntityRegistry(), ecs = createEcsTools(world, entities);
  const room = ecs.createRoom({ name: "Hall" }).result.entityId;
  const otherRoom = ecs.createRoom({ name: "Study" }).result.entityId;
  const actor = ecs.createAgent({ name: "Mara", role: "resident", systemPrompt: "My own priorities.", roomName: "Hall" }).result.entityId;
  const peer = ecs.createAgent({ name: "Sam", role: "resident", systemPrompt: "A separate person.", roomName: "Study" }).result.entityId;
  const prop = addEntity(world);
  for (const component of [Name, PhysicalObject, ObjectState, Description]) addComponent(world, prop, component);
  Name.value[prop] = "Irrigation tap"; ObjectState.current[prop] = "open"; Description.value[prop] = "Water level: 1 litre";
  setLocatedIn(world, prop, room);
  const spirits = createSpiritRegistry(world);
  const spirit = createSpirit(spirits, { name: "Observer", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Observe actual events.", observationInterval: 1000, canInjectEvents: true });
  const daemons = createDaemonRegistry(0), daemon = createDaemonForAgent(daemons, world, actor)!;
  setNudgeDaemonRegistry(world, daemons); advanceSimulationTime(world, 1, 1000);
  let resolve!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const run = () => runSpiritCognition(spirit, world, entities, spirits);
  const evidence = () => JSON.parse(generate.mock.calls.at(-1)![0].prompt.match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]) as { records: { id: string; kind: string; subject: string; value: unknown }[] };
  const ids = (kind = "actor_presence", subject = "Mara") => evidence().records.filter(record => record.kind === kind && record.subject === subject).map(record => record.id);
  const complete = (response: unknown = { narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Would inspecting the controls help?", reason: "A possibility, not an obligation.", evidenceIds: ids() }] }) => resolve({ text: JSON.stringify(response) });
  return { world, ecs, entities, spirits, spirit, room, otherRoom, actor, peer, prop, daemon, daemons, run, complete, evidence, ids };
}

beforeEach(() => { generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live inference in freshness tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("current advice uses the guarded daemon channel, not an unbound stimulus", async () => {
  const f = fixture(), pending = f.run(); f.complete(); const output = await pending;
  expect(drainPendingStimuli()).toEqual([]);
  expect(output.interventions[0].result).toBe("accepted");
  expect(f.daemon.pendingNudges).toHaveLength(1);
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
});

const changes = ["owner", "persona", "name", "inactive", "removed", "room", "roomOwner", "source", "stopped", "rewind", "invalidClock", "producer", "producerPrompt", "ambiguous"] as const;
function change(f: ReturnType<typeof fixture>, kind: typeof changes[number]) {
  if (kind === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (kind === "persona") Agent.systemPrompt[f.actor] = "A different person.";
  if (kind === "name") Name.value[f.actor] = "Renamed";
  if (kind === "inactive") Agent.active[f.actor] = false;
  if (kind === "removed") removeEntity(f.world, f.actor);
  if (kind === "room") setLocatedIn(f.world, f.actor, f.otherRoom);
  if (kind === "roomOwner") WorkingMemoryIdentity.id[f.room] = "replacement-room";
  if (kind === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "stopped") stopCommittedEvents(f.world);
  if (kind === "rewind") f.world.time.elapsed = 0;
  if (kind === "invalidClock") f.world.time.elapsed = Number.NaN;
  if (kind === "producer") f.spirits.spirits.delete(f.spirit.eid);
  if (kind === "producerPrompt") f.spirit.definition.systemPrompt = "A different supervisor.";
  if (kind === "ambiguous") Name.value[f.peer] = "Mara";
}

test.each(changes)("%s change during inference rejects old advice", async kind => {
  const f = fixture(), pending = f.run(); change(f, kind); f.complete();
  const output = await pending;
  if (["source", "stopped", "rewind", "invalidClock", "producer", "producerPrompt"].includes(kind)) {
    expect(output.discarded).toBe("stale_cycle"); expect(output.interventions).toEqual([]);
  } else expect(output.interventions[0].result).toBe("stale_or_invalid_target");
  expect(drainPendingStimuli()).toEqual([]);
  expect(f.daemon.pendingNudges).toEqual([]);
});

test.each(["room", "source", "producer"] as const)("%s change after queueing invalidates delivery", async kind => {
  const f = fixture(), pending = f.run(); f.complete(); await pending;
  expect(f.daemon.pendingNudges).toHaveLength(1);
  change(f, kind);
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
  expect(f.daemon.pendingNudges).toEqual([]);
  expect(drainPendingStimuli()).toEqual([]);
});

test("unrelated actor movement does not invalidate current advice", async () => {
  const f = fixture(), pending = f.run(); setLocatedIn(f.world, f.peer, f.room);
  f.complete(); await pending;
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
  expect(drainPendingStimuli()).toEqual([]);
});

test("a same-name replacement cannot receive the original actor's advice", async () => {
  const f = fixture(), pending = f.run(); removeEntity(f.world, f.actor);
  f.ecs.createAgent({ name: "Mara", role: "visitor", systemPrompt: "Someone new.", roomName: "Hall" });
  f.complete(); const output = await pending;
  expect(output.interventions[0].result).toBe("stale_or_invalid_target");
  expect(drainPendingStimuli()).toEqual([]);
});

test("mood dispatch uses the captured actor, not a changed registry alias", async () => {
  const f = fixture(), pending = f.run(), peerArousal = Mind.arousal[f.peer];
  f.entities.byName.set("Mara", f.peer);
  f.complete({ intervention: { needed: true, type: "modify_mood", targetType: "agent", target: "Mara", content: "arousal: 0.75", evidenceIds: f.ids() } });
  await pending;
  expect(Mind.arousal[f.actor]).toBe(0.75);
  expect(Mind.arousal[f.peer]).toBe(peerArousal);
});

test("room dispatch uses the captured room, not a changed registry alias", async () => {
  const f = fixture(), pending = f.run();
  f.entities.byName.set("Hall", f.otherRoom);
  f.complete({ intervention: { needed: true, type: "inject_stimulus", targetType: "room", target: "Hall", content: "A floorboard creaks.", evidenceIds: f.ids("place", "Hall") } });
  await pending;
  const stimuli = drainPendingStimuli();
  expect(stimuli).toHaveLength(1);
  expect(stimuli[0].targetEid).toBe(f.actor);
});

function citeProp(f: ReturnType<typeof fixture>, kinds = ["object_state", "object_placement"]) {
  f.complete({ narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Could closing the irrigation tap help?",
    evidenceIds: kinds.flatMap(kind => f.ids(kind, "Irrigation tap")) }] });
}
const propChanges = ["state", "placement", "removed", "owner", "membership"] as const;
function changeProp(f: ReturnType<typeof fixture>, kind: typeof propChanges[number]) {
  if (kind === "state") ObjectState.current[f.prop] = "closed";
  if (kind === "placement") setLocatedIn(f.world, f.prop, f.otherRoom);
  if (kind === "removed") removeEntity(f.world, f.prop);
  if (kind === "owner") WorkingMemoryIdentity.id[f.prop] = "replacement-prop";
  if (kind === "membership") removeComponent(f.world, f.prop, ObjectState);
}

test.each(propChanges)("cited prop %s change while inference waits rejects the suggestion", async kind => {
  const f = fixture(), pending = f.run();
  changeProp(f, kind); citeProp(f);
  const output = await pending;
  expect(output.interventions[0].result).toBe("stale_or_invalid_evidence");
  expect(f.daemon.pendingNudges).toEqual([]);
});

test.each(propChanges)("cited prop %s change while daemon waits discards the suggestion", async kind => {
  const f = fixture(), pending = f.run(); citeProp(f); const output = await pending;
  expect(output.interventions[0].result).toBe("accepted");
  expect(f.daemon.pendingNudges).toHaveLength(1);
  changeProp(f, kind);
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
  expect(f.daemon.pendingNudges).toEqual([]);
});

test("uncited changing presentation does not invalidate a stable state observation", async () => {
  const f = fixture(), pending = f.run();
  Description.value[f.prop] = "Water level: 2 litres";
  citeProp(f); expect((await pending).interventions[0].result).toBe("accepted");
  Description.value[f.prop] = "Water level: 3 litres";
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
});

test("a cited description change does invalidate advice depending on that description", async () => {
  const f = fixture(), pending = f.run(); citeProp(f, ["object_description"]); await pending;
  Description.value[f.prop] = "Water level: 0 litres";
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
});

test("duplicate citations cannot authorize a suggestion", async () => {
  const f = fixture(), pending = f.run(), [id] = f.ids();
  f.complete({ narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Consider this", evidenceIds: [id, id] }] });
  expect((await pending).interventions[0].result).toBe("stale_or_invalid_evidence");
  expect(f.daemon.pendingNudges).toEqual([]);
});

test("unchanged observations are issued as new citations each cycle", async () => {
  const f = fixture(), pending = f.run(), oldIds = f.ids(); f.complete(); await pending;
  processPendingNudges(f.daemon, f.world);
  generate.mockResolvedValueOnce({ text: JSON.stringify({ narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Consider this", evidenceIds: oldIds }] }) });
  expect((await f.run()).interventions[0].result).toBe("stale_or_invalid_evidence");
  expect(f.daemon.pendingNudges).toEqual([]);
});

test("a newer inference does not cancel already accepted advice with unchanged evidence", async () => {
  const f = fixture(), pending = f.run(); citeProp(f); await pending;
  generate.mockResolvedValueOnce({ text: "{}" }); await f.run();
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
});

test.each([false, true])("actual daemon delivery honors cited evidence (changed=%s)", async changed => {
  const f = fixture(), pending = f.run(); citeProp(f); await pending;
  if (changed) ObjectState.current[f.prop] = "closed";
  const result = await runDaemonSystem(f.world, f.daemons);
  const perceptions = getAgentPerceptions(f.world, f.actor).map(id => Perception.content[id]);
  // The ordinary daemon can independently notice a goal-less actor and queue
  // its own guidance. Reject stale advice, not unrelated cognition.
  const ordinaryStimuli = drainPendingStimuli();
  expect(result.whispers).toBe((changed ? 0 : 1) + ordinaryStimuli.length);
  expect(ordinaryStimuli.every(stimulus => !stimulus.content.includes("irrigation tap"))).toBe(true);
  expect(f.daemon.pendingNudges).toEqual([]);
  expect(perceptions).toEqual(changed ? [] : [expect.stringContaining("Could closing the irrigation tap help?")]);
  expect(getAgentPerceptions(f.world, f.peer)).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(ObjectState.current[f.prop]).toBe(changed ? "closed" : "open");
});

test("a large observation catalog is bounded and states its omissions", async () => {
  const f = fixture();
  for (let i = 0; i < 210; i++) {
    const eid = addEntity(f.world); addComponent(f.world, eid, Name); addComponent(f.world, eid, PhysicalObject);
    Name.value[eid] = `Fixture ${i}`; setLocatedIn(f.world, eid, f.room);
  }
  const pending = f.run(), catalog = f.evidence() as ReturnType<typeof f.evidence> & { omittedRecords: number };
  expect(catalog.records).toHaveLength(192); expect(catalog.omittedRecords).toBeGreaterThan(0);
  f.complete(); expect((await pending).interventions[0].result).toBe("accepted");
});

test("returned model citation mutations cannot change an already queued evidence guard", async () => {
  const f = fixture(), pending = f.run(); citeProp(f); const output = await pending;
  (output.interventions[0].evidenceIds as string[]).splice(0, 8, ...f.ids());
  ObjectState.current[f.prop] = "closed";
  expect(processPendingNudges(f.daemon, f.world)).toEqual([]);
});

test("an attributed received report survives acknowledgement without becoming a physical fact", async () => {
  const f = fixture();
  sendMessage(f.spirits, f.spirit.eid, f.spirit.eid, "report", "A question", "A witness wondered whether maintenance was needed.", { priority: "normal" });
  const pending = f.run(), records = f.evidence().records.filter(row => row.kind === "attributed_report");
  expect(records).toHaveLength(1);
  expect(records[0].subject).toBe("Observer");
  expect(records[0].value).toContain("A witness wondered");
  f.complete({ narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Would investigating a reported concern fit your plans?", evidenceIds: [records[0].id] }] });
  expect((await pending).interventions[0].result).toBe("accepted");
  expect(f.spirit.inbox).toEqual([]);
  expect(processPendingNudges(f.daemon, f.world)).toHaveLength(1);
  expect(ObjectState.current[f.prop]).toBe("open");
});

test.each([undefined, [], ["invented-observation"], [42]])("unissued evidence %j cannot authorize a suggestion", async evidenceIds => {
  const f = fixture(), pending = f.run();
  f.complete({ narrativeDirectives: [{ type: "nudge_character", target: "Mara", action: "Inspect the controls", evidenceIds }] });
  const output = await pending;
  expect(output.interventions[0].result).toBe("stale_or_invalid_evidence");
  expect(f.daemon.pendingNudges).toEqual([]);
  expect(drainPendingStimuli()).toEqual([]);
});
