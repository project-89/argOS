import { jest } from "@jest/globals";
import { addComponent, addEntity, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Mind, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { drainPendingStimuli, peekPendingStimuli } from "../../cognition/stimulus-queue";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createSpatialWeather, type SpatialWeatherReceipt } from "../spatial-weather";

function fixture() {
  const world = createArgosWorld("Weather boundary"); initializePrefabs(world); startCommittedEvents(world);
  const square = createRoomEntity(world, { name: "Square" }), park = createRoomEntity(world, { name: "Park" });
  const home = createRoomEntity(world, { name: "Home" });
  const actor = (name: string, roomId = square) => createAgentEntity(world, { name, roomId, role: "resident", systemPrompt: "I choose my own actions." });
  const ada = actor("Ada"), blind = actor("Blind resident"), deaf = actor("Deaf resident"), indoors = actor("Indoor resident", home);
  addComponent(world, blind, Traits); Traits.active[blind] = JSON.stringify(["blind"]);
  addComponent(world, deaf, Traits); Traits.active[deaf] = JSON.stringify(["deaf"]);
  const rooms = [square, park].map(id => ({ id, key: workingMemoryEntityRef(world, id)!.key }));
  const receipts: SpatialWeatherReceipt[] = [];
  let running = true;
  const weather = createSpatialWeather({ world, outdoorRooms: rooms, running: () => running, record: receipt => receipts.push(receipt) });
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  return { world, square, park, home, ada, blind, deaf, indoors, rooms, receipts, weather, advance, pause: () => { running = false; } };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Weather tests have no network")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("initial clear and unchanged requests create no invented event or budget use", () => {
  const f = fixture();
  expect(f.weather.view().rooms.map(room => room.condition)).toEqual(["clear", "clear"]);
  expect(f.weather.set("clear", f.square).status).toBe("unchanged");
  expect(f.weather.view().changes).toBe(0); expect(f.receipts).toEqual([]);
  expect(peekPendingStimuli(undefined, f.world)).toEqual([]); f.weather.close();
});
test("native rain produces only local perceivable observations, not emotion or action writes", () => {
  const f = fixture(), arousal = Mind.arousal[f.ada], active = Agent.active[f.ada];
  expect(f.weather.set("rain", f.square).status).toBe("applied");
  expect(f.weather.component.condition[f.square]).toBe("rain");
  expect(peekPendingStimuli(f.ada, f.world).map(row => row.modality)).toEqual(["visual", "auditory", "tactile", "olfactory"]);
  expect(peekPendingStimuli(f.blind, f.world).map(row => row.modality)).toEqual(["auditory", "tactile", "olfactory"]);
  expect(peekPendingStimuli(f.deaf, f.world).map(row => row.modality)).toEqual(["visual", "tactile", "olfactory"]);
  expect(peekPendingStimuli(f.indoors, f.world)).toEqual([]);
  expect(Mind.arousal[f.ada]).toBe(arousal); expect(Agent.active[f.ada]).toBe(active);
  expect(f.receipts).toHaveLength(1); f.weather.close();
});
test("three changes globally, sixty simulated seconds apart, without wall-clock shortcuts", () => {
  const f = fixture(); expect(f.weather.set("rain", f.square).status).toBe("applied");
  f.advance(59_999); expect(f.weather.set("cloudy", f.park).status).toBe("rejected");
  f.advance(1); expect(f.weather.set("cloudy", f.park).status).toBe("applied");
  expect(f.weather.set("cloudy", f.park).status).toBe("unchanged");
  f.advance(60_000); expect(f.weather.set("clear", f.square).status).toBe("applied");
  f.advance(60_000); expect(f.weather.set("rain", f.park).status).toBe("rejected");
  expect(f.weather.view()).toMatchObject({ changes: 3, remainingChanges: 0, available: false }); f.weather.close();
});
test("no indoors or arbitrary operation can become physical weather", () => {
  const f = fixture(); expect(f.weather.set("rain", f.home).status).toBe("rejected");
  expect(f.weather.set("hail" as any, f.square).status).toBe("rejected");
  expect(f.weather.view().changes).toBe(0); expect(f.receipts).toEqual([]); f.weather.close();
});
test.each(["close", "source-stop", "source-restart", "pause", "owner", "removed", "component", "rewind"])("%s revokes physical work and pending observations", kind => {
  const f = fixture(); f.advance(1000); expect(f.weather.set("rain", f.square).status).toBe("applied");
  if (kind === "close") f.weather.close();
  if (kind === "source-stop") stopCommittedEvents(f.world);
  if (kind === "source-restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "pause") f.pause();
  if (kind === "owner") WorkingMemoryIdentity.id[f.square] = "replacement";
  if (kind === "removed") removeEntity(f.world, f.square);
  if (kind === "component") removeComponent(f.world, f.square, f.weather.component);
  if (kind === "rewind") f.world.time.elapsed = 0;
  expect(f.weather.set("cloudy", f.park).status).toBe("rejected");
  expect(peekPendingStimuli(undefined, f.world)).toEqual([]); expect(f.receipts).toHaveLength(1); f.weather.close();
});
test("moving indoors before intake discards the old local observation", () => {
  const f = fixture(); f.weather.set("rain", f.square); setLocatedIn(f.world, f.ada, f.home);
  expect(peekPendingStimuli(f.ada, f.world)).toEqual([]); expect(peekPendingStimuli(f.blind, f.world)).toHaveLength(3); f.weather.close();
});
test("later arrival reads present local weather without inventing historical input", () => {
  const f = fixture(); f.weather.set("rain", f.square); drainPendingStimuli();
  expect(f.weather.localContext(f.indoors)).toBeUndefined();
  setLocatedIn(f.world, f.indoors, f.square);
  const contact = "Raindrops touch your skin and clothing. The rain brings a damp, earthy smell from the ground.";
  expect(f.weather.localContext(f.indoors)).toBe(`Current local weather: Rain is falling here. Rain patters around you. ${contact}`);
  expect(f.weather.localContext(f.blind)).toBe(`Current local weather: Rain patters around you. ${contact}`);
  expect(f.weather.localContext(f.deaf)).toBe(`Current local weather: Rain is falling here. ${contact}`);
  setLocatedIn(f.world, f.indoors, f.park);
  expect(f.weather.localContext(f.indoors)).toBe("Current local weather: The sky overhead is clear.");
  expect(peekPendingStimuli(undefined, f.world)).toEqual([]); expect(f.receipts).toHaveLength(1); f.weather.close();
});
test("present context requires current actor presence, identity and usable senses", () => {
  const f = fixture();
  expect(f.weather.localContext(f.blind)).toBeUndefined(); // Clear sky has no rain sound.
  Agent.active[f.ada] = false; expect(f.weather.localContext(f.ada)).toBeUndefined();
  Agent.active[f.ada] = true; removeComponent(f.world, f.ada, WorkingMemoryIdentity);
  expect(f.weather.localContext(f.ada)).toBeUndefined();
  expect(f.weather.localContext(f.square)).toBeUndefined(); f.weather.close();
  expect(f.weather.localContext(f.deaf)).toBeUndefined();
});
test("stopped or replaced source/room cannot supply present weather context", () => {
  const f = fixture(); f.weather.set("rain", f.square);
  WorkingMemoryIdentity.id[f.square] = "replacement-room";
  expect(f.weather.localContext(f.ada)).toBeUndefined();
  WorkingMemoryIdentity.id[f.square] = f.rooms[0].key;
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(f.weather.localContext(f.ada)).toBeUndefined(); f.weather.close();
});
test("record failure reports the committed weather rather than rolling it back or retrying", () => {
  const f = fixture(); f.weather.close();
  const weather = createSpatialWeather({ world: f.world, outdoorRooms: f.rooms, running: () => true, record: () => { throw Error("sink"); } });
  expect(weather.set("rain", f.square)).toMatchObject({ status: "applied", detail: expect.stringContaining("recording failed") });
  expect(weather.set("rain", f.square).status).toBe("unchanged"); expect(weather.view().changes).toBe(1); weather.close();
});
test("save and remapped restore preserve native condition, identity, cooldown and consumed budget", () => {
  const f = fixture(); f.weather.set("rain", f.square); f.advance(60_000); f.weather.set("cloudy", f.park);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry()))); f.weather.close();
  const world = createArgosWorld("Restored weather"); initializePrefabs(world); for (let n = 0; n < 12; n++) addEntity(world);
  const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), saved); startCommittedEvents(world);
  const square = oldToNewId.get(f.square)!, park = oldToNewId.get(f.park)!;
  const restored = createSpatialWeather({ world, outdoorRooms: f.rooms.map(row => ({ id: oldToNewId.get(row.id)!, key: row.key })), running: () => true, record: () => {} });
  expect(restored.view()).toMatchObject({ changes: 2, remainingChanges: 1, nextChangeAtSimMs: 120_000 });
  expect(restored.view().rooms.map(row => row.condition)).toEqual(["rain", "cloudy"]);
  expect(restored.set("clear", square).status).toBe("rejected");
  advanceSimulationTime(world, world.time.tick + 1, 60_000); expect(restored.set("clear", square).status).toBe("applied");
  advanceSimulationTime(world, world.time.tick + 1, 60_000); expect(restored.set("rain", park).status).toBe("rejected"); restored.close();
});
test("corrupted or replaced persisted owner is rejected, not silently reset", () => {
  const f = fixture(); f.weather.set("rain", f.square); f.weather.close();
  f.weather.component.ownerKey[f.square] = "wrong-owner";
  expect(() => createSpatialWeather({ world: f.world, outdoorRooms: f.rooms, running: () => true, record: () => {} })).toThrow(/invalid|replaced/);
});
