/** World-package hooks around the shared cognition/action pipeline.
 * Packages add physical capabilities and feedback, never a replacement brain.
 * Weak world scoping avoids leaking one simulation's handlers into another. */
import type { World } from "../ecs/world";
import type { AgentAction } from "./agent-mind";
import type { AffordanceDefinition } from "../world/schema";
import { requireRuntimePackage } from "../runtime/package-requirements";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { entityExists, hasComponent } from "bitecs";
import { Agent, Container, Name, ObjectState, PhysicalObject, Room, Surface, Traits, WorkingMemoryIdentity } from "../ecs/components";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { isSpeaking } from "./timed-speech";
import { getSimulationBodyActivity, PUBLIC_PHYSICAL_OPERATIONS, type SimulationBodyActivity, type PublicPhysicalOperation } from "../runtime/simulation-timeline";
import { getRoomRouteTargets, getRoomRouteTopologyGeneration } from "../runtime/room-routes";
import { getPhysicalHeldItems } from "../ecs/held-items";
export type { PublicPhysicalOperation } from "../runtime/simulation-timeline";

/** Explicit public instrument/surface state, never a raw component dump. */
export type ObservableStateField =
    | { key: string; type: "boolean"; value: boolean }
    | { key: string; type: "enum"; values: readonly string[]; value: string };
export interface ObservedStateField {
    readonly subject: string;
    readonly subjectLabel: string;
    readonly slot: string;
    readonly type: "boolean" | "enum";
    readonly allowedValues: readonly string[];
    readonly value: string;
}
export const OBSERVABLE_STATE_LIMITS = { fieldsPerTarget: 8, fieldsPerObservation: 64, enumValues: 12 } as const;

export interface AgentWorldCapabilities {
    /** Schema and current value of a deliberately public local surface. The
     * shared reader gates sight, containment and identity before calling this.
     * Do not include private answers, internal flags, or inferred remote state. */
    observableState?(targetEid: number): readonly ObservableStateField[];
    /** Physical motion visible on this actor, never their private intention,
     * command arguments, thought, diagnosis or destination after another room. */
    publicActivity?(): SimulationBodyActivity | undefined;
    /** Public, actor-known completion conditions supplied by world rules. */
    goalCompletionOptions?(): import("./goal-lifecycle").GoalCompletionOption[];
    /** This package is the sole locomotion authority. Native grid/schedule
     * locomotion must not move the actor behind its back; cognition still selects
     * movement intentions and schedules still supply goals. */
    ownsMovement?: boolean;
    context(): string;
    ready(): boolean;
    /** Pure, exact package admission for releasing/cancelling its current work. */
    canInterruptBusyAction?(action: AgentAction): boolean;
    busy(): boolean;
    visibleEntities?(): number[];
    /** Public destinations reachable by one movement action from the actor's
     * current position. An empty list means no current route, not a global fallback. */
    movementTargets?(): number[];
    /** Pure host projection of generic schema/document operations it actually
     * executes or delegates. Omission retains the default native catalogue.
     * Returning true never grants access or bypasses live prerequisites. Host
     * affordances/knownAffordances below remain its authoritative installed
     * catalogue, including operations known before their prerequisites hold. */
    supportsNativeAffordance?(targetEid: number, name: string): boolean;
    affordances?(targetEid: number): AffordanceDefinition[];
    /** Actor-known operations on a currently seen target, including operations
     * whose prerequisites are not met yet. Pure public catalogue: no private
     * answers, hidden arguments or predicted effects. The shared reader gates
     * sight/containment before calling this. Not execution authority; every
     * stored step still uses live affordances/prerequisites at dispatch. Keep
     * requiresFreshDecision on operations that cannot be pre-scripted. */
    knownAffordances?(targetEid: number): AffordanceDefinition[];
    /** Omniscient facts for the narrator ONLY; never appended to NPC context. */
    narrativeEvidence?(): unknown;
    /** Open a foreground request. finish() releases request resources/latency
     * bookkeeping when inference returns; it is NOT action admission and must
     * not invalidate an otherwise current proposal. The executor subsequently
     * rechecks isCurrent() while consuming the staged action and mental update.
     * Bind validity to a durable request generation, cancellation and package
     * lifetime, independently of the map/flag tracking an in-flight request.
     * A newer decision or world edit may revoke that generation; finish() itself
     * must be idempotent and must not clear a newer request's resources. */
    beginDecision?(): { signal: AbortSignal; isCurrent(): boolean; finish(): void };
    /** true means this package owns execution, including deferred completion.
     * Retain the received action's engine-issued executionId with pending work;
     * return that exact action to completeDeferredAction. Reconstructed actions,
     * altered command arguments and callbacks from older attempts are rejected. */
    execute(action: AgentAction): boolean;
    afterAction?(action: AgentAction, succeeded: boolean, pending: boolean): void;
    onThought?(entity: number, content: string, type: string): void;
    onPerception?(entity: number, content: string, type: string, source: string): void;
    /** Operator-only diagnostics; never feed back into NPC perception or prompts. */
    onPlanningEvent?(event: import("./planning-telemetry").PlanningEvent): void;
    /** Subjective self-review, distinct from objective task-completion proof. */
    onSocialGoalSatisfied?(goalId: number, reason: string): void;
}
const packages = new WeakMap<World, Map<number, AgentWorldCapabilities>>();
const observableOwners = new WeakMap<World, Map<number, string>>();
const packageGenerations = new WeakMap<World, Map<number, object>>();
type RoutedCapabilities = { topology: object; base: AgentWorldCapabilities | undefined; baseGeneration: object | undefined;
    capabilities: AgentWorldCapabilities; generation: object };
