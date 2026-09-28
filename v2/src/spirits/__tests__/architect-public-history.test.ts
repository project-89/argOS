import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, getPendingProposals, resetFactoryState } = await import("../spirit-factory");
const { runArchitectCognition, gatherArchitectContext, validateObservedNeeds } = await import("../architect-spirit");
const { captureSpiritPublicEventReview, getSpiritPublicEventReviewStatus, recordSpiritPublicEnvironmentReceipt } = await import("../spirit-public-event-review");
const { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { setSpiritRegistryActive } = await import("../spirit-cycle-scope");
const { isCurrentSpiritMessage } = await import("../spirit-message-delivery");

function fixture(label = "Town") {
  const world = createArgosWorld(label); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 1000);
  const room = createRoomEntity(world, { name: `${label} square` });
  const actor = createAgentEntity(world, { name: `${label} resident`, role: "neighbor", systemPrompt: "PRIVATE_BACKSTORY", roomId: room });
  const systems = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const superior = createDynamicSpirit(spirits, { name: "Growth observer", type: "watcher", rank: "archangel", domain: "ecology" })!;
  const createWeaver = (name: string) => createDynamicSpirit(spirits, { name, type: "architect", rank: "archangel", domain: "ecology", superiorEid: superior.eid,
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false,
      canProposeRules: false, canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  const weaver = createWeaver("The Weaver");
  const receipt = (id: string) => publishCommittedEvent(world,
    { executionId: id, kind: "action", action: "interact", actorId: actor, roomId: room, status: "succeeded" });
  const say = (id: string, text: string) => publishCommittedEvent(world,
    { executionId: id, kind: "speech", action: "speak", actorId: actor, roomId: room, status: "succeeded", text });
  const run = (owner = weaver) => runArchitectCognition(world, systems, spirits, owner);
  const report = () => superior.inbox.filter(row => row.subject === "World activity reviewed").at(-1);
  return { world, room, actor, systems, spirits, superior, weaver, createWeaver, receipt, say, run, report };
}
const prompt = () => generate.mock.calls.at(-1)![0].prompt as string;
const history = () => JSON.parse(prompt().split("PUBLIC_ACTIVITY_HISTORY (historical, read-only, not construction evidence):\n")[1]?.split("\n")[0] ?? "null");
const fresh = () => JSON.parse(prompt().split("- Recent observed events: ")[1].split("\n")[0]);
async function dispatched() { for (let n = 0; n < 10; n++) await Promise.resolve(); }
beforeEach(() => {
  resetFactoryState(); generate.mockReset().mockResolvedValue({ text: "[]" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Architect history tests must remain offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a sixty-second review retains old native outcomes without renewing construction citations", async () => {
  const f = fixture(), event = f.receipt("old use");
  recordSpiritPublicEnvironmentReceipt(f.world, { id: "wet:1", roomId: f.room, atSimMs: 1000, detail: "A chair became wet." });
  advanceSimulationTime(f.world, 2, 60_000);
  await f.run();
  expect(history()?.records[0].receiptIds).toEqual([event.id]);
  expect(history().environment.receipts[0].id).toBe("wet:1");
  expect(fresh()).toEqual([]);
  expect(prompt()).not.toContain("PRIVATE_BACKSTORY");
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toMatchObject({ accepted: true,
    acknowledgedThroughSequence: event.sequence, acknowledgedEnvironmentThroughSequence: 1 });
  expect(f.report()?.data?.publicActivityHistory).toEqual(history());
  expect(f.report()?.data?.recentEvents).toEqual([]);
  expect(f.report()?.content).toContain("Construction is not proof of use");
  await f.run(); expect(history().records).toEqual([]); expect(history().environment.receipts).toEqual([]);
});

test("historical IDs cannot be cited as event refs or new construction authority", async () => {
  const f = fixture(), old = f.receipt("not current"); advanceSimulationTime(f.world, 2, 60_000);
  generate.mockResolvedValueOnce({ text: JSON.stringify([{ type: "entity", description: "An extra chair", priority: "high",
    rationale: "Old use", evidence: ["event:0"], expectedChange: "More seats" }]) });
  expect(await f.run()).toEqual([]); expect(getPendingProposals()).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(1); expect(history()?.records[0].receiptIds).toEqual([old.id]);
  const context = await gatherArchitectContext(f.world, f.systems);
  for (const ref of [old.id, "history:0", "publicActivityHistory:0", "event:0"])
    expect(validateObservedNeeds([{ type: "entity", description: "A chair", priority: "high", rationale: "Old use",
      evidence: [ref], expectedChange: "A seat" }], context)).toEqual([]);
  const current = f.receipt("current use"); await f.run();
  expect(fresh()).toEqual([expect.objectContaining({ ref: "event:0", event: expect.objectContaining({ id: current.id }) })]);
});

test.each(["provider", "parse", "non-array"])("%s failure does not consume evidence; valid empty needs acknowledge it", async failure => {
  const f = fixture(), event = f.receipt("retry"), next = { text: failure === "parse" ? "not json" : "{}" };
  if (failure === "provider") generate.mockRejectedValueOnce(Error("Offline provider failure"));
  else generate.mockResolvedValueOnce(next);
  await f.run();
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toMatchObject({ accepted: false, acknowledgedThroughSequence: 0 });
  expect(f.report()).toBeUndefined();
  await f.run(); expect(history()?.records[0].receiptIds).toEqual([event.id]);
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)?.acknowledgedThroughSequence).toBe(event.sequence);
});

test("events arriving during inference remain pending after its captured high-water mark", async () => {
  const f = fixture(), before = f.receipt("before"); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(); await dispatched(); expect(history()?.records[0].receiptIds).toEqual([before.id]);
  const during = f.receipt("during"); release({ text: "[]" }); await pending;
  await f.run(); expect(history().records.flatMap((row: any) => row.receiptIds)).toEqual([during.id]);
});

test.each(["stop", "restart", "replacement", "definition", "registry-restart", "rewind"])("%s while awaiting needs cannot acknowledge or report", async change => {
  const f = fixture(); f.receipt("pending"); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(); await dispatched();
  if (change === "stop" || change === "restart") stopCommittedEvents(f.world);
  if (change === "restart") startCommittedEvents(f.world);
  if (change === "replacement") f.spirits.spirits.set(f.weaver.eid, { ...f.weaver });
  if (change === "definition") f.weaver.definition.systemPrompt = "Changed policy";
  if (change === "registry-restart") { setSpiritRegistryActive(f.spirits, false); setSpiritRegistryActive(f.spirits, true); }
  if (change === "rewind") f.world.time.elapsed = 0;
  release({ text: "[]" }); await pending;
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toBeUndefined(); expect(f.report()).toBeUndefined();
});

test("overlapping cycles cannot acknowledge or overwrite a newer review", async () => {
  const f = fixture(); f.receipt("before"); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = f.run(); await dispatched(); const latest = f.receipt("latest"); await f.run();
  const status = getSpiritPublicEventReviewStatus(f.world, f.weaver);
  expect(status?.acknowledgedThroughSequence).toBe(latest.sequence);
  release({ text: "[]" }); await old;
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toEqual(status);
});

test("a superseded history capture cannot report unacknowledged historical review", async () => {
  const f = fixture(); f.receipt("pending"); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(); await dispatched();
  captureSpiritPublicEventReview(f.world, f.weaver, f.spirits, () => true);
  release({ text: "[]" }); await pending;
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toBeUndefined(); expect(f.report()).toBeUndefined();
});

test("history reports keep the existing thirty-second delivery expiry and source binding", async () => {
  const f = fixture(); f.receipt("old use"); advanceSimulationTime(f.world, 2, 60_000); await f.run();
  const report = f.report()!;
  expect(isCurrentSpiritMessage(f.spirits, report, f.superior.eid)).toBe(true);
  advanceSimulationTime(f.world, 3, 30_001);
  expect(isCurrentSpiritMessage(f.spirits, report, f.superior.eid)).toBe(false);
  f.receipt("new use"); await f.run(); const currentReport = f.report()!;
  expect(isCurrentSpiritMessage(f.spirits, currentReport, f.superior.eid)).toBe(true);
  stopCommittedEvents(f.world);
  expect(isCurrentSpiritMessage(f.spirits, currentReport, f.superior.eid)).toBe(false);
});

test("a slow accepted read may acknowledge history but cannot issue an expired feedback report", async () => {
  const f = fixture(), event = f.receipt("reviewed"); let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(); await dispatched(); advanceSimulationTime(f.world, 2, 30_001);
  release({ text: "[]" }); await pending;
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)).toMatchObject({ accepted: true, acknowledgedThroughSequence: event.sequence });
  expect(f.report()).toBeUndefined();
});

