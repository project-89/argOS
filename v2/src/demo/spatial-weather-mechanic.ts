/** One optional generated environmental mechanic. The host projects public
 * exposure and observes committed scalar results; it never implements wetting
 * or drying itself, or writes an inhabitant's thoughts/actions/feelings. */
import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Room, WorkingMemoryIdentity } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getAgentVisualEntities } from "../cognition/world-capabilities";
import { filterPerceivableStimuli, type SensoryEvent } from "../cognition/sensory-capabilities";
import { queueGuardedStimulus } from "../cognition/stimulus-queue";
import type { AcceptanceTest, BuildRequest } from "../engineering/contracts";
import type { PreparedRelease } from "../engineering/release";
import type { SpatialWeatherCondition } from "./spatial-weather";

export const SPATIAL_WEATHER_MECHANIC_SYSTEM = "SpatialRainWetness";
export const SPATIAL_WEATHER_EXPOSURE = "SpatialRainExposure";
export const SPATIAL_WETNESS = "SpatialWetness";
export type SpatialWetnessPhase = "dry" | "damp" | "wet";
export type SpatialWeatherMechanicTarget = { id: number; key: string; kind: "resident" | "furniture" };
export type SpatialWeatherMechanicReceipt = {
  id: string; sourceId: string; targetId: number; targetKey: string; name: string; roomId: number;
  atSimMs: number; before: SpatialWetnessPhase; phase: SpatialWetnessPhase; value: number; detail: string;
};
const INPUT_FIELDS = { eligible: "boolean", rainRate: "number", dryRate: "number", ownerKey: "string", sourceKey: "string" } as const;
/** Install after native prefab/registry initialization, before accepted worker
 * releases are restored. This defines a schema only, never target membership. */
export function registerSpatialWeatherExposureSchema(): void {
  extendDynamicComponent({ name: SPATIAL_WEATHER_EXPOSURE, description: "Host-owned public rain/shelter exposure, not actor cognition", properties: INPUT_FIELDS });
}
const phase = (value: number): SpatialWetnessPhase => value < .05 ? "dry" : value < .5 ? "damp" : "wet";
const sameNames = (actual: readonly string[], expected: readonly string[]) => actual.length === expected.length
  && new Set(actual).size === actual.length && expected.every(name => actual.includes(name));

/** A host policy, not instructions the worker can waive. Run on the exact
 * prepared release and again at admission/reload through CodingDaemon. */
export function assertSpatialWeatherMechanicRelease(release: PreparedRelease): void {
  const { systems } = release.manifest, component = release.components[0], system = systems[0];
  if (systems.length !== 1 || system.name !== SPATIAL_WEATHER_MECHANIC_SYSTEM || system.frequency !== 1
    || !sameNames(system.reads, [SPATIAL_WEATHER_EXPOSURE, SPATIAL_WETNESS])
    || !sameNames(system.writes, [`${SPATIAL_WETNESS}.value`])
    || release.components.length !== 1 || component.name !== SPATIAL_WETNESS
    || !sameNames(Object.keys(component.fields), ["value"])
    || component.fields.value.type !== "number" || component.fields.value.default !== 0)
    throw Error("This town permits only the one generated SpatialRainWetness mechanic and SpatialWetness.value; no other systems, components, reads or writes.");
}

function acceptance(name: string, values: { start?: number; rain?: number; dry?: number; eligible?: boolean;
  ticks?: number; deltaMs?: number; expected: number; attach?: boolean }): AcceptanceTest {
  return { name, system: SPATIAL_WEATHER_MECHANIC_SYSTEM,
    entities: [{ id: 1, components: {
      [SPATIAL_WEATHER_EXPOSURE]: { eligible: values.eligible ?? true, rainRate: values.rain ?? 0,
        dryRate: values.dry ?? 0, ownerKey: "public-target", sourceKey: "test-source" },
      ...(values.attach ? {} : { [SPATIAL_WETNESS]: { value: values.start ?? 0 } }),
    } }], ticks: values.ticks ?? 1, deltaMs: values.deltaMs ?? 10_000,
    expect: [{ entity: 1, component: SPATIAL_WETNESS, field: "value", equals: values.expected }] };
}

