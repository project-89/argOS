/** Native, room-local weather. Renderer and perception derive from the same
 * durable ECS value; narrative prose never becomes a physical weather event. */
import { hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Room, WorkingMemoryIdentity } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { filterPerceivableStimuli } from "../cognition/sensory-capabilities";
import { queueGuardedStimulus } from "../cognition/stimulus-queue";
import { installSpiritPhysicalEffectProfile } from "../spirits/physical-effect-capabilities";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import type { SpiritState } from "../spirits/types";
import type { createSpatialStoryEvents } from "./spatial-story-events";

export type SpatialWeatherCondition = "clear" | "cloudy" | "rain";
export type SpatialWeatherReceipt = { status: "applied" | "unchanged" | "rejected"; detail: string;
  roomId: number; condition: SpatialWeatherCondition; atSimMs: number; revision?: number; origin?: "narrator" | "operator" };
const CONDITIONS = ["clear", "cloudy", "rain"] as const;
const MAX_CHANGES = 3, COOLDOWN_MS = 60_000;
/** Actual exposed rain, not an instruction about how a resident should feel. */
const rainContact = () => [
  { type: "touch", modality: "tactile" as const, source: "local weather", intensity: .55,
    content: "Raindrops touch your skin and clothing." },
  { type: "smell", modality: "olfactory" as const, source: "local weather", intensity: .4,
    content: "The rain brings a damp, earthy smell from the ground." },
];