test("world and spirit cursors are independent and restart forgets the previous source", async () => {
  const a = fixture("A"), b = fixture("B"), ea = a.receipt("A"), eb = b.receipt("B");
  await a.run(); await b.run(); expect(history().records[0].receiptIds).toEqual([eb.id]);
  expect(JSON.stringify(history())).not.toContain(ea.id);
  await a.run(a.createWeaver("Other architect")); expect(history().records[0].receiptIds).toEqual([ea.id]);
  stopCommittedEvents(a.world); startCommittedEvents(a.world); const restarted = a.receipt("new source"); await a.run();
  expect(history().afterSequence).toBe(0); expect(history().records[0].receiptIds).toEqual([restarted.id]);
});

test("speech grouping preserves physical feedback and reports exact represented IDs and omissions", async () => {
  const f = fixture(), physical = f.receipt("physical use");
  for (let n = 0; n < 400; n++) f.say("long speech", `word ${n}`);
  await f.run(); const input = history();
  expect(input?.records).toHaveLength(2); expect(input.records[0].receiptIds).toEqual([physical.id]);
  expect(input.records[1]).toMatchObject({ receiptCount: 400, receiptIdsOmitted: 392 });
  expect(input.records[1].spokenCharactersOmitted).toBeGreaterThan(0);
  expect(f.report()?.data?.publicActivityHistory).toEqual(input);
  expect(fresh().some((row: any) => row.event.id === physical.id)).toBe(false);
  expect(getSpiritPublicEventReviewStatus(f.world, f.weaver)?.receiptIdsOmitted).toBe(392);
});

test("bounded overflow is explicit and not represented as a complete quiet history", async () => {
  const f = fixture(); for (let n = 0; n < 2050; n++) f.receipt(`receipt ${n}`);
  await f.run(); expect(history()).toMatchObject({ droppedBeforeWindow: 2, omittedRecords: 1984, omittedReceipts: 1984 });
  expect(history().records).toHaveLength(64);
  expect(f.report()?.data?.publicActivityHistory).toEqual(history());
});
