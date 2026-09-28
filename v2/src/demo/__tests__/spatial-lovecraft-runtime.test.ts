import { jest } from "@jest/globals";
import { addComponent, hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { createLovecraftTownScenario, createLovecraftWorldSpecification } from "../spatial-lovecraft-town";
import { createSpatialWeather, type SpatialWeatherCondition } from "../spatial-weather";
import { Agent, Name, ObjectState, Position, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { getComponent } from "../../ecs/component-registry";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { getWorldAuthoringContext, getWorldSpecification } from "../../world/world-specification";
import { getCodingDaemon } from "../../engineering/coding-daemon";
import { getCharacterContext } from "../../cognition/character-context";
import { getIdentityAnchors } from "../../cognition/narrative-memory";
import { getWorkingMemory, workingMemoryEntityRef } from "../../cognition/working-memory";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { buildAgentContext } from "../../cognition/agent-mind";
import { drainPendingStimuli, peekPendingStimuli } from "../../cognition/stimulus-queue";
import { getSpiritSystemState } from "../../spirits/spirit-system";
import { getActiveSpirits } from "../../spirits/spirit-registry";
import { TOWN_GROWTH_SITE_LAYOUT } from "../spatial-town-growth";

// These are authored/manual integration checks, not evidence of autonomous
// mystery solving, Narrator judgement, or a provider-backed live run.
const demos: SpatialDemo[] = [];
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Coastal runtime checks stay offline"));
  jest.spyOn(console, "log").mockImplementation(() => {}); drainPendingStimuli();
});
afterEach(() => {
  for (const demo of demos.splice(0)) demo.stop();
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function fixture(live = false) {
  const demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true,
    live, automaticClock: false, seconds: 60 }); demos.push(demo); return demo;
}
const resident = (demo: SpatialDemo, name: string) => demo.snapshot().actors.find(actor => actor.name === name)!;
const bodies = (demo: SpatialDemo) => demo.actors.map(id => ({ id, x: Position.x[id], y: Position.y[id], active: Agent.active[id] }));

test("coastal ready state has real dusk/clouds, ten private histories, a world brief and no coding job", async () => {
  const demo = await fixture(), world = demo.sim.world, view = demo.snapshot(), scenario = createLovecraftTownScenario();
  expect(demo.running).toBe(false); expect(view.scenario).toMatchObject({ theme: "lovecraft", phase: "authored coastal mystery" });
  expect(view.actors).toHaveLength(10); expect(world.time).toMatchObject({ simulationHour: 18, timeOfDay: "evening", elapsed: 0 });
  expect(view.weather).toMatchObject({ condition: "cloudy", revision: 0 });
  expect(demo.townLife!.weather.view()).toMatchObject({ remainingChanges: 12 }); // a living story session
  const weather = getComponent("SpatialWeather")!;
  for (const row of view.weather!.rooms) {
    expect(hasComponent(world, row.roomId, weather)).toBe(true);
    expect(weather.condition[row.roomId]).toBe("cloudy"); expect(weather.revision[row.roomId]).toBe(0);
    expect(weather.changeCount[row.roomId]).toBe(0); expect(weather.changedAtSimMs[row.roomId]).toBe(-1);
  }
  expect(view.townLife!.changes).toEqual([]); // An authored opening is not a Narrator intervention.
  expect(getWorldSpecification(world)).toEqual(createLovecraftWorldSpecification());
  expect(getCodingDaemon(world)).toBeUndefined(); expect(view.limits.autonomousGrowth).toBe(false);
  for (const authored of scenario.residents) {
    const actor = resident(demo, authored.name), context = JSON.stringify(getCharacterContext(world, actor.id));
    expect(getIdentityAnchors(world, actor.id).length).toBeGreaterThan(0);
    for (const other of scenario.residents.filter(r => r.name !== authored.name)) {
      for (const memory of other.past?.memories ?? []) expect(context).not.toContain(memory.recollection);
    }
  }
  expect(getWorldAuthoringContext(world)).not.toContain("I cut two alignment marks into the supplies box lid");
  for (const authored of scenario.residents) {
    // Persona first: the resident's own voice and secret reach their prompt, nobody else's.
    const prompt = buildAgentContext(world, resident(demo, authored.name).id);
    expect(prompt).toContain(authored.past!.secret!.slice(0, 60));
    expect(prompt).toContain(authored.past!.voice!.slice(0, 40));
    for (const other of scenario.residents.filter(r => r.name !== authored.name)) expect(prompt).not.toContain(other.past!.secret!.slice(0, 60));
  }
});