/** Operator-specified task. This is not a fabricated autonomous Weaver need or
 * God approval. Only a real coding worker can produce the implementation. */
export function createSpatialWeatherMechanicRequest(source = "operator"): BuildRequest {
  return { source, instruction: `Implement exactly one managed system named ${SPATIAL_WEATHER_MECHANIC_SYSTEM}, frequency 1. Read only ${SPATIAL_WEATHER_EXPOSURE} and ${SPATIAL_WETNESS}; write only ${SPATIAL_WETNESS}.value. Declare exactly one component ${SPATIAL_WETNESS}, with exactly value:number default 0. The host projects public, identity-bound rain exposure onto approved existing residents and furniture using ${SPATIAL_WEATHER_EXPOSURE}: eligible:boolean, rainRate:number, dryRate:number, ownerKey:string, sourceKey:string. Query exposure-bearing entities. Only eligible===true entities participate. Attach ${SPATIAL_WETNESS} if absent without resetting existing values. Integrate value = clamp(value + (rainRate - dryRate) * ctx.deltaMs / 1000, 0, 1). Read finite nonnegative host rates; ignore invalid inputs. Do not use wall time. Do not attach or change unmarked/ineligible entities. Include worker-authored positive and boundary tests. Do not alter exposure, descriptions, weather, position, inventory, cognition, needs, or any other component. The host separately presents physical wetness and commits threshold observations; do not emit events, force behavior, create entities, or invent plant growth.`,
    protectedConditions: ["Only the host marks exposure targets. Existing public rain and shelter determine input; a wetness worker may not change that input.",
      "Wetting/drying are physical scalar changes, never compulsory feelings, decisions, illness, damage, or goal changes.",
      "This is one explicit operator-requested build, not permission for replacement mechanics or autonomous broad engineering."],
    acceptance: [
      acceptance("host rain exposure accumulates in simulation seconds", { rain: .025, ticks: 2, expected: .5 }),
      acceptance("host finer time steps agree", { rain: .025, ticks: 8, deltaMs: 2500, expected: .5 }),
      acceptance("host clear air dries existing wetness", { start: .75, dry: .0125, ticks: 2, expected: .5 }),
      acceptance("host sheltered drying is slower", { start: .5, dry: .00625, ticks: 2, expected: .375 }),
      acceptance("host simultaneous rates integrate their net effect", { start: .5, rain: .025, dry: .0125, expected: .625 }),
      acceptance("host rain saturates rather than overflowing", { start: .9, rain: .025, expected: 1 }),
      acceptance("host drying stops at zero", { start: .1, dry: .0125, expected: 0 }),
      acceptance("host no exposure preserves water", { start: .5, expected: .5 }),
      acceptance("host revoked eligibility changes nothing", { start: .5, eligible: false, rain: .025, expected: .5 }),
      acceptance("host wetness attaches without fabricated prior history", { rain: .025, attach: true, expected: .25 }),
      { name: "host unmarked entities stay unchanged", system: SPATIAL_WEATHER_MECHANIC_SYSTEM,
        entities: [{ id: 1, components: { [SPATIAL_WETNESS]: { value: .5 } } }], ticks: 2, deltaMs: 10_000,
        expect: [{ entity: 1, component: SPATIAL_WETNESS, field: "value", equals: .5 }] },
    ] };
}

