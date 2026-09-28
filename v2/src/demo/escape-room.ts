/** Fixed-rule, seeded cooperative cognition benchmark. The package supplies
 * physical laws and local observations, never decisions or a solution script. */
import { randomUUID } from "node:crypto";
import { completePhysicalStep, advancePhysicalStep } from "./physical-time";
import { registerSimulationDeadlineProvider, reserveSimulationResources, releaseSimulationResources } from "../runtime/simulation-timeline";
import { publishCommittedEvent, getCommittedEvents } from "../runtime/committed-events";
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { Agent, Appearance, BehaviorPolicy, Container, Description, Goal, GridPosition, Name, ObjectState, Personality, PhysicalObject, Room } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { getDirectContainer, getRoomForEntity, listDirectContents, setLocatedIn } from "../ecs/location";
import { syncInventoryCache, tryAddToInventory } from "../ecs/inventory";
import { registerSystem } from "../ecs/dynamic-systems";
import { addPerception, getAgentMemory, type AgentAction } from "../cognition/agent-mind";
import { completeDeferredAction, createIntentGoal, executeActions } from "../cognition/cognition-system";
import { setGoalContract } from "../cognition/goal-contract";
import { getObservedPublicActivity, registerAgentWorldCapabilities, type ObservableStateField } from "../cognition/world-capabilities";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { publicPhysicalOperation } from "../cognition/physical-activity";
import type { PlanningEvent } from "../cognition/planning-telemetry";
import { getAgentSensoryCapabilities } from "../cognition/sensory-capabilities";
import { clearMovementTarget } from "../systems/builtin-systems";
import { goalEvaluationSystem } from "../systems/goal-evaluation-system";
import { configureCharacterAppearance, snapshotCharacterAppearance } from "../rendering/character-appearance";
import { snapshotDirectorScene, type SceneSnapshot } from "../rendering/scene-director";
import type { TestbedEvent } from "./generative-agents";

export type EscapeCharacter = "Mara" | "Ivo" | "Sera";
export type EscapeTopology = "observatory" | "relay";
export interface EscapeRoomOptions { live?: boolean; seed?: number | string; topology?: EscapeTopology;
  experienceReconsideration?: boolean; narrativeMind?: boolean }
export const ESCAPE_PERTURBATION_STAGES = ["exit_code_read", "exit_unlock_started"] as const;
export type EscapePerturbationStage = typeof ESCAPE_PERTURBATION_STAGES[number];
export function isEscapePerturbationStage(value: string): value is EscapePerturbationStage {
  return ESCAPE_PERTURBATION_STAGES.some(stage => stage === value);
}
export interface EscapeRoomEvent extends TestbedEvent {
  planningEvent?: PlanningEvent;
  /** Operator-only causal evidence captured from an actual pending operation.
   * It is never projected into an actor's context, memory or renderer scene. */
  powerTrip?: {
    fromPower: string;
    exitOpen: boolean;
    pendingUnlock?: { actorId: number; action: AgentAction; untilMs: number; helperId: number; helperUntilMs: number };
  };
}
type IdKey = EscapeCharacter | "atrium" | "gallery" | "workshop" | "archive" | "outside" |
  "galleryClue" | "workshopClue" | "locker" | "crank" | "bypass" | "pump" | "archiveClue" |
  "coil" | "prism" | "generator" | "router" | "bench" | "release" | "exit";
const names: Record<IdKey, string> = {
  Mara: "Mara", Ivo: "Ivo", Sera: "Sera", atrium: "Atrium", gallery: "Gallery", workshop: "Workshop", archive: "Archive", outside: "Courtyard",
  galleryClue: "Gallery plaque", workshopClue: "Workshop notebook", locker: "Crank locker", crank: "Pump crank", bypass: "Pump bypass", pump: "Drain pump",
  archiveClue: "Archive diagram", coil: "Copper coil", prism: "Glass prism", generator: "Generator", router: "Power router", bench: "Optical bench", release: "Exit release", exit: "Exit keypad",
};
function component(name: string, properties: Record<string, "number" | "string" | "boolean">) {
  extendDynamicComponent({ name, description: `Cooperative escape-room physics: ${name}`, properties });
  return getComponent(name)!;
}
function seeded(seed: number | string) {
  let n = 2166136261;
  for (const character of String(seed)) { n ^= character.charCodeAt(0); n = Math.imul(n, 16777619); }
  return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return (n >>> 0) / 4294967296; };
}

export class EscapeRoomTestbed {
  readonly sourceId = randomUUID();
  readonly characters: EscapeCharacter[] = ["Mara", "Ivo", "Sera"];
  readonly names = names;
  readonly ids: Record<IdKey, number>;
  readonly options: Readonly<Required<EscapeRoomOptions>>;
  readonly activity = component("EscapeRoomActivity", { phase: "string", untilMs: "number", origin: "number", destination: "number" });
  readonly physics = component("EscapeRoomState", { lockerOpen: "boolean", drained: "boolean", power: "string", alignment: "string", exitOpen: "boolean", allEscaped: "boolean" });
  readonly sharedGoals = new Map<number, number>();
  private readonly secret: { locker: string; alignment: string; exit: string };
  private elapsed = 0;
  private sequence = 0;
  private started = false;
  private stopped = false;
  private pending = new Map<number, AgentAction>();
  private pendingTargetKeys = new Map<number, string>();
  private operationMeta = new Map<number, { executionId: string; actorKey: string; room: number; roomKey: string;
    startedAtSimMs: number; expectedEndSimMs: number; targets: Array<{ eid: number; key: string }>;
    bindings: Array<{ label: string; eid: number; exact: boolean }> }>();
  private atomicResuming = new WeakSet<AgentAction>();
  private decisions = new Map<number, AbortController>();
  private readyAt = new Map<number, number>();
  private revisions = new Map<number, number>();
  private listeners = new Set<(event: EscapeRoomEvent) => void>();
  private unregister: Array<() => void> = [];
  private history: EscapeRoomEvent[] = [];
  private milestoneTimes = new Map<string, number>();

