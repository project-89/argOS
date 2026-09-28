/** Native blackout mechanics. Cognition chooses actions; the spatial host owns
 * their admission, approach, duration, cancellation and outcome receipts. All
 * physical circuit/part state lives in ECS, not in a parallel scenario machine. */
import { addComponent, entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Container, Name, ObjectState, ObjectType, PhysicalObject, WorkingMemoryIdentity } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getDirectContainer, listDirectContents, setLocatedIn } from "../ecs/location";
import { syncInventoryCache, tryRemoveFromInventory } from "../ecs/inventory";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { transitionObjectState } from "../world/object-state";
import { worldSchema } from "../world/schema";

type Verb = "inspect" | "isolate" | "install" | "power_on";
type Phase = "fault" | "isolated" | "ready" | "powered";

/** A read-only physical snapshot, not execution authority. The host must retain
 * its issued action and enforce approach/time/package authority before commit. */
export type BlackoutOperation = Readonly<{
  actor: number; actorKey: string; target: number; targetKey: string;
  sourceId: string; verb: Verb; revision: number; isolated: boolean;
  requiredSpec: string; installedId: number; installedKey: string;
  part?: Readonly<{ id: number; key: string; name: string; spec: string; intact: boolean }>;
}>;

const validSpec = (value: unknown): value is string => typeof value === "string" && /^[A-Z0-9_-]{1,32}$/.test(value);
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < Number.MAX_SAFE_INTEGER;

/** Creation-time fixture setup only; never reinitialize an existing circuit to
 * restore or retry a run. Later stock can use the same SpatialRepairPart schema. */