export function createSpatialWeatherMechanic(options: {
  world: World; targets: readonly SpatialWeatherMechanicTarget[];
  outdoorRooms: readonly { id: number; key: string }[];
  weather(): { rooms: readonly { id: number; key: string; condition: SpatialWeatherCondition }[] };
  running(): boolean; active(): boolean; record(receipt: SpatialWeatherMechanicReceipt): void;
}) {
  assertSimulationTaskActive();
  const { world } = options, source = getCommittedEvents(world), createdAt = readSimulationTime(world);
  const sourceId = source.sourceId ?? "", targets = options.targets.map(row => ({ ...row })), rooms = options.outdoorRooms.map(row => ({ ...row }));
  const present = (ref: { id: number; key: string }) => isEntityPresent(world, ref.id)
    && hasComponent(world, ref.id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[ref.id] === ref.key;
  const validTarget = (ref: SpatialWeatherMechanicTarget) => present(ref) && hasComponent(world, ref.id, Name)
    && (ref.kind === "resident" ? hasComponent(world, ref.id, Agent) && Agent.active[ref.id] : !hasComponent(world, ref.id, Agent));
  if (!sourceId || source.stopped || !Number.isFinite(createdAt) || createdAt < 0 || !targets.length || targets.length > 128
    || new Set(targets.map(row => row.id)).size !== targets.length || targets.some(row => !row.key || !validTarget(row))
    || !rooms.length || rooms.length > 32 || new Set(rooms.map(row => row.id)).size !== rooms.length
    || rooms.some(row => !row.key || !present(row) || !hasComponent(world, row.id, Room)))
    throw Error("Weather mechanics require bounded exact current targets, outdoor rooms and source.");
  registerSpatialWeatherExposureSchema();
  const exposure = getComponent(SPATIAL_WEATHER_EXPOSURE)!;
  for (const target of targets) {
    if (hasComponent(world, target.id, exposure) && exposure.ownerKey[target.id] !== target.key)
      throw Error("Existing rain exposure belongs to a replaced entity; it cannot be reassigned.");
    attachToEntity(world, target.id, SPATIAL_WEATHER_EXPOSURE, { eligible: false, rainRate: 0, dryRate: 0, ownerKey: target.key, sourceKey: sourceId });
  }
  let closed = false, sequence = 0;
  const phases = new Map<number, SpatialWetnessPhase>();
  const boundState = () => getCommittedEvents(world).sourceId === sourceId && readSimulationTime(world) >= createdAt
    && rooms.every(row => present(row) && hasComponent(world, row.id, Room));
  const current = () => !closed && options.running() && !getCommittedEvents(world).stopped && boundState();
  const ownedExposure = (target: SpatialWeatherMechanicTarget) => hasComponent(world, target.id, exposure)
    && exposure.ownerKey[target.id] === target.key && exposure.sourceKey[target.id] === sourceId;
  function disable() { for (const target of targets) if (isEntityPresent(world, target.id) && ownedExposure(target)) {
    exposure.eligible[target.id] = false; exposure.rainRate[target.id] = 0; exposure.dryRate[target.id] = 0;
  } }
  function close() { if (closed) return; disable(); closed = true; removeStop(); }
  const removeStop = subscribeCommittedSourceStop(world, close);
  // Restored physical wetness is a baseline, not a new rain event. Read only
  // current membership/identity here; fresh entities still start without an
  // output component until an admitted generated worker actually attaches it.
  for (const target of targets) {
    const restored = value(target);
    if (restored !== undefined) phases.set(target.id, phase(restored));
  }
  /** Call before worker-result admission as well as before the next dispatch.
   * Movement or weather changes then invalidate stale read snapshots. */
  function syncInputs() {
    assertSimulationTaskActive();
    if (!current()) { disable(); return; }
    const weather = options.weather().rooms;
    for (const target of targets) {
      if (!ownedExposure(target)) continue;
      const roomId = validTarget(target) ? getRoomForEntity(world, target.id) : undefined;
      const room = rooms.find(row => row.id === roomId), condition = room && weather.find(row => row.id === room.id && row.key === room.key)?.condition;
      const eligible = roomId !== undefined && isEntityPresent(world, roomId) && hasComponent(world, roomId, Room)
        && (!room || ["clear", "cloudy", "rain"].includes(condition ?? ""));
      exposure.eligible[target.id] = eligible;
      exposure.rainRate[target.id] = eligible && condition === "rain" ? .025 : 0;
      exposure.dryRate[target.id] = !eligible || condition === "rain" ? 0 : condition === "clear" ? .0125 : .00625;
    }
  }
  function value(target: SpatialWeatherMechanicTarget): number | undefined {
    const wetness = getComponent(SPATIAL_WETNESS), number = wetness?.value[target.id];
    return validTarget(target) && ownedExposure(target) && wetness && hasComponent(world, target.id, wetness)
      && typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
  }
  function message(target: SpatialWeatherMechanicTarget, wet: SpatialWetnessPhase, own = false): SensoryEvent {
    const person = target.kind === "resident", subject = own ? "Your clothes" : person ? `${Name.value[target.id]}'s clothes` : Name.value[target.id];
    return { type: own ? "touch" : "environmental", modality: own ? "tactile" : "visual", source: "physical wetness", intensity: .55,
      content: wet === "dry" ? `${subject} ${own || person ? "are" : "is"} dry.`
        : `${subject} ${own ? "feel" : person ? "look" : "looks"} ${wet}${own ? " against your skin" : ""}.` };
  }
  const visible = (actor: number, target: number) => getRoomForEntity(world, actor) === getRoomForEntity(world, target)
    && getAgentVisualEntities(world, actor).includes(target);
  /** Observe only admitted scalar state. No outcome may be inferred from a
   * worker proposal, narrative interpretation, or elapsed wall-clock time. */
  function collect() {
    if (!current() || !options.active()) return;
    // One local visibility resolution per observer for this synchronous pass.
    // Delivery guards resolve again later; they must not reuse this snapshot.
    const observers = targets.filter(row => row.kind === "resident" && validTarget(row));
    const visibleByActor = new Map<number, Set<number>>();
    for (const target of targets) {
      const number = value(target); if (number === undefined) continue;
      const next = phase(number), before = phases.get(target.id) ?? "dry";
      phases.set(target.id, next); if (next === before) continue;
      const roomId = getRoomForEntity(world, target.id); if (roomId === undefined) continue;
      const atSimMs = readSimulationTime(world), detail = message(target, next).content;
      const receipt: SpatialWeatherMechanicReceipt = { id: `wetness:${sourceId}:${target.key}:${++sequence}`, sourceId,
        targetId: target.id, targetKey: target.key, name: Name.value[target.id], roomId, atSimMs, before, phase: next, value: number, detail };
      options.record(receipt);
      for (const resident of observers) {
        const own = resident.id === target.id;
        if (!own) {
          if (getRoomForEntity(world, resident.id) !== roomId) continue;
          if (!visibleByActor.has(resident.id)) visibleByActor.set(resident.id, new Set(getAgentVisualEntities(world, resident.id)));
          if (!visibleByActor.get(resident.id)!.has(target.id)) continue;
        }
        const signal = message(target, next, own);
        for (const perceived of filterPerceivableStimuli(world, resident.id, [signal])) queueGuardedStimulus(world,
          { targetEid: resident.id, ...perceived }, () => current() && options.active() && validTarget(resident)
            && value(target) !== undefined && phase(value(target)!) === next && (own || visible(resident.id, target.id)));
      }
    }
  }
  function view() {
    const active = current() && options.active(), readable = boundState() && options.active();
    return { active, system: SPATIAL_WEATHER_MECHANIC_SYSTEM, sourceId, targets: targets.filter(validTarget).map(target => {
      const amount = readable ? value(target) : undefined;
      return { id: target.id, key: target.key, kind: target.kind, roomId: getRoomForEntity(world, target.id),
        value: amount ?? null, phase: amount === undefined ? "unavailable" as const : phase(amount),
        exposedToRain: ownedExposure(target) && exposure.eligible[target.id] && exposure.rainRate[target.id] > 0 };
    }) };
  }
  function localContext(actorId: number): string | undefined {
    const actor = targets.find(row => row.id === actorId && row.kind === "resident");
    if (!current() || !options.active() || !actor || !validTarget(actor)) return;
    const signals: SensoryEvent[] = [], seen = new Set(getAgentVisualEntities(world, actorId));
    for (const target of targets) {
      const amount = value(target); if (amount === undefined || phase(amount) === "dry") continue;
      if (target.id === actorId) signals.push(message(target, phase(amount), true));
      else if (seen.has(target.id)) signals.push(message(target, phase(amount)));
    }
    const perceived = filterPerceivableStimuli(world, actorId, signals);
    return perceived.length ? `Current physical wetness: ${perceived.map(row => row.content).join(" ")}` : undefined;
  }
  function getWetness(id: number): number | undefined {
    const target = targets.find(row => row.id === id);
    // A stopped recording retains its last real physical values. A different
    // source, removed/replaced entity or unadmitted system never inherits them.
    return boundState() && options.active() && target ? value(target) : undefined;
  }
  return { exposure, syncInputs, collect, view, localContext, close, getWetness, isCurrent: current };
}
