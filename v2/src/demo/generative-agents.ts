/** A small authored social laboratory on the production Argos runtime.
 * This package supplies physics, initial conditions and observation, never NPC decisions.
 * No renderer or model request is made until the caller explicitly starts a live run.
 */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { completePhysicalStep, advancePhysicalStep } from "./physical-time";
import { registerSimulationDeadlineProvider, reserveSimulationResources, releaseSimulationResources, scheduleSimulationEvent, type PublicPhysicalOperation } from "../runtime/simulation-timeline";
import { readSimulationTime } from "../ecs/simulation-time";
import { publishCommittedEvent, getCommittedEvents } from "../runtime/committed-events";
import { Agent, Appearance, BehaviorPolicy, Container, Description, EquipSlot, Goal, GridPosition, Name, ObjectState, Personality, PhysicalObject, Room } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { getDirectContainer, getRoomForEntity, listDirectContents, setLocatedIn } from "../ecs/location";
import { syncInventoryCache, tryAddToInventory } from "../ecs/inventory";
import { registerSystem } from "../ecs/dynamic-systems";
import { addPerception, addThought, getAgentMemory, type AgentAction } from "../cognition/agent-mind";
import { completeDeferredAction, createIntentGoal, executeActions } from "../cognition/cognition-system";
import { setGoalContract } from "../cognition/goal-contract";
import { addMemory } from "../cognition/knowledge-graph";
import { registerAgentWorldCapabilities, getAgentWorldCapabilityGeneration } from "../cognition/world-capabilities";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { clearMovementTarget } from "../systems/builtin-systems";
import { goalEvaluationSystem } from "../systems/goal-evaluation-system";
import { configureCharacterAppearance, registerGarment, snapshotCharacterAppearance, tryRemoveGarment, tryWearGarment } from "../rendering/character-appearance";
import { SceneDirector, snapshotDirectorScene, type SceneSnapshot, type SceneEvent } from "../rendering/scene-director";
import { isPublicVisualProp } from "../rendering/public-visual-props";

export type TestbedCharacter = "Mara" | "Ivo" | "Sera";
export interface GenerativeAgentsOptions {
  /** False is a physics fixture, NOT evidence of autonomous cognition. Default true. */
  live?: boolean;
  /** Opt into God/spirit world expansion and coding workers. Baseline isolates cognition. */
  evolve?: boolean;
  /** Opt-in cooperative leak / access-panel repair; false preserves the baseline. */
  challenge?: boolean;
}
export interface TestbedEvent {
  sequence: number; elapsedMs: number; tick: number; actorId?: number; roomId?: number;
  kind: string; text: string; visibility: "public" | "private" | "operator";
  action?: AgentAction; status?: "pending" | "succeeded" | "failed";
  /** Retain provenance: a background interpretation is not a foreground choice. */
  thoughtType?: string;
}
function component(name: string, properties: Record<string, "number" | "string" | "boolean">) {
  extendDynamicComponent({ name, description: `Storm-house testbed: ${name}`, properties });
  return getComponent(name)!;
}

export class GenerativeAgentsTestbed {
  readonly sourceId = randomUUID();
  readonly director = new SceneDirector();
  readonly ids: Record<"Mara" | "Ivo" | "Sera" | "common" | "utility" | "cupboard" | "key" | "fuse" | "relay" | "breaker" | "lamp" | "coat", number>;
  readonly circuit = component("TestbedCircuit", { isolated: "boolean", repaired: "boolean", lit: "boolean" });
  readonly activity = component("TestbedActivity", { phase: "string", untilMs: "number", origin: "number", destination: "number" });
  readonly challengeState = component("TestbedChallenge", { leakActive: "boolean", wet: "boolean", holderId: "number", holdUntilMs: "number", repairerId: "number", dryingBy: "number" });
  readonly challengeIds?: Record<"store" | "valve" | "floor" | "panel" | "cloth", number>;
  readonly options: Required<GenerativeAgentsOptions>;
  private elapsed = 0;
  private sequence = 0;
  private started = false;
  private stopped = false;
  private history: TestbedEvent[] = [];
  private listeners = new Set<(event: TestbedEvent) => void>();
  private unregister: Array<() => void> = [];
  private pending = new Map<number, AgentAction>();
  private decisions = new Map<number, AbortController>();
  private readyAt = new Map<number, number>();
  private revisions = new Map<number, number>();
  private sharedGoals = new Map<number, number>();
  private handling = new Map<number, AgentAction>();
  private resuming = new Set<AgentAction>();
  private intervals = new Map<string, { startedAtSimMs: number; expectedEndSimMs: number; actorKey: string;
    roomId: number; roomKey: string; targetId?: number; targetKey?: string; generation: object | undefined }>();

