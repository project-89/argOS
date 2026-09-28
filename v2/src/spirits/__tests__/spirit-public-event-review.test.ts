import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createEntityRegistry, createEcsTools } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { setSpiritRegistryActive } = await import("../spirit-cycle-scope");
const { captureSpiritPublicEventReview, getSpiritPublicEventReviewStatus, recordSpiritPublicEnvironmentReceipt, getRecentSpiritEnvironmentOutcomes } = await import("../spirit-public-event-review");
const { runSpiritCognition } = await import("../spirit-cognition");
const { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { Name, WorkingMemoryIdentity } = await import("../../ecs/components");

function fixture(label = "Town") {
  const world = createArgosWorld(label); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 1000);
  const entities = createEntityRegistry(), ecs = createEcsTools(world, entities);
  const room = ecs.createRoom({ name: `${label} square` }).result.entityId;
  const actor = ecs.createAgent({ name: `${label} resident`, role: "neighbor", systemPrompt: "Private identity", roomName: `${label} square` }).result.entityId;
  const registry = createSpiritRegistry(world);
  // Receipt acknowledgement is shared by every spirit. A supervisory domain
  // shows the raw receipt JSON; the Narrator's readable summary is tested below.
  const definition = { name: "Public observer", domain: "social" as const, rank: "archangel" as const,
    model: "flash" as const, systemPrompt: "Observe actual events.", observationInterval: 1000 };
  const spirit = createSpirit(registry, definition), other = createSpirit(registry, { ...definition, name: "Other observer" });
  const receipt = (id: string, action = "interact", status: "pending" | "succeeded" | "failed" = "succeeded") =>
    publishCommittedEvent(world, { executionId: id, kind: "action", action, actorId: actor, roomId: room, status });
  const say = (id: string, text: string) => publishCommittedEvent(world,
    { executionId: id, kind: "speech", action: "speak", actorId: actor, roomId: room, status: "succeeded", text });
  const capture = (owner = spirit, current = () => true) => captureSpiritPublicEventReview(world, owner, registry, current);
  const run = () => runSpiritCognition(spirit, world, entities, registry);
  return { world, entities, room, actor, registry, spirit, other, receipt, say, capture, run };
}
const accepted = { accepted: true, interventions: [] };
const promptHistory = () => JSON.parse(generate.mock.calls.at(-1)![0].prompt.match(/COMMITTED_PUBLIC_EVENTS_SINCE_REVIEW:\n([^\n]+)/)![1]);
beforeEach(() => { generate.mockReset().mockResolvedValue({ text: "{}" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No live inference in public event review tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("each spirit acknowledges only its captured native receipts; later events remain pending", () => {
  const f = fixture(), first = f.receipt("first"), review = f.capture();
  const second = f.receipt("second"); expect(review.finish(accepted)).toBe(true);
  expect(f.capture().input.records.flatMap(row => row.receiptIds)).toEqual([second.id]);
  expect(f.capture(f.other).input.records.flatMap(row => row.receiptIds)).toEqual([first.id, second.id]);
});

test("read-only environmental feedback is isolated, bounded, expires and never supersedes reviews", () => {
  const f = fixture(), other = fixture("Other world");
  for (let n = 0; n < 35; n++) recordSpiritPublicEnvironmentReceipt(f.world,
    { id: `wet:${n}`, atSimMs: 1000, roomId: f.room, detail: "A seat is visibly wet." });
  const capture = f.capture(), snapshot = getRecentSpiritEnvironmentOutcomes(f.world);
  expect(snapshot.receipts).toHaveLength(32); expect(snapshot.omitted).toBe(3);
  expect(getRecentSpiritEnvironmentOutcomes(other.world).receipts).toEqual([]);
  (snapshot.receipts[0] as any).detail = "not native";
  expect(getRecentSpiritEnvironmentOutcomes(f.world).receipts[0].detail).toBe("A seat is visibly wet.");
  expect(capture.finish(accepted)).toBe(true);
  expect(getRecentSpiritEnvironmentOutcomes(f.world).receipts).toHaveLength(32);
  advanceSimulationTime(f.world, 2, 60_001);
  expect(getRecentSpiritEnvironmentOutcomes(f.world).receipts).toEqual([]);
  recordSpiritPublicEnvironmentReceipt(f.world, { id: "later", atSimMs: 61_001, roomId: f.room, detail: "Dry again." });
  stopCommittedEvents(f.world); expect(getRecentSpiritEnvironmentOutcomes(f.world).receipts).toEqual([]);
  startCommittedEvents(f.world); expect(getRecentSpiritEnvironmentOutcomes(f.world).receipts).toEqual([]);
});

test("a failed review retains its receipts and exposes failure without private output", () => {
  const f = fixture(), event = f.receipt("retry"), review = f.capture();
  expect(review.finish({ ...accepted, accepted: false })).toBe(true);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toMatchObject({ accepted: false,
    acknowledgedThroughSequence: 0, receiptIdsObserved: [event.id] });
  expect(f.capture().input.records[0].receiptIds).toEqual([event.id]);
});

test.each(["stop", "restart", "replacement", "definition", "registry-restart", "cycle-superseded", "rewind"])(
  "%s cannot acknowledge pending native evidence", change => {
    const f = fixture(); f.receipt("pending"); let current = true;
    const review = f.capture(f.spirit, () => current);
    if (change === "stop" || change === "restart") stopCommittedEvents(f.world);
    if (change === "restart") startCommittedEvents(f.world);
    if (change === "replacement") f.registry.spirits.set(f.spirit.eid, { ...f.spirit });
    if (change === "definition") f.spirit.definition.systemPrompt = "New interpretation policy";
    if (change === "registry-restart") { setSpiritRegistryActive(f.registry, false); setSpiritRegistryActive(f.registry, true); }
    if (change === "cycle-superseded") current = false;
    if (change === "rewind") f.world.time.elapsed = 0;
    expect(review.finish(accepted)).toBe(false);
    expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toBeUndefined();
  });

test("a new source does not inherit acknowledged sequence or history", () => {
  const f = fixture(); f.receipt("old"); f.capture().finish(accepted);
  stopCommittedEvents(f.world);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)?.sourceStopped).toBe(true);
  startCommittedEvents(f.world);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toBeUndefined();
  const fresh = f.receipt("fresh"), review = f.capture();
  expect(review.input.afterSequence).toBe(0); expect(review.input.throughSequence).toBe(1);
  expect(review.input.records[0].receiptIds).toEqual([fresh.id]);
});

test("worlds and exact producer objects cannot consume one another's receipts", () => {
  const a = fixture("A"), b = fixture("B"), ea = a.receipt("a"), eb = b.receipt("b");
  a.capture().finish(accepted);
  expect(b.capture().input.records[0].receiptIds).toEqual([eb.id]);
  expect(JSON.stringify(b.capture().input)).not.toContain(ea.id);
  const replacement = { ...a.spirit }; a.registry.spirits.set(a.spirit.eid, replacement);
  const review = captureSpiritPublicEventReview(a.world, replacement, a.registry, () => true);
  expect(review.input.records[0].receiptIds).toEqual([ea.id]);
});

test("busy speech is coalesced without inventing complete dialogue or crowding physical outcomes", () => {
  const f = fixture(), physical = f.receipt("repair", "interact");
  const speech = Array.from({ length: 400 }, (_, index) => f.say("one utterance", `slice ${index}`));
  const review = f.capture(), records = review.input.records;
  expect(records).toHaveLength(2); expect(records[0].receiptIds).toEqual([physical.id]);
  expect(records[1]).toMatchObject({ kind: "speech", receiptCount: 400, receiptIdsOmitted: 392,
    firstSequence: speech[0].sequence, lastSequence: speech.at(-1)!.sequence });
  expect(records[1].spokenText!.length).toBe(2000); expect(records[1].spokenCharactersOmitted).toBeGreaterThan(0);
  expect(review.input.omittedReceipts).toBe(0);
  review.finish(accepted);
  const status = getSpiritPublicEventReviewStatus(f.world, f.spirit)!;
  expect(status.receiptIdsObserved.length).toBe(9); expect(status.receiptIdsOmitted).toBe(392);
  expect(f.capture().input.records).toEqual([]);
});

test("bounded speech and physical windows disclose every omitted receipt", () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) f.receipt(`physical ${i}`);
  for (let i = 0; i < 100; i++) f.say(`speech ${i}`, `words ${i}`);
  const review = f.capture();
  expect(review.input.records).toHaveLength(64);
  expect(review.input.records.filter(row => row.kind === "action")).toHaveLength(48);
  expect(review.input.records.filter(row => row.kind === "speech")).toHaveLength(16);
  expect(review.input.omittedRecords).toBe(116); expect(review.input.omittedReceipts).toBe(116);
});

