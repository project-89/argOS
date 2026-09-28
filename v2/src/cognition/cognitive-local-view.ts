/** Current local evidence for cognition, separate from last-known world memory.
 * Capturing is a real sensing boundary. Formatting and freshness checks are pure:
 * a stale draft is discarded, never used to invent a receipt or remote fact. */
import { entityExists, hasComponent } from "bitecs";
import { Agent, Name, ObjectState, Room, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import type { World } from "../ecs/world";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { captureWorkingMemoryObservation } from "./working-memory-observation";
import { workingMemoryEntityRef } from "./working-memory";
import { getAgentObservableEntities, getAgentVisualEntities, getAgentWorldCapabilities, getAgentWorldCapabilityGeneration,
  getObservedPublicActivityEvidence, getObservedHeldItemExteriors, getObservedStateFields } from "./world-capabilities";
import { getSimulationBodyActivity, isSimulationResourceBusy, PUBLIC_PHYSICAL_OPERATIONS } from "../runtime/simulation-timeline";
import { isSpeaking } from "./timed-speech";
import { publicFacialExpression } from "./affect-state";
import { snapshotCharacterAppearance } from "../rendering/character-appearance";

interface LocalEntity {
  readonly key: string;
  readonly name: string;
  readonly kind: "person" | "object";
  readonly possession: boolean;
  readonly state?: string;
  readonly activity?: string;
  readonly expression?: string;
  readonly clothing?: string;
  readonly heldItems?: readonly Readonly<{ key: string; name: string }>[];
  readonly fields: Readonly<Record<string, string>>;
}
export interface CognitiveLocalView {
  readonly observedAt: number;
  readonly ownerKey: string;
  readonly room: string;
  readonly roomState?: string;
  readonly roomFields: Readonly<Record<string, string>>;
  readonly selfFields: Readonly<Record<string, string>>;
  readonly visual: boolean;
  readonly body: "occupied" | "free";
  readonly activity?: string;
  readonly entities: readonly LocalEntity[];
  readonly routes: readonly string[];
  readonly truncated: boolean;
}
interface Surface {
  view: Omit<CognitiveLocalView, "observedAt">;
  signature: string;
  generation: object | undefined;
  capability: ReturnType<typeof getAgentWorldCapabilities>;
  hooks: readonly unknown[];
}
interface Issuance { world: World; eid: number; surface: Surface; atMs: number }
const issuedViews = new WeakMap<CognitiveLocalView, Issuance>();
const validActor = (world: World, eid: number) => isEntityPresent(world, eid) && hasComponent(world, eid, Agent)
  && Agent.active[eid] && hasComponent(world, eid, WorkingMemoryIdentity) && !!WorkingMemoryIdentity.id[eid];
const identity = (world: World, eid: number): string => entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
  ? WorkingMemoryIdentity.id[eid] || `unobserved:${eid}` : `unobserved:${eid}`;
const name = (world: World, eid: number): string => entityExists(world, eid) && hasComponent(world, eid, Name)
  ? String(Name.value[eid] || "").slice(0, 240) : "";

function readSurface(world: World, eid: number): Surface | undefined {
  if (!validActor(world, eid)) return;
  const ownerKey = WorkingMemoryIdentity.id[eid], room = getRoomForEntity(world, eid);
  const capability = getAgentWorldCapabilities(world, eid), generation = getAgentWorldCapabilityGeneration(world, eid);
  const visual = getAgentSensoryCapabilities(world, eid).visual > 0;
  const visible = getAgentObservableEntities(world, eid);
  const visualEntities = new Set(getAgentVisualEntities(world, eid));
  const fields = visual ? getObservedStateFields(world, eid) : [];
  const fieldsFor = (key: string) => Object.freeze(Object.fromEntries(fields.filter(field => field.subject === key)
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map(field => [field.slot, field.value])));
  const selfFields = fieldsFor(ownerKey), roomFields = room === undefined ? Object.freeze({}) : fieldsFor(identity(world, room));
  const roomState = visual && room !== undefined && hasComponent(world, room, ObjectState)
    ? String(ObjectState.current[room] || "").slice(0, 240) : undefined;
  // The route catalog is the package's explicit public one-step movement menu,
  // not a scan of remote rooms/contents. Without a package, no route is invented.
  const suppliedRoutes = capability?.movementTargets?.() || [];
  const routes = [...new Set(Array.isArray(suppliedRoutes) ? suppliedRoutes : [])]
    .filter(target => Number.isSafeInteger(target) && isEntityPresent(world, target) && hasComponent(world, target, Room))
    .map(target => ({ key: identity(world, target), name: name(world, target), eid: target })).sort((a, b) => a.key.localeCompare(b.key));
  const bodyActivity = capability?.publicActivity?.() ?? getSimulationBodyActivity(world, eid);
  const activityKind = bodyActivity && ["moving", "holding", "operating"].includes(bodyActivity.kind) ? bodyActivity.kind : undefined;
  const activityTarget = bodyActivity?.targetEid;
  const ownTarget = activityTarget !== undefined && (visible.includes(activityTarget)
    || activityKind === "moving" && routes.some(route => route.eid === activityTarget));
  const operation = bodyActivity?.operation && PUBLIC_PHYSICAL_OPERATIONS.includes(bodyActivity.operation) ? bodyActivity.operation.replaceAll("_", " ") : activityKind;
  const speaking = isSpeaking(world, eid);
  const activity = activityKind ? `${operation}${ownTarget ? ` ${name(world, activityTarget!)}` : ""}${speaking ? " while speaking" : ""}` : speaking ? "speaking" : undefined;
  const body = capability?.busy() || isSimulationResourceBusy(world, eid, "body") ? "occupied" as const : "free" as const;
  const activityTargets: Array<[string, string | undefined]> = [];
  const publicActivities: Record<string, { kind: string; operation?: string; speaking?: boolean }> = {};
  const heldExteriors = getObservedHeldItemExteriors(world, eid);
  const entities = visible.map(target => {
    const key = identity(world, target), possession = getDirectContainer(world, target) === eid;
    const kind = hasComponent(world, target, Agent) ? "person" as const : "object" as const;
    const publicActivity = visualEntities.has(target) && kind === "person" ? getObservedPublicActivityEvidence(world, eid, target) : undefined;
    const activity = publicActivity ? `${publicActivity.operation?.replaceAll("_", " ") ?? publicActivity.kind}${publicActivity.targetLabel
      ? `${publicActivity.kind === "moving" ? " toward" : ""} ${publicActivity.targetLabel}` : ""}${publicActivity.speaking ? " while speaking" : ""}` : undefined;
    if (publicActivity) activityTargets.push([key, publicActivity.targetEid === undefined ? undefined : identity(world, publicActivity.targetEid)]);
    if (publicActivity) publicActivities[key] = { kind: publicActivity.kind, operation: publicActivity.operation, speaking: publicActivity.speaking };
    // Body activity supersedes stale generic Agent ObjectState='idle'. Neither
    // private mental mode nor planned route beyond a visible doorway is queried.
    const state = visualEntities.has(target) && kind !== "person" && hasComponent(world, target, ObjectState)
      ? String(ObjectState.current[target] || "").slice(0, 240) : undefined;
    const expression = visualEntities.has(target) && kind === "person" ? publicFacialExpression(world, target) : undefined;
    // Retain the supplied visible dress at the decision boundary, not only in
    // transient appearance-change notices. Project clothing only, never the
    // appearance snapshot's private possession list or inferred TV-canon traits.
    const clothing = visualEntities.has(target) && kind === "person"
      ? snapshotCharacterAppearance(world, target)?.clothing.slice(0, 512) : undefined;
    const heldItems = heldExteriors.filter(item => item.holderEid === target)
      .map(item => Object.freeze({ key: identity(world, item.eid), name: item.name }));
    return Object.freeze({ key, name: name(world, target), kind, possession, ...(state ? { state } : {}),
      ...(activity ? { activity } : {}), ...(expression ? { expression } : {}),
      ...(clothing ? { clothing } : {}),
      ...(heldItems.length ? { heldItems: Object.freeze(heldItems) } : {}), fields: fieldsFor(key) });
  }).sort((a, b) => a.key.localeCompare(b.key));
  const roomName = room === undefined ? "unknown location" : name(world, room);
  // All visible membership participates in the fence, even if a large room's
  // presentation is bounded. The list is never described as exhaustive.
  const view = Object.freeze({ ownerKey, room: roomName, visual, body, selfFields, roomFields,
    ...(roomState ? { roomState } : {}), ...(activity ? { activity } : {}),
    entities: Object.freeze(entities.slice(0, 32)), routes: Object.freeze(routes.map(route => route.name).slice(0, 20)),
    truncated: entities.length > 32 || routes.length > 20 });
  const signature = JSON.stringify({ ownerKey, room: room === undefined ? null : [identity(world, room), roomName],
    visual, body, activity, ownActivityTarget: ownTarget ? identity(world, activityTarget!) : undefined,
    activityTargets: activityTargets.sort(([a], [b]) => a.localeCompare(b)),
    publicActivities: Object.fromEntries(Object.entries(publicActivities).sort(([a], [b]) => a.localeCompare(b))),
    roomState, roomFields, selfFields, entities, routes: routes.map(({ key, name }) => ({ key, name })),
    persona: [Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]] });
  const hooks = [capability?.publicActivity, capability?.observableState, capability?.visibleEntities, capability?.movementTargets,
    ...visible.filter(target => hasComponent(world, target, Agent)).sort((a, b) => identity(world, a).localeCompare(identity(world, b))).flatMap(target =>
      [target, getAgentWorldCapabilityGeneration(world, target), getAgentWorldCapabilities(world, target)?.publicActivity])];
  if (!validActor(world, eid) || WorkingMemoryIdentity.id[eid] !== ownerKey || getRoomForEntity(world, eid) !== room
    || getAgentWorldCapabilities(world, eid) !== capability || getAgentWorldCapabilityGeneration(world, eid) !== generation
    || (getAgentSensoryCapabilities(world, eid).visual > 0) !== visual) return;
  return { view, signature, generation, capability, hooks };
}