  private constructor(readonly sim: ArgosSimulation, options: GenerativeAgentsOptions) {
    this.options = { live: options.live !== false, evolve: options.evolve === true, challenge: options.challenge === true };
    const find = (name: string) => {
      const id = [...query(sim.world, [Name])].find(e => Name.value[e] === name);
      if (id === undefined) throw new Error(`Missing testbed entity: ${name}`);
      return id;
    };
    this.ids = { Mara: find("Mara"), Ivo: find("Ivo"), Sera: find("Sera"), common: find("Common Room"), utility: find("Utility Room"),
      cupboard: find("Supply cupboard"), key: find("Brass key"), fuse: find("Spare fuse"), relay: find("Lighting relay"),
      breaker: find("Isolation switch"), lamp: find("Reading lamp"), coat: find("Yellow raincoat") };
    if (this.options.challenge) this.challengeIds = { store: find("Store Room"), valve: find("Leak valve"), floor: find("Wet floor"), panel: find("Access panel"), cloth: find("Cleaning cloth") };
    const w = sim.world, i = this.ids;
    attachToEntity(w, i.relay, "TestbedCircuit", { isolated: false, repaired: false, lit: false });
    setLocatedIn(w, i.key, i.Ivo); syncInventoryCache(w, i.Ivo);
    setLocatedIn(w, i.fuse, i.cupboard);
    addComponent(w, i.cupboard, Container);
    Container.capacity[i.cupboard] = 10; Container.currentCount[i.cupboard] = 1; Container.allowedTypes[i.cupboard] = "[]";
    ObjectState.current[i.cupboard] = "locked";
    ObjectState.current[i.relay] = "blown fuse"; ObjectState.current[i.breaker] = "on"; ObjectState.current[i.lamp] = "dark";
    if (this.challengeIds) {
      attachToEntity(w, i.relay, "TestbedChallenge", { leakActive: true, wet: true, holderId: -1, holdUntilMs: 0, repairerId: -1, dryingBy: -1 });
      this.circuit.isolated[i.relay] = true; ObjectState.current[i.breaker] = "off (tripped)";
      ObjectState.current[this.challengeIds.valve] = "open; water leaking toward the Utility Room";
      ObjectState.current[this.challengeIds.floor] = "wet; active drips";
      ObjectState.current[this.challengeIds.panel] = "closed; spring-loaded";
    }
    configureCharacterAppearance(w, i.Mara, { age: "adult, early thirties", build: "slender", hairColor: "dark brown", hairStyle: "short bob", distinguishing: "woman", clothing: "mustard cardigan, charcoal trousers, brown boots", expression: "attentive", posture: "standing" });
    configureCharacterAppearance(w, i.Ivo, { age: "adult, late fifties", build: "broad-shouldered", hairColor: "silver", hairStyle: "cropped", distinguishing: "man with a short silver beard", clothing: "navy work shirt, worn brown work trousers, heavy boots", expression: "concerned", posture: "standing" });
    configureCharacterAppearance(w, i.Sera, { age: "adult, late twenties", build: "compact", hairColor: "black", hairStyle: "long braid", distinguishing: "woman", clothing: "burgundy sweater, cream apron, dark jeans", expression: "alert", posture: "standing" });
    registerGarment(w, i.coat, { slot: "outerwear" });
    const knowledge: Record<TestbedCharacter, string> = {
      Mara: "The reading lamp went out during the storm. I have repaired small circuits before, but I do not know where this house keeps spare parts or its cupboard key. Ivo is the caretaker; Sera stocks the house.",
      Ivo: "I am carrying the Brass key for the Supply cupboard. The lighting circuit must be isolated at the Isolation switch before a fuse is installed, then switched on afterwards. I am willing to lend my key and help, but want a safe repair.",
      Sera: "Yesterday I put the Spare fuse inside the Supply cupboard in the Utility Room. Ivo normally carries its Brass key. I want the lamp working so we can sit together; I dislike being treated as just the cook.",
    };
    if (this.challengeIds) {
      knowledge.Mara = "The relay fuse is blown. I have repaired this model: its spring-loaded Access panel must be physically held open by a second person throughout installation; I cannot hold it and install the part myself. A replacement fuse is needed, but I do not know where this house stores one. Ivo knows the building; Sera stocks supplies.";
      knowledge.Ivo = "I have the Brass key for the Supply cupboard. The circuit has tripped. The Leak valve in the Store Room stops the water entering the Utility Room. The floor cannot be dried until the leak stops. Power is unsafe until the floor is dry, the replacement fuse is installed and the Access panel is closed.";
      knowledge.Sera = "I put the Spare fuse in the locked Supply cupboard in the Store Room yesterday. A Cleaning cloth is hanging in that room. Ivo normally has the Brass key. I can fetch supplies or dry a floor once the water has stopped, and I want to be included as an equal in the repair.";
    }
    for (const name of this.characters) {
      const eid = i[name];
      attachToEntity(w, eid, "TestbedActivity", { phase: "idle", untilMs: 0, origin: -1, destination: -1 });
      if (hasComponent(w, eid, BehaviorPolicy)) BehaviorPolicy.enabled[eid] = false;
      addComponent(w, eid, Personality);
      Personality.openness[eid] = name === "Mara" ? .85 : .65;
      Personality.conscientiousness[eid] = name === "Ivo" ? .9 : .7;
      Personality.extraversion[eid] = name === "Sera" ? .8 : .5;
      Personality.agreeableness[eid] = .65; Personality.neuroticism[eid] = .35;
      addMemory(w, eid, { type: "episodic", content: knowledge[name], importance: .95, emotionalValence: 0, timestamp: Date.now() });
      const goal = createIntentGoal(w, eid, name === "Ivo" ? "Help restore the reading lamp safely, coordinating with Mara and Sera." : name === "Sera" ? "Help get the reading lamp working so we can sit and talk together." : "Restore the reading lamp by coordinating a safe repair with the others.", 8);
      setGoalContract(w, goal, { version: 1, kind: "custom", params: { objective: "storm_house_light" }, success: { type: "entity_component_equals", entityName: "Lighting relay", component: "TestbedCircuit", field: "lit", equals: true } });
      this.sharedGoals.set(eid, goal);
      const socialGoal = createIntentGoal(w, eid, name === "Mara" ? "Understand and get to know the people sharing this house." : name === "Ivo" ? "Feel trusted rather than ordered about." : "Have a warm, equal conversation with my housemates.", 3);
      Goal.kind[socialGoal] = "social";
      this.installCapabilities(eid);
      addPerception(w, eid, { type: "observation", content: `You are inside the Common Room with ${this.characters.filter(n => n !== name).join(" and ")}. Rain rattles the closed window. The Reading lamp has gone dark. The Utility Room is one short indoor walk away.`, source: "local world" });
    }
    const focusCounter = sim.god.systemRegistry.systems.get("GoalProgress");
    if (focusCounter) focusCounter.active = false; // thinking about a goal is not completion
    // The generic preset advances one hour every 30 seconds. This real-time
    // laboratory has one clock: elapsed physical seconds, including schedules.
    const acceleratedClock = sim.god.systemRegistry.systems.get("TimeProgression");
    if (acceleratedClock) acceleratedClock.active = false;
    sim.world.time.simulationHour = 20; sim.world.time.timeOfDay = "evening";
    registerSystem(sim.god.systemRegistry, { name: "GenerativeAgentsPhysics", description: "Grounded travel, circuit consequences and proven shared goal completion", pseudocode: "Advance accepted travel; derive lamp state from physical circuit; complete goals only from ECS proof.", active: true, frequency: 0, lastRun: 0, compiledFn: (_w, ctx) => this.advance(ctx.delta) });
  }
  static async create(options: GenerativeAgentsOptions = {}): Promise<GenerativeAgentsTestbed> {
    const live = options.live !== false, evolve = live && options.evolve === true, challenge = options.challenge === true;
    const sim = await createSimulation({ name: "Storm House — three minds, one world", preset: "minimal", enableAI: live,
      enablePlanning: live, enableReflection: live, enableSpirits: evolve, enableNarrativeEngine: evolve,
      evolution: evolve, codingDaemons: evolve, godAutopilot: evolve, enableServer: false,
      dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500,
      narrative: "Three adult housemates shelter from a storm in a coastal boarding house. A dark reading lamp creates a small practical problem and a reason to talk. They have distinct knowledge, priorities and temperaments. Develop relationships through actual perceptions, speech, movement and grounded actions. Never invent completed repairs, transfer knowledge between minds or force cooperation. Preserve established people, possessions and circuit rules.",
      rooms: [{ name: "Common Room", x: 50, y: 50, description: "INTERIOR enclosed common room, faded green plaster, ceiling, wooden floor, armchairs around a low table, a reading lamp by the rain-streaked CLOSED window, coat peg beside the interior doorway to the utility room. Warm pools of dim emergency light. No exterior stairs or porch." },
        { name: "Utility Room", x: 170, y: 50, description: challenge
          ? "INTERIOR small enclosed utility room, tiled floor beneath exposed pipes, a lighting relay behind a heavy spring-loaded Access panel, and an Isolation switch on the left wall. Interior doorways connect to the Common Room and the Store Room."
          : "INTERIOR small enclosed utility room, tiled floor, exposed pipes, lighting relay and isolation switch on the left wall, wooden supply cupboard on the right. A single interior doorway leads back to the Common Room." },
        ...(challenge ? [{ name: "Store Room", x: 290, y: 50, description: "INTERIOR enclosed storeroom with a wooden Supply cupboard, cleaning supplies and a labelled pipe valve. One interior doorway returns to the Utility Room." }] : [])],
      agents: [
        { name: "Mara", role: "resourceful resident", startRoom: "Common Room", description: "Adult woman with a short dark bob.", systemPrompt: "You are Mara. Curious, practical and independently minded. You enjoy understanding how things work and dislike pretending to know things you do not. Ask people for missing information or help. Coordinate rather than duplicate someone else's work." },
        { name: "Ivo", role: "cautious caretaker", startRoom: "Common Room", description: "Broad-shouldered older adult man with a short silver beard.", systemPrompt: "You are Ivo, the caretaker. Careful, dryly funny, proud of useful work. You can lend tools or keys to people you trust. Explain safety concerns instead of repeating refusals. Listen and respond to what people actually say." },
        { name: "Sera", role: "observant resident and cook", startRoom: "Common Room", description: "Adult woman with a long black braid.", systemPrompt: "You are Sera. Sociable, perceptive and direct. You remember where supplies are kept. Offer useful knowledge and ask for help when needed. You have your own opinions; you are not a servant. Speak briefly and specifically; do not narrate things that have not happened." },
      ],
      objects: [
        { name: "Supply cupboard", room: challenge ? "Store Room" : "Utility Room", description: "A small wooden supply cupboard with a brass keyhole. Its contents are hidden when locked.", portable: false },
        { name: "Brass key", room: "Common Room", description: "One small brass cupboard key.", portable: true, traits: ["takeable"] },
        { name: "Spare fuse", room: "Utility Room", description: "One intact ceramic replacement fuse.", portable: true, traits: ["takeable"] },
        { name: "Lighting relay", room: "Utility Room", description: "A grey wall-mounted lighting relay with a ceramic fuse socket behind a transparent cover.", portable: false },
        { name: "Isolation switch", room: "Utility Room", description: "Labelled OFF to isolate the lighting relay; ON to power it after repair.", portable: false },
        { name: "Reading lamp", room: "Common Room", description: "A brass reading lamp powered by the utility-room lighting relay.", portable: false },
        { name: "Yellow raincoat", room: "Common Room", description: "A knee-length yellow waxed raincoat with dark buttons.", portable: true, traits: ["takeable"] },
        ...(challenge ? [
          { name: "Leak valve", room: "Store Room", description: "A red hand valve on the pipe leading into the Utility Room. Turning it closed stops that pipe's flow; opening it starts the flow again.", portable: false },
          { name: "Wet floor", room: "Utility Room", description: "A patch of tiled floor below the pipe and relay. Water must stop entering before it can be dried with a cleaning cloth.", portable: false },
          { name: "Access panel", room: "Utility Room", description: "A heavy spring-loaded relay cover. One person must hold it open while a different person installs the fuse. It closes when released; the safety interlock blocks power while it is open.", portable: false },
          { name: "Cleaning cloth", room: "Store Room", description: "A thick absorbent cleaning cloth suitable for drying the utility floor.", portable: true, traits: ["takeable"] },
        ] : []),
      ] });
    return new GenerativeAgentsTestbed(sim, options);
  }
  get characters(): TestbedCharacter[] { return ["Mara", "Ivo", "Sera"]; }
  get elapsedMs() { return this.elapsed; }
  onEvent(listener: (event: TestbedEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private record(event: Omit<TestbedEvent, "sequence" | "elapsedMs" | "tick">) {
    if (this.stopped) return; // cancelled background work cannot append after handoff
    const value = { ...event, sequence: ++this.sequence, elapsedMs: this.elapsed, tick: this.sim.world.time.tick };
    this.history.push(value); this.history = this.history.slice(-1000);
    for (const listener of this.listeners) listener(structuredClone(value));
  }
  private installCapabilities(eid: number) {
    const w = this.sim.world;
    this.unregister.push(registerAgentWorldCapabilities(w, eid, {
      ownsMovement: true,
      ready: () => this.started && !this.stopped && !this.pending.has(eid) && !this.handling.has(eid) && !this.decisions.has(eid) && this.elapsed >= (this.readyAt.get(eid) ?? 0),
      busy: () => this.pending.has(eid) || this.handling.has(eid), context: () => this.context(eid),
      publicActivity: () => this.pending.has(eid) || this.handling.has(eid)
        ? { kind: this.activity.phase[eid] === "walking" ? "moving" : this.activity.phase[eid] === "holding_panel" ? "holding" : "operating", operation: this.publicOperation(eid), targetEid: this.activity.destination[eid] } : undefined,
      canInterruptBusyAction: action => Boolean(this.challengeIds && this.activity.phase[eid] === "holding_panel"
        && this.pending.has(eid) && action.type === "interact" && action.target?.trim().toLowerCase() === Name.value[this.challengeIds.panel].toLowerCase()
        && action.content?.trim().toLowerCase() === "release"),
      visibleEntities: () => this.visible(eid),
      movementTargets: () => this.movementTargets(eid),
      // Publish success definitions, not private state snapshots or scripted decisions.
      goalCompletionOptions: () => [
        { id: "light", description: "Reading lamp is lit", success: { type: "entity_component_equals" as const, entityName: "Reading lamp", component: "ObjectState", field: "current", equals: "lit" } },
        ...(this.challengeIds && this.visible(eid).includes(this.challengeIds.cloth) ? [{ id: "return-cloth", description: "Cleaning cloth is put down in the Store Room", success: { type: "entity_in_room" as const, entityName: "Cleaning cloth", roomName: "Store Room", uncarried: true } }] : []),
      ],
      affordances: target => this.verbs(eid, target).map(name => ({ name, requires: [], description: `Physical ${name}; wait for actual world feedback.` })),
      beginDecision: () => {
        const revision = this.revisions.get(eid) ?? 0, abort = new AbortController(), began = performance.now();
        this.decisions.set(eid, abort);
        const timeout = setTimeout(() => abort.abort(), 30_000);
        return { signal: abort.signal, isCurrent: () => !this.stopped && !abort.signal.aborted && revision === (this.revisions.get(eid) ?? 0), finish: () => {
          clearTimeout(timeout); if (this.decisions.get(eid) === abort) this.decisions.delete(eid);
          this.record({ kind: "decision_latency", text: `${Math.round(performance.now() - began)}`, actorId: eid, visibility: "operator" });
        } };
      },
      execute: action => this.executePhysical(eid, action),
      afterAction: (action, succeeded, pending) => {
        if (succeeded && action.type === "give") {
          const recipient = [...query(w, [Agent, Name])].find(id => Name.value[id] === action.target);
          const item = [...query(w, [PhysicalObject, Name])].find(id => Name.value[id] === action.content);
          if (recipient !== undefined && item !== undefined && getDirectContainer(w, item) === recipient) this.holdItem(recipient, item);
        }
        this.readyAt.set(eid, this.elapsed + 1000);
        this.recordAction(eid, action, pending ? "pending" : succeeded ? "succeeded" : "failed");
      },
      onThought: (_entity, content, type) => this.record({ kind: type === "injected" ? "planted_thought" : "thought", text: content, actorId: eid, visibility: "private" }),
      onSocialGoalSatisfied: (goal, reason) => this.record({ kind: "social_goal_satisfied", text: `${Goal.description[goal]}: ${reason}`, actorId: eid, visibility: "private" }),
      onPerception: (_entity, content, type) => {
        this.record({ kind: "perception", text: content, actorId: eid, visibility: "private" });
        if (["directed_speech", "attention", "intent"].includes(type)) this.readyAt.set(eid, this.elapsed);
      },
    }));
  }
  private publicOperation(eid: number): PublicPhysicalOperation | undefined {
    const action = this.handling.get(eid) ?? this.pending.get(eid);
    if (!action) return;
    if (action.type === "pickup") return "picking_up";
    return ({ unlock: "opening", switch_on: "switching", switch_off: "switching", close: "closing", open: "opening",
      dry: "drying", repair: "installing", wear: "wearing", remove: "removing" } as Record<string, PublicPhysicalOperation>)[action.content?.trim().toLowerCase() ?? ""];
  }
  private visible(eid: number) {
    const w = this.sim.world, room = getRoomForEntity(w, eid);
    const contents = room === undefined ? [] : listDirectContents(w, room);
    return [...new Set([...contents, ...listDirectContents(w, eid), ...(room === getRoomForEntity(w, this.ids.cupboard) && ObjectState.current[this.ids.cupboard] === "open" ? listDirectContents(w, this.ids.cupboard) : [])])].filter(id => entityExists(w, id));
  }
  /** One route source for action projection and physical admission. */
  private movementTargets(eid: number): number[] {
    const room = getRoomForEntity(this.sim.world, eid);
    if (room === this.ids.common || this.challengeIds && room === this.challengeIds.store) return [this.ids.utility];
    if (room === this.ids.utility) return [this.ids.common, ...(this.challengeIds ? [this.challengeIds.store] : [])];
    return [];
  }
  private verbs(eid: number, target: number): string[] {
    if (!this.visible(eid).includes(target)) return [];
    // The immediate action menu describes what this actor can execute now,
    // not everything this object has ever supported. Future prerequisites are
    // still described by the object/world rules so planning can prepare them.
    if (this.pending.has(eid)) return this.challengeIds && this.activity.phase[eid] === "holding_panel"
      && target === this.challengeIds.panel ? ["release"] : [];
    if (this.challengeIds) {
      const c = this.challengeIds, state = this.challengeState, relay = this.ids.relay;
      if (target === c.valve) return [state.leakActive[relay] ? "close" : "open"];
      if (target === c.floor) return state.wet[relay] && state.dryingBy[relay] < 0 && !this.workFailure(eid, "drying") ? ["dry"] : [];
      if (target === c.panel) return state.holderId[relay] < 0 && !this.workFailure(eid, "holding_panel") ? ["hold"] : [];
      if (target === relay && state.repairerId[relay] >= 0) return [];
    }
    if (target === this.ids.cupboard) return ObjectState.current[target] === "locked"
      && getDirectContainer(this.sim.world, this.ids.key) === eid ? ["unlock"] : [];
    if (target === this.ids.breaker) {
      if (!this.circuit.isolated[this.ids.relay]) return ["switch_off"];
      if (this.challengeIds && !this.canRestorePower()) return [];
      return ["switch_on"];
    }
    if (target === this.ids.relay) return !this.circuit.repaired[target]
      && this.circuit.isolated[target] && getDirectContainer(this.sim.world, this.ids.fuse) === eid
      && (!this.challengeIds || !this.workFailure(eid, "repairing")) ? ["repair"] : [];
    if (hasComponent(this.sim.world, target, EquipSlot) && getDirectContainer(this.sim.world, target) === eid)
      return [EquipSlot.equippedBy[target] === eid ? "remove" : "wear"];
    return [];
  }
  /** Only this actor's own possessions and physically visible local entities. */
  context(eid: number): string {
    const w = this.sim.world;
    return `SHARED HOUSE PHYSICS. Known rooms: Common Room, Utility Room${this.challengeIds ? ", Store Room. Interior routes: Common Room <-> Utility Room <-> Store Room" : ""}. move target=<exact adjacent room name> takes 3 seconds; no physical interactions while in transit. Your voice remains available while walking or holding.
Speak briefly to a character using speak target=<name> content=<words>. They must be in the same room to hear. Speech is not a transfer of an item.
give target=<recipient name> content=<exact item name> transfers your actual possession to a person here. pickup target=<exact item name> takes a visible portable object, never someone else's inventory.
interact target=<exact object name> content=<one available verb>. wear/remove apply to a physically possessed garment.
Your current room: ${Name.value[getRoomForEntity(w, eid)!]}. Your action: ${this.activity.phase[eid]}.
${this.challengeIds ? "Physical work takes time: dry takes 5 seconds, repair takes 6 seconds, hold supports a panel for at most 45 seconds. A helper stays occupied until repair completes, they release, or the hold times out. Coordinate start times through actual speech and local evidence.\n" : ""}
Visible local facts: ${JSON.stringify(this.visible(eid).filter(id => id !== eid).map(id => ({ name: Name.value[id], state: ObjectState.current[id] || undefined, actions: this.verbs(eid, id) })))}
Other people's private memories and inventory are not visible.`;
  }
  private recordAction(eid: number, action: AgentAction, status: "pending" | "succeeded" | "failed") {
    const kind = action.type === "speak" ? "speech" : action.type === "move" ? "movement" : action.type === "interact" && ["wear", "remove"].includes(action.content ?? "") ? "wardrobe" : "action";
    const privateAction = ["think", "reflect", "remember", "plan", "message", "send_message", "read_message"].includes(action.type)
      || action.type === "speak" && status !== "succeeded";
    this.record({ kind, text: action.type === "speak" ? action.content ?? "" : `${action.type} ${action.target ?? ""} ${action.content ?? ""}`.trim(), actorId: eid, roomId: getRoomForEntity(this.sim.world, eid), visibility: privateAction ? "private" : "public", action: { ...action }, status });
    const w = this.sim.world, executionId = action.executionId;
    if (!executionId || privateAction || action.type === "speak" || this.stopped || getCommittedEvents(w).stopped) return;
    const roomId = getRoomForEntity(w, eid);
    if (roomId === undefined || !entityExists(w, eid)) return;
    if (status === "pending") {
      const targetId = [...query(w, [Name])].find(id => Name.value[id].toLowerCase() === action.target?.trim().toLowerCase());
      this.intervals.set(executionId, { startedAtSimMs: readSimulationTime(w), expectedEndSimMs: this.activity.untilMs[eid],
        actorKey: workingMemoryEntityRef(w, eid)!.key, roomId, roomKey: workingMemoryEntityRef(w, roomId)!.key,
        targetId, targetKey: targetId === undefined ? undefined : workingMemoryEntityRef(w, targetId)!.key,
        generation: getAgentWorldCapabilityGeneration(w, eid) });
      reserveSimulationResources(w, eid, executionId, ["body"]);
    }
    const interval = this.intervals.get(executionId);
    if (!interval) return; // Native fallback publishes its own receipt.
    if (status !== "pending") { this.intervals.delete(executionId); releaseSimulationResources(w, eid, executionId); }
    if (workingMemoryEntityRef(w, eid)?.key !== interval.actorKey) return;
    const targetCurrent = interval.targetId !== undefined && entityExists(w, interval.targetId)
      && workingMemoryEntityRef(w, interval.targetId)?.key === interval.targetKey;
    publishCommittedEvent(w, { executionId, kind: "action", actorId: eid, roomId,
      ...(targetCurrent ? { targetId: interval.targetId } : {}), action: action.type, status,
      startedAtSimMs: interval.startedAtSimMs, expectedEndSimMs: interval.expectedEndSimMs,
      ...(status !== "pending" ? { completedAtSimMs: readSimulationTime(w) } : {}) });
  }
  private finish(eid: number, action: AgentAction, success: boolean, detail: string) {
    if (action.executionId) releaseSimulationResources(this.sim.world, eid, action.executionId);
    if (this.challengeIds) {
      const state = this.challengeState, relay = this.ids.relay;
      if (state.holderId[relay] === eid) {
        state.holderId[relay] = -1; state.holdUntilMs[relay] = 0;
        ObjectState.current[this.challengeIds.panel] = "closed; spring-loaded";
      }
      if (state.repairerId[relay] === eid) {
        state.repairerId[relay] = -1;
        if (!this.circuit.repaired[relay]) ObjectState.current[relay] = "replacement fuse not installed";
      }
      if (state.dryingBy[relay] === eid) {
        state.dryingBy[relay] = -1;
        ObjectState.current[this.challengeIds.floor] = state.wet[relay] ? state.leakActive[relay] ? "wet; active drips" : "wet; water stopped" : "dry";
      }
      if (entityExists(this.sim.world, eid)) Appearance.posture[eid] = "standing";
    }
    this.pending.delete(eid); this.activity.phase[eid] = "idle"; this.activity.untilMs[eid] = 0;
    completeDeferredAction(this.sim.world, eid, action, success, detail);
    this.readyAt.set(eid, this.elapsed + 500);
    this.recordAction(eid, action, success ? "succeeded" : "failed");
  }
  /** A finite body operation retains its exact command and physical identities.
   * Completion re-enters the same laws, so a moved item or changed interlock
   * cannot be overwritten by a previously valid intention. */
  private beginHandling(eid: number, action: AgentAction, durationMs: number, target: number) {
    const w = this.sim.world, captured = Object.freeze({ ...action });
    const secondary = target === this.ids.cupboard ? this.ids.key : target === this.ids.relay ? this.ids.fuse : undefined;
    const secondaryKey = secondary === undefined ? undefined : workingMemoryEntityRef(w, secondary)?.key;
    this.activity.phase[eid] = "handling"; this.activity.untilMs[eid] = this.elapsed + durationMs;
    this.activity.origin[eid] = getRoomForEntity(w, eid) ?? -1; this.activity.destination[eid] = target;
    this.handling.set(eid, captured); this.recordAction(eid, captured, "pending");
    const interval = this.intervals.get(captured.executionId!)!;
    scheduleSimulationEvent(w, { atSimMs: this.activity.untilMs[eid], phase: "physical", run: () => {
      if (this.handling.get(eid) !== captured) return;
      this.handling.delete(eid);
      releaseSimulationResources(w, eid, captured.executionId!);
      if (this.stopped || !entityExists(w, eid) || !Agent.active[eid] || workingMemoryEntityRef(w, eid)?.key !== interval.actorKey
        || getAgentWorldCapabilityGeneration(w, eid) !== interval.generation) { this.intervals.delete(captured.executionId!); return; }
      if (!entityExists(w, interval.roomId) || workingMemoryEntityRef(w, interval.roomId)?.key !== interval.roomKey
        || getRoomForEntity(w, eid) !== interval.roomId || !entityExists(w, target) || workingMemoryEntityRef(w, target)?.key !== interval.targetKey
        || Name.value[target].toLowerCase() !== captured.target?.trim().toLowerCase()
        || secondary !== undefined && (!entityExists(w, secondary) || workingMemoryEntityRef(w, secondary)?.key !== secondaryKey)) {
        this.finish(eid, captured, false, "The physical operation was interrupted by a changed actor, location, or object."); return;
      }
      this.resuming.add(captured);
      try { this.executePhysical(eid, captured); } finally { this.resuming.delete(captured); }
      // Settle derived circuit/goal consequences before this exact boundary is
      // offered to observers. This is not another clock advance.
      this.advancePhysics(0);
    }, cancel: () => {
      if (this.handling.get(eid) !== captured) return;
      this.handling.delete(eid); this.intervals.delete(captured.executionId!);
      releaseSimulationResources(w, eid, captured.executionId!);
    } });
  }
  private holdItem(eid: number, item: number) {
    const w = this.sim.world;
    // A received/picked-up small item is physically in a free hand. Clothing is
    // carried until wear; no inventory-wide guess that every possession is visible.
    if (item === this.ids.coat || getDirectContainer(w, item) !== eid) return;
    const occupied = listDirectContents(w, eid).filter(id => hasComponent(w, id, EquipSlot) && EquipSlot.equippedBy[id] === eid).map(id => EquipSlot.slot[id]);
    const slot = ["mainHand", "offHand"].find(value => !occupied.includes(value));
    if (slot) { addComponent(w, item, EquipSlot); EquipSlot.slot[item] = slot; EquipSlot.equippedBy[item] = eid; }
  }
  private beginWork(eid: number, action: AgentAction, phase: string, durationMs: number, target: number) {
    this.activity.phase[eid] = phase; this.activity.untilMs[eid] = this.elapsed + durationMs;
    this.activity.origin[eid] = getRoomForEntity(this.sim.world, eid) ?? -1; this.activity.destination[eid] = target;
    this.pending.set(eid, { ...action }); this.recordAction(eid, action, "pending");
  }
  private announceLocal(roomId: number, text: string) {
    this.record({ kind: "observation", text, roomId, visibility: "public", status: "succeeded" });
    for (const name of this.characters) if (getRoomForEntity(this.sim.world, this.ids[name]) === roomId)
      addPerception(this.sim.world, this.ids[name], { type: "attention", content: text, source: "local world" });
  }
  private workFailure(eid: number, phase: string): string | undefined {
    const c = this.challengeIds!, state = this.challengeState, relay = this.ids.relay, w = this.sim.world;
    if (!entityExists(w, eid) || !Agent.active[eid] || getRoomForEntity(w, eid) !== this.ids.utility) return "The physical work was interrupted: you are no longer actively working beside the relay.";
    if (!this.circuit.isolated[relay]) return "Work stopped safely because the lighting circuit is no longer isolated.";
    if (state.leakActive[relay]) return "Work stopped: water is still entering. Find and close the pipe's Leak valve first.";
    if (phase === "drying") {
      if (getDirectContainer(w, c.cloth) !== eid) return "Drying stopped because you no longer possess the Cleaning cloth.";
      return;
    }
    if (state.wet[relay]) return "Work stopped: the floor is still wet. It must be physically dried before the panel is opened.";
    if (phase === "repairing") {
      const holder = state.holderId[relay];
      if (holder === eid || !entityExists(w, holder) || !Agent.active[holder] || getRoomForEntity(w, holder) !== this.ids.utility
        || this.activity.phase[holder] !== "holding_panel" || !this.pending.has(holder) || state.holdUntilMs[relay] < this.elapsed)
        return "Installation stopped: a different person must physically hold the Access panel open for the whole repair.";
      if (getDirectContainer(w, this.ids.fuse) !== eid) return "Installation stopped because you no longer possess the Spare fuse.";
    }
  }
  private canRestorePower(): boolean {
    const state = this.challengeState, relay = this.ids.relay;
    return !state.leakActive[relay] && !state.wet[relay] && state.holderId[relay] < 0 && state.repairerId[relay] < 0
      && this.circuit.repaired[relay] && getDirectContainer(this.sim.world, this.ids.fuse) === relay;
  }
  private interruptInvalidWork() {
    if (!this.challengeIds) return;
    for (const [eid, action] of [...this.pending]) {
      const phase = this.activity.phase[eid];
      if (phase === "walking") continue;
      const reason = this.workFailure(eid, phase);
      if (reason) this.finish(eid, action, false, reason);
    }
  }
  private completeDueWork() {
    const w = this.sim.world, i = this.ids;
    const due = [...this.pending].filter(([eid]) => this.activity.untilMs[eid] <= this.elapsed)
      .sort(([a], [b]) => this.activity.untilMs[a] - this.activity.untilMs[b] || Number(this.activity.phase[a] === "holding_panel") - Number(this.activity.phase[b] === "holding_panel"));
    for (const [eid, action] of due) {
      if (!this.pending.has(eid)) continue; // A completed repair can release its helper.
      const interval = action.executionId ? this.intervals.get(action.executionId) : undefined;
      if (interval && (!entityExists(w, eid) || !Agent.active[eid] || workingMemoryEntityRef(w, eid)?.key !== interval.actorKey
        || getAgentWorldCapabilityGeneration(w, eid) !== interval.generation)) {
        this.pending.delete(eid); this.intervals.delete(action.executionId!); releaseSimulationResources(w, eid, action.executionId!);
        if (this.challengeIds) {
          if (this.challengeState.holderId[i.relay] === eid) { this.challengeState.holderId[i.relay] = -1; this.challengeState.holdUntilMs[i.relay] = 0; ObjectState.current[this.challengeIds.panel] = "closed; spring-loaded"; }
          if (this.challengeState.repairerId[i.relay] === eid) this.challengeState.repairerId[i.relay] = -1;
          if (this.challengeState.dryingBy[i.relay] === eid) this.challengeState.dryingBy[i.relay] = -1;
        }
        continue;
      }
      if (interval && (!entityExists(w, interval.roomId) || workingMemoryEntityRef(w, interval.roomId)?.key !== interval.roomKey
        || interval.targetId !== undefined && (!entityExists(w, interval.targetId) || workingMemoryEntityRef(w, interval.targetId)?.key !== interval.targetKey
          || Name.value[interval.targetId].toLowerCase() !== action.target?.trim().toLowerCase()))) {
        this.finish(eid, action, false, "The physical work was interrupted by a changed location or object identity."); continue;
      }
      const phase = this.activity.phase[eid];
      if (phase === "walking") {
        const destination = this.activity.destination[eid], origin = this.activity.origin[eid];
        if (!entityExists(w, eid) || !entityExists(w, destination) || getRoomForEntity(w, eid) !== origin) { this.finish(eid, action, false, "The journey was interrupted by a changed location."); continue; }
        setLocatedIn(w, eid, destination); clearMovementTarget(eid);
        if (hasComponent(w, eid, GridPosition) && hasComponent(w, destination, GridPosition)) {
          GridPosition.x[eid] = GridPosition.x[destination]; GridPosition.y[eid] = GridPosition.y[destination];
        }
        Appearance.posture[eid] = "standing";
        this.finish(eid, action, true, `You arrived inside the ${Name.value[destination]}.`);
        for (const other of listDirectContents(w, destination).filter(id => id !== eid && hasComponent(w, id, Agent)))
          addPerception(w, other, { type: "observation", content: `${Name.value[eid]} entered the room.`, source: "local world" });
        continue;
      }
      if (!this.challengeIds) continue;
      const reason = this.workFailure(eid, phase);
      if (reason) { this.finish(eid, action, false, reason); continue; }
      if (phase === "drying") {
        this.challengeState.wet[i.relay] = false;
        this.finish(eid, action, true, "You physically dried the utility floor. The pipe is stopped and the tiles are now dry.");
        this.announceLocal(i.utility, `${Name.value[eid]} finished drying the floor. The tiles are visibly dry.`);
      } else if (phase === "holding_panel") {
        this.finish(eid, action, false, "The panel hold timed out after 45 seconds without a completed repair. You lowered it safely; coordinate a fresh attempt.");
      } else if (phase === "repairing") {
        const helper = this.challengeState.holderId[i.relay];
        const holding = this.pending.get(helper);
        setLocatedIn(w, i.fuse, i.relay); syncInventoryCache(w, eid);
        this.circuit.repaired[i.relay] = true; ObjectState.current[i.relay] = "replacement fuse installed";
        this.finish(eid, action, true, `You installed the real Spare fuse while ${Name.value[helper]} held the Access panel open. The panel can now close; power has not yet been restored.`);
        if (holding) this.finish(helper, holding, true, `You held the Access panel throughout ${Name.value[eid]}'s completed fuse installation, then safely closed it.`);
        this.announceLocal(i.utility, "The real replacement fuse is installed and the Access panel has closed. The circuit remains isolated until somebody restores power.");
      }
    }
    this.interruptInvalidWork();
  }
  private executePhysical(eid: number, action: AgentAction): boolean {
    if (this.stopped || !this.started) return true;
    const w = this.sim.world, i = this.ids;
    const target = [...query(w, [Name])].find(id => Name.value[id].toLowerCase() === String(action.target ?? "").trim().toLowerCase());
    const verb = String(action.content ?? "").trim().toLowerCase();
    const done = (success: boolean, detail: string) => { this.finish(eid, action, success, detail); return true; };
    if (this.handling.has(eid)) return true;
    if (this.pending.has(eid)) {
      if (this.challengeIds && this.activity.phase[eid] === "holding_panel" && target === this.challengeIds.panel && action.type === "interact" && verb === "release") {
        this.finish(eid, this.pending.get(eid)!, false, "You released the Access panel before installation finished.");
        this.interruptInvalidWork();
        return done(true, "You lowered the spring-loaded Access panel; it is now closed.");
      }
      return true;
    }
    if (w.meta.timedActions && !this.resuming.has(action) && target !== undefined) {
      const duration = action.type === "pickup" ? 800 : action.type !== "interact" ? 0
        : target === i.relay && verb === "repair" && !this.challengeIds ? 6000
        : target === i.coat && ["wear", "remove"].includes(verb) ? 1500
        : target === i.cupboard && verb === "unlock" || target === i.breaker && ["switch_on", "switch_off"].includes(verb)
          || target === this.challengeIds?.valve && ["open", "close"].includes(verb) ? 700 : 0;
      if (duration) { this.beginHandling(eid, action, duration, target); return true; }
    }
    if (action.type === "move" && target !== undefined && hasComponent(w, target, Room)) {
      const from = getRoomForEntity(w, eid);
      if (from === target) return done(true, "You are already here.");
      const route = this.movementTargets(eid).includes(target);
      if (!route) return done(false, "There is no established physical route between those rooms in this testbed.");
      clearMovementTarget(eid);
      this.activity.phase[eid] = "walking"; this.activity.untilMs[eid] = this.elapsed + 3000;
      this.activity.origin[eid] = from; this.activity.destination[eid] = target; this.pending.set(eid, { ...action });
      Appearance.posture[eid] = `walking toward the interior doorway to ${Name.value[target]}`;
      this.recordAction(eid, action, "pending"); return true;
    }
    if (action.type === "pickup" && target !== undefined) {
      if (!this.visible(eid).includes(target) || getRoomForEntity(w, target) !== getRoomForEntity(w, eid)) return done(false, "That object is not visible and reachable here.");
      const container = getDirectContainer(w, target);
      if (container !== undefined && hasComponent(w, container, Agent)) return done(false, container === eid ? "You already possess that item." : "That belongs to another person's inventory. Ask them to give it to you.");
      if (!hasComponent(w, target, PhysicalObject) || !PhysicalObject.portable[target]) return done(false, "That object is not portable.");
      const result = tryAddToInventory(w, eid, target);
      if (result.success) this.holdItem(eid, target);
      return done(result.success, result.success ? `You picked up ${Name.value[target]} from ${Name.value[container!]}.` : result.reason);
    }
    if (action.type !== "interact" || target === undefined) return false;
    if (![i.cupboard, i.relay, i.breaker, i.coat, ...(this.challengeIds ? [this.challengeIds.valve, this.challengeIds.floor, this.challengeIds.panel] : [])].includes(target)) return false;
    if (!this.visible(eid).includes(target)) return done(false, "That object is not visible and reachable in your current room.");
    if (this.challengeIds) {
      const c = this.challengeIds, state = this.challengeState;
      if (target === c.valve && ["close", "open"].includes(verb)) {
        const leakActive = verb === "open";
        state.leakActive[i.relay] = leakActive;
        ObjectState.current[target] = leakActive ? "open; water leaking toward the Utility Room" : "closed; water stopped";
        if (leakActive) {
          state.wet[i.relay] = true; ObjectState.current[c.floor] = "wet; active drips";
          this.circuit.isolated[i.relay] = true; ObjectState.current[i.breaker] = "off (safety interlock tripped)";
          this.interruptInvalidWork();
        }
        this.announceLocal(i.utility, leakActive ? "Water starts dripping onto the utility floor; the safety interlock isolates the circuit." : "The dripping in the Utility Room stops. The floor remains wet.");
        return done(true, leakActive ? "You opened the Leak valve. Water is flowing again." : "You closed the Leak valve. Water has stopped entering the Utility Room.");
      }
      if (target === c.floor && verb === "dry") {
        if (!state.wet[i.relay]) return done(false, "The floor is already dry.");
        if (state.dryingBy[i.relay] >= 0) return done(false, "Someone is already physically drying that patch of floor.");
        const reason = this.workFailure(eid, "drying"); if (reason) return done(false, reason);
        state.dryingBy[i.relay] = eid; this.beginWork(eid, action, "drying", 5000, target);
        Appearance.posture[eid] = "kneeling and drying the tiled floor with a cleaning cloth";
        ObjectState.current[target] = `wet; being dried by ${Name.value[eid]}`;
        return true;
      }
      if (target === c.panel && verb === "hold") {
        if (state.holderId[i.relay] >= 0) return done(false, "Someone is already holding the Access panel open.");
        const reason = this.workFailure(eid, "holding_panel"); if (reason) return done(false, reason);
        state.holderId[i.relay] = eid; state.holdUntilMs[i.relay] = this.elapsed + 45_000;
        this.beginWork(eid, action, "holding_panel", 45_000, target);
        Appearance.posture[eid] = "bracing the spring-loaded Access panel open with one hand";
        ObjectState.current[target] = `held open by ${Name.value[eid]}`;
        this.announceLocal(i.utility, `${Name.value[eid]} is physically holding the Access panel open for a second person to work. The hold can last up to 45 seconds.`);
        return true;
      }
      if (target === c.panel && verb === "release") return done(false, "You are not holding the Access panel.");
    }
    if (target === i.cupboard && verb === "unlock") {
      if (getDirectContainer(w, i.key) !== eid) return done(false, "The cupboard is locked. You need to possess its Brass key, not merely know about it.");
      ObjectState.current[target] = "open";
      return done(true, `You unlocked and opened the Supply cupboard. Inside you can now see: ${listDirectContents(w, target).map(id => Name.value[id]).join(", ") || "nothing"}.`);
    }
    if (target === i.breaker && ["switch_off", "switch_on"].includes(verb)) {
      if (this.challengeIds && verb === "switch_on") {
        if (!this.canRestorePower())
          return done(false, "The safety interlock refuses power: the leak must be stopped, floor dry, real fuse installed, repair finished and Access panel closed.");
      }
      this.circuit.isolated[i.relay] = verb === "switch_off"; ObjectState.current[target] = verb === "switch_off" ? "off" : "on";
      return done(true, `The Isolation switch is now ${ObjectState.current[target]}.`);
    }
    if (target === i.relay && verb === "repair") {
      if (!this.circuit.isolated[target]) return done(false, "Unsafe: the lighting circuit is still powered. Switch it OFF before repairing.");
      if (this.circuit.repaired[target]) return done(false, "The replacement fuse is already installed.");
      if (getDirectContainer(w, i.fuse) !== eid) return done(false, "You must physically possess the intact Spare fuse to install it.");
      if (this.challengeIds) {
        if (this.challengeState.repairerId[target] >= 0) return done(false, "Someone is already installing the fuse.");
        const reason = this.workFailure(eid, "repairing"); if (reason) return done(false, reason);
        this.challengeState.repairerId[target] = eid; this.beginWork(eid, action, "repairing", 6000, target);
        Appearance.posture[eid] = "carefully installing a replacement fuse behind the held-open relay panel";
        ObjectState.current[target] = `installation in progress by ${Name.value[eid]}; not yet repaired`;
        this.announceLocal(i.utility, `${Name.value[eid]} begins installing the real Spare fuse. The panel must remain held open for six seconds.`);
        return true;
      }
      setLocatedIn(w, i.fuse, target); syncInventoryCache(w, eid);
      this.circuit.repaired[target] = true; ObjectState.current[target] = "replacement fuse installed";
      return done(true, "You installed the Spare fuse into the isolated Lighting relay. Restore power at the Isolation switch to test the lamp.");
    }
    if (target === i.coat && ["wear", "remove"].includes(verb)) {
      const result = verb === "wear" ? tryWearGarment(w, eid, target) : tryRemoveGarment(w, eid, target);
      return done(result.success, result.success ? `You ${verb === "wear" ? "put on" : "took off"} the Yellow raincoat.` : result.reason);
    }
    return done(false, `Available interactions here: ${this.verbs(eid, target).join(", ") || "none"}.`);
  }
  /** Advance only physical state. Live cognition is scheduled by sim.start(). */
  advance(deltaMs: number) {
    if (!this.started || this.stopped) return;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) throw new Error("Expected a positive physical delta");
    advancePhysicalStep(this.sim.world, deltaMs, delta => this.advancePhysics(delta));
  }
  private advancePhysics(deltaMs: number) {
    const targetElapsed = this.elapsed + deltaMs;
    if (this.challengeIds) {
      this.interruptInvalidWork();
      // Process physical deadlines in order. A large fixture step must not let
      // a later hold timeout erase a repair that finished while support existed.
      while (true) {
        const due = [...this.pending.keys()].map(eid => this.activity.untilMs[eid]).filter(at => at <= targetElapsed);
        if (!due.length) break;
        this.elapsed = Math.max(this.elapsed, Math.min(...due));
        this.completeDueWork();
      }
    }
    this.elapsed = targetElapsed;
    const w = this.sim.world, i = this.ids;
    this.completeDueWork();
    completePhysicalStep(w, targetElapsed);
    // A repaired flag cannot outlive the actual installed part after an operator edit.
    if (this.circuit.repaired[i.relay] && getDirectContainer(w, i.fuse) !== i.relay) {
      this.circuit.repaired[i.relay] = false; ObjectState.current[i.relay] = "replacement fuse missing";
    }
    const challengeSafe = !this.challengeIds || (!this.challengeState.leakActive[i.relay] && !this.challengeState.wet[i.relay]
      && this.challengeState.holderId[i.relay] < 0 && this.challengeState.repairerId[i.relay] < 0);
    const lit = Boolean(challengeSafe && this.circuit.repaired[i.relay] && !this.circuit.isolated[i.relay] && getDirectContainer(w, i.fuse) === i.relay);
    if (lit !== this.circuit.lit[i.relay]) {
      this.circuit.lit[i.relay] = lit; ObjectState.current[i.lamp] = lit ? "lit" : "dark";
      const text = `The Reading lamp ${lit ? "comes on, lighting the Common Room" : "goes dark"}.`;
      this.record({ kind: "observation", text, roomId: i.common, visibility: "public", status: "succeeded" });
      for (const name of this.characters) if (getRoomForEntity(w, i[name]) === i.common) addPerception(w, i[name], { type: "attention", content: text, source: "local world" });
    }
    // Reuse native proof -> completion -> learning -> event pipeline. A model's
    // description of success never sets Goal.status or the circuit's truth.
    goalEvaluationSystem(w, { query, getRelationTargets, log: message => this.sim.god.systemRegistry.logs.push(message),
      emit: (type, data) => {
        this.sim.god.systemRegistry.events.push({ type, data, timestamp: Date.now() });
        if (type === "goal_completed" || type === "goal_retired") this.record({ kind: type, text: `${data.goal}${type === "goal_retired" ? ` (${data.status}: ${data.reason})` : ""}`, actorId: this.ids[data.agent as TestbedCharacter], visibility: "operator" });
      } });
    this.director.observeWorld(this.scenes());
  }
  /** Start physics fixture or full runtime. Fixtures use dispatch + advance explicitly. */
  async start() { if (this.started || this.stopped) throw new Error("Create a fresh testbed to restart."); this.started = true;
    this.unregister.push(registerSimulationDeadlineProvider(this.sim.world, () => {
      const due = [...this.pending.keys()].map(eid => this.activity.untilMs[eid]).filter(at => at > this.elapsed);
      return due.length ? Math.min(...due) : undefined;
    }));
    this.director.observeWorld(this.scenes()); if (this.options.live) await this.sim.start(); }
  stop() { if (this.stopped) return; this.stopped = true; for (const abort of this.decisions.values()) abort.abort(); this.sim.stop(); for (const remove of this.unregister) remove(); this.listeners.clear(); }
  /** Explicit operator intention, useful for physical regression tests; not autonomous evidence. */
  dispatch(character: TestbedCharacter, action: AgentAction) { if (!this.started || this.stopped) throw new Error("Start a testbed first"); executeActions(this.sim.world, [{ eid: this.ids[character], action }], this.sim.god.systemRegistry); }
  plantThought(character: TestbedCharacter, thought: string) {
    const eid = this.ids[character]; if (!thought.trim() || !this.started || this.stopped) throw new Error("A running world and nonempty thought are required");
    this.revisions.set(eid, (this.revisions.get(eid) ?? 0) + 1); this.decisions.get(eid)?.abort();
    addThought(this.sim.world, eid, { content: thought.trim().slice(0, 1000), type: "injected" });
    addPerception(this.sim.world, eid, { content: `A stray thought, not proof or an order: ${thought.trim().slice(0, 1000)}`, type: "intent", source: "operator whisper" });
  }
  /** Deliberate operator mutation; no character silently learns about a remote edit. */
  relocateObject(itemName: string, roomName: string) {
    const w = this.sim.world;
    if (!this.started || this.stopped) throw new Error("Start a testbed first");
    const item = [...query(w, [Name, PhysicalObject])].find(id => Name.value[id] === itemName);
    const room = [...query(w, [Name, Room])].find(id => Name.value[id] === roomName);
    if (item === undefined || room === undefined || !PhysicalObject.portable[item]) throw new Error("Choose an existing portable item and room");
    const previous = getDirectContainer(w, item); setLocatedIn(w, item, room); if (previous !== undefined) syncInventoryCache(w, previous);
    this.interruptInvalidWork();
    for (const name of this.characters) { const eid = this.ids[name]; this.revisions.set(eid, (this.revisions.get(eid) ?? 0) + 1); this.decisions.get(eid)?.abort(); }
    this.record({ kind: "operator_edit", text: `${itemName} moved to ${roomName}`, visibility: "operator" });
  }
  /** Immutable public room snapshots. Thoughts, memories and private inventory stay out. */
  scenes(): SceneSnapshot[] {
    const w = this.sim.world;
    return [...query(w, [Room, Name])].map(roomId => {
      const actors = [...query(w, [Agent, Name])].filter(id => getRoomForEntity(w, id) === roomId);
      const visibleProps = [...listDirectContents(w, roomId), ...(roomId === getRoomForEntity(w, this.ids.cupboard) && ObjectState.current[this.ids.cupboard] === "open" ? listDirectContents(w, this.ids.cupboard) : [])].filter(id => isPublicVisualProp(w, id));
      const heldProps = actors.flatMap(actorId => snapshotCharacterAppearance(w, actorId)?.heldItems.filter(item => isPublicVisualProp(w, item.eid)).map(item => ({ id: item.eid, roomId, name: item.name, description: item.description, heldBy: actorId })) ?? []);
      const events: SceneEvent[] = this.history.filter(e => e.visibility === "public" && e.kind === "observation" && e.roomId === roomId && e.elapsedMs >= this.elapsed - 8000).map(e => ({ id: `${this.sourceId}:${e.sequence}`, actorId: e.actorId,
        targetId: [...query(w, [Name])].find(id => Name.value[id] === e.action?.target), roomId, kind: e.kind, action: e.action?.type, status: e.status ?? "succeeded", text: e.text, sourceTick: e.tick, elapsedMs: e.elapsedMs }));
      events.push(...getCommittedEvents(w).events.filter(e => e.roomId === roomId && e.atSimMs >= this.elapsed - 8000).map(e => ({
        id: e.id, sequence: e.sequence, actorId: e.actorId, targetId: e.targetId, roomId, kind: e.kind,
        action: e.action, status: e.status, text: e.text, sourceTick: e.tick, elapsedMs: e.atSimMs,
        interval: e.startedAtSimMs === undefined ? undefined : { executionId: e.executionId, startedAtSimMs: e.startedAtSimMs,
          expectedEndSimMs: e.expectedEndSimMs, completedAtSimMs: e.completedAtSimMs },
      })));
      return snapshotDirectorScene({ sourceId: this.sourceId, sourceTick: w.time.tick, elapsedMs: this.elapsed, capturedWallMs: Date.now(), room: { id: roomId, name: Name.value[roomId], description: Description.value[roomId] || "" },
        actors: actors.flatMap(id => { const appearance = snapshotCharacterAppearance(w, id); return appearance ? [{ id, roomId, name: Name.value[id], appearance,
          activity: this.pending.has(id) || this.handling.has(id) ? { action: this.activity.phase[id], status: "pending" as const, targetId: this.activity.destination[id] } : undefined }] : []; }),
        props: [...visibleProps.map(id => ({ id, roomId, name: Name.value[id], description: Description.value[id] || "", state: ObjectState.current[id] || undefined })), ...heldProps], events });
    });
  }
  snapshot() {
    return { sourceId: this.sourceId, elapsedMs: this.elapsed, tick: this.sim.world.time.tick, options: this.options,
      lamp: ObjectState.current[this.ids.lamp], circuit: { isolated: this.circuit.isolated[this.ids.relay], repaired: this.circuit.repaired[this.ids.relay], lit: this.circuit.lit[this.ids.relay] },
      ...(this.challengeIds ? { challenge: { ids: { ...this.challengeIds }, leakActive: this.challengeState.leakActive[this.ids.relay], wet: this.challengeState.wet[this.ids.relay],
        holderId: this.challengeState.holderId[this.ids.relay], holdUntilMs: this.challengeState.holdUntilMs[this.ids.relay], repairerId: this.challengeState.repairerId[this.ids.relay], dryingBy: this.challengeState.dryingBy[this.ids.relay] } } : {}),
      actors: this.characters.map(name => ({ name, id: this.ids[name], room: Name.value[getRoomForEntity(this.sim.world, this.ids[name])!], appearance: snapshotCharacterAppearance(this.sim.world, this.ids[name]), mind: getAgentMemory(this.sim.world, this.ids[name]), goalStatus: Goal.status[this.sharedGoals.get(this.ids[name])!] })),
      events: structuredClone(this.history), scenes: this.scenes(), camera: this.director.snapshot(), runtime: this.sim.getRuntimeStatus() };
  }
}