test("live-ready coastal hierarchy has its own bounded narrator but performs no work before Start", async () => {
  const demo = await fixture(true), state = getSpiritSystemState(demo.sim.world)!;
  expect(getActiveSpirits(state.registry).map(s => s.definition.name).sort())
    .toEqual(["The Arbiter", "The Crafter", "The Narrator", "The Steward", "The Watcher", "The Weaver"]);
  const narrator = [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator")!;
  expect(narrator.definition.systemPrompt).not.toContain("warm community drama");
  expect(narrator.definition.canCreateEntities).toBe(false); expect(narrator.definition.canBakeSystems).toBe(false);
  expect(demo.snapshot().townLife!.growth.remaining).toBe(TOWN_GROWTH_SITE_LAYOUT.length);
  expect(demo.sim.getEvolutionStatus()).toMatchObject({ stageRuns: { architect: 0 } });
  expect(demo.storyEvents!.view()).toMatchObject({ remainingEvents: 2 });
  expect(demo.running).toBe(false); expect(getCodingDaemon(demo.sim.world)).toBeUndefined();
});

test("manual phone pickup/read/reply uses existing timed private transport in the new setting", async () => {
  const demo = await fixture(); await demo.start();
  const world = demo.sim.world, mara = resident(demo, "Mara");
  const authored = createLovecraftTownScenario().residents.find(r => r.name === "Mara")!;
  const phone = demo.byId.get(authored.phoneId!)!, phoneKey = WorkingMemoryIdentity.id[phone];
  expect(getRoomForEntity(world, phone)).toBe(getRoomForEntity(world, mara.id));
  const message = demo.text(mara.key, "PRIVATE_COASTAL_PHONE_941: There are marks on the box lid.");
  expect(resident(demo, "Mara").messages.find(m => m.id === message)?.status).toBe("delivered");
  expect(getPrivateCommunications(world, mara.id)).toHaveLength(0);
  demo.dispatch(mara.key, "pickup", phoneKey); demo.advance(15_000);
  expect(getDirectContainer(world, phone)).toBe(mara.id);
  demo.dispatch(mara.key, "interact", phoneKey, "read_phone"); demo.advance(500);
  expect(resident(demo, "Mara").messages.find(m => m.id === message)?.status).toBe("delivered");
  demo.advance(700);
  expect(resident(demo, "Mara").messages.find(m => m.id === message)?.status).toBe("read");
  demo.dispatch(mara.key, "interact", phoneKey, `reply ${JSON.stringify({ replyTo: message, text: "I will look for myself." })}`);
  demo.advance(4000);
  expect(resident(demo, "Mara").messages.filter(m => m.direction === "out").map(m => m.text)).toEqual(["I will look for myself."]);
  for (const id of demo.actors.filter(id => id !== mara.id)) expect(JSON.stringify(getPrivateCommunications(world, id))).not.toContain("PRIVATE_COASTAL_PHONE_941");
  expect(JSON.stringify({ entities: demo.snapshot().entities, events: demo.snapshot().events })).not.toContain("PRIVATE_COASTAL_PHONE_941");
  expect(() => demo.worldCommand("summon a stranger")).toThrow("only installed in Blackout");
});

test("an actual native branch complication publishes local observation without moving or deciding for residents", async () => {
  const demo = await fixture(); await demo.start(); drainPendingStimuli();
  const world = demo.sim.world, tree = demo.byId.get("square-tree-1")!, room = getRoomForEntity(world, tree)!;
  const before = bodies(demo), at = demo.atSimMs;
  expect(demo.storyEvents!.damage(Name.value[tree], room)).toMatchObject({ status: "applied", revision: 1, atSimMs: at });
  expect(ObjectState.current[tree]).toBe("branch_damage"); expect(demo.storyEvents!.verbs(tree)).toEqual(["clear_branches"]);
  expect(bodies(demo)).toEqual(before);
  expect(demo.snapshot().townLife!.changes).toContainEqual(expect.objectContaining({ spirit: "The Narrator", status: "applied", atSimMs: at,
    id: `story:${tree}:1:tree_damage` }));
  const local = demo.actors.filter(id => getRoomForEntity(world, id) === room), remote = demo.actors.filter(id => getRoomForEntity(world, id) !== room);
  expect(local.length).toBeGreaterThan(0);
  expect(local.some(id => peekPendingStimuli(id, world).some(s => s.modality === "auditory"))).toBe(true);
  for (const id of remote) expect(peekPendingStimuli(id, world)).toEqual([]);
  expect(demo.storyEvents!.damage(Name.value[tree], room).status).toBe("unchanged");
});

test("visible authored markings reach only the actual inspecting actor; private recollections are not exterior clues", async () => {
  const demo = await fixture(); await demo.start(); drainPendingStimuli();
  const world = demo.sim.world, ada = resident(demo, "Ada"), box = demo.byId.get("workshop-box")!, key = WorkingMemoryIdentity.id[box];
  const clue = "the middle one fresh and splintered, with pale paint caught in the middle cut.";
  const privatePast = "I cut two alignment marks into the supplies box lid to refit its hinge";
  expect(getRoomForEntity(world, ada.id)).toBe(getRoomForEntity(world, box));
  demo.dispatch(ada.key, "observe", key);
  expect(peekPendingStimuli(ada.id, world).some(row => row.content.includes(clue))).toBe(false);
  demo.advance(1000); // Inspection is a timed native action, not instant knowledge.
  expect(peekPendingStimuli(ada.id, world).map(row => row.content)).toEqual(expect.arrayContaining([expect.stringContaining(clue)]));
  expect(peekPendingStimuli(ada.id, world).some(row => row.content.includes(privatePast))).toBe(false);
  for (const id of demo.actors.filter(id => id !== ada.id)) {
    expect(JSON.stringify(peekPendingStimuli(id, world))).not.toContain(clue);
    expect(buildAgentContext(world, id)).not.toContain(privatePast);
    expect(JSON.stringify(getWorkingMemory(world, id))).not.toContain(clue);
  }
  drainPendingStimuli(); addComponent(world, ada.id, Traits); Traits.active[ada.id] = '["blind"]';
  demo.dispatch(ada.key, "observe", key);
  expect(peekPendingStimuli(ada.id, world).some(row => row.content.includes(clue))).toBe(false);
});

test.each([
  ["household", { scenario: "household", story: "coastal-mystery", evolving: true }],
  ["without evolution", { scenario: "town", story: "coastal-mystery", evolving: false }],
  ["custom world", { scenario: "town", story: "coastal-mystery", evolving: true, world: createLovecraftTownScenario() }],
])("coastal profile rejects incompatible authoring overrides: %s", async (_label, options) => {
  await expect(SpatialDemo.create({ ...options, live: false } as Parameters<typeof SpatialDemo.create>[0])).rejects.toThrow();
});

function weatherFixture() {
  const world = createArgosWorld(); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Outside" }), key = workingMemoryEntityRef(world, room)!.key;
  const record = jest.fn();
  const open = (initialCondition: SpatialWeatherCondition) => createSpatialWeather({ world, outdoorRooms: [{ id: room, key }],
    initialCondition, running: () => true, record });
  return { world, room, record, open };
}
test("opening weather cannot reset an existing source-reopened weather row or replenish its budget", () => {
  const f = weatherFixture(), first = f.open("cloudy");
  expect(first.view()).toMatchObject({ remainingChanges: 3 });
  expect(f.record).not.toHaveBeenCalled();
  expect(first.set("rain", f.room)).toMatchObject({ status: "applied", revision: 1 });
  first.close(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  const restored = f.open("clear");
  try {
    expect(restored.view()).toMatchObject({ remainingChanges: 2, rooms: [expect.objectContaining({ condition: "rain", revision: 1 })] });
    expect(restored.component.changedAtSimMs[f.room]).toBe(0); expect(restored.component.changeCount[f.room]).toBe(1);
    expect(restored.set("clear", f.room).status).toBe("rejected"); // Existing cooldown survives.
    expect(f.record).toHaveBeenCalledTimes(1);
  } finally { restored.close(); }
});
test("invalid opening weather fails before attaching native state", () => {
  const f = weatherFixture();
  expect(() => f.open("fog" as SpatialWeatherCondition)).toThrow("Unknown opening weather");
  const component = getComponent("SpatialWeather");
  expect(component && hasComponent(f.world, f.room, component)).toBeFalsy(); expect(f.record).not.toHaveBeenCalled();
});
