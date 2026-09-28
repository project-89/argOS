/** Real narrative events for the author of a spatial world: a sound in the
 * dark, something arriving on a doorstep, a lamp that flickers, a text from an
 * unknown number. Each is a native change with a receipt: perceptions go to
 * residents who could actually sense it, props are inspectable entities, and
 * phone texts land on the resident's physical phone. Residents still decide
 * what any of it means and what to do. The Narrator and God share one budget. */
import { hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Description, Name, ObjectState, Room } from "../ecs/components";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { filterPerceivableStimuli } from "../cognition/sensory-capabilities";
import { queueGuardedStimulus } from "../cognition/stimulus-queue";
import { isAgentVisualEntity } from "../cognition/world-capabilities";
import { registerNarrativeHost, type NarrativeEventOrigin, type NarrativeEventReceipt, type NarrativeHost } from "../god/narrative-authority";

export const NARRATIVE_EVENT_OPERATIONS = ["sound", "arrival", "lights", "phone_message"] as const;
export type NarrativeEventOperation = typeof NARRATIVE_EVENT_OPERATIONS[number];
export type NarrativeEventCommand = Readonly<
  | { operation: "sound"; place: string; sound: string }
  | { operation: "arrival"; place: string; object: string; description: string; text?: string; sound?: string }
  | { operation: "lights"; place: string; effect: "flicker" | "out" }
  | { operation: "phone_message"; resident: string; text: string; from: string }>;
export type SpatialNarrativeReceipt = NarrativeEventReceipt & { id: string;
  /** Safe to show every viewer; never a private phone body. */
  publicDetail: string; privateDetail?: string };
/** Text, when present, is private to whoever reads the object. */
export type StoryPropSpec = { name: string; description: string; text?: string };

const DEFAULT_LIMITS = { maxEvents: 24, cooldownMs: 20_000 };
const LIGHTS_OUT_MS = 45_000;
const clean = (value: unknown, min: number, max: number): string | undefined => {
  if (typeof value !== "string") return;
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").replace(/\s+/g, " ").trim();
  return text.length >= min && text.length <= max ? text : undefined;
};

/** Accepts a plain object or JSON text; reads only known data fields. */
export function parseNarrativeEventCommand(content: unknown): NarrativeEventCommand | undefined {
  let value: unknown = content;
  if (typeof content === "string") { if (content.length > 4000) return; try { value = JSON.parse(content); } catch { return; } }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const field = (key: string) => { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined; };
  const operation = field("operation");
  if (operation === "sound") {
    const place = clean(field("place"), 1, 120), sound = clean(field("sound"), 3, 300);
    return place && sound ? Object.freeze({ operation, place, sound }) : undefined;
  }
  if (operation === "arrival") {
    const place = clean(field("place"), 1, 120), object = clean(field("object"), 2, 80), description = clean(field("description"), 8, 600);
    const text = field("text") === undefined || field("text") === "" ? undefined : clean(field("text"), 1, 800);
    const sound = field("sound") === undefined || field("sound") === "" ? undefined : clean(field("sound"), 3, 200);
    if (!place || !object || !description || field("text") && !text) return;
    return Object.freeze({ operation, place, object, description, ...(text ? { text } : {}), ...(sound ? { sound } : {}) });
  }
  if (operation === "lights") {
    const place = clean(field("place"), 1, 120), effect = field("effect") ?? "flicker";
    return place && (effect === "flicker" || effect === "out") ? Object.freeze({ operation, place, effect }) : undefined;
  }
  if (operation === "phone_message") {
    const resident = clean(field("resident"), 1, 80), text = clean(field("text"), 1, 500);
    const from = field("from") === undefined || field("from") === "" ? "Unknown number" : clean(field("from"), 1, 40);
    return resident && text && from ? Object.freeze({ operation, resident, text, from }) : undefined;
  }
}

