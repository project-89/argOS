/**
 * A deliberately small, authored Argos scenario. ECS owns facts, Belief owns
 * remembered facts, and a bounded agent chooses actions from local observations.
 * These view DTOs/receipts are NOT a replacement for the canonical Change Record.
 */
import { stampGoalTiming } from "../ecs/temporal-age";
import { addComponent, addEntity, entityExists, hasComponent, query, removeEntity } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { Belief, Description, Goal, Mind, Name, ObjectState, PhysicalObject, Room } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../ecs/location";
import { addBelief, addMemory } from "../cognition/knowledge-graph";
import { addPerception, addThought } from "../cognition/agent-mind";
import { registerSystem } from "../ecs/dynamic-systems";
import { createObjectEntity, createRoomEntity } from "../ecs/prefabs";
import { attachToEntity, getRegistryEntry, listDynamic, registryCreateComponent } from "../ecs/component-registry";

export type OilAction = "go_kitchen" | "inspect_shelf" | "take_oil" | "go_beacon" | "refuel" | "inspect" | "take" | "speak" | "wait";
export type OilChoice = { action: OilAction; thought: string; speech?: string; target?: string };
export type OilObservation = {
  name: string; location: string; goal: string; rememberedOil: string;
  observation: string; thought: string; heard: string[]; recentActions: string[];
  allowedActions: OilAction[];
  replyRequested: boolean;
  visible: Array<{ name: string; description: string; state: string }>;
};
export type OilDecider = (observation: OilObservation, signal: AbortSignal) => Promise<OilChoice>;
export type OilReceipt = { sequence: number; atMs: number; kind: string; text: string; perceived: boolean };
export type OilSnapshot = ReturnType<OilDemo["snapshot"]>;
export type WorldEdit =
  | { op: "create"; name: string; kind: "object" | "room"; description: string; location?: string; portable?: boolean }
  | { op: "remove"; name: string }
  | { op: "move"; name: string; destination: string }
  | { op: "set"; name: string; component: string; field: string; value: string | number | boolean }
  | { op: "declare"; component: string; description: string; fields: Record<string, "string" | "number" | "boolean"> };

const INITIAL_MEMORY = "I left the red oil can on the kitchen shelf. I last saw it there.";
export const OIL_THOUGHT = "The beacon needs oil. I should fetch the red can from the kitchen shelf.";

export class OilDemo {
  readonly sim: ArgosSimulation;
  readonly ids: { mara: number; beaconRoom: number; stairs: number; kitchen: number; beacon: number; shelf: number };
  private oil: number | undefined;
  private belief: number;
  private goal: number;
  private goneReason = "";
  private elapsed = 0;
  private stopped = false;
  private started = false;
  private busy = false;
  private decisionNeeded = false;
  private choices = 0;
  private generation = 0;
  private abort?: AbortController;
  private journey?: { from: number; to: number; began: number; duration: number };
  private inspectionEnds?: number;
  private nextDecisionAt = 0;
  private lastObservation = "The brass beacon is dark. You remember leaving oil in the kitchen.";
  private lastThought = INITIAL_MEMORY;
  private lastSpeech = "";
  private heard: string[] = [];
  private replyRequested = false;
  private receipts: OilReceipt[] = [];
  private error: string | null = null;
  private lastAction = "Waiting at the beacon";
  private inspected = false;
  private pathBlocked = false;

