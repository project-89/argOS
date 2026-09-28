/** Host-issued physical effect authority. A model selects a strict operation;
 * it never supplies an executor, expected state or an ECS mutation script. */
import type { World } from "../ecs/world";
import type { SpiritRegistry } from "./spirit-registry";
import type { SpiritState } from "./types";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { captureSpiritSourceScope } from "./spirit-cycle-scope";
import { isEntityPresent } from "../ecs/entity-presence";
import { types as nodeTypes } from "node:util";

export type PhysicalEffectCommand = Readonly<{ operation: "weather"; condition: "clear" | "cloudy" | "rain" }
  | { operation: "tree_damage"; tree: string }>;
export type PhysicalEffectReceipt = { status: "applied" | "unchanged" | "rejected"; detail: string };
type NativeLease = { description: string; current(): boolean; execute(command: PhysicalEffectCommand, room: number): PhysicalEffectReceipt };
type Grant = { registry: SpiritRegistry; spirit: SpiritState; current(): boolean; capture(): NativeLease };
type Profile = { active: boolean; source: string; grants: Map<SpiritState, Grant> };
const profiles = new WeakMap<World, Profile>();

export function parsePhysicalEffectCommand(content: unknown): PhysicalEffectCommand | undefined {
  if (typeof content === "string" && content.length > 200) return;
  try {
    // Providers may encode this JSON value as an object or as JSON text. That
    // transport difference confers no extra authority. Read data descriptors,
    // never getters/toJSON/proxy traps, and return a fresh bounded command.
    const value = typeof content === "string" ? JSON.parse(content) : content;
    if (!value || typeof value !== "object" || nodeTypes.isProxy(value) || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || keys.some(key => typeof key !== "string")) return;
    const ownString = (key: string): string | undefined => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      return field?.enumerable && Object.hasOwn(field, "value") && typeof field.value === "string" ? field.value : undefined;
    };
    const operation = ownString("operation");
    if (operation === "weather") {
      const condition = ownString("condition");
      if (condition === "clear" || condition === "cloudy" || condition === "rain") return Object.freeze({ operation, condition });
    }
    if (operation === "tree_damage") {
      const tree = ownString("tree");
      if (tree !== undefined && tree.trim() === tree && tree.length > 0 && tree.length <= 120) return Object.freeze({ operation, tree });
    }
    return;
  } catch { return; }
}

/** Restriction persists as a closed tombstone after disposal: late work must
 * not fall back to legacy free-prose events or direct mood writes. */
export function installSpiritPhysicalEffectProfile(world: World) {
  assertSimulationTaskActive();
  const source = getCommittedEvents(world);
  if (!source.sourceId || source.stopped || profiles.get(world)?.active) throw Error("A current world needs one physical-effect profile");
  const profile: Profile = { source: source.sourceId, active: true, grants: new Map() };
  profiles.set(world, profile);
  const close = () => { profile.active = false; profile.grants.clear(); removeStop(); };
  const removeStop = subscribeCommittedSourceStop(world, close);
  return {
    register(registry: SpiritRegistry, spirit: SpiritState, capture: () => NativeLease) {
      assertSimulationTaskActive();
      if (!profile.active || profiles.get(world) !== profile || registry.world !== world || registry.spirits.get(spirit.eid) !== spirit
        || getCommittedEvents(world).stopped || getCommittedEvents(world).sourceId !== profile.source || profile.grants.has(spirit))
        throw Error("Physical effect registration requires an exact active spirit/world");
      const eid = spirit.eid, definition = spirit.definition, configuration = JSON.stringify(definition);
      const grant: Grant = { registry, spirit, capture, current: () => registry.world === world
        && spirit.eid === eid && registry.spirits.get(eid) === spirit && isEntityPresent(world, eid)
        && spirit.definition === definition && JSON.stringify(definition) === configuration };
      profile.grants.set(spirit, grant);
      return () => { if (profile.grants.get(spirit) === grant) profile.grants.delete(spirit); };
    },
    close,
  };
}

export function captureSpiritPhysicalEffects(world: World, spirit: SpiritState, registry: SpiritRegistry) {
  const profile = profiles.get(world), grant = profile?.grants.get(spirit);
  const sourceCurrent = captureSpiritSourceScope(world, spirit, registry);
  const lease = profile?.active && grant?.registry === registry && grant.current() ? grant.capture() : undefined;
  const current = () => !!profile && profile.active && profiles.get(world) === profile
    && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === profile.source
    && sourceCurrent() && !!grant && profile.grants.get(spirit) === grant && grant.registry === registry && grant.current() && !!lease?.current();
  return {
    restricted: !!profile,
    description: lease && current() ? lease.description : undefined,
    // A profile installed while inference was in flight also revokes legacy
    // physical writes. Actor-local advice remains advisory through its own guards.
    legacyAllowed: () => !profile && !profiles.has(world),
    execute(content: unknown, room: number, evidenceCurrent: () => boolean): PhysicalEffectReceipt {
      assertSimulationTaskActive();
      const command = parsePhysicalEffectCommand(content);
      if (!command || !current() || !evidenceCurrent()) return { status: "rejected", detail: "Physical effect authority, evidence or operation is invalid/stale." };
      return lease!.execute(command, room);
    },
  };
}
