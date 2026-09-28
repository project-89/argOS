import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createTownScenario } from "../spatial-town-fixtures";
import { STORY_TOWN_NARRATOR_PROMPT } from "../spatial-town-story";
import { ObjectState, Position, WorkingMemoryIdentity } from "../../ecs/components";
import { getComponent } from "../../ecs/component-registry";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getCommittedEvents } from "../../runtime/committed-events";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import { createSpirit, createSpiritRegistry, type SpiritRegistry, type SpiritState } from "../../spirits/spirit-registry";
import { captureSpiritPhysicalEffects, parsePhysicalEffectCommand } from "../../spirits/physical-effect-capabilities";
import { captureSpiritPublicEventReview } from "../../spirits/spirit-public-event-review";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

const demos: SpatialDemo[] = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Town story integration is offline")); });
afterEach(() => { for (const demo of demos.splice(0)) demo.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function fixture(story = true, live = false) {
  const demo = await SpatialDemo.create({ scenario: "town", evolving: true, ...(story ? { story: "community-drama" as const } : {}), live, automaticClock: false });
  demos.push(demo); return demo;
}
function actor(demo: SpatialDemo) { return demo.snapshot().actors.find(a => a.name === "Eli")!; }
function tree(demo: SpatialDemo) { return demo.snapshot().entities.find(e => e.id === demo.byId.get("square-tree-3"))!; }
function grant(demo: SpatialDemo) {
  const bound = (registry: SpiritRegistry, narrator: SpiritState) => Object.assign(
    () => captureSpiritPhysicalEffects(demo.sim.world, narrator, registry),
    { review: () => captureSpiritPublicEventReview(demo.sim.world, narrator, registry, () => true) });
  const state = getSpiritSystemState(demo.sim.world);
  if (state) {
    const narrator = [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator")!;
    return bound(state.registry, narrator);
  }
  // Manual physics does not run AI. Install only the same native grant here;
  // the separate live-ready assertion checks production hierarchy installation.
  const registry = createSpiritRegistry(demo.sim.world);
  const narrator = createSpirit(registry, { name: "The Narrator", domain: "narrative", rank: "archangel", model: "flash",
    systemPrompt: "Observe actual events.", observationInterval: 1000, canInjectEvents: true });
  demo.townLife!.weather.registerNarrator(registry, narrator, demo.storyEvents);
  return bound(registry, narrator);
}

test("story must be explicitly scoped to the authored evolving town, not a substitute world", async () => {
  await expect(SpatialDemo.create({ story: "community-drama" })).rejects.toThrow(/Story requires/);
  await expect(SpatialDemo.create({ scenario: "town", story: "community-drama" })).rejects.toThrow(/Story requires/);
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, story: "community-drama", townFixture: "cafe-seat-need" })).rejects.toThrow(/Story requires/);
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, story: "community-drama", world: createTownScenario() })).rejects.toThrow(/authored town/);
  await expect(SpatialDemo.create({ scenario: "town", evolving: true, story: "arbitrary" as any })).rejects.toThrow(/Story requires/);
});
test("live-ready story profile installs a bounded existing Narrator before any model work", async () => {
  const demo = await fixture(true, true), view = demo.snapshot();
  expect(demo.running).toBe(false); expect(view.townLife?.story).toMatchObject({ remainingEvents: 2 });
  expect(view.townLife?.story?.style).toBeTruthy(); expect(demo.storyEvents!.view().trees).toHaveLength(3);
  expect(demo.storyEvents!.damage("Common tree 3", demo.byId.get("common-square")!).status).toBe("rejected");
  const state = getSpiritSystemState(demo.sim.world)!;
  const narrator = [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator")!;
  expect(narrator.definition.observationInterval).toBe(20_000);
  expect(narrator.definition.systemPrompt).toBe(STORY_TOWN_NARRATOR_PROMPT);
  expect(narrator.definition.systemPrompt).toContain("active director");
  expect(demo.sim.god.systemRegistry.systems.get("NarrativeEvents")?.active).toBe(false);
  expect(captureSpiritPhysicalEffects(demo.sim.world, narrator, state.registry).legacyAllowed()).toBe(false);
  expect(demo.sim.getEvolutionStatus().stageRuns.architect).toBe(0);
});
test("ordinary town remains the ordinary profile, with no story authority or tree condition attached", async () => {
  const demo = await fixture(false); await demo.start();
  expect(demo.storyEvents).toBeUndefined(); expect(demo.snapshot().townLife?.story).toBeUndefined();
  const component = getComponent("SpatialStoryTree");
  expect(component && hasComponent(demo.sim.world, tree(demo).id, component)).toBeFalsy();
  const capture = grant(demo), content = JSON.stringify({ operation: "tree_damage", tree: "Common tree 3" });
  expect(parsePhysicalEffectCommand(content)).toEqual({ operation: "tree_damage", tree: "Common tree 3" });
  expect(capture().execute(content, demo.byId.get("common-square")!, () => true).status).toBe("rejected");
  expect(capture().execute('{"operation":"weather","condition":"rain"}', demo.byId.get("common-square")!, () => true).status).toBe("applied");
  expect(tree(demo).state).toBe("normal"); expect(demo.snapshot().townLife?.changes.some(e => /branch/.test(e.summary))).toBe(false);
});
test("combined Narrator grant makes only grounded named native effects and retains one shared source boundary", async () => {
  const demo = await fixture(); await demo.start(); const capture = grant(demo), t = tree(demo);
  const content = JSON.stringify({ operation: "tree_damage", tree: t.name });
  expect(capture().description).toContain("tree_damage"); expect(capture().description).toContain("weather");
  expect(capture().execute(content, t.roomId, () => false).status).toBe("rejected");
  expect(capture().execute(content, demo.byId.get("town-cafe")!, () => true).status).toBe("rejected");
  expect(capture().execute('{"operation":"tree_damage","tree":"Common tree 2"}', t.roomId, () => true).status).toBe("rejected");
  const stale = capture();
  // The live provider sometimes returns content as an object, not JSON text.
  // Its exact two-field command must reach the same native bound target.
  expect(capture().execute({ operation: "tree_damage", tree: t.name }, t.roomId, () => true).status).toBe("applied");
  expect(stale.execute('{"operation":"weather","condition":"rain"}', t.roomId, () => true).status).toBe("rejected");
  expect(capture().execute('{"operation":"weather","condition":"rain"}', t.roomId, () => true).status).toBe("applied");
  const view = demo.snapshot(); expect(view.weather?.condition).toBe("rain"); expect(tree(demo).state).toBe("branch_damage");
  expect(view.townLife?.story?.remainingEvents).toBe(1);
  expect(view.townLife?.changes.filter(e => e.status === "applied")).toHaveLength(2);
  expect(view.cues.some(cue => /branch snapped/.test(cue.text))).toBe(true);
  // These are native environmental receipts, not a fictitious NPC actor or
  // repeated prose from the spirit. A manual acknowledgement verifies the
  // durable review handoff without claiming an LLM has reviewed this fixture.
  const review = capture.review();
  expect(review.input.environment.receipts).toHaveLength(2);
  expect(review.input.environment.receipts.map(r => r.detail)).toEqual(expect.arrayContaining([
    expect.stringContaining("branch snapped"), expect.stringContaining("changed to rain"),
  ]));
  expect(review.input.environment.receipts.every(r => r.sourceId === demo.sourceId && r.roomKey === WorkingMemoryIdentity.id[t.roomId])).toBe(true);
  expect(review.finish({ accepted: true, interventions: [] })).toBe(true);
  expect(capture.review().input.environment.receipts).toEqual([]);
  demo.stop(); expect(capture().execute(content, t.roomId, () => true).status).toBe("rejected");
});
test("full host action approaches a real interaction point, works for six seconds, commits repair and feeds actual outcomes", async () => {
  const demo = await fixture(); await demo.start(); const person = actor(demo), t = tree(demo), world = demo.sim.world;
  const sourceId = demo.sourceId, before = demo.snapshot(), destinations = demo.spatial.movementTargets(person.id);
  expect(demo.storyEvents!.damage(t.name, t.roomId).status).toBe("applied");
  expect(demo.snapshot().entities.map(e => [e.id, e.position, e.size])).toEqual(before.entities.map(e => [e.id, e.position, e.size]));
  expect(demo.spatial.movementTargets(person.id)).toEqual(destinations);
  expect(getAgentWorldCapabilities(world, person.id)!.affordances?.(t.id)).toContainEqual(expect.objectContaining({ name: "clear_branches" }));
  expect(getAgentWorldCapabilities(world, person.id)!.context()).toContain("loose branches");
  demo.dispatch(person.key, "interact", t.key, "clear_branches");
  expect(actor(demo).action).toBe("walking"); expect(tree(demo).state).toBe("branch_damage");
  let repairBeganAt: number | undefined;
  while (demo.atSimMs < 40_000 && tree(demo).state !== "pruned") {
    demo.advance(100);
    if (actor(demo).action === "repairing" && repairBeganAt === undefined) repairBeganAt = demo.atSimMs;
    // Branch damage does not unregister the solid standing trunk. Every physical
    // position on this real routed approach remains outside its trunk collider.
    expect(Math.abs(Position.x[person.id] - Position.x[t.id]) > .299 || Math.abs(Position.y[person.id] - Position.y[t.id]) > .299).toBe(true);
    if (repairBeganAt !== undefined && demo.atSimMs - repairBeganAt < 6000) expect(tree(demo).state).toBe("branch_damage");
  }
  expect(repairBeganAt).toBeDefined(); expect(tree(demo).state).toBe("pruned"); expect(demo.atSimMs - repairBeganAt!).toBeGreaterThanOrEqual(6000);
  expect(demo.spatial.isAtTarget(person.id, t.id)).toBe(true); expect(demo.sourceId).toBe(sourceId);
  expect(getCommittedEvents(world).events).toContainEqual(expect.objectContaining({ kind: "action", actorId: person.id, targetId: t.id, action: "interact", status: "succeeded" }));
  expect(JSON.stringify(getWorkingMemory(world, person.id).receipts)).toContain("cleared the loose broken branches");
  const after = demo.snapshot();
  expect(after.townLife?.changes).toContainEqual(expect.objectContaining({ spirit: "Residents", status: "applied", summary: expect.stringContaining("cleared the loose") }));
  expect(after.entities.filter(e => e.id !== person.id).map(e => [e.id, e.position, e.size])).toEqual(before.entities.filter(e => e.id !== person.id).map(e => [e.id, e.position, e.size]));
  expect(demo.storyEvents!.damage(t.name, t.roomId).status).toBe("unchanged");
  expect(demo.snapshot().events.some(e => e.kind === "operator")).toBe(true); // This is a manual integration test, never autonomous-use evidence.
});
test.each(["stopped", "target-replaced", "target-moved", "state-changed"])("%s during approach cancels the host action before stale branch clearing", async reason => {
  const demo = await fixture(); await demo.start(); const person = actor(demo), t = tree(demo), world = demo.sim.world;
  demo.storyEvents!.damage(t.name, t.roomId); demo.dispatch(person.key, "interact", t.key, "clear_branches"); demo.advance(100);
  const x = Position.x[person.id], y = Position.y[person.id];
  if (reason === "stopped") demo.stop();
  if (reason === "target-replaced") WorkingMemoryIdentity.id[t.id] = "replacement-tree";
  if (reason === "target-moved") Position.x[t.id] += 1;
  if (reason === "state-changed") ObjectState.current[t.id] = "pruned";
  if (reason !== "stopped") demo.advance(12_000);
  expect(Position.x[person.id]).toBe(x); expect(Position.y[person.id]).toBe(y);
  expect(demo.storyEvents!.component.revision[t.id]).toBe(1);
  expect(getCommittedEvents(world).events.some(e => e.actorId === person.id && e.targetId === t.id && e.status === "succeeded")).toBe(false);
  expect(demo.snapshot().townLife?.changes.some(e => e.spirit === "Residents" && e.status === "applied")).toBe(false);
});