export function createBlackout(world: World, ids: { panel: number; box: number; lamp: number; parts: number[] },
  options: { requiredSpec?: string } = {}) {
  assertSimulationTaskActive();
  const requiredSpec = options.requiredSpec ?? "A";
  const allIds = [ids.panel, ids.box, ids.lamp, ...ids.parts];
  if (!validSpec(requiredSpec) || ids.parts.length !== 2 || new Set(allIds).size !== allIds.length
    || allIds.some(id => !isEntityPresent(world, id) || !hasComponent(world, id, PhysicalObject)
      || !hasComponent(world, id, Name) || !Name.value[id]?.trim())) throw new Error("Blackout requires distinct current physical fixtures and two repair parts.");
  if (getCommittedEvents(world).stopped) throw new Error("Cannot initialize blackout in a stopped world.");
  const boxType = hasComponent(world, ids.box, ObjectType) ? worldSchema.getObjectType(ObjectType.typeId[ids.box]) : undefined;
  if (!hasComponent(world, ids.box, ObjectState) || !boxType?.states.closed) throw new Error("The supply box needs a native closed state.");
  const existing = getComponent("SpatialCircuit");
  if (existing && hasComponent(world, ids.panel, existing)) throw new Error("This circuit is already initialized; preserve its ECS state.");

  extendDynamicComponent({ name: "SpatialCircuit", description: "Native electrical circuit and exact installed-part binding", properties: {
    requiredSpec: "string", isolated: "boolean", installedId: "number", installedKey: "string",
    powered: "boolean", phase: "string", revision: "number",
  } });
  extendDynamicComponent({ name: "SpatialRepairPart", description: "Physical repair cartridge specification and condition", properties: {
    spec: "string", intact: "boolean",
  } });
  const component = getComponent("SpatialCircuit")!, partComponent = getComponent("SpatialRepairPart")!;
  const panelKey = workingMemoryEntityRef(world, ids.panel)!.key;
  const lampKey = workingMemoryEntityRef(world, ids.lamp)!.key;
  const sourceId = getCommittedEvents(world).sourceId;
  workingMemoryEntityRef(world, ids.box);
  attachToEntity(world, ids.panel, "SpatialCircuit", { requiredSpec, isolated: false, installedId: -1,
    installedKey: "", powered: false, phase: "fault", revision: 0 });
  for (const [id, capacity] of [[ids.panel, 1], [ids.box, 2]]) {
    if (!hasComponent(world, id, Container)) {
      addComponent(world, id, Container); Container.capacity[id] = capacity; Container.allowedTypes[id] = "[]";
    } else Container.capacity[id] = Math.max(capacity, Container.capacity[id] || 0);
  }
  const closed = transitionObjectState(world, ids.box, "closed", { world, worldSchema }, "blackout:initial_supply_box");
  if (!closed.ok) throw new Error(closed.error || "Could not close the supply box.");
  ids.parts.forEach((part, index) => {
    workingMemoryEntityRef(world, part);
    attachToEntity(world, part, "SpatialRepairPart", { spec: index === 0 ? "A" : "B", intact: true });
    PhysicalObject.portable[part] = true;
    const previous = getDirectContainer(world, part);
    setLocatedIn(world, part, ids.box);
    if (previous !== undefined) syncInventoryCache(world, previous);
  });
  syncInventoryCache(world, ids.panel); syncInventoryCache(world, ids.box);

  function key(id: number): string | undefined {
    return isEntityPresent(world, id) && hasComponent(world, id, WorkingMemoryIdentity)
      && typeof WorkingMemoryIdentity.id[id] === "string" && WorkingMemoryIdentity.id[id]
      ? WorkingMemoryIdentity.id[id] : undefined;
  }
  function currentPanel() {
    return key(ids.panel) === panelKey && hasComponent(world, ids.panel, PhysicalObject)
      && hasComponent(world, ids.panel, Container) && hasComponent(world, ids.panel, component);
  }
  function partPresent(id: number) {
    return key(id) !== undefined && hasComponent(world, id, PhysicalObject) && hasComponent(world, id, partComponent)
      && PhysicalObject.portable[id] === true && validSpec(partComponent.spec[id]);
  }
  function installed() {
    const part = component.installedId[ids.panel], boundKey = component.installedKey[ids.panel];
    return Number.isSafeInteger(part) && typeof boundKey === "string" && !!boundKey
      && partPresent(part) && key(part) === boundKey && getDirectContainer(world, part) === ids.panel
      && partComponent.intact[part] === true && partComponent.spec[part] === component.requiredSpec[ids.panel];
  }
  function physical() {
    const valid = currentPanel() && key(ids.lamp) === lampKey && hasComponent(world, ids.lamp, PhysicalObject)
      && validSpec(component.requiredSpec[ids.panel]) && typeof component.isolated[ids.panel] === "boolean";
    const fitted = valid && installed();
    const powered = fitted && component.isolated[ids.panel] === false;
    const phase: Phase = powered ? "powered" : valid && component.isolated[ids.panel]
      ? fitted ? "ready" : "isolated" : "fault";
    return { valid, powered, phase };
  }
  /** Derive caches from live bindings; never invent or consume a replacement.
   * Called after native mutations and each physical tick by the host. */
  function derive() {
    assertSimulationTaskActive();
    // A tombstone can retain its component row, but it is no longer powered
    // world matter. Clear this derived cache only on our exact original row;
    // deletion, detachment or a replacement lifetime never grants write access.
    if (getCommittedEvents(world).stopped || !entityExists(world, ids.panel)
      || !hasComponent(world, ids.panel, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[ids.panel] !== panelKey
      || !hasComponent(world, ids.panel, component)) return;
    const state = physical();
    if (component.powered[ids.panel] === state.powered && component.phase[ids.panel] === state.phase) return;
    if (!validRevision(component.revision[ids.panel])) return; // Corrupt state is not repair authority.
    component.powered[ids.panel] = state.powered; component.phase[ids.panel] = state.phase;
    component.revision[ids.panel]++;
  }
  function validate(operation: BlackoutOperation): string | undefined {
    const source = getCommittedEvents(world);
    if (!operation || !source.sourceId || source.stopped || source.sourceId !== operation.sourceId) return "The operation belongs to an expired world source.";
    if (operation.target !== ids.panel || operation.targetKey !== panelKey || !currentPanel()) return "The circuit is no longer the admitted physical target.";
    if (!hasComponent(world, operation.actor, Agent) || !Agent.active[operation.actor] || key(operation.actor) !== operation.actorKey) return "The actor is no longer active in this operation.";
    if (!["inspect", "isolate", "install", "power_on"].includes(operation.verb)) return "Unknown circuit operation.";
    if (!validRevision(component.revision[ids.panel]) || component.revision[ids.panel] !== operation.revision
      || component.requiredSpec[ids.panel] !== operation.requiredSpec || !validSpec(operation.requiredSpec)
      || component.isolated[ids.panel] !== operation.isolated || typeof operation.isolated !== "boolean"
      || component.installedId[ids.panel] !== operation.installedId || component.installedKey[ids.panel] !== operation.installedKey)
      return "The circuit changed after this operation was selected.";
    const state = physical();
    if (!state.valid || state.powered !== component.powered[ids.panel] || state.phase !== component.phase[ids.panel]) return "The physical circuit state changed; inspect the current condition.";
    if (operation.verb === "isolate" && operation.isolated) return "The circuit is already isolated.";
    if (operation.verb === "install") {
      if (!operation.isolated) return "Isolate the circuit before installing a cartridge.";
      if (installed()) return "A serviceable cartridge is already installed.";
      const part = operation.part;
      if (!part || !partPresent(part.id) || key(part.id) !== part.key || Name.value[part.id] !== part.name
        || getDirectContainer(world, part.id) !== operation.actor || partComponent.spec[part.id] !== part.spec
        || partComponent.intact[part.id] !== part.intact || part.intact !== true) return "The selected carried cartridge changed or is no longer intact.";
      if (part.spec !== operation.requiredSpec) return "That cartridge does not match the panel's socket.";
    }
    if (operation.verb === "power_on") {
      if (!operation.isolated) return "The circuit is not isolated; power is already selected.";
      if (!installed()) return "A matching intact cartridge must actually be installed before restoring power.";
    }
  }
  function prepare(actor: number, target: number, verb: string, content?: string):
    { ok: true; operation: BlackoutOperation; durationMs: number } | { ok: false; reason: string } {
    const source = getCommittedEvents(world), actorKey = key(actor);
    if (!source.sourceId || source.stopped || !actorKey || target !== ids.panel || !currentPanel()) return { ok: false, reason: "This circuit or actor is not currently available." };
    if (!["inspect", "isolate", "install", "power_on"].includes(verb)) return { ok: false, reason: "That circuit operation is not implemented." };
    let part: BlackoutOperation["part"];
    if (verb === "install") {
      const command = content?.trim() ?? "";
      if (command && !/^install(?:\s|$)/i.test(command)) return { ok: false, reason: "Use install followed by the exact carried cartridge name." };
      const requested = command.replace(/^install(?:\s+|$)/i, "").trim();
      // Do not secretly select the right answer when both labelled candidates
      // are carried. Compatibility is checked only after an unambiguous choice.
      const candidates = listDirectContents(world, actor).filter(id => partPresent(id)
        && (requested ? Name.value[id] === requested : partComponent.intact[id] === true));
      if (candidates.length !== 1) return { ok: false, reason: "Select exactly one cartridge you actually carry: install <exact name>." };
      const id = candidates[0];
      part = Object.freeze({ id, key: key(id)!, name: Name.value[id], spec: partComponent.spec[id], intact: partComponent.intact[id] });
    }
    const operation: BlackoutOperation = Object.freeze({ actor, actorKey, target, targetKey: panelKey, sourceId: source.sourceId,
      verb: verb as Verb, revision: component.revision[ids.panel], isolated: component.isolated[ids.panel],
      requiredSpec: component.requiredSpec[ids.panel], installedId: component.installedId[ids.panel], installedKey: component.installedKey[ids.panel],
      ...(part ? { part } : {}) });
    const reason = validate(operation);
    return reason ? { ok: false, reason } : { ok: true, operation,
      durationMs: verb === "install" ? 4000 : verb === "inspect" ? 1500 : 1000 };
  }
  function commit(operation: BlackoutOperation): { success: boolean; detail: string } {
    assertSimulationTaskActive();
    const reason = validate(operation); if (reason) return { success: false, detail: reason };
    if (operation.verb === "inspect") return { success: true, detail: installed()
      ? `Your inspection finds a serviceable installed cartridge. The socket label requires specification ${component.requiredSpec[ids.panel]}; the circuit is ${component.isolated[ids.panel] ? "isolated" : "powered"}.`
      : `Your inspection finds no serviceable installed cartridge. The socket label requires specification ${component.requiredSpec[ids.panel]}. Isolate the circuit, install an intact matching cartridge, then restore power.` };
    if (operation.verb === "install") {
      const result = tryRemoveFromInventory(world, operation.actor, operation.part!.id, ids.panel);
      if (!result.success) return { success: false, detail: result.reason };
      component.installedId[ids.panel] = operation.part!.id; component.installedKey[ids.panel] = operation.part!.key;
    } else component.isolated[ids.panel] = operation.verb === "isolate";
    derive();
    return { success: true, detail: operation.verb === "isolate" ? "You isolated the circuit. It is now safe to install a matching cartridge."
      : operation.verb === "install" ? `You installed the actual ${operation.part!.name}. The circuit remains isolated; power has not yet been restored.`
      : "You restored power. The apartment lamp is now illuminated." };
  }
  function verbs(target: number): string[] {
    if (target !== ids.panel || !currentPanel()) return [];
    return ["inspect", ...(component.isolated[ids.panel] ? installed() ? ["power_on"] : ["install"] : ["isolate"])];
  }
  function knownAffordances(target: number) {
    if (target !== ids.panel || !currentPanel()) return [];
    return [
      { name: "inspect", description: "Inspect the panel to learn its current condition and socket specification.", requires: [], opensEvidenceBoundary: true },
      { name: "isolate", description: "Disconnect power before replacing a cartridge.", requires: [] },
      { name: "install", description: "install <exact carried cartridge name>. Requires an isolated circuit and an intact matching cartridge in your possession.", requires: [] },
      { name: "power_on", description: "Restore power after a matching intact cartridge has been installed.", requires: [] },
    ];
  }
  /** Operator authority is deliberately narrower than an arbitrary ECS patch.
   * A delayed interpretation is valid only for the exact captured physical state.
   * Restoring power never fabricates, repairs or installs a cartridge. */
  function controlStamp(): string | undefined {
    const source = getCommittedEvents(world), state = physical();
    if (source.stopped || source.sourceId !== sourceId || !state.valid || !validRevision(component.revision[ids.panel])) return;
    const part = component.installedId[ids.panel];
    return JSON.stringify([sourceId, panelKey, lampKey, component.revision[ids.panel],
      component.requiredSpec[ids.panel], component.isolated[ids.panel], part, component.installedKey[ids.panel],
      key(part), partPresent(part), getDirectContainer(world, part), partComponent.spec[part], partComponent.intact[part],
      state.powered, state.phase]);
  }
  function controlPower(power: "on" | "off", expectedStamp: string) {
    assertSimulationTaskActive();
    if (!expectedStamp || controlStamp() !== expectedStamp) return { status: "rejected" as const, detail: "The circuit changed while the request was being interpreted. Try again against the current world." };
    if (power !== "on" && power !== "off") return { status: "rejected" as const, detail: "Unknown power operation." };
    if (power === "on" ? physical().powered : component.isolated[ids.panel] === true) return { status: "unchanged" as const,
      detail: power === "on" ? "The apartment light is already on." : "The lighting circuit is already disconnected; the lamp remains dark." };
    if (power === "on" && !installed()) return { status: "rejected" as const, detail: "Power cannot be restored: the panel still needs an intact matching cartridge. No repair was invented." };
    component.isolated[ids.panel] = power === "off";
    derive();
    return { status: "applied" as const, detail: power === "off"
      ? "Cut power at the lighting panel. The apartment lamp is dark; existing parts were left unchanged."
      : "Restored power through the existing repaired circuit. The apartment lamp is illuminated." };
  }
  function view(): { id: "blackout"; title: string; power: "off" | "on"; phase: string; complete: boolean } {
    const state = physical();
    return { id: "blackout", title: "Restore the apartment lights", power: state.powered ? "on" : "off",
      phase: state.valid ? state.phase : "unavailable", complete: state.powered };
  }
  return { component, partComponent, prepare, validate, commit, verbs, knownAffordances, derive, view, controlStamp, controlPower };
}