  private constructor(sim: ArgosSimulation, private decide: OilDecider, private travelMs: number) {
    this.sim = sim;
    const find = (name: string) => {
      const id = [...query(sim.world, [Name])].find(id => Name.value[id] === name);
      if (id === undefined) throw new Error(`Missing demo entity: ${name}`);
      return id;
    };
    this.ids = { mara: find("Mara"), beaconRoom: find("Beacon room"), stairs: find("Spiral stairs"),
      kitchen: find("Kitchen"), beacon: find("Brass beacon"), shelf: find("Kitchen shelf") };
    this.oil = find("Red oil can");
    setLocatedIn(sim.world, this.oil, this.ids.shelf);
    ObjectState.current[this.ids.beacon] = "dark";
    this.belief = addBelief(sim.world, this.ids.mara, { subject: "Red oil can", predicate: "location",
      object: "kitchen_shelf", confidence: 0.95, source: "earlier direct observation", timestamp: Date.now() });
    this.remember(INITIAL_MEMORY);
    this.goal = addEntity(sim.world);
    addComponent(sim.world, this.goal, Goal);
    addComponent(sim.world, this.ids.mara, HasGoal(this.goal));
    Goal.description[this.goal] = "Keep the lighthouse beacon burning";
    Goal.kind[this.goal] = "custom";
    Goal.status[this.goal] = "pending";
    Goal.priority[this.goal] = 90;
    Goal.progress[this.goal] = 0;
    Goal.createdAt[this.goal] = Date.now();
    stampGoalTiming(sim.world, this.goal);
    // Isolate this interaction from unrelated wandering, schedules and world generation.
    // The library still owns the world, tick, ECS entities and system health telemetry.
    for (const system of sim.god.systemRegistry.systems.values()) system.active = false;
    sim.god.fileSystems.length = 0;
    registerSystem(sim.god.systemRegistry, { name: "OilDemoPhysics", description: "Travel and local shelf inspection",
      pseudocode: "Advance an accepted journey; resolve a local inspection against current ECS state.",
      frequency: 0, active: true, lastRun: 0, compiledFn: () => this.advance(1000) });
    this.receipt("ready", "Mara remembers the oil on the kitchen shelf.", true);
  }

  static async create(decide: OilDecider, options: { travelMs?: number } = {}) {
    const sim = await createSimulation({ name: "The missing oil", preset: "minimal", enableAI: false,
      enableSpirits: false, enableNarrativeEngine: false, evolution: false, enableServer: false,
      rooms: [
        { name: "Beacon room", description: "Rain-streaked glass, a dark brass beacon.", x: 0, y: 0 },
        { name: "Spiral stairs", description: "A narrow stone spiral staircase between beacon and kitchen.", x: 10, y: 0 },
        { name: "Kitchen", description: "A wooden shelf above a battered workbench, lit by a blue-grey window.", x: 20, y: 0 },
      ],
      agents: [{ name: "Mara", role: "lighthouse keeper", startRoom: "Beacon room",
        description: "An adult lighthouse keeper with dark hair, wearing a weathered yellow raincoat." }],
      objects: [
        { name: "Brass beacon", room: "Beacon room", portable: false },
        { name: "Kitchen shelf", room: "Kitchen", portable: false },
        { name: "Red oil can", room: "Kitchen", portable: true, traits: ["takeable"] },
      ] });
    return new OilDemo(sim, decide, options.travelMs ?? 18000);
  }

  start() {
    if (this.started || this.stopped) throw new Error("One run per launch. Restart for a fresh world.");
    this.started = true;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    this.abort?.abort();
    this.busy = false;
    this.sim.stop();
    this.receipt("stopped", "Simulation stopped; world and memories retained.", false);
  }

  injectThought(text: string) {
    this.assertActive();
    if (!text.trim() || text.length > 300) throw new Error("Use a thought of 1–300 characters.");
    this.lastThought = text.trim();
    addThought(this.sim.world, this.ids.mara, { content: this.lastThought, type: "injected", salience: 1 });
    Goal.status[this.goal] = "active";
    this.receipt("thought_injected", this.lastThought, true);
    this.wake();
  }

  talk(text: string) {
    this.assertActive();
    if (!text.trim() || text.length > 300) throw new Error("Use a message of 1–300 characters.");
    const heard = `A voice on your handheld radio says: ${text.trim()}`;
    this.heard.push(heard);
    this.replyRequested = true;
    this.heard = this.heard.slice(-6);
    this.perceive(heard, "speech");
    this.remember(heard);
    this.receipt("player_spoke", text.trim(), true);
    this.wake();
  }