export function createSpatialNarrativeEvents(options: {
  world: World;
  rooms: readonly { id: number; key: string; outdoor: boolean }[];
  lamps?: readonly { id: number; key: string }[];
  running(): boolean;
  /** Host creates a real, visible, inspectable prop and returns its entity. */
  placeProp?(roomId: number, spec: StoryPropSpec): number | undefined;
  /** Host delivers a text to the resident's physical phone; false if none. */
  sendPhoneText?(actor: number, text: string, from: string): boolean;
  /** Host presentation cue (renderer only). */
  cue?(entity: number, kind: "sound" | "action", text: string): void;
  record(receipt: SpatialNarrativeReceipt): void;
  limits?: { maxEvents: number; cooldownMs: number };
  mechanicGuidance?: string;
}) {
  assertSimulationTaskActive();
  const { world } = options, source = getCommittedEvents(world).sourceId, createdAt = readSimulationTime(world);
  const limits = options.limits ?? DEFAULT_LIMITS;
  if (!Number.isSafeInteger(limits.maxEvents) || limits.maxEvents < 1 || limits.maxEvents > 200
    || !Number.isSafeInteger(limits.cooldownMs) || limits.cooldownMs < 5_000 || limits.cooldownMs > 3_600_000)
    throw Error("Invalid narrative event budget");
  if (!source || getCommittedEvents(world).stopped || !options.rooms.length) throw Error("Narrative events need a live source and places");
  const rooms = options.rooms.map(r => ({ ...r })), lamps = (options.lamps ?? []).map(l => ({ ...l }));
  let closed = false, count = 0, lastAt = -1, sequence = 0;
  const dark = new Map<number, { until: number; description: string; state: string; roomId: number; ambience: string }>();
  const current = () => !closed && options.running() && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === source;
  const now = () => readSimulationTime(world);
  const roomByName = (name: string) => {
    const lower = name.trim().toLowerCase();
    return rooms.find(r => isEntityPresent(world, r.id) && hasComponent(world, r.id, Room) && Name.value[r.id]?.toLowerCase() === lower);
  };
  const residentByName = (name: string) => {
    const lower = name.trim().toLowerCase();
    const matches = [...query(world, [Agent, Name])].filter(id => Agent.active[id] && Name.value[id]?.toLowerCase() === lower);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const residents = () => [...query(world, [Agent, Name])].filter(id => Agent.active[id]);
  function deliver(actor: number, signals: Array<{ type: string; modality: "visual" | "auditory"; content: string; intensity: number; source: string }>,
    guard: () => boolean, visualTarget?: number): boolean {
    let failed = false;
    const roomId = getRoomForEntity(world, actor);
    for (const row of filterPerceivableStimuli(world, actor, signals)
      .filter(s => s.modality !== "visual" || visualTarget === undefined || isAgentVisualEntity(world, actor, visualTarget))) {
      try { if (!queueGuardedStimulus(world, { targetEid: actor, ...row }, () => current() && guard() && getRoomForEntity(world, actor) === roomId)) failed = true; }
      catch { failed = true; }
    }
    return failed;
  }
  function finish(receipt: SpatialNarrativeReceipt): SpatialNarrativeReceipt {
    try { options.record(receipt); } catch { receipt.detail += " Native state committed; receipt recording failed."; }
    return receipt;
  }
  function soundFrom(roomId: number, sound: string, intensity = .8): boolean {
    const room = rooms.find(r => r.id === roomId)!, roomName = Name.value[roomId];
    let failed = false;
    for (const actor of residents()) {
      const here = getRoomForEntity(world, actor);
      if (here === roomId) failed = deliver(actor, [{ type: "sound", modality: "auditory", source: "the world", intensity,
        content: `You hear ${sound.replace(/\.$/, "")}.` }], () => true) || failed;
      else if (room.outdoor && here !== undefined) failed = deliver(actor, [{ type: "sound", modality: "auditory", source: "the world",
        intensity: intensity * .55, content: `Faintly, from ${roomName}, you hear ${sound.replace(/\.$/, "")}.` }], () => true) || failed;
    }
    return failed;
  }

  function stage(content: unknown, origin: NarrativeEventOrigin = "narrator"): SpatialNarrativeReceipt {
    assertSimulationTaskActive();
    const atSimMs = now(), command = parseNarrativeEventCommand(content);
    const id = `narrative-event:${source}:${++sequence}`;
    const reject = (detail: string, operation = command?.operation ?? "unknown"): SpatialNarrativeReceipt =>
      ({ id, status: "rejected", operation, detail, publicDetail: detail, atSimMs, origin });
    if (!command) return reject("The event did not match the catalogue (sound, arrival, lights, phone_message) and its fields.");
    if (!current()) return reject("The world is not running; nothing happened.");
    if (count >= limits.maxEvents) return reject(`This session's ${limits.maxEvents}-event story budget is spent.`);
    if (lastAt >= 0 && atSimMs - lastAt < limits.cooldownMs)
      return reject(`Let the last event land: the next one can happen from ${lastAt + limits.cooldownMs}ms of world time.`);
    const applied = (detail: string, publicDetail: string, extra: Partial<SpatialNarrativeReceipt> = {}): SpatialNarrativeReceipt => {
      count++; lastAt = atSimMs;
      return finish({ id, status: "applied", operation: command.operation, detail, publicDetail, atSimMs, origin, ...extra });
    };
    if (command.operation === "phone_message") {
      const actor = residentByName(command.resident);
      if (actor === undefined) return reject(`There is no resident named ${command.resident}.`);
      if (!options.sendPhoneText) return reject("Phones are not wired in this world.");
      let sent = false;
      try { sent = options.sendPhoneText(actor, command.text, command.from); } catch { sent = false; }
      if (!sent) return reject(`${Name.value[actor]} has no phone that can receive a text right now.`);
      return applied(`A text from "${command.from}" arrived on ${Name.value[actor]}'s phone: "${command.text}"`,
        `${Name.value[actor]}'s phone buzzes with a new message.`, { privateDetail: command.text, roomId: getRoomForEntity(world, actor) });
    }
    const room = roomByName(command.place);
    if (!room) return reject(`There is no place named ${command.place}. Use an exact place name.`);
    const roomName = Name.value[room.id];
    if (command.operation === "sound") {
      const failed = soundFrom(room.id, command.sound);
      options.cue?.(room.id, "sound", command.sound.slice(0, 60));
      return applied(`In ${roomName}: ${command.sound}${failed ? " (some listeners could not be reached)" : ""}`,
        `A sound in ${roomName}: ${command.sound}`, { roomId: room.id });
    }
    if (command.operation === "arrival") {
      if (!options.placeProp) return reject("This world cannot place new objects.");
      const lower = command.object.toLowerCase();
      if ([...query(world, [Name])].some(eid => Name.value[eid]?.toLowerCase() === lower))
        return reject(`Something named "${command.object}" already exists; give the new object a distinct name.`);
      const description = `${command.description}${command.text ? " There is writing on it." : ""}`.slice(0, 1400);
      let entity: number | undefined;
      try { entity = options.placeProp(room.id, { name: command.object, description, ...(command.text ? { text: command.text } : {}) }); } catch { entity = undefined; }
      if (entity === undefined || !isEntityPresent(world, entity)) return reject("The object could not be placed there.");
      let failed = command.sound ? soundFrom(room.id, command.sound, .7) : false;
      for (const actor of residents()) if (getRoomForEntity(world, actor) === room.id)
        failed = deliver(actor, [{ type: "environmental", modality: "visual", source: "the world", intensity: .7,
          content: `Something is here that wasn't a moment ago: ${command.object}.` }], () => isEntityPresent(world, entity!), entity) || failed;
      options.cue?.(entity, command.sound ? "sound" : "action", command.sound ? command.sound.slice(0, 60) : "something new");
      return applied(`${command.object} appeared in ${roomName}. ${description}${command.text ? ` It reads: "${command.text}"` : ""}`,
        `${command.object} is now in ${roomName}.`, { roomId: room.id, entityId: entity });
    }
    // lights
    const roomLamps = lamps.filter(l => isEntityPresent(world, l.id) && getRoomForEntity(world, l.id) === room.id);
    if (!roomLamps.length) return reject(`${roomName} has no lamp to flicker.`);
    const lamp = roomLamps[0], lampName = Name.value[lamp.id];
    if (command.effect === "out") {
      if (dark.has(lamp.id)) return reject(`${lampName} is already dark.`);
      dark.set(lamp.id, { until: atSimMs + LIGHTS_OUT_MS, description: Description.value[lamp.id] ?? "", state: ObjectState.current[lamp.id] ?? "normal",
        roomId: room.id, ambience: Room.ambience[room.id] ?? "" });
      ObjectState.current[lamp.id] = "unlit"; Description.value[lamp.id] = `${Description.value[lamp.id] ?? lampName} It has gone dark.`;
      Room.ambience[room.id] = "dark";
    }
    let failed = false;
    for (const actor of residents()) if (getRoomForEntity(world, actor) === room.id)
      failed = deliver(actor, [{ type: "environmental", modality: "visual", source: "the world", intensity: .75,
        content: command.effect === "out" ? `${lampName} flickers and goes out. The room drops into shadow.` : `${lampName} flickers, dims to almost nothing, then steadies.` }],
        () => command.effect === "flicker" || dark.has(lamp.id), lamp.id) || failed;
    options.cue?.(lamp.id, "action", command.effect === "out" ? "lamp out" : "flicker");
    return applied(`${lampName} in ${roomName} ${command.effect === "out" ? "went out" : "flickered"}.`,
      `${lampName} in ${roomName} ${command.effect === "out" ? "goes dark" : "flickers"}.`, { roomId: room.id, entityId: lamp.id });
  }
  /** Relight lamps whose dark spell has run out. Called on the world tick. */
  function tick() {
    if (!current()) return;
    for (const [lampId, row] of [...dark]) {
      if (now() < row.until) continue;
      dark.delete(lampId);
      if (!isEntityPresent(world, lampId)) continue;
      ObjectState.current[lampId] = row.state; Description.value[lampId] = row.description; Room.ambience[row.roomId] = row.ambience;
      for (const actor of residents()) if (getRoomForEntity(world, actor) === row.roomId)
        deliver(actor, [{ type: "environmental", modality: "visual", source: "the world", intensity: .6,
          content: `${Name.value[lampId]} comes back on by itself.` }], () => true, lampId);
      options.cue?.(lampId, "action", "light returns");
      finish({ id: `narrative-event:${source}:${++sequence}`, status: "applied", operation: "lights", origin: "narrator", atSimMs: now(),
        roomId: row.roomId, entityId: lampId, detail: `${Name.value[lampId]} came back on by itself.`, publicDetail: `${Name.value[lampId]} comes back on.` });
    }
  }
  function view() {
    return { available: current() && count < limits.maxEvents, events: count, remainingEvents: Math.max(0, limits.maxEvents - count),
      nextEventAtSimMs: lastAt < 0 ? createdAt : lastAt + limits.cooldownMs, darkLamps: dark.size };
  }
  function describe(): string {
    const places = rooms.filter(r => isEntityPresent(world, r.id)).map(r => `${Name.value[r.id]}${r.outdoor ? " (outdoors)" : ""}`);
    const lit = [...new Set(lamps.filter(l => isEntityPresent(world, l.id)).map(l => getRoomForEntity(world, l.id)).filter((r): r is number => r !== undefined))].map(r => Name.value[r]);
    const v = view();
    return [`Story events (${v.remainingEvents} of ${limits.maxEvents} left; at least ${limits.cooldownMs / 1000}s of world time apart; next possible at ${v.nextEventAtSimMs}ms):`,
      `- {"operation":"sound","place":"<place>","sound":"three slow knocks at the door"} — heard clearly there${rooms.some(r => r.outdoor) ? ", faintly everywhere if outdoors" : ""}.`,
      `- {"operation":"arrival","place":"<place>","object":"<new unique name>","description":"what anyone looking sees","text":"optional words written on it","sound":"optional sound as it arrives"} — a real object anyone can examine and pick up; whoever reads it learns the text.`,
      ...(lit.length ? [`- {"operation":"lights","place":"<place with a lamp>","effect":"flicker"|"out"} — "out" lasts about ${LIGHTS_OUT_MS / 1000}s. Lamps in: ${lit.join(", ")}.`] : []),
      ...(options.sendPhoneText ? [`- {"operation":"phone_message","resident":"<resident>","text":"the message","from":"optional sender label; default Unknown number"} — lands on their physical phone; they must pick it up and read it.`] : []),
      `Places: ${places.join(", ")}.`].join("\n");
  }
  const host: NarrativeHost = { describe, stage: (command, origin) => stage(command, origin), operations: NARRATIVE_EVENT_OPERATIONS,
    ...(options.mechanicGuidance ? { mechanicGuidance: options.mechanicGuidance } : {}) };
  const unregister = registerNarrativeHost(world, host);
  function close() { if (closed) return; closed = true; unregister(); removeStop(); }
  const removeStop = subscribeCommittedSourceStop(world, close);
  /** Only the host-selected Narrator may stage directly; God stages via its tool. */
  function grantNarrator(spirit: object) { host.narrator = spirit; }
  return { stage, tick, view, describe, close, grantNarrator, host };
}
