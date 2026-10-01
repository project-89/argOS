import { ConditionTracker, stageOf, validateCondition, type LandCondition } from "../settlement/conditions";

const DRUNK: LandCondition = { kind: "drunk", name: "Drink", wearsOffPerHour: .15, effects: { work: -.5, walk: -.3, attention: .4 },
  labels: { mild: "tipsy", strong: "drunk" }, feels: { mild: "The ale warms you; the edges of things soften.", strong: "Your head swims and your tongue runs ahead of you.", gone: "Your head is clear again." } };

test("a condition rises with what is consumed, crosses mild and strong, shapes effects, and wears off by the hour", () => {
  const t = new ConditionTracker(() => [DRUNK]);
  expect(t.add(1, "drunk", .3)).toEqual({ actor: 1, kind: "drunk", from: "none", to: "mild", level: .3 });
  expect(t.labelOf(1)).toBe("tipsy");
  expect(t.factor(1, "work")).toBeCloseTo(1 - .5 * .3);
  expect(t.factor(1, "attention")).toBeCloseTo(1 + .4 * .3);
  expect(t.factor(2, "work")).toBe(1); // nobody else is affected
  expect(t.add(1, "drunk", .4)?.to).toBe("strong");
  expect(t.labelOf(1)).toBe("drunk");
  expect(t.add(1, "drunk", .5)).toBeUndefined(); // capped at 1, still strong
  expect(t.wearOff(2)).toEqual([]); // 0.7: still strong
  expect(t.wearOff(1)).toEqual([{ actor: 1, kind: "drunk", from: "strong", to: "mild", level: expect.closeTo(.55, 5) }]);
  const back = t.wearOff(10);
  expect(back.map(c => c.to)).toEqual(["none"]);
  expect(t.feeling(back[0])).toBe("Your head is clear again.");
  expect(t.labelOf(1)).toBeUndefined();
  expect(t.add(1, "unknown", .5)).toBeUndefined(); // only the land's conditions exist
  expect(stageOf(.19)).toBe("none"); expect(stageOf(.2)).toBe("mild"); expect(stageOf(.6)).toBe("strong");
});

test("a proposed condition is checked: effects only from the vocabulary and within bounds; it must do something and say how it feels", () => {
  expect(validateCondition(DRUNK)).toEqual({ ok: true, condition: DRUNK });
  expect(validateCondition({ ...DRUNK, effects: { flight: .5 } })).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown effect "flight"/) });
  expect(validateCondition({ ...DRUNK, effects: { work: -.9 } })).toMatchObject({ ok: false, reason: expect.stringMatching(/work must be within/) });
  expect(validateCondition({ ...DRUNK, effects: {} })).toMatchObject({ ok: false, reason: expect.stringMatching(/must do something/) });
  expect(validateCondition({ ...DRUNK, wearsOffPerHour: 5 })).toMatchObject({ ok: false });
  expect(validateCondition({ ...DRUNK, feels: { mild: "x" } })).toMatchObject({ ok: false, reason: expect.stringMatching(/feels/) });
});

test("conditions carry across a night's save", () => {
  const t = new ConditionTracker(() => [DRUNK]);
  t.add(7, "drunk", .5);
  const again = new ConditionTracker(() => [DRUNK]);
  again.restore(7, t.of(7));
  expect(again.level(7, "drunk")).toBe(.5);
  again.restore(8, { nonsense: .4 });
  expect(again.of(8)).toEqual({});
});