  private constructor(readonly sim: ArgosSimulation, options: EscapeRoomOptions) {
    this.options = Object.freeze({ live: options.live !== false, seed: options.seed ?? 89, topology: options.topology ?? "observatory",
      experienceReconsideration: options.experienceReconsideration ?? false, narrativeMind: options.narrativeMind ?? false });
    const random = seeded(this.options.seed);
    this.secret = { locker: String(1000 + Math.floor(random() * 9000)), alignment: ["amber", "cobalt", "violet"][Math.floor(random() * 3)]!, exit: String(1000 + Math.floor(random() * 9000)) };
    const w = sim.world;
    this.ids = Object.fromEntries(Object.entries(names).map(([key, name]) => {
      const eid = [...query(w, [Name])].find(id => Name.value[id] === name);
      if (eid === undefined) throw new Error(`Missing escape-room entity: ${name}`);
      return [key, eid];
    })) as Record<IdKey, number>;
    const i = this.ids;
    attachToEntity(w, i.pump, "EscapeRoomState", { lockerOpen: false, drained: false, power: "off", alignment: "unset", exitOpen: false, allEscaped: false });
    addComponent(w, i.locker, Container); Container.capacity[i.locker] = 1; Container.currentCount[i.locker] = 1; Container.allowedTypes[i.locker] = "[]";
    setLocatedIn(w, i.crank, i.locker);
    for (const name of this.characters) {
      const eid = i[name];
      attachToEntity(w, eid, "EscapeRoomActivity", { phase: "idle", untilMs: 0, origin: -1, destination: -1 });
      if (hasComponent(w, eid, BehaviorPolicy)) BehaviorPolicy.enabled[eid] = false;
      addComponent(w, eid, Personality);
      Personality.openness[eid] = name === "Mara" ? .85 : .7; Personality.conscientiousness[eid] = .85;
      Personality.extraversion[eid] = name === "Sera" ? .8 : .5; Personality.agreeableness[eid] = .7; Personality.neuroticism[eid] = .3;
      configureCharacterAppearance(w, eid, { age: name === "Ivo" ? "adult, late fifties" : "adult, early thirties", hairColor: name === "Ivo" ? "silver" : "dark brown", hairStyle: name === "Mara" ? "short bob" : name === "Ivo" ? "cropped" : "long braid", clothing: name === "Mara" ? "mustard cardigan, charcoal trousers, brown boots" : name === "Ivo" ? "navy work shirt, brown trousers, heavy boots" : "burgundy sweater, dark jeans, walking shoes", posture: "standing", expression: "attentive" });
      const goal = createIntentGoal(w, eid, "Reach the Courtyard safely, cooperating with the others so all three of us can escape.", 10);
      setGoalContract(w, goal, { version: 1, kind: "custom", params: { objective: "cooperative_escape" }, success: { type: "in_room", roomName: names.outside } });
      this.sharedGoals.set(eid, goal);
      this.installCapabilities(eid);
      addPerception(w, eid, { type: "observation", content: `You are in the Atrium with ${this.characters.filter(other => other !== name).join(" and ")}. The exterior door is locked. Open interior doorways lead to the Gallery and Workshop. The Exit keypad and Exit release have legible operating labels.`, source: "local world" });
    }
    for (const name of ["GoalProgress", "TimeProgression"]) { const system = sim.god.systemRegistry.systems.get(name); if (system) system.active = false; }
    sim.world.time.simulationHour = 20; sim.world.time.timeOfDay = "evening";
    this.syncPhysicalState();
    registerSystem(sim.god.systemRegistry, { name: "EscapeRoomPhysics", description: "Seeded local puzzle laws, cooperative timed work and ECS escape proof", pseudocode: "Validate actual possession and continuous helper presence; advance deadlines; project physical ObjectState; evaluate goals from proof.", active: true, frequency: 0, lastRun: 0, compiledFn: (_w, ctx) => this.advance(ctx.delta) });
  }

  static async create(options: EscapeRoomOptions = {}) {
    if (options.topology !== undefined && !["observatory", "relay"].includes(options.topology)) throw new Error("Unknown escape topology");
    const live = options.live !== false;
    const relay = options.topology === "relay";
    const sim = await createSimulation({ name: relay ? "The Flooded Relay" : "The Drowned Observatory", preset: "minimal", enableAI: live, enablePlanning: live, enableReflection: live,
      cognitionController: "priority", experienceReconsideration: options.experienceReconsideration ?? false, narrativeMind: options.narrativeMind ?? false,
      hostOfficeTools: false,
      enableSpirits: false, enableNarrativeEngine: false, evolution: false, codingDaemons: false, godAutopilot: false, enableServer: false,
      dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500,
      narrative: "Three adults are trapped in an old observatory after a storm. Escape depends on investigating local mechanisms, retaining discovered information and coordinating physical work. Fixed physical rules; no invented tools, exits or successful actions. Each person knows only their own perceptions and received communication.",
      rooms: [
        { name: names.atrium, x: 50, y: 50, description: "A stone entry hall. Interior doorways lead to the Gallery and Workshop. An electronically locked exterior door leads to the Courtyard. Its current lock state is shown by the Exit keypad; a separate spring-loaded Exit release operates the latch." + (relay ? " Floodwater covers the exterior threshold; a drainage interlock prevents opening until the threshold is drained." : "") },
        { name: names.gallery, x: 170, y: 50, description: "A high-ceilinged gallery containing a Gallery plaque and an Optical bench. The only doorway returns to the Atrium." },
        { name: names.workshop, x: 50, y: 170, description: "A workshop containing a notebook, combination crank locker, drain pump, spring-loaded bypass, generator and power router. A doorway returns to the Atrium." + (relay ? " An open, dry doorway leads into the Archive. The drain pump empties the flooded exterior threshold." : " A lower doorway into the Archive is passable only when its water has been drained.") },
        { name: names.archive, x: 170, y: 170, description: relay ? "A dry archive reached through the open Workshop doorway. A shelf holds an Archive diagram, Copper coil and Glass prism. The only route returns to the Workshop." : "A lower archive, inaccessible while flooded. Above the water line a sealed shelf protects an Archive diagram, Copper coil and Glass prism. The only route returns to the Workshop." },
        { name: names.outside, x: -70, y: 50, description: "An open-air courtyard beyond the observatory's exterior door. This is outside the building." },
      ],
      agents: [
        { name: "Mara", role: "resourceful investigator", startRoom: names.atrium, description: "Adult woman, short dark bob, mustard cardigan and charcoal trousers.", systemPrompt: "You are Mara, curious and practical. You want everyone to get out safely. You enjoy understanding unfamiliar mechanisms and have your own judgment." },
        { name: "Ivo", role: "careful mechanic", startRoom: names.atrium, description: "Older adult man, cropped silver hair, navy work shirt and brown trousers.", systemPrompt: "You are Ivo, methodical and mechanically minded. You want everyone to get out safely. You take responsibility for work you agree to do and value clear cooperation." },
        { name: "Sera", role: "observant archivist", startRoom: names.atrium, description: "Adult woman, long black braid, burgundy sweater and dark jeans.", systemPrompt: "You are Sera, observant and direct. You want everyone to get out safely. You are good at noticing written details and connecting them, but do not already know this building's secrets." },
      ],
      objects: [
        { name: names.galleryClue, room: names.gallery, description: "A small engraved plaque. Its fine print can be read up close.", portable: false },
        { name: names.workshopClue, room: names.workshop, description: "A workshop notebook, open to a handwritten maintenance entry. Read to learn its contents.", portable: false },
        { name: names.locker, room: names.workshop, description: "A four-digit combination locker labelled CRANK. Control: unlock <four digits>. Its contents are hidden while locked.", portable: false },
        { name: names.crank, room: names.workshop, description: "A removable metal crank shaped for the drain pump's empty spindle.", portable: true, traits: ["takeable"] },
        { name: names.bypass, room: names.workshop, description: "A spring-loaded pump bypass. Hold to keep it open, release to let it close. A holder cannot operate the distant crank simultaneously; two people are required throughout pumping.", portable: false },
        { name: names.pump, room: names.workshop, description: relay ? "An electrically assisted drain pump with a crank spindle. Controls: install (your carried Pump crank); pump. Eight uninterrupted seconds of pumping require the installed generator coil, power routed to pump, and another person holding the Pump bypass throughout. It permanently drains the exterior threshold; losing power or the bypass interrupts the job." : "A manual drain pump with a crank spindle. Controls: install (your carried Pump crank); pump. Pumping takes eight seconds while another person holds the Pump bypass. It permanently drains the Archive route.", portable: false },
        { name: names.archiveClue, room: names.archive, description: "A protected optical calibration diagram. Read its small annotations up close.", portable: false },
        { name: names.coil, room: names.archive, description: "An intact copper generator coil.", portable: true, traits: ["takeable"] },
        { name: names.prism, room: names.archive, description: "A triangular glass prism sized for the Optical bench's socket.", portable: true, traits: ["takeable"] },
        { name: names.generator, room: names.workshop, description: "A hand-start generator with a coil socket. Control: install (your carried Copper coil). With a coil installed it can supply the Power router.", portable: false },
        { name: names.router, room: names.workshop, description: relay ? "A labelled power selector. Controls: route pump, route optics, route exit, route off. The generator must contain its real coil. Power serves exactly one circuit at a time; switching away from pump interrupts pumping, and switching away from optics extinguishes the display." : "A labelled power selector. Controls: route optics, route exit, route off. The generator must contain its real coil. Power can serve only one circuit at once; exit power extinguishes the optical display.", portable: false },
        { name: names.bench, room: names.gallery, description: "An optical bench with a prism socket and three calibration detents: amber, cobalt, violet. Controls: install (your carried Glass prism), align <detent>, read. A correctly calibrated prism under optical power reveals a small exit code; the code vanishes without light. A label points to a calibration diagram in the Archive.", portable: false },
        { name: names.release, room: names.atrium, description: "A spring-loaded exterior-door release. Controls: hold, release. A second person must enter the code on the separate Exit keypad while this is continuously held.", portable: false },
        { name: names.exit, room: names.atrium, description: "A four-digit keypad controlling the exterior door. Control: enter <four digits>. Requires exit power and another person physically holding the Exit release for the two-second unlock. The correct code is optically displayed in the Gallery, not written on this keypad." + (relay ? " Its drainage interlock also requires the exterior threshold to be drained by the Workshop pump before unlocking." : ""), portable: false },
      ],
    });
    return new EscapeRoomTestbed(sim, options);
  }

