import { createArgosWorld } from "../../ecs/world";
import { startCommittedEvents } from "../committed-events";
import { enableControlLoopDiagnostics, recordControlLoopDiagnostic, getControlLoopDiagnostics, foregroundChoiceDiagnostic } from "../control-loop-diagnostics";

test("operator diagnostics are opt-in, bounded, isolated, detached and nonthrowing", () => {
  const world = createArgosWorld(); startCommittedEvents(world);
  let evaluated = false;
  recordControlLoopDiagnostic(world, () => { evaluated = true; throw new Error("must not run"); });
  expect(evaluated).toBe(false); expect(getControlLoopDiagnostics(world).enabled).toBe(false);
  enableControlLoopDiagnostics(world);
  const input = { lane: "reflection" as const, actorId: 42, stage: "test", detail: { counts: [1] } };
  recordControlLoopDiagnostic(world, () => input); input.detail.counts.push(2);
  const first = getControlLoopDiagnostics(world);
  expect(first.entries[0].detail.counts).toEqual([1]); first.entries[0].detail.counts = [100];
  expect(getControlLoopDiagnostics(world).entries[0].detail.counts).toEqual([1]);
  expect(() => recordControlLoopDiagnostic(world, () => { throw new Error("observer failure"); })).not.toThrow();
  recordControlLoopDiagnostic(world, () => ({ ...input, detail: { oversized: "x".repeat(16001) } }));
  for (let i = 0; i < 600; i++) recordControlLoopDiagnostic(world, () => input);
  const final = getControlLoopDiagnostics(world);
  expect(final.entries).toHaveLength(512); expect(final.latestSequence).toBe(601); expect(final.dropped).toBe(91);
  enableControlLoopDiagnostics(world); expect(getControlLoopDiagnostics(world).latestSequence).toBe(601);
  expect(getControlLoopDiagnostics(createArgosWorld()).entries).toEqual([]);
});

test("foreground projection distinguishes omission and selection without logging arbitrary payloads", () => {
  const omitted = foregroundChoiceDiagnostic({ control: { purpose: "Listen before deciding", version: 2 }, action: { type: "wait" }, innerThought: "PRIVATE_THOUGHT" });
  expect(omitted).toMatchObject({ purpose: "Listen before deciding", nextPurposePresent: false });
  const selected = foregroundChoiceDiagnostic({ control: { nextPurpose: { goalId: 5, purpose: "Reply" },
    nextPurposeReview: { id: "next:1", disposition: "take", reason: "I am ready" }, extra: "SECRET" },
    action: { type: "interact", content: "SECRET_MESSAGE" }, credential: "SECRET_KEY" });
  expect(selected).toMatchObject({ nextPurposePresent: true, nextPurpose: { goalId: 5, purpose: "Reply" }, nextPurposeReview: { id: "next:1", disposition: "take" } });
  expect(JSON.stringify([omitted, selected])).not.toMatch(/SECRET|PRIVATE_THOUGHT/);
  expect(foregroundChoiceDiagnostic({ control: { nextPurpose: "bad" } }).nextPurposePresent).toBe(true);
});