  removeOil() {
    this.assertActive();
    if (!this.journey || this.journey.to !== this.ids.kitchen) throw new Error("Wait until Mara is on her way to the kitchen.");
    if (!this.oilExists() || getDirectContainer(this.sim.world, this.oil!) !== this.ids.shelf) {
      throw new Error("The oil is no longer on the kitchen shelf.");
    }
    // Do not notify cognition. She is elsewhere and did not witness this mutation.
    removeEntity(this.sim.world, this.oil!);
    this.oil = undefined; // EIDs can be recycled: a new memory must never become the oil can.
    this.goneReason = "removed";
    this.receipt("oil_removed", "You removed the oil can. Mara did not see it.", false);
  }

  /** The world-editing agent calls this against the live ECS, never a parallel scene description. */
  editWorld(edit: WorldEdit) {
    this.assertActive();
    const world = this.sim.world;
    const lookup = (name: string) => [...query(world, [Name])].find(eid => Name.value[eid] === name);
    const requireEntity = (name: string) => { const eid = lookup(name); if (eid === undefined) throw new Error(`No live entity named ${name}`); return eid; };
    let affectedRoom: number | undefined;
    let description = "";
    if (edit.op === "declare") {
      if (!/^Demo[A-Z][A-Za-z0-9]{0,40}$/.test(edit.component)) throw new Error("New component names must start with Demo and contain only letters/numbers.");
      if (!Object.keys(edit.fields).length || Object.keys(edit.fields).length > 12 || Object.keys(edit.fields).some(f => !/^[a-z][a-zA-Z0-9]{0,40}$/.test(f))) throw new Error("Invalid component fields");
      registryCreateComponent({ name: edit.component, description: edit.description, properties: edit.fields });
      description = `Declared ECS component ${edit.component}`;
    } else if (edit.op === "create") {
      if (!edit.name.trim() || edit.name.length > 80 || lookup(edit.name) !== undefined) throw new Error("Use a unique entity name (up to 80 characters).");
      const container = edit.location ? requireEntity(edit.location) : undefined;
      if (edit.kind === "object" && container === undefined) throw new Error("An object needs a location.");
      const eid = edit.kind === "room"
        ? createRoomEntity(world, { name: edit.name, description: edit.description })
        : createObjectEntity(world, { name: edit.name, description: edit.description, portable: edit.portable ?? true, roomId: container });
      if (container !== undefined && edit.kind === "object") setLocatedIn(world, eid, container);
      if (edit.name === "Red oil can" && edit.kind === "object") { this.oil = eid; this.goneReason = ""; }
      affectedRoom = getRoomForEntity(world, eid);
      description = `Created ${edit.name}${edit.location ? ` in ${edit.location}` : ""}`;
    } else {
      const eid = requireEntity(edit.name);
      affectedRoom = hasComponent(world, eid, Room) ? eid : getRoomForEntity(world, eid);
      if (edit.op === "remove") {
        if (Object.values(this.ids).includes(eid)) throw new Error("This focused demo keeps its followed NPC and structural anchors. Change their components, or remove another entity.");
        if ([...query(world, [Name])].some(child => getDirectContainer(world, child) === eid)) throw new Error("Move the entity's contents somewhere first.");
        removeEntity(world, eid);
        if (eid === this.oil) { this.oil = undefined; this.goneReason = "removed"; }
        description = `Removed ${edit.name}`;
      } else if (edit.op === "move") {
        const destination = requireEntity(edit.destination);
        if (hasComponent(world, eid, Room)) throw new Error("Move objects or characters, not room roots.");
        let parent: number | undefined = destination;
        for (let depth = 0; parent !== undefined && depth < 64; depth++) {
          if (parent === eid) throw new Error("Containment cycles are not allowed.");
          parent = getDirectContainer(world, parent);
        }
        setLocatedIn(world, eid, destination);
        if (eid === this.ids.mara) { this.journey = undefined; this.inspectionEnds = undefined; this.inspected = false; }
        const newRoom = getRoomForEntity(world, eid);
        if (newRoom === getRoomForEntity(world, this.ids.mara)) affectedRoom = newRoom;
        description = `Moved ${edit.name} to ${edit.destination}`;
      } else {
        const staticFields: Record<string, Record<string, string>> = {
          Description: { value: "string" }, ObjectState: { current: "string" },
          Room: { ambience: "string" }, PhysicalObject: { material: "string", portable: "boolean", weight: "number" },
        };
        const entry = getRegistryEntry(edit.component);
        const expected = entry?.isStatic ? staticFields[edit.component]?.[edit.field] : entry?.definition?.properties[edit.field];
        if (!entry || !expected || typeof edit.value !== expected || (typeof edit.value === "number" && !Number.isFinite(edit.value))) {
          throw new Error("Unknown, protected or wrongly typed component field. Use a physical field or declare a new Demo component.");
        }
        attachToEntity(world, eid, edit.component, { [edit.field]: edit.value });
        description = `${edit.name}.${edit.component}.${edit.field} = ${String(edit.value)}`;
      }
    }
    const witnessed = affectedRoom !== undefined && affectedRoom === getRoomForEntity(world, this.ids.mara);
    this.receipt("world_edited", description, witnessed);
    if (witnessed) {
      this.lastObservation = `You notice a nearby change: ${description}. Only describe what is visible here.`;
      if (this.oil === undefined && this.inspected && affectedRoom === this.ids.kitchen) this.setBelief("missing", "witnessed local change");
      this.inspected = false;
      this.perceive(this.lastObservation);
      this.wake();
    }
    return { applied: true, description, witnessedByMara: witnessed };
  }

