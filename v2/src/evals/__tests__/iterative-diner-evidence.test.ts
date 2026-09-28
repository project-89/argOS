import { assertDinerRepairFits, dinerContinuityFailures, dinerReviewIncludesMeal, dinerRuntimeHealthy, type DinerIdentity, type DinerReview } from "../iterative-diner-evidence";
import { FastRuntimeHealth } from "../../runtime/fast-system-health";
import { createArgosWorld } from "../../ecs/world";
import { startCommittedEvents } from "../../runtime/committed-events";

const initial: DinerIdentity[] = [
  { key: "room", name: "Diner", kind: "room", removed: false },
  { key: "chair", name: "Chair", kind: "object", roomKey: "room", removed: false },
  { key: "cake", name: "Celebration cake", kind: "object", roomKey: "room", removed: true },
];
const food: DinerIdentity = { key: "lunch", name: "Simple lunch", kind: "object", roomKey: "room", removed: false };
test("additive repair preserves the original room and removed object through consumption", () => {
  expect(dinerContinuityFailures(initial, [...initial, food], [food])).toEqual([]);
  expect(dinerContinuityFailures(initial, initial, [food])).toEqual([]); // Consumed, not forgotten from construction history.
});
test.each(["new-room", "reused-id", "restored-cake", "renamed-chair", "remote-addition", "duplicate-consumed", "duplicate-removed"])(
  "continuity gate rejects %s without mutating evidence", mode => {
    const current = structuredClone(initial), additions = [structuredClone(food)];
    if (mode === "new-room") current.push({ key: "extra", name: "Other diner", kind: "room", removed: false });
    if (mode === "reused-id") current[1].key = "replacement";
    if (mode === "restored-cake") current[2].removed = false;
    if (mode === "renamed-chair") current[1].name = "Another chair";
    if (mode === "remote-addition") additions[0].roomKey = "elsewhere";
    if (mode === "duplicate-consumed") additions.push({ ...food, key: "new-food", name: " SIMPLE  LUNCH " });
    if (mode === "duplicate-removed") additions[0].name = "celebration cake";
    const before = JSON.stringify({ current, additions });
    expect(dinerContinuityFailures(initial, current, additions).length).toBeGreaterThan(0);
    expect(JSON.stringify({ current, additions })).toBe(before);
  });
function review(): DinerReview {
  return { before: [{ id: "review", timestamp: 1, fromEid: 3, fromName: "Weaver", type: "report", domain: "ecology",
    priority: "high", subject: "World activity reviewed", content: "Evidence", requiresResponse: false,
    data: { recentEvents: [{ id: "meal", action: "interact", status: "succeeded" }] } }],
    result: { ran: true, executed: true, messagesIncluded: 1, messagesConsidered: 1 } };
}
test("a successful full current report batch can witness an exact meal", () => expect(dinerReviewIncludesMeal(review(), "meal")).toBe(true));
test.each(["unrelated", "expired", "subset", "proposal", "pending", "speech", "empty"])("meal feedback rejects %s", mode => {
  const value = review();
  if (mode === "unrelated") value.before[0].data!.recentEvents[0].id = "other";
  if (mode === "expired") value.result.executed = false;
  if (mode === "subset") value.result.messagesIncluded = 0;
  if (mode === "proposal") value.before[0].data!.proposal = { id: "unrelated-proposal" };
  if (mode === "pending") value.before[0].data!.recentEvents[0].status = "pending";
  if (mode === "speech") value.before[0].data!.recentEvents[0].action = "speak";
  if (mode === "empty") { value.before = []; value.result.messagesIncluded = 0; }
  expect(dinerReviewIncludesMeal(value, "meal")).toBe(false);
});

test("construction ceiling applies before allocation, without altering approved designs", () => {
  const spec = { type: "object", roomEid: 7 };
  expect(() => assertDinerRepairFits(spec, 7, 2)).not.toThrow();
  expect(() => assertDinerRepairFits(spec, 7, 3)).toThrow("budget");
  expect(() => assertDinerRepairFits({ type: "room", roomEid: 7 }, 7, 0)).toThrow("replacement");
  expect(() => assertDinerRepairFits(spec, 8, 0)).toThrow("replacement");
  expect(spec).toEqual({ type: "object", roomEid: 7 });
});
test("recovered native failures still fail the diagnostic health gate", () => {
  const world = createArgosWorld("health"), health = new FastRuntimeHealth(world, "probe"), callback = { name: "native" };
  startCommittedEvents(world); health.register(callback); health.start();
  const systems = [{ name: "system", active: true, totalErrors: 0, consecutiveErrors: 0, lastError: null,
    lastErrorTimestamp: null, disabledReason: null, disabledAt: null, totalExecutions: 1, avgDurationMs: 1 }];
  expect(dinerRuntimeHealthy(health.snapshot(), systems)).toBe(false);
  health.execute(callback, 1, () => {}); expect(dinerRuntimeHealthy(health.snapshot(), systems)).toBe(true);
  expect(dinerRuntimeHealthy(health.snapshot(), [{ ...systems[0], totalErrors: 1 }])).toBe(false);
  expect(() => health.execute(callback, 2, () => { throw Error("failure"); })).toThrow();
  health.execute(callback, 3, () => {}); expect(dinerRuntimeHealthy(health.snapshot(), systems)).toBe(false);
  health.stop(); expect(dinerRuntimeHealthy(health.snapshot(), systems)).toBe(false);
});
