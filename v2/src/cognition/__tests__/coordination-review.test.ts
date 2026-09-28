import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { CommunicationMemory, Goal, SocialMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { startCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { recordPrivateCommunication } from "../communication-memory";
import { createIntentGoal } from "../cognition-system";
import { getCoordinationMemory } from "../coordination-memory";
import { recordCommittedSpeech, getSocialDialogue } from "../social-memory";
import { runCoordinationReview, hasPendingCoordinationReview, snapshotCoordinationReview } from "../coordination-review";

function fixture() {
  const world = createArgosWorld("Background commitments"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Kitchen" });
  const make = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Own your decisions", roomId: room });
  const actor = make("Ada"), peer = make("Bea"), sourceId = startCommittedEvents(world);
  const goal = createIntentGoal(world, actor, "Bring the map", 7);
  const receipt = recordPrivateCommunication(world, actor, { sourceId, messageKey: "map-promise", channel: "phone",
    kind: "sent", other: "Alex", content: "I will bring the map.", sentAtSimMs: 0 })!;
  const answer = { reviews: [{ kind: "undertake", speechId: receipt.id, task: "Bring the map", goalId: goal }] };
  return { world, actor, peer, goal, receipt, answer, sourceId };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline review tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

test("one new sent promise can be reviewed privately without selecting an action or completing its goal", async () => {
  const f = fixture(), infer = jest.fn(async () => f.answer);
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(true);
  await runCoordinationReview(f.world, f.actor, { infer });
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toMatchObject({ id: f.receipt.id, localStatus: "not_started" });
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
  expect(getSocialDialogue(f.world, f.peer)).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  await runCoordinationReview(f.world, f.actor, { infer }); expect(infer).toHaveBeenCalledTimes(1);
});
test("nothing to track is a durable successful review, not a reason to keep generating work", async () => {
  const f = fixture(); await runCoordinationReview(f.world, f.actor, { infer: async () => ({ reviews: [] }) });
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
  const saved = structuredClone(serializeWorld(f.world, createSystemRegistry()));
  const restored = createArgosWorld("Restored review"); restored.meta.aiEnabled = true;
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved); startCommittedEvents(restored);
  const actor = oldToNewId.get(f.actor)!;
  expect(hasPendingCoordinationReview(restored, actor)).toBe(false);
});
test("cancelled background interpretation cannot leave an undertaking behind", async () => {
  const f = fixture(), abort = new AbortController(); let finish!: (value: unknown) => void;
  const running = withSimulationTask(abort.signal, () => runCoordinationReview(f.world, f.actor,
    { infer: () => new Promise(resolve => { finish = resolve; }) }));
  abort.abort(); finish(f.answer); await expect(running).rejects.toThrow();
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
  expect(snapshotCoordinationReview(f.world, f.actor)?.inFlight).toBe(false);
});
test.each(["goal", "owner", "speech"])("%s changes during inference discard the stale review", async change => {
  const f = fixture(); let finish!: (v: unknown) => void;
  const running = runCoordinationReview(f.world, f.actor, { infer: () => new Promise(resolve => { finish = resolve; }) });
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  if (change === "goal") Goal.description[f.goal] = "Leave the map alone";
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "speech") recordCommittedSpeech(f.world, f.actor, "Actually I cannot bring it.", "Bea");
  finish(f.answer); await running;
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
  expect(snapshotCoordinationReview(f.world, f.actor)?.outcome).toBe("stale");
});
test("invalid sources retry only twice for unchanged evidence, without creating goals or accounts", async () => {
  jest.useFakeTimers(); jest.setSystemTime(100000);
  const f = fixture(), infer = jest.fn(async () => ({ reviews: [{ kind: "undertake", speechId: "invented", task: "Do things" }] }));
  await runCoordinationReview(f.world, f.actor, { infer });
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  jest.setSystemTime(103000); await runCoordinationReview(f.world, f.actor, { infer });
  jest.setSystemTime(200000); expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  await runCoordinationReview(f.world, f.actor, { infer }); expect(infer).toHaveBeenCalledTimes(2);
  expect(getCoordinationMemory(f.world, f.actor).items).toEqual([]);
});

test("readiness reads each communication store once, including when every source is already reviewed", async () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.actor, "I will bring the map.", "Bea");
  const inputs = [SocialMemory.turnsJson[f.actor], CommunicationMemory.receiptsJson[f.actor]];
  const parse = jest.spyOn(JSON, "parse");
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(true);
  for (const input of inputs) expect(parse.mock.calls.filter(([text]) => text === input)).toHaveLength(1);
  await runCoordinationReview(f.world, f.actor, { infer: async () => ({ reviews: [] }) });
  parse.mockClear();
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  for (const input of inputs) expect(parse.mock.calls.filter(([text]) => text === input)).toHaveLength(1);
});

test("an in-flight review does not rebuild communication snapshots during readiness probes", async () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.actor, "I will bring the map.", "Bea");
  const inputs = [SocialMemory.turnsJson[f.actor], CommunicationMemory.receiptsJson[f.actor]];
  let finish!: (value: unknown) => void;
  const running = runCoordinationReview(f.world, f.actor, { infer: () => new Promise(resolve => { finish = resolve; }) });
  const parse = jest.spyOn(JSON, "parse");
  try {
    expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
    for (const input of inputs) expect(parse.mock.calls.filter(([text]) => text === input)).toHaveLength(0);
  } finally { finish({ reviews: [] }); await running; }
});

test.each(["goal", "unselected source"])("readiness still notices a changed %s during retry backoff", async change => {
  jest.useFakeTimers(); jest.setSystemTime(100000);
  const f = fixture();
  const addMessage = (id: number) => recordPrivateCommunication(f.world, f.actor, {
    sourceId: f.sourceId, messageKey: `additional-${id}`,
    channel: "phone", kind: "sent", other: "Alex", content: `Additional map observation ${id}.`, sentAtSimMs: 0,
  });
  addMessage(2); addMessage(3);
  let selectedIds: string[] = [];
  await runCoordinationReview(f.world, f.actor, { infer: async context => {
    selectedIds = (context.communications as Array<{ id: string }>).map(row => row.id);
    return { reviews: [{ kind: "undertake", speechId: "invented", task: "Do things" }] };
  } });
  expect(selectedIds).toHaveLength(3);
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(false);
  if (change === "goal") Goal.description[f.goal] = "Bring the annotated map";
  else expect(selectedIds).not.toContain(addMessage(4)!.id);
  expect(hasPendingCoordinationReview(f.world, f.actor)).toBe(true);
});