const routedPackages = new WeakMap<World, Map<number, RoutedCapabilities>>();
function routedCapabilities(world: World, eid: number): RoutedCapabilities | undefined {
    const topology = getRoomRouteTopologyGeneration(world); if (!topology) return;
    const base = packages.get(world)?.get(eid), baseGeneration = packageGenerations.get(world)?.get(eid);
    let agents = routedPackages.get(world); if (!agents) { agents = new Map(); routedPackages.set(world, agents); }
    const previous = agents.get(eid);
    if (previous?.topology === topology && previous.base === base && previous.baseGeneration === baseGeneration) return previous;
    const movementTargets = () => getRoomRouteTargets(world, eid);
    const delegate: AgentWorldCapabilities = base ?? {
        context: () => "", ready: () => true, busy: () => false, execute: () => false,
    };
    // Do not proxy the package itself: a frozen package's non-configurable
    // movementTargets property cannot legally be overridden by a Proxy get.
    const capabilities = new Proxy({} as AgentWorldCapabilities, {
        get: (_target, property) => property === "movementTargets" ? movementTargets
            : property === "ownsMovement" ? true : Reflect.get(delegate, property, delegate),
        has: (_target, property) => property === "movementTargets" || property === "ownsMovement" || property in delegate,
    });
    const value = { topology, base, baseGeneration, capabilities, generation: Object.freeze({}) };
    agents.set(eid, value); return value;
}
export function registerAgentWorldCapabilities(world: World, eid: number, capabilities: AgentWorldCapabilities): () => void {
    let agents = packages.get(world);
    if (!agents) { agents = new Map(); packages.set(world, agents); }
    if (agents.has(eid)) throw new Error(`World capabilities already registered for agent ${eid}`);
    requireRuntimePackage(world, "native-agent-world-capabilities");
    agents.set(eid, capabilities);
    let generations = packageGenerations.get(world);
    if (!generations) { generations = new Map(); packageGenerations.set(world, generations); }
    const generation = Object.freeze({}); generations.set(eid, generation);
    if (capabilities.observableState && hasComponent(world, eid, Agent) && Agent.active[eid]) {
        // Registration is a real package/actor boundary, not prompt formatting.
        const owner = workingMemoryEntityRef(world, eid);
        if (owner) {
            let owners = observableOwners.get(world);
            if (!owners) { owners = new Map(); observableOwners.set(world, owners); }
            owners.set(eid, owner.key);
        }
    }
    return () => {
        if (generations!.get(eid) !== generation) return;
        agents!.delete(eid); observableOwners.get(world)?.delete(eid); generations!.delete(eid);
    };
}
export function getAgentWorldCapabilities(world: World, eid: number) {
    return routedCapabilities(world, eid)?.capabilities ?? packages.get(world)?.get(eid);
}
/** Opaque in-process binding identity. Reusing a capability object after
 * unregistering still creates a distinct authority lifetime. Pure lookup. */