test("native ledger retention gaps remain explicit until an accepted review", () => {
  const f = fixture(); for (let i = 0; i < 2050; i++) f.receipt(`event ${i}`);
  const review = f.capture(); expect(review.input.droppedBeforeWindow).toBe(2);
  expect(review.input.records).toHaveLength(64); expect(review.input.omittedReceipts).toBe(1984);
  review.finish({ ...accepted, accepted: false }); expect(f.capture().input.droppedBeforeWindow).toBe(2);
  f.capture().finish(accepted); expect(f.capture().input.droppedBeforeWindow).toBe(0);
});

test("historical receipt names/keys never rebind to current entity identity", () => {
  const f = fixture(), first = f.say("same execution", "Before the change.");
  const review = f.capture();
  Name.value[f.actor] = "Replacement name"; WorkingMemoryIdentity.id[f.actor] = "replacement actor";
  const second = f.say("same execution", "After the change.");
  expect(review.input.records[0]).toMatchObject({ actorKey: first.actorKey, actorName: "Town resident" });
  expect(Object.isFrozen(review.input.records[0])).toBe(true);
  const later = f.capture(); expect(later.input.records).toHaveLength(2);
  expect(later.input.records.map(row => row.actorKey)).toEqual([first.actorKey, second.actorKey]);
});

