import { afterRepairTailEvidence, parseAfterRepairTail } from "../spatial-after-repair-protocol";

test("the existing default request budget is unchanged; a tail is explicit and bounded", () => {
  expect(parseAfterRepairTail([])).toEqual({ tailMs: 0, httpAttempts: 100 });
  expect(parseAfterRepairTail(["--after-repair-tail=60"])).toEqual({ tailMs: 60000, httpAttempts: 160 });
  expect(parseAfterRepairTail(["--after-repair-tail=120"])).toEqual({ tailMs: 120000, httpAttempts: 160 });
});
test.each(["", "0", "-1", "1.5", "121", "Infinity", "NaN", "1e2", "9007199254740993"])("invalid tail %j is rejected before any world/network initialization", raw => {
  expect(() => parseAfterRepairTail([`--after-repair-tail=${raw}`])).toThrow(/positive whole number/);
});
test("missing, duplicate and incompatible arguments fail closed", () => {
  expect(() => parseAfterRepairTail(["--after-repair-tail"])).toThrow();
  expect(() => parseAfterRepairTail(["--after-repair-tail=10", "--after-repair-tail=20"])).toThrow(/only once/);
  expect(() => parseAfterRepairTail(["--after-repair-tail=60", "--second-outage"])).toThrow(/cannot be combined/);
});
test("reaching a deadline before or during the tail cannot become behavioral success", () => {
  expect(afterRepairTailEvidence(60000, undefined, 180000)).toMatchObject({ startedAtSimMs: null, elapsedMs: 0, observedEntireTail: false });
  expect(afterRepairTailEvidence(60000, 150000, 180000)).toMatchObject({ elapsedMs: 30000, observedEntireTail: false });
  expect(afterRepairTailEvidence(60000, 80000, 140000)).toMatchObject({ elapsedMs: 60000, observedEntireTail: true, behavioralSuccess: "not automatically judged" });
  expect(afterRepairTailEvidence(0, undefined, 180000).observedEntireTail).toBe(false);
});