export function getAgentWorldCapabilityGeneration(world: World, eid: number): object | undefined {
    return routedCapabilities(world, eid)?.generation ?? packageGenerations.get(world)?.get(eid);
}

function publicTraits(world: World, eid: number): string[] {
    if (!hasComponent(world, eid, Traits)) return [];
    try { const values = JSON.parse(Traits.active[eid] || "[]"); return Array.isArray(values)
        ? values.filter(v => typeof v === "string").map(v => v.trim().toLowerCase()) : []; }
    catch { return []; }
}
function concealed(world: World, eid: number): boolean {
    return !isEntityPresent(world,eid) || publicTraits(world, eid).some(trait => ["hidden", "invisible", "concealed"].includes(trait));
}
/** Canonical public containment boundary. A stale trait cannot open a physically
 * closed/locked container. Unknown container state is opaque, not assumed open. */
export function isPublicContainerOpen(world: World, eid: number): boolean {
    if (!isEntityPresent(world, eid) || hasComponent(world, eid, Agent)) return false;
    const state = hasComponent(world, eid, ObjectState) ? String(ObjectState.current[eid] || "").trim().toLowerCase() : "";
    return !/\b(closed|locked)\b/.test(state) && (state === "open" || publicTraits(world, eid).includes("open")
        || hasComponent(world, eid, Surface) && !hasComponent(world, eid, Container));
}
function observableSurface(world: World, actor: number, target: number, room: number, visible: Set<number>): boolean {
    if (!entityExists(world, target) || target !== actor && target !== room && !visible.has(target)
        || concealed(world, target) || target !== room && getRoomForEntity(world, target) !== room) return false;
    if (target === actor || target === room) return true;
    const visited = new Set<number>([target]);
    let parent = getDirectContainer(world, target);
    // Legacy direct-room named entities remain compatible. Contents newly
    // discovered behind a physical parent need an actual physical type; a
    // Name-bearing message/data record is not a visible item or readable label.
    if (parent !== undefined && parent !== actor && parent !== room
        && !hasComponent(world, target, PhysicalObject) && !hasComponent(world, target, Agent)) return false;
    while (parent !== undefined && visited.size <= 16) {
        if (parent === actor || parent === room) return true;
        if (visited.has(parent) || !entityExists(world, parent) || !visible.has(parent) || concealed(world, parent)
            || hasComponent(world, parent, Agent)) return false;
        // A parent is a physical enclosure through LocatedIn even if legacy
        // authoring omitted the Container marker. Package IDs cannot bypass it.
        if (!isPublicContainerOpen(world, parent)) return false;
        visited.add(parent); parent = getDirectContainer(world, parent);
    }
    return false;
}
/** Direct possessions known through touch/proprioception, not their labels,
 * screen contents, concealed interior, or another person's inventory. Pure. */
export function getAgentTangibleEntities(world: World, actor: number): number[] {
    if (!isEntityPresent(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]) return [];
    return listDirectContents(world, actor).filter(target => target !== actor && isEntityPresent(world, target)).sort((a, b) => a - b);
}
/** One pure visual surface graph for prose, menus, memory and freshness. Native
 * open containers are traversed with bounded depth; package-advertised surfaces
 * pass the same containment/concealment gate. No identity or evidence is created.
 * Sound/smell deliberately use their own emission rules, never this visual list. */