test("public event diagnostics expose counts and judgments, not content", () => {
  const f = fixture(); f.say("speech", "Public spoken words");
  f.capture().finish({ accepted: true, interventions: [{ result: "applied" }, { result: "An unsafe private summary" }],
    phase: "rising", tension: .45 });
  const status = getSpiritPublicEventReviewStatus(f.world, f.spirit)!;
  expect(status).toMatchObject({ accepted: true, interventionsRequested: 2, interventionResults: ["applied"], phase: "rising", tension: .45 });
  expect(JSON.stringify(status)).not.toMatch(/Public spoken words|Private identity|unsafe private/);
  (status.receiptIdsObserved as string[]).push("external mutation");
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)!.receiptIdsObserved).not.toContain("external mutation");
});

test("actual cognition sees native receipts apart from prior interpretations and acknowledges once", async () => {
  const f = fixture(), event = f.receipt("actual", "examine", "failed");
  f.spirit.observations.push({ id: "interpretation", timestamp: Date.now(), domain: "narrative", type: "emergence",
    content: "A prior interpretation", entities: [], significance: .5 });
  await f.run();
  expect(promptHistory().records[0].receiptIds).toEqual([event.id]);
  expect(generate.mock.calls.at(-1)![0].prompt).toContain("PRIOR SPIRIT INTERPRETATIONS (not native event receipts)");
  await f.run(); expect(promptHistory().records).toEqual([]);
});

test.each(["provider", "parse"])("actual %s failure leaves native receipts available for the next review", async failure => {
  const f = fixture(), event = f.receipt("retry actual");
  if (failure === "provider") generate.mockRejectedValueOnce(Error("Offline provider failure"));
  else generate.mockResolvedValueOnce({ text: "not valid json" });
  await f.run(); expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)?.accepted).toBe(false);
  await f.run(); expect(promptHistory().records[0].receiptIds).toEqual([event.id]);
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)?.accepted).toBe(true);
});