  get elapsedMs() { return this.elapsed; }
  private get relay() { return this.options.topology === "relay"; }
  private get powerRoutes() { return this.relay ? ["off", "optics", "exit", "pump"] : ["off", "optics", "exit"]; }
  onEvent(listener: (event: EscapeRoomEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private record(event: Omit<EscapeRoomEvent, "sequence" | "elapsedMs" | "tick">) {
    if (this.stopped) return;
    const value = { ...event, sequence: ++this.sequence, elapsedMs: this.elapsed, tick: this.sim.world.time.tick };
    this.history.push(value); this.history = this.history.slice(-4000);
    for (const listener of this.listeners) listener(structuredClone(value));
  }
  private milestone(name: string) {
    if (this.milestoneTimes.has(name)) return;
    this.milestoneTimes.set(name, this.elapsed);
    this.record({ kind: "milestone", text: name, visibility: "operator", status: "succeeded" });
  }
  private installCapabilities(eid: number) {
    const w = this.sim.world;
    this.unregister.push(registerAgentWorldCapabilities(w, eid, {
      ownsMovement: true,
      observableState: target => this.observableState(target),
      publicActivity: () => {
        if (!this.started || this.stopped || !this.pending.has(eid) || this.workFailure(eid)) return;
        const phase = this.activity.phase[eid];
        return { kind: phase === "walking" ? "moving" : String(phase).startsWith("holding_") ? "holding" : "operating",
          operation: phase === "unlocking" ? "opening" : publicPhysicalOperation(this.pending.get(eid)!),
          targetEid: this.activity.destination[eid] };
      },
      ready: () => this.started && !this.stopped && !this.pending.has(eid) && !this.decisions.has(eid) && this.elapsed >= (this.readyAt.get(eid) ?? 0),
      busy: () => this.pending.has(eid), context: () => this.context(eid),
      canInterruptBusyAction: action => action.type === "interact" && action.content?.trim().toLowerCase() === "release"
        && String(this.activity.phase[eid]).startsWith("holding_")
        && Name.value[this.activity.destination[eid]]?.toLowerCase() === action.target?.trim().toLowerCase(),
      visibleEntities: () => this.visible(eid), movementTargets: () => this.movementTargets(eid),
      affordances: target => this.verbs(eid, target).map(name => ({ name, requires: [], description: `Physical control: ${name}. Only an actual result establishes success.` })),
      knownAffordances: target => this.visible(eid).includes(target) ? this.labelledControls(target)
        .map(name => ({ name, requires: [], description: `Labelled control: ${name}. Its physical prerequisites must hold at execution; labels do not establish answers or success.` })) : [],
      goalCompletionOptions: () => [{ id: "escape", description: "You have physically reached the Courtyard", success: { type: "in_room", roomName: names.outside } }],
      beginDecision: () => {
        const revision = this.revisions.get(eid) ?? 0, abort = new AbortController(), began = performance.now();
        this.decisions.set(eid, abort); const timeout = setTimeout(() => abort.abort(), 30_000);
        return { signal: abort.signal, isCurrent: () => !this.stopped && !abort.signal.aborted && revision === (this.revisions.get(eid) ?? 0), finish: () => {
          clearTimeout(timeout); if (this.decisions.get(eid) === abort) this.decisions.delete(eid);
          this.record({ kind: "decision_latency", text: `${Math.round(performance.now() - began)}`, actorId: eid, visibility: "operator" });
        } };
      },
      execute: action => this.executePhysical(eid, action),
      afterAction: (action, succeeded, pending) => { this.readyAt.set(eid, this.elapsed + 500); this.recordAction(eid, action, pending ? "pending" : succeeded ? "succeeded" : "failed"); },
      onThought: (_entity, content, thoughtType) => this.record({ kind: "thought", thoughtType, text: content, actorId: eid, visibility: "private" }),
      onPlanningEvent: event => this.record({ kind: `planning_${event.stage}`, text: event.stage === "discarded" ? event.reason : event.stage,
        actorId: eid, visibility: "operator", planningEvent: event }),
      onPerception: (_entity, content, type) => {
        this.record({ kind: "perception", text: content, actorId: eid, visibility: "private" });
        if (["directed_speech", "attention", "intent"].includes(type)) this.readyAt.set(eid, this.elapsed);
      },
    }));
  }
  private visible(eid: number) {
    const w = this.sim.world, room = getRoomForEntity(w, eid);
    const canSee = getAgentSensoryCapabilities(w, eid).visual > 0;
    return [...new Set([...(room === undefined || !canSee ? [] : listDirectContents(w, room)), ...listDirectContents(w, eid),
      ...(canSee && room === this.ids.workshop && this.physics.lockerOpen[this.ids.pump] ? listDirectContents(w, this.ids.locker) : [])])].filter(id => entityExists(w, id));
  }
  private movementTargets(eid: number): number[] {
    const i = this.ids, room = getRoomForEntity(this.sim.world, eid);
    if (room === i.atrium) return [i.gallery, i.workshop, ...(this.physics.exitOpen[i.pump] && (!this.relay || this.physics.drained[i.pump]) ? [i.outside] : [])];
    if (room === i.gallery || room === i.outside) return [i.atrium];
    if (room === i.workshop) return [i.atrium, ...(this.relay || this.physics.drained[i.pump] ? [i.archive] : [])];
    if (room === i.archive) return [i.workshop];
    return [];
  }
  private verbs(eid: number, target: number): string[] {
    if (!this.visible(eid).includes(target)) return [];
    if (this.pending.has(eid)) return target === this.activity.destination[eid] && String(this.activity.phase[eid]).startsWith("holding_") ? ["release"] : [];
    return this.labelledControls(target).filter(command => !this.controlFailure(eid, target, command));
  }
  /** Public operating labels are not the same as controls usable right now. */
  private labelledControls(target: number): string[] {
    const i = this.ids;
    if ([i.galleryClue, i.workshopClue, i.archiveClue].includes(target)) return ["read"];
    if (target === i.locker) return ["unlock <four digits>"];
    if (target === i.pump) return ["install", "pump"];
    if (target === i.bypass || target === i.release) return ["hold"];
    if (target === i.generator) return ["install"];
    if (target === i.router) return this.powerRoutes.map(route => `route ${route}`);
    if (target === i.bench) return ["install", "align amber", "align cobalt", "align violet", "read"];
    if (target === i.exit) return ["enter <four digits>"];
    return [];
  }
  /** One current-prerequisite authority for both the menu and execution. Code
   * correctness is intentionally excluded: availability must never test secrets. */
  private controlFailure(eid: number, target: number, command: string): string | undefined {
    const i = this.ids, w = this.sim.world;
    if (command === "read") return [i.galleryClue, i.workshopClue, i.archiveClue, i.bench].includes(target)
      ? undefined : "There is no readable inscription or display on that object.";
    if (target === i.locker && /^unlock (?:\d{4}|<four digits>)$/.test(command))
      return this.physics.lockerOpen[i.pump] ? "The Crank locker is already open." : undefined;
    if ([i.pump, i.generator, i.bench].includes(target) && command === "install") {
      const item = target === i.pump ? i.crank : target === i.generator ? i.coil : i.prism;
      if (getDirectContainer(w, item) === target) return "The correct part is already installed.";
      return getDirectContainer(w, item) === eid ? undefined : `You must physically possess the ${Name.value[item]} to install it here.`;
    }
    if ((target === i.bypass || target === i.release) && command === "hold")
      return this.holder(target) === undefined ? undefined : "Someone is already holding this control.";
    if (target === i.pump && command === "pump") {
      if (this.physics.drained[i.pump]) return this.relay ? "The exterior threshold is already drained." : "The Archive is already drained.";
      if ([...this.pending.keys()].some(id => this.activity.phase[id] === "pumping")) return "Someone is already operating the pump.";
      return this.cooperativeFailure(eid, "pumping");
    }
    if (target === i.router && this.powerRoutes.some(route => command === `route ${route}`))
      return command === "route off" || getDirectContainer(w, i.coil) === i.generator ? undefined
        : "The generator cannot supply power without its actual Copper coil installed.";
    if (target === i.bench && /^align (amber|cobalt|violet)$/.test(command)) return;
    if (target === i.exit && /^enter (?:\d{4}|<four digits>)$/.test(command)) {
      if (this.physics.exitOpen[i.pump]) return "The exterior door is already unlocked.";
      if ([...this.pending.keys()].some(id => this.activity.phase[id] === "unlocking")) return "Someone is already using the keypad.";
      return this.cooperativeFailure(eid, "unlocking");
    }
    return `That is not an operating control for ${Name.value[target]}. Labelled controls: ${this.labelledControls(target).join(", ") || "none"}.`;
  }
  private cooperativeFailure(eid: number, phase: "pumping" | "unlocking", ongoing = false): string | undefined {
    const w = this.sim.world, i = this.ids;
    if (phase === "pumping") {
      if (getDirectContainer(w, i.crank) !== i.pump) return ongoing
        ? "Pumping stopped: the real Pump crank is no longer installed." : "The pump's real crank must be installed first.";
      if (this.relay && (this.physics.power[i.pump] !== "pump" || getDirectContainer(w, i.coil) !== i.generator)) return ongoing
        ? "Pumping stopped: the drain pump has lost its generator supply; power must remain routed to pump."
        : "The drain pump requires the actual generator coil installed and power routed to pump.";
      const helper = this.holder(i.bypass);
      if (helper === undefined || helper === eid || getRoomForEntity(w, helper) !== i.workshop)
        return ongoing ? "Pumping stopped: a different person must continuously hold the Pump bypass beside you."
          : "A different person here must physically hold the Pump bypass throughout pumping.";
    } else {
      if (this.relay && !this.physics.drained[i.pump]) return ongoing
        ? "Unlocking stopped: the drainage interlock detects a flooded exterior threshold."
        : "The drainage interlock blocks unlocking until the exterior threshold is drained.";
      if (this.physics.power[i.pump] !== "exit" || getDirectContainer(w, i.coil) !== i.generator) return ongoing
        ? "Unlocking stopped: the Exit keypad has lost generator power." : "The Exit keypad is unpowered.";
      const helper = this.holder(i.release);
      if (helper === undefined || helper === eid || getRoomForEntity(w, helper) !== i.atrium)
        return ongoing ? "Unlocking stopped: a different person must continuously hold the Exit release beside you."
          : "A different person here must physically hold the Exit release while you enter the code.";
    }
  }
  /** Only actor-local observations. No seed, code, clue text or remote inventory. */
  context(eid: number) {
    const w = this.sim.world;
    return `${this.relay ? "RELAY" : "OBSERVATORY"} PHYSICS. Known layout: Atrium <-> Gallery; Atrium <-> Workshop; Workshop <-> Archive (${this.relay ? "open dry doorway" : "flooded route"}); Atrium <-> Courtyard (${this.relay ? "flooded threshold and locked exterior door" : "locked exterior door"}).
move target=<adjacent room name> takes 3 seconds. Available routes here: ${this.movementTargets(eid).map(id => Name.value[id]).join(", ")}.
interact target=<exact object name> content=<one control, including its argument>. read is a control for written objects; seeing an unread object is not reading it. Labels describe operating rules, not discovered answers.
pickup target=<portable item name>; drop target=<your item name>; give target=<person here> content=<your item name>. Speech does not transfer an object. speak target=<person here> content=<words>; distant people cannot hear.
Timed work occupies its actor. A hold lasts at most 45 seconds; its holder cannot travel or operate another control while holding. A successful cooperative job releases its helper. No accepted intention is a completed physical action.
Your room: ${Name.value[getRoomForEntity(w, eid)!]}. Your activity: ${this.activity.phase[eid]}.
Visible local facts: ${JSON.stringify(this.visible(eid).filter(id => id !== eid).map(id => ({ name: Name.value[id], description: Description.value[id] || undefined, state: getObservedPublicActivity(w, eid, id) || ObjectState.current[id] || undefined, controls: this.verbs(eid, id) })))}
Other people's private thoughts and inventory are not visible.`;
  }
  private recordAction(eid: number, action: AgentAction, status: "pending" | "succeeded" | "failed") {
    this.record({ kind: action.type === "speak" ? "speech" : action.type === "move" ? "movement" : "action", text: action.type === "speak" ? action.content ?? "" : `${action.type} ${action.target ?? ""} ${action.content ?? ""}`.trim(), actorId: eid, roomId: getRoomForEntity(this.sim.world, eid), visibility: ["think", "reflect", "remember", "plan"].includes(action.type) ? "private" : "public", action: { ...action }, status });
  }
  private finish(eid: number, action: AgentAction, success: boolean, detail: string, targetKey?: string) {
    const timing = this.operationMeta.get(eid);
    if (timing && timing.executionId !== action.executionId) return;
    this.operationMeta.delete(eid);
    if (action.executionId) releaseSimulationResources(this.sim.world, eid, action.executionId);
    if (!entityExists(this.sim.world, eid) || timing && workingMemoryEntityRef(this.sim.world, eid)?.key !== timing.actorKey) {
      this.pending.delete(eid); this.pendingTargetKeys.delete(eid); return;
    }
    const committedTargetKey = this.pending.has(eid) ? this.pendingTargetKeys.get(eid) : targetKey;
    this.pendingTargetKeys.delete(eid);
    this.pending.delete(eid); this.activity.phase[eid] = "idle"; this.activity.untilMs[eid] = 0;
    Appearance.posture[eid] = "standing";
    this.syncPhysicalState();
    completeDeferredAction(this.sim.world, eid, action, success, detail, { targetKey: committedTargetKey });
    const roomId = getRoomForEntity(this.sim.world, eid);
    if (action.executionId && roomId !== undefined && !getCommittedEvents(this.sim.world).stopped)
      publishCommittedEvent(this.sim.world, { executionId: action.executionId, kind: "action", actorId: eid, roomId,
        action: action.type, status: success ? "succeeded" : "failed", startedAtSimMs: timing?.startedAtSimMs ?? this.elapsed,
        expectedEndSimMs: timing?.expectedEndSimMs ?? this.elapsed, completedAtSimMs: this.elapsed });
    this.readyAt.set(eid, this.elapsed + 500);
    this.recordAction(eid, action, success ? "succeeded" : "failed");
    this.record({ kind: "action_detail", text: detail, actorId: eid, roomId: getRoomForEntity(this.sim.world, eid), visibility: "private", action: { ...action }, status: success ? "succeeded" : "failed" });
  }
  private begin(eid: number, action: AgentAction, phase: string, duration: number, target: number) {
    if (!action.executionId || !reserveSimulationResources(this.sim.world, eid, action.executionId, ["body"])) return;
    const targetKey = workingMemoryEntityRef(this.sim.world, target)?.key;
    if (targetKey) this.pendingTargetKeys.set(eid, targetKey); else this.pendingTargetKeys.delete(eid);
    this.activity.phase[eid] = phase; this.activity.untilMs[eid] = this.elapsed + duration;
    this.activity.origin[eid] = getRoomForEntity(this.sim.world, eid) ?? -1; this.activity.destination[eid] = target;
    const refs = [target];
    const bindings = action.target ? [{ label: action.target, eid: target, exact: false }] : [];
    if (action.type === "give") {
      const item = [...query(this.sim.world, [Name])].find(id => Name.value[id] === action.content);
      if (item !== undefined) { refs.push(item); bindings.push({ label: action.content!, eid: item, exact: true }); }
    }
    if (action.type === "interact" && action.content?.trim().toLowerCase() === "install")
      refs.push(target === this.ids.pump ? this.ids.crank : target === this.ids.generator ? this.ids.coil : this.ids.prism);
    this.operationMeta.set(eid, { executionId: action.executionId, actorKey: workingMemoryEntityRef(this.sim.world, eid)!.key,
      room: this.activity.origin[eid], roomKey: workingMemoryEntityRef(this.sim.world, this.activity.origin[eid])!.key,
      startedAtSimMs: this.elapsed, expectedEndSimMs: this.elapsed + duration,
      targets: refs.map(id => ({ eid: id, key: workingMemoryEntityRef(this.sim.world, id)!.key })), bindings });
    this.pending.set(eid, { ...action }); this.syncPhysicalState(); this.recordAction(eid, action, "pending");
    publishCommittedEvent(this.sim.world, { executionId: action.executionId, kind: "action", actorId: eid,
      roomId: this.activity.origin[eid], action: action.type, status: "pending", startedAtSimMs: this.elapsed, expectedEndSimMs: this.elapsed + duration });
    if (phase === "unlocking") this.milestone("exit_unlock_started");
  }
  private beginAtomic(eid: number, action: AgentAction, target: number, duration: number): boolean {
    if (!this.sim.world.meta.timedActions || this.atomicResuming.has(action)) return false;
    this.begin(eid, action, "handling", duration, target); return true;
  }
  private announce(room: number, text: string) {
    this.record({ kind: "observation", roomId: room, text, visibility: "public", status: "succeeded" });
    for (const name of this.characters) if (getRoomForEntity(this.sim.world, this.ids[name]) === room)
      addPerception(this.sim.world, this.ids[name], { type: "attention", content: text, source: "local world" });
  }
  private holder(control: number) {
    return [...this.pending.keys()].find(eid => this.activity.destination[eid] === control && String(this.activity.phase[eid]).startsWith("holding_")
      && this.activity.untilMs[eid] >= this.elapsed && !this.workFailure(eid));
  }
  private workFailure(eid: number): string | undefined {
    const w = this.sim.world, phase = this.activity.phase[eid];
    if (!entityExists(w, eid) || !hasComponent(w, eid, Agent) || !Agent.active[eid])
      return "Your activity was interrupted because its actor is no longer active.";
    const meta = this.operationMeta.get(eid);
    if (meta && (workingMemoryEntityRef(w, eid)?.key !== meta.actorKey
      || workingMemoryEntityRef(w, meta.room)?.key !== meta.roomKey
      || meta.targets.some(target => !entityExists(w, target.eid) || workingMemoryEntityRef(w, target.eid)?.key !== target.key)))
      return "Your activity was interrupted because its original actor, room or target no longer exists.";
    if (meta?.bindings.some(binding => [...query(w, [Name])].find(id => binding.exact
      ? Name.value[id] === binding.label : String(Name.value[id]).toLowerCase() === binding.label.trim().toLowerCase()) !== binding.eid))
      return "Your activity was interrupted because its original target binding changed.";
    if (!entityExists(w, eid) || getRoomForEntity(w, eid) !== this.activity.origin[eid]) return "Your activity was interrupted because your physical location changed.";
    if (phase === "pumping" || phase === "unlocking") return this.cooperativeFailure(eid, phase, true);
  }
  private interruptInvalidWork() {
    for (const [eid, action] of [...this.pending]) { const reason = this.workFailure(eid); if (reason) this.finish(eid, action, false, reason); }
  }
  private read(eid: number, target: number): string | undefined {
    const i = this.ids;
    if (target === i.galleryClue) { this.milestone("gallery_clue_read"); return `Gallery plaque: "CRANK LOCKER: the first two digits are ${this.secret.locker.slice(0, 2)}. The workshop maintenance entry supplies the last two. Keep the order: gallery, then workshop."`; }
    if (target === i.workshopClue) { this.milestone("workshop_clue_read"); return `Workshop notebook: "Crank locker maintenance: the last two digits are ${this.secret.locker.slice(2)}. Prefix them with the pair engraved in the Gallery. The lower Archive contains a spare generator coil and the optical calibration kit."`; }
    if (target === i.archiveClue) { this.milestone("archive_clue_read"); return `Archive diagram: "For the observatory's Glass prism, set the Optical bench to ${this.secret.alignment}. With power routed to optics, read the projected four-digit exit code. Routing power to exit extinguishes that projection; retain the code before changing the supply."`; }
    if (target === i.bench) {
      if (!this.illuminated()) return "The Optical bench shows no legible code. Its prism, calibration and optical power must all be correct.";
      this.milestone("exit_code_read"); return `In the Optical bench's illuminated projection you read the exit code: ${this.secret.exit}. This light disappears when the power is routed away.`;
    }
  }
  private illuminated() {
    return this.physics.power[this.ids.pump] === "optics" && getDirectContainer(this.sim.world, this.ids.coil) === this.ids.generator &&
      getDirectContainer(this.sim.world, this.ids.prism) === this.ids.bench && this.physics.alignment[this.ids.pump] === this.secret.alignment;
  }
  private executePhysical(eid: number, action: AgentAction): boolean {
    if (!this.started || this.stopped) return true;
    const w = this.sim.world, i = this.ids;
    const target = [...query(w, [Name])].find(id => String(Name.value[id]).toLowerCase() === String(action.target ?? "").trim().toLowerCase());
    // These are labelled physical controls, not free-form speech/tool payloads.
    const verb = String(action.content ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const done = (success: boolean, detail: string) => {
      this.finish(eid, action, success, detail, target === undefined ? undefined : workingMemoryEntityRef(w, target)?.key); return true;
    };
    if (this.pending.has(eid) && !this.atomicResuming.has(action)) {
      if (action.type === "interact" && verb === "release" && target === this.activity.destination[eid] && String(this.activity.phase[eid]).startsWith("holding_")) {
        this.finish(eid, this.pending.get(eid)!, false, "You released the spring-loaded control before the cooperative job finished.");
        this.interruptInvalidWork(); return done(true, "You have released the control; it returned to rest.");
      }
      return true; // Preserve the accepted operation and its original receipt.
    }
    if (action.type === "move") {
      if (target === undefined || !hasComponent(w, target, Room)) return done(false, "That is not an established room.");
      if (getRoomForEntity(w, eid) === target) return done(true, "You are already in this room.");
      if (!this.movementTargets(eid).includes(target)) return done(false, "There is no currently traversable doorway to that room from here.");
      clearMovementTarget(eid); this.begin(eid, action, "walking", 3000, target); Appearance.posture[eid] = `walking toward ${Name.value[target]}`; return true;
    }
    if (action.type === "pickup") {
      if (target === undefined || !this.visible(eid).includes(target)) return done(false, "That object is not visible and reachable here.");
      const owner = getDirectContainer(w, target);
      if (owner !== undefined && hasComponent(w, owner, Agent)) return done(false, owner === eid ? "You already possess it." : "That is another person's possession; they must give it to you.");
      if ([i.pump, i.generator, i.bench].includes(owner!)) return done(false, "That part is installed in its mechanism, not loose for pickup.");
      if (!hasComponent(w, target, PhysicalObject) || !PhysicalObject.portable[target]) return done(false, "That object is fixed in place, not portable.");
      if (this.beginAtomic(eid, action, target, 800)) return true;
      const result = tryAddToInventory(w, eid, target);
      return done(result.success, result.success ? `You picked up the actual ${Name.value[target]}.` : result.reason);
    }
    if (action.type === "drop" || action.type === "give") {
      const item = action.type === "drop" ? target : [...query(w, [Name])].find(id => Name.value[id] === action.content);
      if (item === undefined || getDirectContainer(w, item) !== eid) return done(false, "You do not physically possess that item.");
      if (action.type === "drop" && this.beginAtomic(eid, action, item, 600)) return true;
      if (action.type === "give") {
        if (target === undefined || !hasComponent(w, target, Agent) || target === eid || getRoomForEntity(w, target) !== getRoomForEntity(w, eid)) return done(false, "The recipient must be a different person here in this room.");
        if (this.beginAtomic(eid, action, target, 1000)) return true;
        const result = tryAddToInventory(w, target, item);
        if (!result.success) return done(false, result.reason);
        addPerception(w, target, { type: "attention", content: `${Name.value[eid]} physically gave you the ${Name.value[item]}; it is now in your possession.`, source: "local world" });
      } else { setLocatedIn(w, item, getRoomForEntity(w, eid)!); syncInventoryCache(w, eid); }
      return done(true, `You ${action.type === "give" ? `gave ${Name.value[target!]} the` : "put down the"} actual ${Name.value[item]}.`);
    }
    if (["observe", "examine"].includes(action.type) && target !== undefined && !hasComponent(w, target, Agent) && !hasComponent(w, target, Room)) {
      if (!this.visible(eid).includes(target)) return done(false, "That object is not visible and reachable here.");
      if (this.beginAtomic(eid, action, target, 1500)) return true;
      return done(true, `You examine ${Name.value[target]}: ${Description.value[target] || ""} Current visible state: ${ObjectState.current[target] || "unchanged"}.`);
    }
    if (!["interact", "use", "attack"].includes(action.type)) return false;
    if (target === undefined || !this.visible(eid).includes(target)) return done(false, "That control or object is not visible and reachable in your current room.");
    if (action.type !== "interact") return done(false, "Use this mechanism's labelled interact control; that action does not operate it.");
    const unavailable = this.controlFailure(eid, target, verb);
    if (unavailable) return done(false, unavailable);
    if (!["hold", "release", "pump"].includes(verb) && !/^enter \d{4}$/.test(verb)
      && this.beginAtomic(eid, action, target, verb === "read" ? 1500 : verb === "install" ? 2000 : 1000)) return true;
    if (verb === "read") {
      const text = this.read(eid, target); return done(text !== undefined, text ?? "There is no readable inscription or display on that object.");
    }
    if (target === i.locker && /^unlock \d{4}$/.test(verb)) {
      if (verb.slice(7) !== this.secret.locker) return done(false, "The Crank locker rejects that combination and remains locked.");
      this.physics.lockerOpen[i.pump] = true; this.milestone("locker_open");
      return done(true, "The Crank locker opens. Inside you can now see the Pump crank.");
    }
    if ([i.pump, i.generator, i.bench].includes(target) && verb === "install") {
      const item = target === i.pump ? i.crank : target === i.generator ? i.coil : i.prism;
      setLocatedIn(w, item, target); syncInventoryCache(w, eid);
      this.milestone(target === i.pump ? "crank_installed" : target === i.generator ? "coil_installed" : "prism_installed");
      return done(true, `You installed the actual ${Name.value[item]} into the ${Name.value[target]}.`);
    }
    if ((target === i.bypass || target === i.release) && verb === "hold") {
      this.begin(eid, action, target === i.bypass ? "holding_bypass" : "holding_release", 45_000, target);
      this.announce(getRoomForEntity(w, eid)!, `${Name.value[eid]} is physically holding the ${Name.value[target]}. The spring-loaded control can be held for up to 45 seconds.`);
      return true;
    }
    if (target === i.pump && verb === "pump") {
      this.begin(eid, action, "pumping", 8000, target); this.announce(i.workshop, `${Name.value[eid]} starts cranking the drain pump. Water will recede only after eight uninterrupted seconds.`); return true;
    }
    if (target === i.router && this.powerRoutes.some(route => verb === `route ${route}`)) {
      const power = verb.slice(6);
      this.physics.power[i.pump] = power; this.syncPhysicalState(); this.interruptInvalidWork();
      this.announce(i.gallery, power === "optics" ? "The Optical bench's light switches on." : "The Optical bench's light is off; no projected digits remain visible.");
      this.announce(i.atrium, power === "exit" ? "The Exit keypad powers up." : "The Exit keypad is dark and unpowered.");
      if (this.relay) this.announce(i.workshop, power === "pump" ? "The drain pump's electrical supply switches on." : "The drain pump's electrical supply is off.");
      this.milestone(`power_${power}`); return done(true, `You routed generator power to ${power}.`);
    }
    if (target === i.bench && /^align (amber|cobalt|violet)$/.test(verb)) {
      this.physics.alignment[i.pump] = verb.slice(6);
      return done(true, `You set the Optical bench's calibration detent to ${verb.slice(6)}.`);
    }
    if (target === i.exit && /^enter \d{4}$/.test(verb)) {
      if (verb.slice(6) !== this.secret.exit) return done(false, "The Exit keypad rejects that code. The door remains locked.");
      this.begin(eid, action, "unlocking", 2000, target); return true;
    }
    return done(false, `That is not an operating control for ${Name.value[target]}. Labelled controls: ${this.verbs(eid, target).join(", ") || "none"}.`);
  }

  private syncPhysicalState() {
    const w = this.sim.world, i = this.ids, p = this.physics;
    if (getDirectContainer(w, i.coil) !== i.generator) p.power[i.pump] = "off";
    ObjectState.current[i.locker] = p.lockerOpen[i.pump] ? "open" : "locked";
    const floodedArea = this.relay ? "exterior threshold" : "Archive";
    ObjectState.current[i.pump] = p.drained[i.pump] ? this.relay ? "exterior threshold drained; drainage interlock clear" : "Archive drained; route passable" : [...this.pending.keys()].some(id => this.activity.phase[id] === "pumping") ? `pumping; ${floodedArea} still flooded` : getDirectContainer(w, i.crank) === i.pump ? `crank installed; ${floodedArea} flooded` : `crank missing; ${floodedArea} flooded`;
    ObjectState.current[i.generator] = getDirectContainer(w, i.coil) === i.generator ? "coil installed; available" : "empty coil socket";
    ObjectState.current[i.router] = `power routed to ${p.power[i.pump]}`;
    ObjectState.current[i.bench] = `${getDirectContainer(w, i.prism) === i.bench ? "prism installed" : "empty prism socket"}; calibration ${p.alignment[i.pump]}; ${this.illuminated() ? "illuminated digits; read to discern them" : "no legible projection"}`;
    if (this.illuminated()) this.milestone("optical_display_lit");
    ObjectState.current[i.exit] = p.exitOpen[i.pump] ? "unlocked; exterior door open" : p.power[i.pump] === "exit" ? "powered; locked" : "unpowered; locked";
    if (this.relay) ObjectState.current[i.exit] += p.drained[i.pump] ? "; drainage interlock clear" : "; exterior threshold flooded; drainage interlock blocking";
    for (const control of [i.bypass, i.release]) { const helper = this.holder(control); ObjectState.current[control] = helper === undefined ? "at rest" : `held by ${Name.value[helper]}`; }
    p.allEscaped[i.pump] = this.characters.every(name => getRoomForEntity(w, i[name]) === i.outside);
  }
  /** A small authored public surface, not the internal physics component. In
   * particular: no combinations, correct calibration answer, hidden inventory,
   * helper identity, remote actor state, or global all-escaped flag. */
  private observableState(target: number): ObservableStateField[] {
    if (this.stopped) return [];
    const w = this.sim.world, i = this.ids, p = this.physics;
    const flag = (key: string, value: boolean): ObservableStateField => ({ key, type: "boolean", value });
    const operating = (phase: string) => [...this.pending.keys()].some(eid => this.activity.phase[eid] === phase && !this.workFailure(eid));
    if (target === i.locker) return [flag("open", p.lockerOpen[i.pump] === true)];
    if (target === i.pump) return [flag("drained", p.drained[i.pump] === true),
      flag("crankInstalled", getDirectContainer(w, i.crank) === i.pump), flag("operating", operating("pumping"))];
    if (target === i.generator) return [flag("coilInstalled", getDirectContainer(w, i.coil) === i.generator)];
    if (target === i.router) return [{ key: "route", type: "enum", values: this.powerRoutes, value: p.power[i.pump] }];
    if (target === i.bench) return [flag("prismInstalled", getDirectContainer(w, i.prism) === i.bench),
      { key: "calibration", type: "enum", values: ["unset", "amber", "cobalt", "violet"], value: p.alignment[i.pump] },
      flag("illuminated", this.illuminated())];
    if (target === i.bypass || target === i.release) return [flag("held", this.holder(target) !== undefined)];
    if (target === i.exit) return [flag("powered", p.power[i.pump] === "exit" && getDirectContainer(w, i.coil) === i.generator),
      flag("open", p.exitOpen[i.pump] === true), flag("operating", operating("unlocking")),
      ...(this.relay ? [flag("drainageClear", p.drained[i.pump] === true)] : [])];
    return [];
  }
  private completeDueWork() {
    const w = this.sim.world, i = this.ids;
    const due = [...this.pending.keys()].filter(eid => this.activity.untilMs[eid] <= this.elapsed)
      .sort((a, b) => this.activity.untilMs[a] - this.activity.untilMs[b] || Number(String(this.activity.phase[a]).startsWith("holding_")) - Number(String(this.activity.phase[b]).startsWith("holding_")));
    for (const eid of due) {
      const action = this.pending.get(eid); if (!action) continue;
      const reason = this.workFailure(eid); if (reason) { this.finish(eid, action, false, reason); continue; }
      const phase = this.activity.phase[eid];
      if (phase === "handling") {
        this.atomicResuming.add(action);
        try { this.executePhysical(eid, action); } finally { this.atomicResuming.delete(action); }
      } else if (phase === "walking") {
        const destination = this.activity.destination[eid];
        if (!this.movementTargets(eid).includes(destination)) { this.finish(eid, action, false, "That doorway became impassable before you arrived."); continue; }
        setLocatedIn(w, eid, destination); clearMovementTarget(eid);
        if (hasComponent(w, eid, GridPosition)) { GridPosition.x[eid] = GridPosition.x[destination]; GridPosition.y[eid] = GridPosition.y[destination]; }
        this.finish(eid, action, true, `You arrived in the ${Name.value[destination]}.`);
        this.announce(destination, `${Name.value[eid]} enters the ${Name.value[destination]}.`);
        if (destination === i.archive) this.milestone("archive_entered");
        if (destination === i.outside) this.milestone(`${Name.value[eid].toLowerCase()}_escaped`);
      } else if (String(phase).startsWith("holding_")) {
        this.finish(eid, action, false, "After 45 seconds you can no longer hold the spring-loaded control; it returned to rest. Coordinate a fresh attempt.");
      } else if (phase === "pumping" || phase === "unlocking") {
        const helper = this.holder(phase === "pumping" ? i.bypass : i.release)!;
        const holding = this.pending.get(helper);
        if (phase === "pumping") { this.physics.drained[i.pump] = true; this.milestone(this.relay ? "threshold_drained" : "archive_drained"); }
        else { this.physics.exitOpen[i.pump] = true; this.milestone("exit_open"); }
        const drainedDetail = this.relay ? "The exterior threshold is drained and its drainage interlock is clear." : "The Archive is drained and its doorway is passable.";
        this.finish(eid, action, true, phase === "pumping" ? `You finished eight seconds of pumping while your partner held the bypass. ${drainedDetail}` : "The valid code and held release completed the unlock. The exterior door is now open to the Courtyard.");
        if (holding) this.finish(helper, holding, true, `You held the control throughout the completed ${phase === "pumping" ? "pumping" : "unlocking"}, then released it.`);
        this.announce(phase === "pumping" ? i.workshop : i.atrium, phase === "pumping" ? this.relay ? "The exterior floodwater recedes. The threshold drainage indicator is clear." : "The water recedes. The Archive doorway is now visibly passable." : "The exterior door clicks open. The Courtyard is accessible.");
        if (phase === "pumping" && this.relay) this.announce(i.atrium, "The exterior threshold is dry; the keypad's drainage interlock clears.");
      }
    }
    this.interruptInvalidWork();
  }
  /** Advance physical deadlines, never model decisions. Large steps preserve order. */
  advance(deltaMs: number) {
    if (!this.started || this.stopped) return;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) throw new Error("Expected a positive finite physical delta");
    advancePhysicalStep(this.sim.world, deltaMs, delta => this.advancePhysics(delta));
  }
  private advancePhysics(deltaMs: number) {
    const target = this.elapsed + deltaMs;
    this.syncPhysicalState(); this.interruptInvalidWork();
    while (true) {
      const due = [...this.pending.keys()].map(eid => this.activity.untilMs[eid]).filter(at => at <= target);
      if (!due.length) break;
      this.elapsed = Math.max(this.elapsed, Math.min(...due)); this.completeDueWork();
    }
    this.elapsed = target; this.syncPhysicalState();
    completePhysicalStep(this.sim.world, target);
    if (this.physics.allEscaped[this.ids.pump]) this.milestone("all_escaped");
    goalEvaluationSystem(this.sim.world, { query, getRelationTargets, log: message => this.sim.god.systemRegistry.logs.push(message), emit: (type, data) => {
      this.sim.god.systemRegistry.events.push({ type, data, timestamp: Date.now() });
      if (type === "goal_completed") this.record({ kind: type, text: String(data.goal), actorId: this.ids[data.agent as EscapeCharacter], visibility: "operator" });
    } });
  }
  async start() { if (this.started || this.stopped) throw new Error("Create a fresh escape room to restart"); this.started = true;
    this.unregister.push(registerSimulationDeadlineProvider(this.sim.world, () => {
      const due = [...this.pending.keys()].map(eid => this.activity.untilMs[eid]).filter(at => at > this.elapsed);
      return due.length ? Math.min(...due) : undefined;
    }));
    if (this.options.live) await this.sim.start(); }
  stop() { if (this.stopped) return; this.stopped = true; for (const abort of this.decisions.values()) abort.abort(); this.sim.stop(); for (const remove of this.unregister) remove(); this.listeners.clear(); }
  /** Operator fixture input, not autonomous cognition evidence. */
  dispatch(character: EscapeCharacter, action: AgentAction) { if (!this.started || this.stopped) throw new Error("Start the testbed first"); executeActions(this.sim.world, [{ eid: this.ids[character], action }], this.sim.god.systemRegistry); }
  /** An old milestone alone cannot establish that interruptible work is active.
   * These are operator triggers, not extra knowledge available to the actors. */
  canPerturbAfter(stage: EscapePerturbationStage): boolean {
    if (!isEscapePerturbationStage(stage) || !this.started || this.stopped || !this.milestoneTimes.has(stage)) return false;
    if (stage === "exit_code_read") return this.physics.power[this.ids.pump] !== "off";
    return !this.physics.exitOpen[this.ids.pump] && [...this.pending.keys()].some(eid =>
      this.activity.phase[eid] === "unlocking" && this.activity.untilMs[eid] > this.elapsed && !this.workFailure(eid));
  }
  /** Recoverable reset. Only witnesses at the affected mechanisms hear it.
   * The optional stage is rechecked atomically, so a stale trigger cannot claim
   * it interrupted work that has already finished or failed. */
  perturb(options: { after?: EscapePerturbationStage } = {}) {
    if (!this.started || this.stopped) throw new Error("Start the testbed first");
    if (options.after !== undefined && !this.canPerturbAfter(options.after)) return { changed: false };
    const changed = this.physics.power[this.ids.pump] !== "off";
    if (!changed) return { changed: false };
    const actorId = [...this.pending.keys()].find(eid => this.activity.phase[eid] === "unlocking" && !this.workFailure(eid));
    const helperId = this.holder(this.ids.release);
    const powerTrip: NonNullable<EscapeRoomEvent["powerTrip"]> = {
      fromPower: String(this.physics.power[this.ids.pump]), exitOpen: Boolean(this.physics.exitOpen[this.ids.pump]),
      pendingUnlock: actorId !== undefined && helperId !== undefined ? { actorId, action: { ...this.pending.get(actorId)! },
        untilMs: this.activity.untilMs[actorId], helperId, helperUntilMs: this.activity.untilMs[helperId] } : undefined,
    };
    this.physics.power[this.ids.pump] = "off"; this.syncPhysicalState();
    this.record({ kind: "operator_edit", text: "A recoverable power trip reset the router to off; installed parts and door state are preserved.", visibility: "operator", powerTrip });
    this.interruptInvalidWork();
    if (powerTrip.pendingUnlock && !this.pending.has(powerTrip.pendingUnlock.actorId)) this.milestone("exit_unlock_interrupted");
    this.announce(this.ids.workshop, "The generator safety relay clicks; the Power router visibly trips to off. Its installed coil remains intact.");
    this.announce(this.ids.gallery, "The optical light cuts out. Its projected digits disappear.");
    this.announce(this.ids.atrium, "The Exit keypad loses power.");
    for (const name of this.characters) {
      const eid = this.ids[name];
      if (![this.ids.workshop, this.ids.gallery, this.ids.atrium].includes(getRoomForEntity(this.sim.world, eid)!)) continue;
      this.revisions.set(eid, (this.revisions.get(eid) ?? 0) + 1); this.decisions.get(eid)?.abort();
    }
    return { changed: true };
  }
  /** Public renderer projection. Private read receipts never become scene text. */
  scenes(): SceneSnapshot[] {
    const w = this.sim.world;
    return [...query(w, [Room, Name])].map(roomId => {
      const actors = this.characters.map(name => this.ids[name]).filter(eid => getRoomForEntity(w, eid) === roomId);
      const props = [...listDirectContents(w, roomId), ...(roomId === this.ids.workshop && this.physics.lockerOpen[this.ids.pump] ? listDirectContents(w, this.ids.locker) : [])]
        .filter(eid => hasComponent(w, eid, PhysicalObject) && !hasComponent(w, eid, Agent));
      return snapshotDirectorScene({ sourceId: this.sourceId, sourceTick: this.sim.world.time.tick, elapsedMs: this.elapsed, capturedWallMs: Date.now(),
        room: { id: roomId, name: Name.value[roomId], description: Description.value[roomId] || "" },
        actors: actors.flatMap(eid => { const appearance = snapshotCharacterAppearance(w, eid); return appearance ? [{ id: eid, roomId, name: Name.value[eid], appearance,
          activity: this.pending.has(eid) ? { action: this.activity.phase[eid], status: "pending" as const, targetId: this.activity.destination[eid] } : undefined }] : []; }),
        props: props.map(eid => ({ id: eid, roomId, name: Name.value[eid], description: Description.value[eid] || "", state: ObjectState.current[eid] || undefined })),
        events: this.history.filter(event => event.visibility === "public" && event.roomId === roomId && event.elapsedMs >= this.elapsed - 8000).map(event => ({ id: `${this.sourceId}:${event.sequence}`, actorId: event.actorId, roomId, kind: event.kind, action: event.action?.type, status: event.status ?? "succeeded", text: event.text, sourceTick: event.tick, elapsedMs: event.elapsedMs })),
      });
    });
  }
  invariants(): string[] {
    const w = this.sim.world, i = this.ids, violations: string[] = [];
    if (this.physics.power[i.pump] !== "off" && getDirectContainer(w, i.coil) !== i.generator) violations.push("power_without_installed_coil");
    if (!this.physics.exitOpen[i.pump] && this.characters.some(name => getRoomForEntity(w, i[name]) === i.outside)) violations.push("actor_outside_locked_exit");
    if (!this.relay && !this.physics.drained[i.pump] && this.characters.some(name => getRoomForEntity(w, i[name]) === i.archive)) violations.push("actor_inside_flooded_archive");
    if (this.relay && !this.physics.drained[i.pump] && (this.physics.exitOpen[i.pump] || this.characters.some(name => getRoomForEntity(w, i[name]) === i.outside))) violations.push("exit_crossed_before_threshold_drained");
    if (!this.physics.lockerOpen[i.pump] && getDirectContainer(w, i.crank) !== i.locker) violations.push("crank_escaped_locked_locker");
    return violations;
  }
  snapshot() {
    const w = this.sim.world, i = this.ids;
    const state = { lockerOpen: Boolean(this.physics.lockerOpen[i.pump]), crankInstalled: getDirectContainer(w, i.crank) === i.pump,
      drained: Boolean(this.physics.drained[i.pump]), coilInstalled: getDirectContainer(w, i.coil) === i.generator, prismInstalled: getDirectContainer(w, i.prism) === i.bench,
      power: String(this.physics.power[i.pump]), alignment: String(this.physics.alignment[i.pump]), aligned: this.physics.alignment[i.pump] === this.secret.alignment,
      illuminated: this.illuminated(), exitOpen: Boolean(this.physics.exitOpen[i.pump]), allEscaped: this.characters.every(name => getRoomForEntity(w, i[name]) === i.outside) };
    return { sourceId: this.sourceId, elapsedMs: this.elapsed, seed: this.options.seed, topology: this.options.topology, escaped: state.allEscaped, tick: this.sim.world.time.tick, options: this.options, state,
      milestones: Object.fromEntries(this.milestoneTimes), invariantViolations: this.invariants(),
      actors: this.characters.map(name => ({ name, id: i[name], room: Name.value[getRoomForEntity(w, i[name])!], activity: this.activity.phase[i[name]], untilMs: this.activity.untilMs[i[name]], mind: getAgentMemory(w, i[name]), goalStatus: Goal.status[this.sharedGoals.get(i[name])!] })),
      events: structuredClone(this.history), runtime: this.sim.getRuntimeStatus() };
  }
}