export function getAgentVisualEntities(world: World, actor: number): number[] {
    if (!isEntityPresent(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
        || getAgentSensoryCapabilities(world, actor).visual <= 0) return [];
    const room = getRoomForEntity(world, actor); if (room === undefined || !entityExists(world, room)) return [];
    const capability = getAgentWorldCapabilities(world, actor), generation = getAgentWorldCapabilityGeneration(world, actor);
    // Evaluate the authored projection before enumerating native surfaces. A
    // producer must be pure, but its accidental mutation cannot expose an old
    // now-hidden entry from a list we captured before invoking it.
    const supplied: unknown = capability?.visibleEntities?.();
    const visible = new Set<number>();
    const visit = (target: number, depth: number): void => {
        if (depth > 16 || target === actor || visible.has(target) || !entityExists(world, target)
            || concealed(world, target) || getRoomForEntity(world, target) !== room) return;
        visible.add(target);
        if (isPublicContainerOpen(world, target)) for (const child of listDirectContents(world, target)) {
            if (hasComponent(world, child, PhysicalObject) || hasComponent(world, child, Agent)) visit(child, depth + 1);
        }
    };
    for (const target of [...listDirectContents(world, room), ...getAgentTangibleEntities(world, actor)]) visit(target, 0);
    // A broken package projection is not an authoritative empty scene. Let the
    // sensing boundary reject the whole observation, as with other failed hooks.
    const candidates = Array.isArray(supplied) ? supplied.filter(target => Number.isSafeInteger(target)
        && entityExists(world, target) && target !== actor) : [];
    const advertised = new Set<number>([...visible, ...candidates]);
    for (const target of candidates) if (observableSurface(world, actor, target, room, advertised)) visit(target, 0);
    if (!isEntityPresent(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
        || getAgentSensoryCapabilities(world, actor).visual <= 0 || getRoomForEntity(world, actor) !== room
        || getAgentWorldCapabilities(world, actor) !== capability || getAgentWorldCapabilityGeneration(world, actor) !== generation) return [];
    return [...visible].filter(target => observableSurface(world, actor, target, room, visible)).sort((a, b) => a - b);
}
/** Membership-only counterpart to the native visual graph. Looking up one
 * target need not enumerate every surface in a crowded room. This is a fresh
 * containment walk, not a persistent visibility cache. Custom producers retain
 * the full reader and its before/after mutation defenses. */
export function isAgentVisualEntity(world: World, actor: number, target: number): boolean {
    if (!Number.isSafeInteger(target)) return false;
    if (getAgentWorldCapabilities(world, actor)?.visibleEntities) return getAgentVisualEntities(world, actor).includes(target);
    if (target === actor || !isEntityPresent(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
        || getAgentSensoryCapabilities(world, actor).visual <= 0) return false;
    const room = getRoomForEntity(world, actor);
    if (room === undefined || !entityExists(world, room) || target === room || getRoomForEntity(world, target) !== room) return false;
    const visited = new Set<number>();
    let current = target;
    // Match observableSurface's 16-entity containment fence, including its
    // legacy direct-room/direct-possession exception for named data entities.
    while (visited.size < 16) {
        if (visited.has(current) || !entityExists(world, current) || concealed(world, current)) return false;
        visited.add(current);
        const parent = getDirectContainer(world, current);
        if (parent === actor || parent === room) return true;
        if (parent === undefined || !entityExists(world, parent) || hasComponent(world, parent, Agent)
            || !hasComponent(world, current, PhysicalObject) && !hasComponent(world, current, Agent)
            || !isPublicContainerOpen(world, parent)) return false;
        current = parent;
    }
    return false;
}
/** Perceptible physical targets: actual sight plus direct own possessions. A
 * consumer reading visual fields must use getAgentVisualEntities, not this union. */
export function getAgentObservableEntities(world: World, actor: number): number[] {
    const visual = getAgentVisualEntities(world, actor);
    return [...new Set([...getAgentTangibleEntities(world, actor), ...visual])].sort((a, b) => a - b);
}
/** Seeing the exterior of a held phone is not reading its screen or gaining
 * access to its owner's inventory. These typed observations intentionally stay
 * out of the detailed-surface/action catalogue. Only identity and holder pass. */
export function getObservedHeldItemExteriors(world: World, observer: number): readonly Readonly<{ eid: number; holderEid: number; name: string }>[] {
    const visible = getAgentVisualEntities(world, observer);
    return Object.freeze(visible.filter(eid => hasComponent(world, eid, Agent)).flatMap(holderEid =>
        getPhysicalHeldItems(world, holderEid).flatMap(item => {
            const name = hasComponent(world, item.eid, Name) ? String(Name.value[item.eid] || "").trim().slice(0, 240) : "";
            return name ? [Object.freeze({ eid: item.eid, holderEid, name })] : [];
        })));
}
function copyObservableFields(input: unknown): Array<Omit<ObservedStateField, "subject" | "subjectLabel">> | undefined {
    if (!Array.isArray(input) || input.length > OBSERVABLE_STATE_LIMITS.fieldsPerTarget) return;
    const result: Array<Omit<ObservedStateField, "subject" | "subjectLabel">> = [], seen = new Set<string>();
    for (const field of input) {
        if (!field || typeof field !== "object" || typeof field.key !== "string" || !/^[a-z][a-zA-Z0-9_]{0,47}$/.test(field.key)
            || seen.has(field.key) || Object.keys(field).some(key => !["key", "type", "value", ...(field.type === "enum" ? ["values"] : [])].includes(key))) return;
        seen.add(field.key);
        let allowedValues: readonly string[], value: string;
        if (field.type === "boolean" && typeof field.value === "boolean") {
            allowedValues = Object.freeze(["false", "true"]); value = String(field.value);
        } else if (field.type === "enum" && Array.isArray(field.values) && field.values.length > 0
            && field.values.length <= OBSERVABLE_STATE_LIMITS.enumValues
            && field.values.every((v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 80 && v.trim() === v)
            && new Set(field.values).size === field.values.length && typeof field.value === "string" && field.values.includes(field.value)) {
            allowedValues = Object.freeze([...field.values]); value = field.value;
        } else return;
        result.push(Object.freeze({ slot: `Observable.${field.key}`, type: field.type, allowedValues, value }));
    }
    return result;
}
/** Pure local catalog. UUIDs must already exist from real sensing/registration;
 * this reader never assigns identity or refreshes actor memory. Callers that
 * format known facts must use their ledger value, not pretend this is a receipt. */
export function getObservedStateFields(world: World, actor: number, targetEid?: number): readonly ObservedStateField[] {
    if (!entityExists(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
        || !hasComponent(world, actor, WorkingMemoryIdentity) || getAgentSensoryCapabilities(world, actor).visual <= 0) return [];
    const owner = WorkingMemoryIdentity.id[actor], capability = getAgentWorldCapabilities(world, actor);
    const generation = getAgentWorldCapabilityGeneration(world, actor);
    if (!owner || observableOwners.get(world)?.get(actor) !== owner || !capability?.observableState) return [];
    const room = getRoomForEntity(world, actor); if (room === undefined || concealed(world, actor)) return [];
    const visible = new Set(getAgentVisualEntities(world, actor));
    const targets = targetEid === undefined ? [...visible, room, actor] : [targetEid];
    const result: ObservedStateField[] = [];
    for (const target of [...new Set(targets)]) {
        if (!Number.isSafeInteger(target) || !observableSurface(world, actor, target, room, visible)
            || !hasComponent(world, target, WorkingMemoryIdentity) || !hasComponent(world, target, Name)) continue;
        const subject = WorkingMemoryIdentity.id[target], subjectLabel = Name.value[target];
        if (!subject || !subjectLabel || subject.length > 240 || subjectLabel.length > 240) continue;
        let fields: ReturnType<typeof copyObservableFields>;
        try { fields = copyObservableFields(capability.observableState(target)); } catch { continue; }
        // A producer is trusted physical code, but cannot change/recycle the
        // observed identity or move a target out of sight during projection.
        if (!entityExists(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]
            || !hasComponent(world, actor, WorkingMemoryIdentity) || getAgentWorldCapabilities(world, actor) !== capability
            || getAgentWorldCapabilityGeneration(world, actor) !== generation
            || observableOwners.get(world)?.get(actor) !== owner || WorkingMemoryIdentity.id[actor] !== owner || concealed(world, actor)
            || getRoomForEntity(world, actor) !== room || getAgentSensoryCapabilities(world, actor).visual <= 0) return [];
        if (!fields || !entityExists(world, target) || !hasComponent(world, target, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[target] !== subject
            || !observableSurface(world, actor, target, room, new Set(getAgentVisualEntities(world, actor)))) continue;
        for (const field of fields) {
            if (result.length >= OBSERVABLE_STATE_LIMITS.fieldsPerObservation) return Object.freeze(result);
            result.push(Object.freeze({ subject, subjectLabel, ...field }));
        }
    }
    return Object.freeze(result);
}
/** Format only physically witnessed activity. Even a package-supplied target ID
 * cannot disclose a hidden object or an unobserved remote location. */
export function getObservedPublicActivityEvidence(world: World, observer: number, actor: number):
    { readonly kind: "moving" | "holding" | "operating" | "speaking"; readonly operation?: PublicPhysicalOperation; readonly speaking?: true; readonly targetEid?: number; readonly targetLabel?: string } | undefined {
    if (observer === actor || !entityExists(world, observer) || !entityExists(world, actor) || !hasComponent(world, actor, Agent)
        || getAgentSensoryCapabilities(world, observer).visual <= 0) return;
    const room = getRoomForEntity(world, observer);
    if (room === undefined || getRoomForEntity(world, actor) !== room) return;
    // Native membership needs only the target's containment chain. Preserve
    // the original single guarded projection for custom visibility producers.
    const visible = getAgentWorldCapabilities(world, observer)?.visibleEntities ? getAgentVisualEntities(world, observer) : undefined;
    const canSee = (target: number) => visible ? visible.includes(target) : isAgentVisualEntity(world, observer, target);
    if (!canSee(actor)) return;
    const speaking = isSpeaking(world, actor);
    const activity = getAgentWorldCapabilities(world, actor)?.publicActivity?.() ?? getSimulationBodyActivity(world, actor);
    if (!activity || !["moving", "holding", "operating"].includes(activity.kind)) return speaking ? Object.freeze({ kind: "speaking" }) : undefined;
    const target = activity.targetEid;
    const targetVisible = target !== undefined && Number.isSafeInteger(target) && entityExists(world, target)
        && (canSee(target) || getPhysicalHeldItems(world, actor).some(item => item.eid === target)
            || activity.kind === "moving" && hasComponent(world, target, Room)
            && (getAgentWorldCapabilities(world, observer)?.movementTargets?.() || []).includes(target));
    const label = targetVisible ? String(Name.value[target!] || "").trim() : "";
    const operation = activity.operation && PUBLIC_PHYSICAL_OPERATIONS.includes(activity.operation) ? activity.operation : undefined;
    return Object.freeze({ kind: activity.kind, ...(operation ? { operation } : {}), ...(speaking ? { speaking: true as const } : {}), ...(targetVisible ? { targetEid: target, targetLabel: label } : {}) });
}
export function getObservedPublicActivity(world: World, observer: number, actor: number): string | undefined {
    const activity = getObservedPublicActivityEvidence(world, observer, actor);
    return activity ? `${activity.operation?.replaceAll("_", " ") ?? activity.kind}${activity.targetLabel ? `${activity.kind === "moving" ? " toward" : ""} ${activity.targetLabel}` : ""}${activity.speaking ? " while speaking" : ""}` : undefined;
}
export function getWorldNarrativeEvidence(world: World): unknown[] {
    return [...(packages.get(world)?.values() || [])].flatMap(p => p.narrativeEvidence ? [p.narrativeEvidence()] : []);
}
/** Compatibility target-list name. Shares the same public-surface authority;
 * visual prose must use getAgentVisualEntities to distinguish own touch. */
export function getAgentVisibleEntities(world: World, eid: number): number[] {
    return getAgentObservableEntities(world, eid);
}