  entities() {
    return [...query(this.sim.world, [Name])].filter(eid => hasComponent(this.sim.world, eid, PhysicalObject) || hasComponent(this.sim.world, eid, Room) || eid === this.ids.mara)
      .map(eid => ({ name: Name.value[eid], kind: hasComponent(this.sim.world, eid, Room) ? "room" : eid === this.ids.mara ? "npc" : "object",
        location: Name.value[getDirectContainer(this.sim.world, eid)!] || null,
        description: hasComponent(this.sim.world, eid, Description) ? Description.value[eid] || "" : "",
        ambience: hasComponent(this.sim.world, eid, Room) ? Room.ambience[eid] || "" : "",
        properties: Object.fromEntries(listDynamic().filter(def => {
          const entry = getRegistryEntry(def.name); return entry && hasComponent(this.sim.world, eid, entry.soa);
        }).map(def => [def.name, Object.fromEntries(Object.keys(def.properties).map(field => [field, getRegistryEntry(def.name)!.soa[field][eid]]))])),
        state: hasComponent(this.sim.world, eid, ObjectState) ? ObjectState.current[eid] || "normal" : "normal" }));
  }

  advance(milliseconds: number) {
    if (!this.started || this.stopped) return;
    this.elapsed += milliseconds;
    if (this.journey && ["blocked", "locked"].includes(ObjectState.current[this.ids.stairs])) {
      this.journey.began += milliseconds; // Keep travel progress fixed while the route is impassable.
      if (!this.pathBlocked) {
        this.pathBlocked = true;
        this.lastObservation = "The staircase is blocked. You cannot continue along it.";
        this.lastAction = "Stopped at the blocked staircase";
        this.perceive(this.lastObservation); this.receipt("path_blocked", this.lastObservation, true); this.wake();
      }
    } else if (this.pathBlocked) {
      this.pathBlocked = false;
      this.lastObservation = "The staircase is passable again.";
      this.perceive(this.lastObservation); this.receipt("path_opened", this.lastObservation, true);
    }
    if (this.journey && this.elapsed >= this.journey.began + this.journey.duration) {
      const target = this.journey.to;
      setLocatedIn(this.sim.world, this.ids.mara, target);
      this.journey = undefined;
      this.inspected = false;
      this.lastAction = `Arrived in ${Name.value[target]}`;
      this.lastObservation = target === this.ids.kitchen
        ? "You have entered the kitchen. The shelf is around the corner; inspect it to learn what is there now."
        : "You are beside the dark brass beacon.";
      this.perceive(this.lastObservation);
      this.receipt("arrived", this.lastAction, true);
      this.decisionNeeded = true;
    }
    if (this.inspectionEnds !== undefined && this.elapsed >= this.inspectionEnds) {
      this.inspectionEnds = undefined;
      this.inspected = true;
      const found = this.oilExists() && getDirectContainer(this.sim.world, this.oil!) === this.ids.shelf;
      this.setBelief(found ? "kitchen_shelf" : "missing", "direct shelf inspection");
      const shelfContents = this.entities().filter(e => e.location === "Kitchen shelf" && e.name !== "Red oil can");
      this.lastObservation = found
        ? "You inspect the kitchen shelf. The red oil can is here, within reach."
        : `You inspect the kitchen shelf. ${shelfContents.length ? "The red oil can is absent." : "It is empty."} The red oil can you remember is not here. You do not know who moved it or where it went.`;
      if (shelfContents.length) this.lastObservation += ` Other things you see: ${shelfContents.map(e => `${e.name}: ${e.description}`).join("; ")}`;
      this.perceive(this.lastObservation);
      this.remember(this.lastObservation);
      this.lastAction = found ? "Found the oil can" : "Discovered the empty shelf";
      this.receipt(found ? "oil_found" : "absence_discovered", this.lastObservation, true);
      this.decisionNeeded = true;
    }
    if (this.decisionNeeded && !this.busy && this.elapsed >= this.nextDecisionAt) {
      void this.think();
    }
  }