export function createSpatialWeather(options: { world: World; outdoorRooms: readonly { id: number; key: string }[];
  /** Host profile budget, never supplied by a spirit or restored fiction. */
  limits?: { maxChanges: number; cooldownMs: number };
  /** Host-authored opening weather. Only seeds fresh rows; never resets a saved
   * condition or counts an initial scene as a Narrator intervention. */
  initialCondition?: SpatialWeatherCondition;
  running(): boolean; record(receipt: SpatialWeatherReceipt): void }) {
  assertSimulationTaskActive();
  const MAX_CHANGES = options.limits?.maxChanges ?? 3, COOLDOWN_MS = options.limits?.cooldownMs ?? 60_000;
  if (!Number.isSafeInteger(MAX_CHANGES) || MAX_CHANGES < 1 || MAX_CHANGES > 100
    || !Number.isSafeInteger(COOLDOWN_MS) || COOLDOWN_MS < 10_000 || COOLDOWN_MS > 3_600_000)
    throw Error("Invalid host weather budget");
  if (options.initialCondition !== undefined && !CONDITIONS.includes(options.initialCondition)) throw Error("Unknown opening weather condition");
  const { world } = options, rooms = options.outdoorRooms.map(room => ({ ...room }));
  const source = getCommittedEvents(world).sourceId, createdAt = readSimulationTime(world);
  const roomCurrent = (room: { id: number; key: string }) => isEntityPresent(world, room.id)
    && hasComponent(world, room.id, Room) && hasComponent(world, room.id, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[room.id] === room.key && hasComponent(world, room.id, Name);
  if (!source || getCommittedEvents(world).stopped || !Number.isFinite(createdAt) || createdAt < 0
    || !rooms.length || rooms.length > 32 || new Set(rooms.map(room => room.id)).size !== rooms.length
    || rooms.some(room => !room.key || !roomCurrent(room))) throw Error("Weather requires exact current approved outdoor rooms.");
  extendDynamicComponent({ name: "SpatialWeather", description: "Native outdoor weather; persisted state, revision and bounded change budget", properties: {
    ownerKey: "string", condition: "string", revision: "number", changeCount: "number", changedAtSimMs: "number",
  } });
  const component = getComponent("SpatialWeather")!;
  const stateCurrent = (room: typeof rooms[number]) => roomCurrent(room) && hasComponent(world, room.id, component)
    && component.ownerKey[room.id] === room.key && CONDITIONS.includes(component.condition[room.id])
    && Number.isSafeInteger(component.revision[room.id]) && component.revision[room.id] >= 0
    && Number.isSafeInteger(component.changeCount[room.id]) && component.changeCount[room.id] >= 0
    && component.changeCount[room.id] <= MAX_CHANGES && component.revision[room.id] === component.changeCount[room.id]
    && Number.isFinite(component.changedAtSimMs[room.id]) && component.changedAtSimMs[room.id] >= -1
    && (component.changeCount[room.id] === 0 ? component.changedAtSimMs[room.id] === -1 : component.changedAtSimMs[room.id] >= 0);
  for (const room of rooms) if (hasComponent(world, room.id, component) && !stateCurrent(room))
    throw Error("Existing weather state is invalid or belongs to a replaced room; it cannot be reset.");
  const profile = installSpiritPhysicalEffectProfile(world);
  for (const room of rooms) if (!hasComponent(world, room.id, component)) attachToEntity(world, room.id, "SpatialWeather", {
    ownerKey: room.key, condition: options.initialCondition ?? "clear", revision: 0, changeCount: 0, changedAtSimMs: -1,
  });
  let closed = false;
  const current = () => !closed && options.running() && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === source && Number.isFinite(readSimulationTime(world))
    && readSimulationTime(world) >= createdAt && rooms.every(stateCurrent)
    && rooms.every(room => component.changedAtSimMs[room.id] <= readSimulationTime(world));
  const changes = () => rooms.reduce((sum, room) => sum + component.changeCount[room.id], 0);
  const lastChange = () => Math.max(...rooms.map(room => component.changedAtSimMs[room.id]));
  const stamp = () => JSON.stringify(rooms.map(room => [room.id, room.key, Name.value[room.id], component.ownerKey[room.id],
    component.condition[room.id], component.revision[room.id], component.changeCount[room.id], component.changedAtSimMs[room.id]]));
  const removers: Array<() => void> = [];
  function close() { if (closed) return; closed = true; profile.close(); for (const remove of removers.splice(0)) remove(); removeStop(); }
  const removeStop = subscribeCommittedSourceStop(world, close);

  function set(condition: SpatialWeatherCondition, roomId: number, expectedStamp?: string, origin: "narrator" | "operator" = "narrator"): SpatialWeatherReceipt {
    assertSimulationTaskActive();
    const atSimMs = readSimulationTime(world), room = rooms.find(row => row.id === roomId);
    const receipt = (status: SpatialWeatherReceipt["status"], detail: string): SpatialWeatherReceipt => ({ status, detail, roomId, condition, atSimMs, origin,
      ...(room && stateCurrent(room) ? { revision: component.revision[roomId] } : {}) });
    if (!CONDITIONS.includes(condition) || !current() || !room || expectedStamp !== undefined && stamp() !== expectedStamp)
      return receipt("rejected", "Weather source, room, state or operation changed; nothing applied.");
    if (component.condition[roomId] === condition) return receipt("unchanged", "The weather in this outdoor area is already unchanged.");
    if (changes() >= MAX_CHANGES) return receipt("rejected", `This weather session has reached its ${MAX_CHANGES}-change limit.`);
    if (lastChange() >= 0 && atSimMs - lastChange() < COOLDOWN_MS) return receipt("rejected", `Weather changes require ${COOLDOWN_MS / 1000} seconds of simulation time between them.`);
    const before = component.condition[roomId] as SpatialWeatherCondition;
    component.condition[roomId] = condition; component.revision[roomId]++;
    component.changeCount[roomId]++; component.changedAtSimMs[roomId] = atSimMs;
    const revision = component.revision[roomId];
    const visual = condition === "rain" ? "Rain starts falling in this outdoor area."
      : condition === "cloudy" ? "Clouds cover the sky above this outdoor area."
      : "The clouds clear and the sky above this outdoor area brightens.";
    const signals = [{ type: "environmental", modality: "visual" as const, source: "local weather", content: visual, intensity: .6 },
      ...(condition === "rain" || before === "rain" ? [{ type: "sound", modality: "auditory" as const, source: "local weather",
        content: condition === "rain" ? "You hear rain pattering around you outside." : "The patter of rain around you outside stops.", intensity: .5 }] : []),
      ...(condition === "rain" ? rainContact() : [])];
    let failed = false;
    for (const actor of query(world, [Agent])) {
      if (!Agent.active[actor] || getRoomForEntity(world, actor) !== roomId) continue;
      for (const signal of filterPerceivableStimuli(world, actor, signals)) {
        try { if (!queueGuardedStimulus(world, { targetEid: actor, ...signal }, () => current() && stateCurrent(room)
          && component.revision[roomId] === revision && getRoomForEntity(world, actor) === roomId)) failed = true; }
        catch { failed = true; }
      }
    }
    const result = receipt("applied", `Native weather in ${Name.value[roomId]} changed to ${condition}.${failed ? " Some local observation delivery failed." : ""}`);
    try { options.record(result); } catch { result.detail += " Physical state committed; receipt recording failed."; }
    return result;
  }
  function view() {
    const valid = rooms.every(stateCurrent), count = valid ? changes() : MAX_CHANGES, last = valid ? lastChange() : -1;
    return { rooms: rooms.filter(stateCurrent).map(room => ({ id: room.id, key: room.key,
      condition: component.condition[room.id] as SpatialWeatherCondition, revision: component.revision[room.id] as number })),
      changes: count, remainingChanges: Math.max(0, MAX_CHANGES - count), nextChangeAtSimMs: last < 0 ? createdAt : last + COOLDOWN_MS,
      available: current() && count < MAX_CHANGES };
  }
  /** Present sensory context, not a replayed arrival event or a global forecast. */
  function localContext(actorId: number): string | undefined {
    if (!current() || !isEntityPresent(world, actorId) || !hasComponent(world, actorId, Agent)
      || !Agent.active[actorId] || !hasComponent(world, actorId, WorkingMemoryIdentity)
      || !WorkingMemoryIdentity.id[actorId]) return;
    const room = rooms.find(row => row.id === getRoomForEntity(world, actorId));
    if (!room) return;
    const condition = component.condition[room.id] as SpatialWeatherCondition;
    const signals = [{ type: "environmental", modality: "visual" as const, source: "local weather", intensity: .6,
      content: condition === "rain" ? "Rain is falling here." : condition === "cloudy" ? "The sky overhead is cloudy." : "The sky overhead is clear." },
      ...(condition === "rain" ? [{ type: "sound", modality: "auditory" as const, source: "local weather", intensity: .5, content: "Rain patters around you." }, ...rainContact()] : [])];
    const perceived = filterPerceivableStimuli(world, actorId, signals);
    return perceived.length ? `Current local weather: ${perceived.map(row => row.content).join(" ")}` : undefined;
  }
  function registerNarrator(registry: SpiritRegistry, spirit: SpiritState,
    storyEvents?: ReturnType<typeof createSpatialStoryEvents>) {
    if (spirit.definition.name !== "The Narrator" || spirit.definition.domain !== "narrative") throw Error("Only the exact host-selected Narrator receives weather authority.");
    const remove = profile.register(registry, spirit, () => {
      const captured = stamp(), story = storyEvents?.capture();
      return { description: `Optional native world_effect: content must be exactly JSON, for example {"operation":"weather","condition":"rain"}; condition may also be "clear" or "cloudy". Target one listed outdoor room by exact name. ${MAX_CHANGES} changes maximum and ${COOLDOWN_MS / 1000} simulated seconds between changes. Remaining changes: ${Math.max(0, MAX_CHANGES - changes())}; next eligible simulation time: ${lastChange() < 0 ? createdAt : lastChange() + COOLDOWN_MS}ms. Current approved areas: ${JSON.stringify(rooms.map(room => ({ name: Name.value[room.id], condition: component.condition[room.id] })))}.`,
        current: () => current() && stamp() === captured && (!story || story.current()),
        execute: (command, roomId) => command.operation === "weather" ? set(command.condition, roomId, captured)
          : story ? story.execute(command, roomId) : { status: "rejected" as const, detail: "This world has no native story-event grant." },
        ...(story ? { description: `Native effects: Current simulation time: ${readSimulationTime(world)}ms; next eligible weather simulation time: ${lastChange() < 0 ? createdAt : lastChange() + COOLDOWN_MS}ms. Weather content: {"operation":"weather","condition":"rain"}, or "cloudy"/"clear". Target an approved outdoor room by exact name. ${Math.max(0, MAX_CHANGES - changes())} weather changes remain, ${COOLDOWN_MS / 1000} simulated seconds apart. Current areas: ${JSON.stringify(rooms.map(room => ({ name: Name.value[room.id], condition: component.condition[room.id] })))}. ${story.description}` } : {}) };
    });
    removers.push(remove); return remove;
  }
  return { component, view, localContext, set, registerNarrator, close };
}