test("actual in-flight cognition acknowledges its snapshot, not events received while waiting", async () => {
  const f = fixture(), first = f.receipt("before");
  let release!: (result: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(); expect(promptHistory().records[0].receiptIds).toEqual([first.id]);
  const later = f.receipt("during"); release({ text: "{}" }); await pending;
  await f.run(); expect(promptHistory().records[0].receiptIds).toEqual([later.id]);
});

test("the Narrator reads public events as a story summary and acknowledges them once", async () => {
  const f = fixture(), narrator = createSpirit(f.registry, { name: "The Narrator", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Tell the story.", observationInterval: 1000 });
  f.say("spoken", "Somebody forced that box."); f.receipt("looked", "examine");
  await runSpiritCognition(narrator, f.world, f.entities, f.registry);
  const first = generate.mock.calls.at(-1)![0].prompt as string;
  expect(first).toContain('Town resident (Town square) says: "Somebody forced that box."');
  expect(first).toContain("Town resident examine in Town square — succeeded");
  expect(first).not.toContain("COMMITTED_PUBLIC_EVENTS_SINCE_REVIEW");
  await runSpiritCognition(narrator, f.world, f.entities, f.registry);
  expect(generate.mock.calls.at(-1)![0].prompt).toContain("(Nothing public happened since your last review.)");
});

test("actual overlapping cycles cannot acknowledge or replace newer review diagnostics", async () => {
  const f = fixture(); f.receipt("old");
  let release!: (result: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run(), newer = f.receipt("newer"); await f.run();
  const status = getSpiritPublicEventReviewStatus(f.world, f.spirit)!;
  expect(status.acknowledgedThroughSequence).toBe(newer.sequence);
  release({ text: '{"narrativeUpdate":{"tension":0.99}}' });
  expect((await pending).discarded).toBe("stale_cycle");
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)).toEqual(status);
});

test("native environmental receipts share acceptance, retry and in-flight high-water semantics", async () => {
  const f = fixture();
  const weather = { id: "weather:revision:1", atSimMs: 1000, roomId: f.room, detail: "Rain is falling in the square." };
  expect(recordSpiritPublicEnvironmentReceipt(f.world, weather)).toBe(true);
  expect(recordSpiritPublicEnvironmentReceipt(f.world, weather)).toBe(true);
  expect(recordSpiritPublicEnvironmentReceipt(f.world, { ...weather, detail: "A different claim" })).toBe(false);
  let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.run();
  expect(promptHistory().environment.receipts).toHaveLength(1);
  const tree = { id: "tree:revision:1", atSimMs: 1000, roomId: f.room, detail: "A branch has fallen from the tree." };
  expect(recordSpiritPublicEnvironmentReceipt(f.world, tree)).toBe(true);
  release({ text: "not json" }); await pending;
  expect(getSpiritPublicEventReviewStatus(f.world, f.spirit)?.acknowledgedEnvironmentThroughSequence).toBe(0);
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const retry = f.run();
  expect(promptHistory().environment.receipts.map((row: any) => row.id)).toEqual([weather.id, tree.id]);
  recordSpiritPublicEnvironmentReceipt(f.world, { ...tree, id: "tree:revision:2", detail: "The branch was cleared." });
  release({ text: "{}" }); await retry;
  const status = getSpiritPublicEventReviewStatus(f.world, f.spirit)!;
  expect(status.acknowledgedEnvironmentThroughSequence).toBe(2);
  expect(status.receiptIdsObserved).toEqual([weather.id, tree.id]);
  expect(JSON.stringify(status)).not.toContain("fallen");
  await f.run(); expect(promptHistory().environment.receipts.map((row: any) => row.id)).toEqual(["tree:revision:2"]);
});

test("environment history is world/source scoped with historical room identity", () => {
  const a = fixture("A"), b = fixture("B");
  const receipt = { id: "weather:1", atSimMs: 1000, roomId: a.room, detail: "The rain stops." };
  expect(recordSpiritPublicEnvironmentReceipt(a.world, receipt)).toBe(true);
  expect(b.capture().input.environment.receipts).toEqual([]);
  const historical = a.capture().input.environment.receipts[0];
  Name.value[a.room] = "Renamed place"; WorkingMemoryIdentity.id[a.room] = "replacement-room";
  expect(a.capture().input.environment.receipts[0]).toEqual(historical);
  stopCommittedEvents(a.world);
  expect(recordSpiritPublicEnvironmentReceipt(a.world, { ...receipt, id: "stopped" })).toBe(false);
  startCommittedEvents(a.world);
  expect(a.capture().input.environment.receipts).toEqual([]);
  expect(recordSpiritPublicEnvironmentReceipt(a.world, receipt)).toBe(true);
  expect(a.capture().input.environment.receipts[0].roomName).toBe("Renamed place");
});

test.each(["future", "negative", "not-a-room", "oversize", "missing-id"])("invalid environment receipt %s is not historical evidence", kind => {
  const f = fixture();
  const receipt = { id: "native:1", atSimMs: 1000, roomId: f.room, detail: "Clouds gather." };
  if (kind === "future") receipt.atSimMs = 1001;
  if (kind === "negative") receipt.atSimMs = -1;
  if (kind === "not-a-room") receipt.roomId = f.actor;
  if (kind === "oversize") receipt.detail = "x".repeat(1001);
  if (kind === "missing-id") receipt.id = "";
  expect(recordSpiritPublicEnvironmentReceipt(f.world, receipt)).toBe(false);
  expect(f.capture().input.environment.receipts).toEqual([]);
});

test("environment retention and review limits expose exact omissions rather than quiet", () => {
  const f = fixture();
  for (let n = 0; n < 130; n++) recordSpiritPublicEnvironmentReceipt(f.world,
    { id: `effect:${n}`, atSimMs: 1000, roomId: f.room, detail: `Public native outcome ${n}` });
  const review = f.capture();
  expect(review.input.environment).toMatchObject({ droppedBeforeWindow: 2, omittedReceipts: 96, throughSequence: 130 });
  expect(review.input.environment.receipts).toHaveLength(32);
  review.finish(accepted);
  expect(f.capture().input.environment).toMatchObject({ droppedBeforeWindow: 0, omittedReceipts: 0, receipts: [] });
});

test("speech completion metadata does not crowd already-spoken words out of the review", () => {
  const f = fixture();
  for (let n = 0; n < 30; n++) { f.say(`utterance:${n}`, `Spoken words ${n}`); f.receipt(`utterance:${n}`, "speak"); }
  const records = f.capture().input.records;
  expect(records).toHaveLength(16);
  expect(records.every(row => row.spokenText?.startsWith("Spoken words"))).toBe(true);
});