function safeReadSurface(world: World, eid: number): Surface | undefined {
  try { return readSurface(world, eid); } catch { return; } // Broken package projection confers no fresh authority.
}

/** Explicit current sensing; call before building a model's request context. */
export function captureCognitiveLocalView(world: World, eid: number): Readonly<CognitiveLocalView> | undefined {
  if (!isEntityPresent(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return;
  let observation;
  try {
    observation = captureWorkingMemoryObservation(world, eid); if (!observation) return;
    // An explicit public destination is known as a route, not as remote contents.
    // Give it stable identity at this real request boundary so another consumer
    // assigning the same known room cannot invalidate an otherwise unchanged view.
    const routes = getAgentWorldCapabilities(world, eid)?.movementTargets?.();
    if (Array.isArray(routes)) for (const target of routes) if (Number.isSafeInteger(target) && isEntityPresent(world, target)
      && hasComponent(world, target, Room)) workingMemoryEntityRef(world, target);
  } catch { return; }
  const surface = safeReadSurface(world, eid); if (!surface || surface.view.ownerKey !== observation.ownerKey) return;
  const atMs = Date.now();
  const view: CognitiveLocalView = Object.freeze({ observedAt: atMs, ...surface.view });
  issuedViews.set(view, { world, eid, surface, atMs });
  return view;
}

/** No sensing receipt, identity allocation, world mutation or remote lookup. */
export function isCognitiveLocalViewCurrent(world: World, eid: number, view: CognitiveLocalView | undefined): boolean {
  const issued = view && issuedViews.get(view);
  if (!issued || issued.world !== world || issued.eid !== eid || Date.now() < issued.atMs) return false;
  const current = safeReadSurface(world, eid), old = issued.surface;
  return !!current && current.signature === old.signature && current.generation === old.generation
    && current.capability === old.capability && current.hooks.length === old.hooks.length
    && current.hooks.every((hook, index) => hook === old.hooks[index]);
}

/** Engine-issued dependency catalog for the immediate action, not a semantic
 * certificate for model prose. Historical interpretations remain historical.
 * Only actually presented local evidence can be selected; no remote queries. */
export function getLocalDependencyCatalog(view: CognitiveLocalView | undefined): readonly { id: string; description: string }[] {
  if (!view || !issuedViews.has(view)) return [];
  return [
    { id: "room", description: "Observed room state and public fields" },
    { id: "self", description: "Observed own body activity and public fields" },
    { id: "routes", description: "Public one-step route catalog" },
    ...(view.visual && !view.truncated ? [{ id: "occupants", description: "The observed local people remain the same, including nobody new arriving. Use when choosing where to go depends on who is here; not their posture, speech or private intentions." }] : []),
    ...view.entities.map(entity => ({ id: `entity:${entity.key}`, description: `${entity.name}: full current state, expression and activity; use when those facts must remain unchanged.` })),
    ...view.entities.filter(entity => entity.kind === "person").map(entity => ({ id: `presence:${entity.key}`,
      description: `${entity.name}: the same person remains locally observable. For addressing them or replying to heard words without requiring their current task or posture to stay unchanged.` })),
    ...view.entities.filter(entity => entity.kind === "person").map(entity => ({ id: `activity:${entity.key}`,
      description: `${entity.name}'s current physical activity, including looking/inspection. Cite when your action depends on it; incidental inspection does not invalidate speech about this person.` })),
  ];
}
export function validateLocalDependencies(view: CognitiveLocalView | undefined, value: unknown): readonly string[] | undefined {
  const ids = new Set(getLocalDependencyCatalog(view).map(row => row.id));
  if (!view || !issuedViews.has(view) || !Array.isArray(value) || value.length > 12
    || value.some(id => typeof id !== "string" || !ids.has(id)) || new Set(value).size !== value.length) return;
  return Object.freeze([...value]);
}
export type LocalDependencyKind = "actor" | "room" | "self" | "routes" | "occupants" | "entity" | "activity" | "presence";
export type LocalDependencyField = "identity" | "presence" | "room" | "senses" | "producer" | "body"
  | "activity" | "activity_target" | "possession" | "state" | "expression" | "public_fields" | "routes";
/** Exact engine-issued IDs and field categories only. Never private source
 * bodies, public prose values, raw model input or a new sensing receipt. */
export interface LocalDependencyChange {
  readonly reason: "invalid_issuance" | "surface_unavailable" | "producer_changed" | "actor_surface_changed" | "dependency_changed" | "whole_view_changed";
  readonly changed: readonly { readonly id: string; readonly kind: LocalDependencyKind; readonly fields: readonly LocalDependencyField[] }[];
}
export function getLocalDependencyChange(world: World, eid: number, view: CognitiveLocalView | undefined,
  dependencies: readonly string[], options: { actionType?: string } = {}): LocalDependencyChange | undefined {
  const change = (reason: LocalDependencyChange["reason"], changed: LocalDependencyChange["changed"] = []): LocalDependencyChange =>
    Object.freeze({ reason, changed: Object.freeze(changed.map(row => Object.freeze({ ...row, fields: Object.freeze([...row.fields]) }))) });
  const issued = view && issuedViews.get(view);
  if (!issued || issued.world !== world || issued.eid !== eid || Date.now() < issued.atMs
    || !validateLocalDependencies(view, dependencies)) return change("invalid_issuance");
  const current = safeReadSurface(world, eid), old = issued.surface;
  if (!current) return change("surface_unavailable");
  if (current.generation !== old.generation || current.capability !== old.capability) return change("producer_changed");
  const a = JSON.parse(old.signature), b = JSON.parse(current.signature);
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  // Actor, sensory capability, room identity and producer hooks never become
  // optional just because the model selected an empty dependency list.
  const actorFields: LocalDependencyField[] = [];
  if (!equal([a.ownerKey, a.persona], [b.ownerKey, b.persona])) actorFields.push("identity");
  if (!equal(a.room, b.room)) actorFields.push("room");
  if (a.visual !== b.visual) actorFields.push("senses");
  if (current.hooks.slice(0, 4).some((hook, index) => hook !== old.hooks[index])) actorFields.push("producer");
  if (actorFields.length) return change("actor_surface_changed", [{ id: "actor", kind: "actor", fields: actorFields }]);
  const select = (data: any, id: string): unknown => {
    if (id === "room") return [data.roomState, data.roomFields];
    if (id === "self") return [data.body, data.activity, data.ownActivityTarget, data.selfFields];
    if (id === "routes") return data.routes;
    // Only offered for a complete visual catalog. This detects arrival/departure
    // without consulting remote positions or making movement depend on every
    // unrelated change in the room. No person action/intent is inferred here.
    if (id === "occupants") return data.entities.filter((row: LocalEntity) => row.kind === "person")
      .map((row: LocalEntity) => [row.key, row.name]);
    const key = id.slice(id.indexOf(":") + 1);
    const entity = data.entities.find((row: LocalEntity) => row.key === key);
    if (id.startsWith("presence:")) return entity && { key: entity.key, name: entity.name, kind: entity.kind };
    if (id.startsWith("activity:")) return { entityKey: entity?.key, activity: entity?.activity,
      target: data.activityTargets.find(([owner]: [string]) => owner === key) };
    const physical = data.publicActivities[key];
    // A person looking at someone does not change their identity, possessions,
    // expression or the actual words a grounded conversational reply addresses.
    // Keep this in the displayed view, and retain strict activity:<id> evidence
    // when the chosen line specifically depends on that physical activity.
    if (options.actionType === "speak" && !dependencies.includes(`activity:${key}`)
      && physical?.kind === "operating" && physical.operation === "inspecting") {
      return { entity: { ...entity, activity: physical.speaking ? "speaking" : undefined },
        target: physical.speaking ? [key, undefined] : undefined };
    }
    // Include public activity target identity, not merely its display name.
    return { entity, target: data.activityTargets.find(([owner]: [string]) => owner === key) };
  };
  const changed: Array<LocalDependencyChange["changed"][number]> = [];
  for (const id of dependencies) {
    const kind = id.split(":")[0] as LocalDependencyKind;
    const fields: LocalDependencyField[] = [];
    // Function/object producer identity needs reference comparison, not JSON.
    if (["entity", "activity", "presence"].includes(kind)) {
      const personIndex = (data: any) => data.entities.filter((row: LocalEntity) => row.kind === "person")
        .findIndex((row: LocalEntity) => row.key === id.slice(id.indexOf(":") + 1));
      const ai = personIndex(a), bi = personIndex(b);
      if ((ai < 0) !== (bi < 0)) fields.push("presence");
      else if (ai >= 0 && old.hooks.slice(4 + ai * 3, 7 + ai * 3).some((hook, offset) => hook !== current.hooks[4 + bi * 3 + offset])) fields.push("producer");
    }
    const left: any = select(a, id), right: any = select(b, id);
    if (!equal(left, right)) {
      if (kind === "occupants") fields.push("presence");
      else if (kind === "presence") fields.push(!left || !right ? "presence" : "identity");
      else if (kind === "activity") {
        if (left?.entityKey !== right?.entityKey) fields.push("presence");
        if (left?.activity !== right?.activity) fields.push("activity");
        if (!equal(left?.target, right?.target)) fields.push("activity_target");
      } else if (kind === "entity") {
        if (!left?.entity || !right?.entity) fields.push("presence");
        if (!equal([left?.entity?.key, left?.entity?.name, left?.entity?.kind], [right?.entity?.key, right?.entity?.name, right?.entity?.kind])) fields.push("identity");
        for (const field of ["possession", "state", "activity", "expression"] as const) if (!equal(left?.entity?.[field], right?.entity?.[field])) fields.push(field);
        if (!equal(left?.entity?.fields, right?.entity?.fields)) fields.push("public_fields");
        if (!equal(left?.entity?.clothing, right?.entity?.clothing)) fields.push("public_fields");
        if (!equal(left?.entity?.heldItems, right?.entity?.heldItems)) fields.push("possession");
        if (!equal(left?.target, right?.target)) fields.push("activity_target");
      } else if (kind === "room") {
        if (!equal(a.roomState, b.roomState)) fields.push("state");
        if (!equal(a.roomFields, b.roomFields)) fields.push("public_fields");
      } else if (kind === "self") {
        if (a.body !== b.body) fields.push("body");
        if (a.activity !== b.activity) fields.push("activity");
        if (a.ownActivityTarget !== b.ownActivityTarget) fields.push("activity_target");
        if (!equal(a.selfFields, b.selfFields)) fields.push("public_fields");
      } else fields.push("routes");
    }
    if (fields.length) changed.push({ id, kind, fields: [...new Set(fields)] });
  }
  if (changed.length) return change("dependency_changed", changed);
}
export function areLocalDependenciesCurrent(world: World, eid: number, view: CognitiveLocalView | undefined,
  dependencies: readonly string[], options: { actionType?: string } = {}): boolean {
  return !getLocalDependencyChange(world, eid, view, dependencies, options);
}

export function formatCognitiveLocalView(view: CognitiveLocalView | undefined): string {
  if (!view) return "CURRENT LOCAL VIEW: unavailable. Retained locations and state are last-observed, not freshly confirmed.";
  return `CURRENT LOCAL VIEW (observed at request; distinct from remembered earlier scenes):\n` +
    `Your location: ${JSON.stringify(view.room)}. Your body: ${view.body}${view.activity ? `, ${view.activity}` : ""}.\n` +
    (view.roomState || Object.keys(view.roomFields).length ? `Local room surface: ${JSON.stringify({ ...(view.roomState ? { state: view.roomState } : {}), ...view.roomFields })}.\n` : "") +
    (Object.keys(view.selfFields).length ? `Your public instrument fields: ${JSON.stringify(view.selfFields)}.\n` : "") +
    (view.visual ? "Visible local people and objects" : "No visual observation; tangible own possessions") +
    `${view.truncated ? " (bounded sample)" : ""}:\n` +
    (view.entities.map(entity => `- ${JSON.stringify({ name: entity.name, kind: entity.kind,
      ...(entity.possession ? { inYourInventory: true } : {}), ...(entity.activity ? { activity: entity.activity } : {}),
      ...(entity.expression ? { expression: entity.expression } : {}),
      ...(entity.clothing ? { clothing: entity.clothing } : {}),
      ...(entity.heldItems?.length ? { visiblyHolding: entity.heldItems.map(item => item.name) } : {}),
      ...(entity.state ? { state: entity.state } : {}), ...entity.fields })}`).join("\n") || "(none observed)") +
    `\nPublic one-step destinations: ${view.routes.map(route => JSON.stringify(route)).join(", ") || "none supplied"}.\n` +
    "People absent from this local view may have been seen earlier; their current remote locations and actions are not established here.";
}