  /** Only this DTO goes to the NPC model. It deliberately excludes omniscient facts/receipts. */
  observe(): OilObservation {
    const location = Name.value[getRoomForEntity(this.sim.world, this.ids.mara)!];
    const allowed: OilAction[] = ["speak", "wait"];
    if (!this.journey && this.inspectionEnds === undefined) {
      if (location === "Beacon room") allowed.push("go_kitchen", "refuel", "inspect", "take");
      if (location === "Kitchen") {
        allowed.push("take_oil", "go_beacon", "inspect", "take");
        if (!this.inspected) allowed.push("inspect_shelf");
      }
    }
    return { name: "Mara", location, goal: Goal.description[this.goal], rememberedOil: Belief.object[this.belief],
      observation: this.lastObservation, thought: this.lastThought, heard: [...this.heard],
      recentActions: this.receipts.filter(r => r.perceived && !["ready", "thought_injected"].includes(r.kind)).slice(-5).map(r => r.text),
      allowedActions: this.replyRequested ? ["speak"] : allowed, replyRequested: this.replyRequested,
      visible: this.entities().filter(e => e.location === location && e.name !== "Mara").map(({ name, description, state }) => ({ name, description, state })) };
  }

  private async think() {
    if (this.choices >= 16) { this.error = "Decision limit reached. Stop this run to avoid unbounded model usage."; return; }
    this.busy = true;
    this.decisionNeeded = false;
    this.choices++;
    const generation = this.generation;
    const observation = this.observe();
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 20000);
    try {
      const choice = await this.decide(observation, this.abort.signal);
      if (this.stopped || generation !== this.generation) return;
      this.applyChoice(choice);
      this.error = null;
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.error = error instanceof Error ? error.message : "NPC decision failed";
        this.receipt("decision_error", "NPC decision failed; no action was fabricated.", false);
      }
    } finally {
      clearTimeout(timeout);
      this.busy = false;
    }
  }

  /** Validate and execute first, then emit the receipt. Intended actions are not facts. */
  applyChoice(choice: OilChoice) {
    this.assertActive();
    if ((this.journey || this.inspectionEnds !== undefined) && !["speak", "wait"].includes(choice.action)) throw new Error("An action is still in progress.");
    this.lastThought = choice.thought.slice(0, 220);
    addThought(this.sim.world, this.ids.mara, { content: this.lastThought, type: "decision", salience: 0.9 });
    const room = getRoomForEntity(this.sim.world, this.ids.mara);
    const fail = (message: string) => {
      this.lastObservation = `Your attempted action failed: ${message}`;
      this.perceive(this.lastObservation, "action_failed");
      this.receipt("action_failed", this.lastObservation, true);
      this.decisionNeeded = true;
    };
    switch (choice.action) {
      case "inspect": case "take": {
        const eid = [...query(this.sim.world, [Name])].find(eid => Name.value[eid] === choice.target);
        if (eid === undefined || (eid !== room && getRoomForEntity(this.sim.world, eid) !== room)) { fail("That object is not visible and within reach here."); break; }
        if (choice.action === "inspect" && eid === this.ids.shelf && this.inspected) {
          fail("You already inspected this unchanged shelf. Use that observation and change strategy."); break;
        }
        if (choice.action === "inspect") {
          this.lastObservation = `You inspect ${Name.value[eid]}: ${Description.value[eid] || "No further detail."} State: ${ObjectState.current[eid] || "normal"}.`;
          if (eid === this.oil) this.setBelief(getDirectContainer(this.sim.world, eid) === this.ids.shelf ? "kitchen_shelf" : "here", "directly observed oil");
          this.perceive(this.lastObservation); this.remember(this.lastObservation);
          this.receipt("object_inspected", this.lastObservation, true);
        } else {
          if (!hasComponent(this.sim.world, eid, PhysicalObject) || !PhysicalObject.portable[eid]) { fail("That object is not portable."); break; }
          setLocatedIn(this.sim.world, eid, this.ids.mara);
          if (eid === this.oil) this.setBelief("carried", "successful pickup");
          this.lastObservation = `You are now holding ${Name.value[eid]}.`;
          this.lastAction = `Picked up ${Name.value[eid]}`;
          this.receipt("object_taken", this.lastObservation, true);
        }
        this.decisionNeeded = true;
        break;
      }
      case "go_kitchen": case "go_beacon": {
        const target = choice.action === "go_kitchen" ? this.ids.kitchen : this.ids.beaconRoom;
        const expected = choice.action === "go_kitchen" ? this.ids.beaconRoom : this.ids.kitchen;
        if (room !== expected) { fail("That journey cannot start from your current location."); break; }
        this.journey = { from: room, to: target, began: this.elapsed, duration: this.travelMs };
        setLocatedIn(this.sim.world, this.ids.mara, this.ids.stairs);
        this.lastAction = `Walking to ${Name.value[target]}`;
        this.lastObservation = "You are on the enclosed spiral staircase. You cannot see the kitchen shelf from here.";
        this.receipt("departed", this.lastAction, true);
        break;
      }
      case "inspect_shelf":
        if (room !== this.ids.kitchen) { fail("You cannot inspect the shelf from here."); break; }
        if (this.inspected) { fail("You already inspected this unchanged shelf. Change strategy."); break; }
        this.inspectionEnds = this.elapsed + 4000;
        this.lastAction = "Looking at the kitchen shelf";
        this.receipt("inspection_started", this.lastAction, true);
        break;
      case "take_oil":
        if (room !== this.ids.kitchen || !this.inspected || !this.oilExists() || getDirectContainer(this.sim.world, this.oil!) !== this.ids.shelf) {
          fail("You cannot take the oil: it must be observed and within reach."); break;
        }
        setLocatedIn(this.sim.world, this.oil!, this.ids.mara);
        this.setBelief("carried", "successful pickup");
        this.lastObservation = "You are holding the red oil can.";
        this.lastAction = "Picked up the red oil can";
        Goal.progress[this.goal] = 0.5;
        this.receipt("oil_taken", this.lastAction, true);
        this.decisionNeeded = true;
        break;
      case "refuel":
        if (["broken", "damaged"].includes(ObjectState.current[this.ids.beacon])) { fail("The beacon is damaged. Adding oil cannot repair it."); break; }
        if (room !== this.ids.beaconRoom || !this.oilExists() || getDirectContainer(this.sim.world, this.oil!) !== this.ids.mara) {
          fail("You need to be at the beacon holding the oil can. The beacon remains dark."); break;
        }
        ObjectState.current[this.ids.beacon] = "lit";
        removeEntity(this.sim.world, this.oil!);
        this.oil = undefined;
        this.goneReason = "used";
        this.setBelief("used", "successful refueling");
        Goal.status[this.goal] = "completed";
        Goal.progress[this.goal] = 1;
        this.lastAction = "Refueled and lit the beacon";
        this.lastObservation = "The beacon is burning. You successfully used the oil.";
        this.remember(this.lastObservation);
        this.receipt("beacon_lit", this.lastAction, true);
        break;
      case "speak":
        if (!choice.speech?.trim()) { fail("No words were supplied."); break; }
        this.lastSpeech = choice.speech.trim().slice(0, 200);
        this.replyRequested = false;
        this.lastAction = "Spoke aloud";
        this.remember(`I said: ${this.lastSpeech}`);
        this.receipt("mara_spoke", this.lastSpeech, true);
        // Once the missing-can discovery has prompted a response, wait for the player.
        if (Belief.object[this.belief] !== "missing" && Goal.status[this.goal] !== "completed") this.decisionNeeded = true;
        break;
      case "wait":
        this.lastAction = "Waiting; no world change";
        this.receipt("waited", this.lastAction, true);
        break;
      default: fail("Unknown action.");
    }
    Mind.focus[this.ids.mara] = this.lastAction;
    this.nextDecisionAt = this.elapsed + 2000;
  }

  snapshot() {
    const room = getRoomForEntity(this.sim.world, this.ids.mara);
    const oilState = this.oilExists()
      ? getDirectContainer(this.sim.world, this.oil!) === this.ids.mara ? "carried" : getDirectContainer(this.sim.world, this.oil!) === this.ids.shelf ? "on_shelf" : "elsewhere"
      : this.goneReason || "removed";
    const belief = Belief.object[this.belief];
    return { elapsedMs: this.elapsed, tick: this.sim.tick, running: this.started && !this.stopped,
      phase: this.journey ? "walking" : this.inspectionEnds !== undefined ? "searching" : belief === "missing" ? "discovered" : oilState === "used" ? "resolved" : "idle",
      location: Name.value[room!] || "Unknown", destination: this.journey ? Name.value[this.journey.to] : null,
      progress: this.journey ? Math.min(1, (this.elapsed - this.journey.began) / this.journey.duration) : 0,
      world: { oil: oilState, beacon: ObjectState.current[this.ids.beacon] },
      mara: { oilBelief: belief, beliefSource: Belief.source[this.belief], goal: Goal.description[this.goal],
        goalStatus: Goal.status[this.goal], thought: this.lastThought, speech: this.lastSpeech,
        observation: this.lastObservation, action: this.lastAction },
      divergence: ["removed", "elsewhere"].includes(oilState) && belief === "kitchen_shelf",
      canRemove: Boolean(this.journey?.to === this.ids.kitchen && oilState === "on_shelf"),
      thinking: this.busy, error: this.error, choices: this.choices, pathBlocked: this.pathBlocked,
      entities: this.entities(), components: listDynamic(), receipts: this.receipts.map(r => ({ ...r })) };
  }

  private wake() { this.decisionNeeded = true; this.nextDecisionAt = this.elapsed; }
  private assertActive() { if (!this.started || this.stopped) throw new Error("Start a fresh demo session first."); }
  private oilExists() { return this.oil !== undefined && entityExists(this.sim.world, this.oil); }
  private setBelief(value: string, source: string) {
    Belief.object[this.belief] = value;
    Belief.source[this.belief] = source;
    Belief.timestamp[this.belief] = Date.now();
  }
  private perceive(content: string, type = "observation") { addPerception(this.sim.world, this.ids.mara, { type, content, source: "local experience" }); }
  private remember(content: string) { addMemory(this.sim.world, this.ids.mara, { type: "episodic", content, importance: 40, emotionalValence: 0, timestamp: Date.now() }); }
  private receipt(kind: string, text: string, perceived: boolean) {
    this.receipts.push({ sequence: this.receipts.length + 1, atMs: this.elapsed, kind, text, perceived });
  }
}
