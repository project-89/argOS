/** In-process delivery bindings. A report's content is historical, but its
 * destination and source epoch must not be silently replaced before receipt. */
import { randomUUID } from "node:crypto";
import { entityExists, hasComponent } from "bitecs";
import { GodAgent, Name, Removed, WorkingMemoryIdentity } from "../ecs/components";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import type { SpiritRegistry } from "./spirit-registry";
import type { DivineMessage } from "./types";
import type { World } from "../ecs/world";
import { captureSpiritRegistryLifetime } from "./spirit-cycle-scope";

const PREFIX = "scoped-spirit-message:";
/** Native timing only. Serialized/model-authored message data cannot supply it. */
export type SpiritMessageTiming = { expiresAtSimMs?: number };
const deliveries = new WeakMap<DivineMessage, { registry: SpiritRegistry; recipient: number; at: number;
  expiresAtSimMs?: number; current(): boolean }>();

export function bindSpiritMessageDelivery(registry: SpiritRegistry, message: DivineMessage,
  dependency: () => boolean = () => true, timing: SpiritMessageTiming = {}): void {
  const world = registry.world, source = getCommittedEvents(world), at = readSimulationTime(world);
  const expiresAtSimMs = timing.expiresAtSimMs;
  const validTiming = expiresAtSimMs === undefined || Number.isFinite(expiresAtSimMs) && expiresAtSimMs >= 0;
  const lifetimeCurrent = captureSpiritRegistryLifetime(registry);
  message.id = `${PREFIX}${randomUUID()}`;
  const { id, from, to, type, senderLabel } = message;
  const recipient = registry.spirits.get(to), definition = recipient?.definition;
  const isGod = to === registry.godAgentEid;
  const godRef = !recipient && isGod ? workingMemoryEntityRef(world, to) : undefined;
  deliveries.set(message, { registry, recipient: to, at, expiresAtSimMs, current: () => {
    const live = getCommittedEvents(world), now = readSimulationTime(world);
    if (!lifetimeCurrent() || !dependency() || registry.world !== world || source.stopped || live.stopped || live.sourceId !== source.sourceId
      || !Number.isFinite(at) || !Number.isFinite(now) || now < at || !validTiming
      || expiresAtSimMs !== undefined && now > expiresAtSimMs
      || message.id !== id || message.from !== from || message.to !== to || message.type !== type || message.senderLabel !== senderLabel
      || !entityExists(world, to) || hasComponent(world, to, Removed)
      || (to === registry.godAgentEid) !== isGod) return false;
    if (recipient) return registry.spirits.get(to) === recipient && recipient.eid === to && recipient.definition === definition;
    return !!godRef && !registry.spirits.has(to) && hasComponent(world, to, GodAgent)
      && hasComponent(world, to, Name) && Name.value[to] === godRef.label
      && hasComponent(world, to, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[to] === godRef.key;
  } });
}

/** Retain native delivery admission across the second (God autopilot) inbox.
 * A serialized/cross-world receipt cannot acquire a new local scope. */
export function captureGodMessageDelivery(world: World, recipient: number, message: DivineMessage): {
  at: number; expiresAtSimMs?: number; current(): boolean;
} | undefined {
  const binding=deliveries.get(message);
  if(!binding) return;
  return {at:binding.at,expiresAtSimMs:binding.expiresAtSimMs,current:()=>deliveries.get(message)===binding
    && binding.registry.world===world && binding.registry.godAgentEid===recipient
    && isCurrentSpiritMessage(binding.registry,message,recipient)};
}

export function isScopedSpiritMessage(message: DivineMessage): boolean {
  return deliveries.has(message) || typeof message.id==="string" && message.id.startsWith(PREFIX);
}

/** Legacy direct inbox producers remain a separate compatibility path. Scoped
 * copies/serialized receipts never downgrade to that path on a missing guard. */
export function isCurrentSpiritMessage(registry: SpiritRegistry, message: DivineMessage, recipient: number | undefined): boolean {
  const binding = deliveries.get(message);
  if (!binding) return typeof message.id === "string" && !message.id.startsWith(PREFIX);
  try { return binding.registry === registry && binding.recipient === recipient && binding.current(); }
  catch { return false; }
}
