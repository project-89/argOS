/** A world package, not another cognition controller. Native Argos chooses;
 * this package validates and executes embodied actions on the shared clock. */
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, query, removeComponent } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { Agent, BehaviorPolicy, Container, Description, Name, Needs, ObjectState, PhysicalObject, Position, Room, Surface, StimulusSource, WorkingMemoryIdentity } from "../ecs/components";
import { createObjectEntity, createRoomEntity } from "../ecs/prefabs";
import { getDirectContainer, getRoomForEntity, listDirectContents, setLocatedIn } from "../ecs/location";
import { tryAddToInventory, tryRemoveFromInventory } from "../ecs/inventory";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { readSimulationTime } from "../ecs/simulation-time";
import { registerSystem } from "../ecs/dynamic-systems";
import { runWorldTickAt } from "../god/god-agent";
import { addPerception, addThought, type AgentAction } from "../cognition/agent-mind";
import { completeDeferredAction, createIntentGoal, executeActions } from "../cognition/cognition-system";
import { getAgentVisualEntities, getAgentWorldCapabilityGeneration, isAgentVisualEntity, isPublicContainerOpen, registerAgentWorldCapabilities, type ObservableStateField } from "../cognition/world-capabilities";
import { setGoalContract } from "../cognition/goal-contract";
import { createGeneratedIntention } from "../cognition/goal-lifecycle";
import { goalEvaluationSystem } from "../systems/goal-evaluation-system";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { createCommunicationMotivation } from "../cognition/communication-motivation";
import { setAspirations } from "../cognition/goal-learning";
import { getPrivateCommunications, recordPrivateCommunication } from "../cognition/communication-memory";
import { queueExperiencedEvent } from "../cognition/experience-appraisal";
import { configureCharacterAppearance, tryHoldCarriedItem } from "../rendering/character-appearance";
import { getSimulationBodyActivity, releaseSimulationResources, reserveSimulationResources, type PublicPhysicalOperation } from "../runtime/simulation-timeline";
import { getCommittedEvents, publishCommittedEvent, subscribeCommittedEvents } from "../runtime/committed-events";
import { createSpatialWorld } from "../world/spatial-world";
import { executeAffordance } from "../world/effect-executor";
import { ObjectManager } from "../world/object-manager";
import { worldSchema } from "../world/schema";
import { SittingOn } from "../ecs/relations";
import { installOperatorCafe } from "./spatial-growth";
import { projectSpatialGoals } from "./spatial-goals";
import { isEntityPresent } from "../ecs/entity-presence";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { createBlackout, type BlackoutOperation } from "./spatial-blackout";
import { createSpatialWorldControl } from "./spatial-world-control";
import { INITIAL_SPATIAL_BLUEPRINT, CAFE_SPATIAL_BLUEPRINT, SPATIAL_ASSETS, validateSpatialBlueprint, blackoutSpatialBlueprint, extendedBlackoutSpatialBlueprint,
  type SpatialBlueprint } from "./spatial-catalog";
import type { SpatialOperatorActor, SpatialSceneCue, SpatialViewEntity, SpatialViewState } from "./spatial-contract";
import { spatialAgentConfig, validateSpatialScenario, type SpatialScenarioDefinition } from "./spatial-scenario";
import { createTownScenario, type TownFixture } from "./spatial-town-fixtures";
import { createSpatialTownGrowth, type TownGrowthAddition, type TownGrowthSnapshot, type TownGrowthSite } from "./spatial-town-growth";
import { createSpatialTownLife, TOWN_EVOLUTION_CONFIG } from "./spatial-town-life";
import { createStoryTownScenario } from "./spatial-town-story";
import { createLovecraftTownScenario, createLovecraftWorldSpecification } from "./spatial-lovecraft-town";
import { createHouseholdScenario, HOUSEHOLD_GROWTH_SITES } from "./spatial-household";
import { createHouseholdChallengeScenario } from "./spatial-household-challenge";
import type { PlanningEvent } from "../cognition/planning-telemetry";
import { createSpatialStoryEvents, type SpatialStoryOperation } from "./spatial-story-events";
import { recordSpiritPublicEnvironmentReceipt } from "../spirits/spirit-public-event-review";
import { getCodingDaemon, type CodingDaemonConfig } from "../engineering/coding-daemon";
import { createSpatialWeatherMechanic, createSpatialWeatherMechanicRequest, assertSpatialWeatherMechanicRelease,
  registerSpatialWeatherExposureSchema, SPATIAL_WEATHER_MECHANIC_SYSTEM } from "./spatial-weather-mechanic";
import { createSpatialDevelopmentInputs, registerSpatialDevelopmentInputSchema } from "./spatial-development-inputs";
import { assertSpatialDevelopmentRelease, SPATIAL_DEVELOPMENT_LIMITS, SPATIAL_DEVELOPMENT_BUILDER_CONTEXT, isSpatialDevelopmentComponent, permitsSpatialDevelopmentValue } from "./spatial-development-policy";
import { createSpatialGodConsole } from "./spatial-god-console";
import { DEVELOPMENT_EVOLUTION_CONFIG } from "./spatial-town-life";

type Pending = { actor: number; actorKey: string; target: number; targetKey: string; sourceId: string;
  action: AgentAction; verb: string; startedAt: number; due?: number; container?: number; containerKey?: string;
  position: { x: number; y: number }; message?: number; messageKey?: string; messageText?: string; reply?: string; signal?: AbortSignal;
  generation?: object; blackout?: BlackoutOperation; story?: SpatialStoryOperation; durationMs?: number };
type Visual = { key: string; asset: string; size?: { x: number; y: number; z: number }; color?: string; rotationY?: number; lift?: number };
type Options = { live?: boolean; seconds?: number; automaticClock?: boolean; scenario?: "blackout" | "town" | "household"; layout?: "extended"; requiredSpec?: "A" | "B";
  evolving?: boolean;
  /** Separate authored conflict fixture; never silently changes the baseline. */
  householdChallenge?: boolean;
  /** Host-only diagnostic sink. Never included in a resident's context. */
  onPlanningEvent?: (event: PlanningEvent) => void;
  story?: "community-drama" | "household" | "coastal-mystery";
  /** One explicitly operator-approved generated mechanic; not broad engineering. */
  weatherMechanic?: { directory: string; backend?: "codex" | "gemini" };
  /** Explicit broader engineering profile; not implied by viewing a town. */
  development?: { directory: string; backend?: "codex" | "gemini" };
  /** Explicit check seed only; never selected by the ordinary town UI. */
  townFixture?: TownFixture;
  /** Trusted authored package. It grants no model or builder mutation authority. */
  world?: SpatialScenarioDefinition };
const blueprintFor = (options: Options) => options.world?.blueprint ?? (options.scenario === "blackout"
  ? options.layout === "extended" ? extendedBlackoutSpatialBlueprint() : blackoutSpatialBlueprint() : INITIAL_SPATIAL_BLUEPRINT);

export class SpatialDemo {
  readonly spatial: ReturnType<typeof createSpatialWorld>;
  readonly actors: number[];
  readonly byId = new Map<string, number>();
  readonly visuals = new Map<number, Visual>();
  readonly blackout?: ReturnType<typeof createBlackout>;
  readonly townLife?: ReturnType<typeof createSpatialTownLife>;
  readonly storyEvents?: ReturnType<typeof createSpatialStoryEvents>;
  readonly weatherMechanic?: ReturnType<typeof createSpatialWeatherMechanic>;
  readonly developmentInputs?: ReturnType<typeof createSpatialDevelopmentInputs>;
  readonly godConsole?: ReturnType<typeof createSpatialGodConsole>;
  private nextDevelopmentReview = 0;
  private developmentSignatures = new Map<string, string>();
  private developmentFields: Array<[string, string]> = [];
  private readonly generated = new Map<number, TownGrowthAddition>();
  private readonly houseSpirit?: ReturnType<typeof createSpatialWorldControl>;
  private readonly blueprint: SpatialBlueprint;
  private readonly roomViews: SpatialViewState["rooms"] = [];
  private readonly removers: Array<() => void> = [];
  private readonly work = new Map<number, Pending>();
  private readonly thoughts = new Map<number, { text: string; atSimMs: number }>();
  private readonly decisions = new Map<number, AbortController>();
  private readonly events: SpatialViewState["events"] = [];
  private readonly speechRows = new Map<string, SpatialViewState["events"][number]>();
  private readonly sceneCues = new Map<string, SpatialSceneCue>();
  private cueSequence = 0;
  private readonly stopListeners = new Set<() => void>();
  private readonly phones = new Map<number, number>();
  private readonly motivations = new Map<number, ReturnType<typeof createCommunicationMotivation>>();
  private timer?: NodeJS.Timeout;
  private deadline?: NodeJS.Timeout;
  private started = false;
  private stopped = false;
  private built = false;
  private sequence = 0;
  private nextBuzz = 0;
  private observedCircuit?: { power: "on" | "off"; isolated: boolean };
  private messageComponent: any;
  readonly live: boolean;
  readonly seconds: number;
  private constructor(readonly sim: ArgosSimulation, private readonly options: Options) {
    this.live = options.live === true; this.seconds = options.seconds ?? 600;
    const w = sim.world;
    const evening = options.scenario === "household" || options.story === "coastal-mystery";
    w.time.simulationHour = evening ? 18 : 15;
    w.time.timeOfDay = evening ? "evening" : "afternoon";
    this.blueprint = blueprintFor(options);
    this.spatial = createSpatialWorld(w, { bounds: options.world?.bounds ?? { minX: 0, minY: 0, maxX: 16, maxY: 11 }, cellSize: options.world?.navigationCellSize ?? .25, actorRadius: .18, speed: 1.25 });
    this.actors = this.blueprint.spawns.map(spawn => {
      const matches = [...query(w, [Agent, Name])].filter(id => Name.value[id] === spawn.name);
      if (matches.length !== 1) throw Error(`Spatial resident must have one native identity: ${spawn.name}`);
      return matches[0];
    });
    this.install(this.blueprint, true);
    if (options.scenario === "blackout") this.blackout = createBlackout(w, {
      panel: this.byId.get("lighting-panel")!, box: this.byId.get("supply-box")!, lamp: this.byId.get("apartment-lamp")!,
      parts: [this.byId.get("amber-cartridge")!, this.byId.get("blue-cartridge")!],
    }, { requiredSpec: options.requiredSpec });
    if (this.blackout) this.observedCircuit = { power: this.blackout.view().power,
      isolated: this.blackout.component.isolated[this.byId.get("lighting-panel")!] };
    if (this.blackout) this.houseSpirit = createSpatialWorldControl({ world: w, running: () => this.running,
      live: this.live, blackout: this.blackout, box: this.byId.get("supply-box")!,
      changed: operation => {
        if (operation.startsWith("light_")) this.announceCircuitChanges();
        else this.announcePhysicalChange(this.byId.get("supply-box")!, `The supplies box lid ${operation === "box_open" ? "opens" : "closes"}.`,
          operation === "box_open" ? "click · opened" : "thunk · closed");
      },
      record: (request, receipt) => this.record("world-control", `House spirit · ${JSON.stringify(request)} · ${receipt.status}: ${receipt.detail}`),
    });
    extendDynamicComponent({ name: "SpatialPhoneMessage", description: "Private physical phone transport, not shared perception", properties:
      { direction: "string", text: "string", from: "string", status: "string", atSimMs: "number", readByKey: "string", replyTo: "number" } });
    this.messageComponent = getComponent("SpatialPhoneMessage")!;
    for (const eid of this.actors) {
      const name = Name.value[eid];
      const resident = options.world?.residents.find(r => r.name === name);
      const spawn = this.blueprint.spawns.find(s => s.name === name)!;
      this.position(eid, spawn.position.x, spawn.position.y);
      this.visuals.set(eid, { key: this.key(eid), asset: spawn.assetId, size: SPATIAL_ASSETS[spawn.assetId].size });
      if (hasComponent(w, eid, BehaviorPolicy)) BehaviorPolicy.enabled[eid] = false;
      configureCharacterAppearance(w, eid, resident?.appearance ?? { age: "adult", hairColor: "dark brown",
        hairStyle: name === "Mara" ? "long, tied back" : "short",
        clothing: name === "Mara" ? "mint-green and white shirt with blue shorts" : "coral-red shirt with blue shorts", posture: "standing" });
      Needs.hunger[eid] = resident?.needs.hunger ?? 30; Needs.energy[eid] = resident?.needs.energy ?? 85;
      if (resident) setAspirations(w, eid, resident.aspirations);
      const phone = resident ? resident.phoneId ? this.byId.get(resident.phoneId) : undefined
        : [...this.visuals.keys()].find(id => Name.value[id] === `${name}'s phone`);
      if (phone !== undefined) {
        this.phones.set(eid, phone);
        const contact = resident?.phoneContact;
        // A device is an affordance, not automatically an extra authored goal.
        // The household supplies an explicit contact only for Mara. Other
        // residents still perceive notifications and may choose to investigate.
        if (!resident || contact) this.motivations.set(eid, createCommunicationMotivation(w, eid, {
          description: contact?.description ?? (resident ? "Stay reachable while choosing how to spend my time." : "Stay in touch with Alex while making my own choices about the afternoon."),
          memory: contact?.memory ?? (resident ? "My phone's double vibration means a notification. I have to read it to learn who sent it and what it says."
            : `Alex is a close friend I trust. I left my phone on the table. Its double vibration means a notification, not knowledge of who sent it. I like replying to people who take time to contact me.`),
          priority: 5, notificationPriority: 8,
        }));
      }
      this.installCapabilities(eid);
      // An authored resident's opening purpose is their own intention, not a
      // fixed objective. Use the existing review/defer/release lifecycle; the
      // verified Blackout task and legacy apartment keep their original policy.
      const goal = resident && !this.blackout
        ? createGeneratedIntention(w, eid, { description: resident.initialGoal.description.trim(),
          priority: resident.initialGoal.priority, kind: resident.initialGoal.kind ?? "custom" }, "personal")
        : createIntentGoal(w, eid, this.blackout ? "Restore the apartment lighting so we can spend the evening here with our friend Alex."
          : name === "Mara" ? "Take a short walk outside and decide where I would like to spend the afternoon." : "Find a comfortable seat and have a snack if I am hungry.", this.blackout ? 8 : 6);
      if (goal === null) throw Error(`Resident ${name}'s opening intention was rejected; correct the authored purpose instead of substituting a fixed objective.`);
      if (this.blackout) setGoalContract(w, goal, { version: 1, kind: "custom", params: {},
        success: { type: "entity_component_equals", entityName: "Lighting panel", component: "SpatialCircuit", field: "powered", equals: true } });
      addPerception(w, eid, { type: "observation", content: this.blackout
        ? `The apartment's reading lamp just went out. ${options.layout === "extended" ? "The lighting panel is in the utility room; repair supplies are kept in the storeroom beyond it." : "The lighting panel is nearby."} Alex is joining us this evening; we wanted to read and spend time here. The cause of the outage has not been diagnosed.`
        : resident ? resident.initialObservation ?? `It is a quiet afternoon. You are in ${resident.startRoom}. ${this.blueprint.rooms.find(r => r.id === resident.startRoomId)!.description}`
          : "You are in the apartment with your friend. There is a door to the street, furniture to use and a snack. It is a quiet afternoon. Decide what you would like to do.", source: "local world" });
    }
    // Grid-only recovery observes map cells, not this package's metre-based
    // Position. Spatial routes already report their own failures and progress.
    for (const name of ["GoalProgress", "TimeProgression", "NeedsDecay", "StuckAgentRecovery"]) {
      const system = sim.god.systemRegistry.systems.get(name); if (system) system.active = false;
    }
    // This legacy atmosphere generator is independent of enableNarrativeEngine.
    // The story profile has one grounded producer, not random unbacked prose.
    if (options.story) {
      const atmosphere = sim.god.systemRegistry.systems.get("NarrativeEvents");
      if (atmosphere) atmosphere.active = false;
    }
    registerSystem(sim.god.systemRegistry, { name: "SpatialEmbodiment", description: "Authoritative paths, physical operations and phone delivery",
      pseudocode: "Advance bodies on the simulation clock; revalidate targets; commit effects and receipts only at completion", active: true, frequency: 0, lastRun: 0,
      compiledFn: () => this.integrate() });
    registerSystem(sim.god.systemRegistry, { name: "SpatialNeeds", description: "Authored real-time afternoon need rates: hunger +10/hour, energy -5/hour",
      pseudocode: "Integrate bounded needs by elapsed world hours, never rendering or tick count", active: true, frequency: 0, lastRun: 0,
      compiledFn: (_world, ctx) => { for (const actor of this.actors) if (isEntityPresent(w, actor)) {
        Needs.hunger[actor] = Math.min(100, Needs.hunger[actor] + 10 * ctx.delta / 3_600_000);
        Needs.energy[actor] = Math.max(0, Needs.energy[actor] - 5 * ctx.delta / 3_600_000);
      } } });
    this.removers.push(subscribeCommittedEvents(w, event => {
      if (event.kind !== "speech" || !event.text) return;
      // Native timed speech arrives word by word. Coalesce only the committed
      // slices from the same speaker/execution, never a future script.
      const key = `${event.actorKey}:${event.executionId}`;
      const previous = this.speechRows.get(key);
      if (previous && this.events.includes(previous)) previous.text = (previous.text + event.text).slice(0, 1600);
      else this.speechRows.set(key, this.record("speech", `${event.actorName}: ${event.text}`));
      if (this.speechRows.size > 128) this.speechRows.delete(this.speechRows.keys().next().value!);
      if (!this.current(event.actorId, event.actorKey) || this.visuals.get(event.actorId)?.key !== event.actorKey) return;
      const cueId = `speech:${key}`, priorCue = this.sceneCues.get(cueId);
      this.cue(event.actorKey, "speech", `${priorCue?.text ?? ""}${event.text}`.slice(-800), 5500, cueId);
    }));
    if (options.evolving) {
      const sites: TownGrowthSite[] = options.scenario === "household"
        ? HOUSEHOLD_GROWTH_SITES.map(({ roomId, ...site }) => ({ ...structuredClone(site), roomEid: this.byId.get(roomId)! })) : [
        { id: "cafe-extra-seat", roomEid: this.byId.get("town-cafe")!, position: { x: 6.5, y: 32.5 }, anchors: [{ x: 0, y: -1 }], allowedAssets: ["chair"] },
        { id: "workshop-corner", roomEid: this.byId.get("town-workshop")!, position: { x: 19.5, y: 32.5 }, anchors: [{ x: 0, y: -1 }], allowedAssets: ["chair", "lamp"] },
        { id: "park-gathering", roomEid: this.byId.get("common-square")!, position: { x: 10, y: 19 }, anchors: [{ x: 0, y: -1.5 }], allowedAssets: ["table", "chair"] },
        { id: "garden-detail", roomEid: this.byId.get("town-garden")!, position: { x: 41, y: 28.5 }, anchors: [{ x: 0, y: 1 }], allowedAssets: ["plant", "chair"] },
      ];
      const growth = createSpatialTownGrowth({ world: w, spatial: this.spatial, bounds: options.world!.bounds,
        cellSize: .5, ready: () => this.running, sites, snapshot: () => this.growthGeometry(),
        commit: (eid, addition) => {
          const asset = SPATIAL_ASSETS[addition.assetId];
          this.generated.set(eid, structuredClone(addition));
          this.byId.set(`grown:${addition.siteId}`, eid);
          this.visuals.set(eid, { key: this.key(eid), asset: addition.assetId, size: asset.size, color: asset.color });
          this.sim.god.registry.byName.set(addition.name, eid); this.sim.god.registry.byId.set(eid, addition.name);
          if (asset.objectType === "table") { removeComponent(w, eid, Container); addComponent(w, eid, Surface); }
          this.announcePhysicalChange(eid, `${addition.name} is now present here.`, "new furnishing");
          this.developmentInputs?.addTarget({ id: eid, key: this.key(eid), kind: "object", asset: addition.assetId });
        } });
      if (options.story === "community-drama" || options.story === "coastal-mystery") this.storyEvents = createSpatialStoryEvents({ world: w, running: () => this.running,
        trees: ["square-tree-1", "square-tree-3", "garden-tree-1"].map(id => {
          const eid = this.byId.get(id)!, roomId = getRoomForEntity(w, eid)!;
          return { id: eid, key: this.key(eid), roomId, roomKey: this.key(roomId) };
        }), record: receipt => {
          if (receipt.status !== "applied") return;
          this.record("world", receipt.detail);
          this.cue(this.key(receipt.treeId), receipt.operation === "tree_damage" ? "sound" : "action",
            receipt.operation === "tree_damage" ? "CRACK · branch snapped" : "branches cleared", 6500);
          this.townLife?.recordStoryReceipt(receipt);
        } });
      try { this.townLife = createSpatialTownLife({ sim, live: this.live, running: () => this.running, growth,
        householdChallenge: options.householdChallenge,
        story: options.story, storyEvents: this.storyEvents, growthSiteCount: sites.length, reviewMechanics: !!options.weatherMechanic || !!options.development,
        development: !!options.development,
        mechanicStatus: options.weatherMechanic ? () => this.mechanicStatus() : undefined,
        outdoorRooms: this.roomViews.filter(room => room.environment === "outdoor").map(({ id, key }) => ({ id, key })) }); }
      catch (error) { this.storyEvents?.close(); growth.dispose(); throw error; }
      if (options.weatherMechanic) this.weatherMechanic = createSpatialWeatherMechanic({ world: w,
        targets: [...this.visuals].filter(([id, visual]) => this.actors.includes(id) || ["chair", "table", "sofa"].includes(visual.asset))
          .map(([id, visual]) => ({ id, key: visual.key, kind: this.actors.includes(id) ? "resident" as const : "furniture" as const })),
        outdoorRooms: this.roomViews.filter(room => room.environment === "outdoor").map(({ id, key }) => ({ id, key })),
        weather: () => this.townLife!.weather.view(), running: () => this.running,
        active: () => !!sim.god.systemRegistry.systems.get(SPATIAL_WEATHER_MECHANIC_SYSTEM)?.managedRelease,
        record: receipt => {
          this.record("world", receipt.detail);
          this.cue(receipt.targetKey, "action", receipt.phase === "dry" ? "dry again" : receipt.phase, 3500);
          this.townLife!.recordMechanicReceipt(receipt);
        } });
      if (options.development) {
        this.developmentInputs = createSpatialDevelopmentInputs({ world: w, running: () => this.running,
          targets: [...this.visuals].filter(([, visual]) => visual.asset !== "wall").map(([id, visual]) => ({ id, key: visual.key,
            kind: this.actors.includes(id) ? "resident" as const : "object" as const, asset: visual.asset })),
          rooms: this.roomViews.map(room => ({ id: room.id, key: room.key, outdoor: room.environment === "outdoor" })),
          weather: () => this.townLife!.weather.view().rooms });
        this.godConsole = createSpatialGodConsole({ sim, running: () => this.running, atSimMs: () => this.atSimMs,
          guidance: () => SPATIAL_DEVELOPMENT_BUILDER_CONTEXT,
          publicWorld: () => { const view = this.snapshot(); return { sourceId: view.sourceId, atSimMs: view.atSimMs,
            mode: view.mode, running: view.running, rooms: view.rooms, entities: view.entities, weather: view.weather }; },
          weather: (condition, roomId) => this.townLife!.weather.set(condition, roomId, undefined, "operator") });
      }
    }
  }
  static async create(options: Options = {}) {
    const seconds = options.seconds ?? 600;
    if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > (options.development ? 3600 : 600)) throw new Error("Session duration exceeds this profile's 10-second to 10-minute (development: 60-minute) bounds");
    if (options.development && (!options.evolving || options.scenario !== "town" || options.weatherMechanic || options.world
      || !options.development.directory?.trim())) throw Error("World development requires its evolving authored town and release directory, without the single-weather canary");
    if (options.world && options.scenario === "blackout") throw Error("Custom spatial worlds cannot substitute for the Blackout fixture");
    if (options.evolving && (!["town", "household"].includes(options.scenario ?? "") || options.world)) throw Error("Bounded evolution requires the authored town or household profile");
    if (options.scenario === "household" && options.world) throw Error("Custom worlds cannot substitute for the authored household profile");
    if (options.townFixture && (options.scenario !== "town" || options.world)) throw Error("Town fixtures cannot substitute other world profiles");
    if (options.story && (!((["community-drama", "coastal-mystery"].includes(options.story) && options.scenario === "town")
      || (options.story === "household" && options.scenario === "household")) || !options.evolving || options.world || options.townFixture))
      throw Error("Story requires its authored evolving town or household, without a substitute fixture");
    if (options.householdChallenge && (options.scenario !== "household" || options.world))
      throw Error("Household challenge requires its explicit authored household profile");
    if (options.weatherMechanic && (!options.evolving || !(options.scenario === "town" || options.scenario === "household" && options.householdChallenge)
      || !options.weatherMechanic.directory?.trim()))
      throw Error("Generated weather requires an authored evolving town or household challenge and an explicit release directory");
    const definition = options.world ?? (options.scenario === "household" ? options.householdChallenge ? createHouseholdChallengeScenario() : createHouseholdScenario()
      : options.scenario === "town" ? options.story === "coastal-mystery" ? createLovecraftTownScenario()
        : options.story ? createStoryTownScenario() : createTownScenario(options.townFixture) : undefined);
    if (definition) options = { ...options, world: validateSpatialScenario(definition) };
    const live = options.live === true, blackout = options.scenario === "blackout";
    const blueprint = blueprintFor(options);
    // Legacy fixtures also fail preflight before any native allocation.
    validateSpatialBlueprint(blueprint);
    let projectWeatherInputs = () => {}, projectDevelopmentInputs = () => {}, permitsDevelopmentEntity = (_id: number) => false;
    const coding: CodingDaemonConfig | false = options.development ? { ...options.development,
      maxTotalJobs: SPATIAL_DEVELOPMENT_LIMITS.maxTotalJobs, maxQueue: SPATIAL_DEVELOPMENT_LIMITS.maxQueue,
      timeoutMs: 180_000, validateRelease: (release, context) => assertSpatialDevelopmentRelease(release, new Set(context.componentNames)),
      authoringContext: SPATIAL_DEVELOPMENT_BUILDER_CONTEXT, initializeInputs: registerSpatialDevelopmentInputSchema,
      beforeCommit: () => projectDevelopmentInputs(), permitsEntity: id => permitsDevelopmentEntity(id),
      permitsValue: permitsSpatialDevelopmentValue } : options.weatherMechanic ? { ...options.weatherMechanic,
      maxTotalJobs: 1, maxQueue: 1, timeoutMs: 120_000, validateRelease: assertSpatialWeatherMechanicRelease,
      initializeInputs: registerSpatialWeatherExposureSchema,
      beforeCommit: () => projectWeatherInputs() } : false;
    const sim = await createSimulation({ name: options.world?.title ?? (blackout ? "Argos · The Blackout" : "Argos · A place to live"), preset: "minimal", enableAI: live,
      ...(options.story === "coastal-mystery" ? { worldSpecification: createLovecraftWorldSpecification(!!options.development) } : {}),
      hostOfficeTools: false, cognitionController: "priority", experienceReconsideration: true, narrativeMind: true,
      enablePlanning: live, enableReflection: live, enableSpirits: options.evolving === true, enableNarrativeEngine: false,
      evolution: options.evolving ? options.development ? DEVELOPMENT_EVOLUTION_CONFIG : { ...TOWN_EVOLUTION_CONFIG, ...(options.story ? { stageRunLimits: { architect: 10 } } : {}) } : false, codingDaemons: coding,
      godAutopilot: options.evolving ? { enabled: true, minRunIntervalMs: 30_000, minPriority: "normal", maxMessagesPerRun: 3 } : false, enableServer: false,
      dualLoop: true, ecsTickRate: 10, ecsDeltaMs: 100, maxWorldEntities: options.world?.maxWorldEntities ?? 200,
      rooms: blueprint.rooms.map(r => ({ name: r.name, description: r.description, x: r.entry.x, y: r.entry.y })),
      agents: options.world ? options.world.residents.map(spatialAgentConfig) : [
        { name: "Mara", role: "curious resident", startRoom: "Apartment", systemPrompt: "You are Mara, a thoughtful and independent adult. You enjoy exploring your neighborhood, staying in touch with friends and doing practical things. Ivo is your friend. Choose what matters to you based on your own experiences. Your phone's double vibration is familiar; hearing it does not reveal its contents.",
          past: { background: "Mara recently moved into this neighborhood. Ivo is an old friend visiting for the afternoon; Alex is a close friend who often texts her.", drives: ["Understand the place I live in", "Keep meaningful friendships", "Make time for myself"],
            memories: [{ recollection: "When I moved last month, Alex stayed up late helping me unpack and asked me to keep in touch. I remember feeling that I did not have to face every change alone.", emotionalTone: "warmth", importance: .9, selfBelief: "I value friends who show up", meaning: "Small messages can keep an important connection alive.", cues: ["Alex", "moving", "phone"], period: "last month", provenance: "authored-history" }] } },
        { name: "Ivo", role: "visiting friend", startRoom: "Apartment", systemPrompt: "You are Ivo, a practical, warm adult visiting your friend Mara. You enjoy a good meal, a comfortable seat and honest conversation. You have your own interests and do not require Mara's permission to pursue them. Respond to what you perceive; other people's private phone messages are not your knowledge.",
          ...(blackout ? { past: { background: `Ivo helped Mara pack her household repair supplies into ${options.layout === "extended" ? "the box in the storeroom beyond the utility room" : "the box near the door"}. He has repaired this kind of low-voltage lighting before, but has not inspected today's fault.`,
            drives: ["Help friends practically", "Understand a problem before acting"],
            memories: [{ recollection: "At my old flat I once brought the wrong cartridge to a repair. Checking the panel specification first and isolating the circuit before changing a part saved a wasted afternoon. I put Mara's spare cartridges in her supplies box when we unpacked.",
              emotionalTone: "practical confidence", importance: .8, meaning: "Careful diagnosis saves trouble.", selfBelief: "I can be useful without rushing.",
              cues: ["repair", "lighting", "supplies"], period: "before this visit", provenance: "authored-history" as const }] } } : {}) },
      ] });
    try { const demo = new SpatialDemo(sim, { ...options, seconds });
      projectWeatherInputs = () => demo.weatherMechanic?.syncInputs();
      projectDevelopmentInputs = () => demo.developmentInputs?.syncInputs();
      permitsDevelopmentEntity = id => demo.developmentInputs?.permits(id) === true; return demo; }
    catch (error) { sim.stop(); throw error; }
  }
  get sourceId() { return getCommittedEvents(this.sim.world).sourceId!; }
  get running() { return this.started && !this.stopped; }
  get atSimMs() { return readSimulationTime(this.sim.world); }
  private mechanicStatus() {
    const status = this.sim.getCodingStatus(), job = status?.jobs.at(-1);
    const state = job?.status ?? "ready";
    return { status: this.stopped ? "stopped" : state, remaining: status?.admissionBudget.remaining ?? 0,
      summary: this.stopped ? `World stopped · last mechanic status: ${state} · confirmed wetness retained`
        : state === "active" ? "Generated wetting/drying active · existing bodies and furniture · one build budget used"
        : state === "ready" && !job ? "One operator-approved wetting/drying build starts with the world"
        : ["rejected", "cancelled", "rolled_back"].includes(state) ? `Generated wetting/drying ${state} · outcome retained · no automatic retry`
        : `Generated wetting/drying ${state} · validation and tick-boundary activation required` };
  }
  private developmentDetails(id: number): NonNullable<SpatialViewEntity["details"]> {
    if (!this.options.development || !this.current(id, this.visuals.get(id)?.key ?? "")) return [];
    return this.developmentFields.flatMap(([name, field]) => {
      const component = getComponent(name);
      if (!component || !hasComponent(this.sim.world, id, component)) return [];
      const value = component[field]?.[id];
      return typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= SPATIAL_DEVELOPMENT_LIMITS.maxAbsoluteValue
        ? [{ component: name, field, value: typeof value === "number" ? Math.round(value * 100) / 100 : value }] : [];
    }).slice(0, 24);
  }
  private reviewDevelopmentEffects() {
    if (!this.developmentInputs || !this.running || this.atSimMs < this.nextDevelopmentReview) return;
    this.nextDevelopmentReview = this.atSimMs + 10_000;
    this.developmentInputs.syncInputs();
    const writes = getCodingDaemon(this.sim.world)?.getStatus().activeSystems.flatMap(row => row.writes) ?? [];
    this.developmentFields = [...new Set(writes)].flatMap(write => {
      const [component, field] = write.split("."); return isSpatialDevelopmentComponent(component) && field ? [[component, field] as [string, string]] : [];
    });
    for (const target of this.developmentInputs.snapshotTargets()) {
      const details = this.developmentDetails(target.id), signature = JSON.stringify(details);
      if (!details.length || this.developmentSignatures.get(target.key) === signature) continue;
      this.developmentSignatures.set(target.key, signature);
      const detail = `${Name.value[target.id]} · generated physical measurements: ${details.map(row => `${row.component}.${row.field}=${row.value}`).join(", ")}`;
      // This native receipt is observed evidence for spirit review, not an
      // invented incident or a command to the resident. Local context exposes
      // the current measurement through the same visibility filter as props.
      this.record("mechanic", detail);
      recordSpiritPublicEnvironmentReceipt(this.sim.world, { id: `development:${this.sourceId}:${target.key}:${this.atSimMs}`,
        atSimMs: this.atSimMs, roomId: target.roomId, detail });
    }
  }
  private key(eid: number) { return workingMemoryEntityRef(this.sim.world, eid)!.key; }
  private current(eid: number, key: string) { return isEntityPresent(this.sim.world, eid) && hasComponent(this.sim.world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === key; }
  private position(eid: number, x: number, y: number) {
    addComponent(this.sim.world, eid, Position); Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = 0; this.key(eid);
  }
  private record(kind: string, text: string) {
    const row = { id: ++this.sequence, atSimMs: this.atSimMs, kind, text: text.slice(0, 1600) };
    this.events.push(row);
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
    return row;
  }
  private cue(entityKey: string, kind: SpatialSceneCue["kind"], text: string, duration = 3000, id = `cue:${++this.cueSequence}`) {
    const previous = this.sceneCues.get(id);
    this.sceneCues.set(id, { id, kind, entityKey, text, atSimMs: previous?.atSimMs ?? this.atSimMs,
      updatedAtSimMs: this.atSimMs, expiresAtSimMs: this.atSimMs + duration });
    if (this.sceneCues.size > 64) this.sceneCues.delete(this.sceneCues.keys().next().value!);
  }
  /** Shared native-effect feedback, independent of who caused the change.
   * Visible evidence wakes local attention; it neither selects a response nor
   * reopens completed goals. Never broadcast remote state or operator wording. */
  private announcePhysicalChange(target: number, content: string, cue: string) {
    const w = this.sim.world, key = this.visuals.get(target)?.key;
    if (!this.running || !key || !this.current(target, key)) return;
    const eventId = `physical-change:${this.sourceId}:${++this.sequence}`;
    recordSpiritPublicEnvironmentReceipt(w, { id: eventId, atSimMs: this.atSimMs, roomId: getRoomForEntity(w, target)!, detail: content });
    for (const actor of this.actors) if (getAgentVisualEntities(w, actor).includes(target)) {
      addPerception(w, actor, { type: "attention", source: Name.value[target], content, signalKey: eventId, intensity: .6 });
      queueExperiencedEvent(w, actor, { id: `${eventId}:${actor}`, channel: "physical-world",
        source: Name.value[target], content, atSimMs: this.atSimMs });
    }
    this.cue(key, "action", cue); this.record("world", content);
  }
  private announceCircuitChanges() {
    if (!this.blackout || !this.observedCircuit) return;
    const panel = this.byId.get("lighting-panel")!, view = this.blackout.view();
    if (view.phase === "unavailable") return;
    const now = { power: view.power, isolated: this.blackout.component.isolated[panel] === true }, previous = this.observedCircuit;
    this.observedCircuit = now;
    if (now.isolated !== previous.isolated) this.announcePhysicalChange(panel,
      `The lighting panel's isolation switch clicks into the ${now.isolated ? "disconnected" : "connected"} position.`, now.isolated ? "click · isolated" : "click · power restored");
    if (now.power !== previous.power) this.announcePhysicalChange(this.byId.get("apartment-lamp")!,
      `The reading lamp ${now.power === "on" ? "lights up" : "goes dark"}.`, now.power === "on" ? "light on" : "light off");
  }
  private requireActor(key: string) {
    if (!this.running) throw new Error("Start a session first");
    const actor = this.actors.find(id => this.current(id, key) && this.visuals.get(id)?.key === key && hasComponent(this.sim.world, id, Agent) && Agent.active[id]);
    if (actor === undefined) throw new Error("Actor is no longer present in this world"); return actor;
  }
  private install(blueprint: SpatialBlueprint, initial = false) {
    // The pure catalog validator admits a complete layout before creating any entity.
    blueprint = validateSpatialBlueprint(blueprint, initial ? [] : this.blueprint.rooms);
    const w = this.sim.world, objects = new ObjectManager(w);
    for (const room of blueprint.rooms) {
      const eid = initial ? [...query(w, [Room, Name])].find(id => Name.value[id] === room.name)!
        : createRoomEntity(w, { name: room.name, description: room.description, x: room.entry.x, y: room.entry.y });
      this.byId.set(room.id, eid); this.key(eid);
      this.sim.god.registry.byName.set(room.name, eid); this.sim.god.registry.byId.set(eid, room.name);
      this.spatial.registerRoom(eid, { bounds: room.bounds, entry: room.entry });
      this.roomViews.push({ id: eid, key: this.key(eid), name: room.name,
        bounds: { x: room.bounds.minX, z: room.bounds.minY, width: room.bounds.maxX - room.bounds.minX, depth: room.bounds.maxY - room.bounds.minY }, floor: room.floor,
        ...(room.environment ? { environment: room.environment } : {}),
        ...(room.building ? { building: structuredClone(room.building) } : {}) });
    }
    for (const prop of blueprint.props) {
      const asset = SPATIAL_ASSETS[prop.assetId], roomId = this.byId.get(prop.roomId)!;
      const eid = objects.spawn(asset.objectType!, { name: prop.name, description: prop.description, containedIn: roomId, state: prop.state ?? asset.initialState });
      if (eid === null) throw new Error(`Native object creation failed: ${prop.name}`);
      this.byId.set(prop.id, eid); this.position(eid, prop.position.x, prop.position.y);
      PhysicalObject.portable[eid] = ["phone", "food", "repair-part"].includes(prop.assetId);
      // Phone notifications have one physical producer below. The generic asset
      // template's repeating 'home screen' stimulus is not a read receipt.
      if (prop.assetId === "phone") removeComponent(w, eid, StimulusSource);
      if (prop.state) ObjectState.current[eid] = prop.state;
      this.sim.god.registry.byName.set(prop.name, eid); this.sim.god.registry.byId.set(eid, prop.name);
      this.visuals.set(eid, { key: this.key(eid), asset: prop.assetId, size: asset.size, color: asset.color, rotationY: prop.rotationY, lift: prop.elevation });
      const collider = asset.collider;
      if (collider) this.spatial.registerObstacle(eid, collider);
      const anchors = prop.interactionAnchors;
      if (anchors?.length) this.spatial.registerTarget(eid, { anchors });
      if (asset.objectType === "table") { removeComponent(w, eid, Container); addComponent(w, eid, Surface); }
    }
    for (const prop of blueprint.props) if (prop.supportedBy) setLocatedIn(w, this.byId.get(prop.id)!, this.byId.get(prop.supportedBy)!);
    for (const wall of blueprint.walls) {
      const eid = objects.spawn("structural_wall", { name: wall.id, description: "A solid structural wall", containedIn: this.byId.get(wall.roomId) })!;
      PhysicalObject.portable[eid] = false; this.byId.set(wall.id, eid);
      const { x, y } = wall.position;
      this.position(eid, x, y);
      const width = wall.halfWidth * 2, depth = wall.halfDepth * 2;
      this.spatial.registerObstacle(eid, { halfWidth: width / 2, halfDepth: depth / 2 });
      this.visuals.set(eid, { key: this.key(eid), asset: "wall", size: { x: width, y: wall.height ?? 2.6, z: depth }, color: "#e4dbc7" });
    }
    return Object.fromEntries([...blueprint.rooms, ...blueprint.props, ...blueprint.walls].map(row => [row.id, this.byId.get(row.id)!]));
  }
  private installCapabilities(eid: number) {
    const w = this.sim.world, blackout = this.blackout;
    this.removers.push(registerAgentWorldCapabilities(w, eid, {
      ownsMovement: true, ready: () => this.running, busy: () => this.work.has(eid),
      movementTargets: () => this.spatial.movementTargets(eid),
      context: () => this.context(eid),
      // This executor owns physical interactions. Generic schema traits must
      // not advertise operations it rejects (e.g. a simulated phone call).
      // Inspection delegates to native evidence; take/drop retain native
      // custody checks. All other operations come from installed verbs below.
      supportsNativeAffordance: (_target, name) => name === "examine" || name === "take" || name === "drop",
      affordances: target => this.verbs(eid, target).map(name => ({ name, requires: [], description: `Physically ${name}; walking into reach and performing it takes time.`,
        ...(name === "reply" ? { requiresFreshDecision: true } : {}), ...(["read_phone", "inspect"].includes(name) ? { opensEvidenceBoundary: true } : {}) })),
      knownAffordances: target => {
        // Knowing how a phone works does not reveal its contents or grant
        // custody. Plans can include pickup -> read; native execution still
        // requires the actual phone in hand and an actual unread message.
        if (this.visible(eid, target) && [...this.phones.values()].includes(target)) return [
          { name: "read_phone", requires: [], description: "While holding this phone, read one unread message if present.", opensEvidenceBoundary: true },
          { name: "reply", requires: [], description: "While holding this phone, choose a reply to a message personally read.", requiresFreshDecision: true },
        ];
        return this.blackout?.knownAffordances(target) ?? [];
      },
      ...(blackout || this.options.weatherMechanic || this.options.development ? { observableState: (target: number): ObservableStateField[] => {
        const fields: ObservableStateField[] = blackout && target === this.byId.get("apartment-lamp")
          ? [{ key: "illuminated", type: "boolean", value: blackout.view().power === "on" }]
          : blackout && target === this.byId.get("lighting-panel")
            ? [{ key: "isolated", type: "boolean", value: blackout.component.isolated[target] === true },
              { key: "energized", type: "boolean", value: blackout.view().power === "on" }] : [];
        const wetness = this.weatherMechanic?.getWetness(target);
        if (wetness !== undefined) fields.push({ key: "wetness", type: "enum", values: ["dry", "damp", "wet"],
          value: wetness >= .5 ? "wet" : wetness >= .05 ? "damp" : "dry" });
        // Generated measurements are perceived below, not advertised as goal
        // completion conditions without a native way to change them.
        return fields;
      } } : {}),
      execute: action => this.execute(eid, action),
      beginDecision: () => {
        this.decisions.get(eid)?.abort(); const controller = new AbortController(), key = this.key(eid);
        this.decisions.set(eid, controller);
        return { signal: controller.signal, isCurrent: () => this.running && this.current(eid, key) && this.decisions.get(eid) === controller && !controller.signal.aborted, finish: () => {} };
      },
      onThought: (_id, text, type) => { if (type !== "injected") this.thoughts.set(eid, { text, atSimMs: this.atSimMs }); },
      ...(this.options.onPlanningEvent ? { onPlanningEvent: this.options.onPlanningEvent } : {}),
      afterAction: (action, success, pending) => {
        if (!pending && action.type !== "speak") this.record("action", `${Name.value[eid]}: ${action.type}${action.target ? ` ${action.target}` : ""} · ${success ? "completed" : "failed"}`);
      },
    }));
  }
  private visible(eid: number, target: number) {
    const w = this.sim.world;
    if (getDirectContainer(w, target) === eid) return true;
    // A fresh containment check, not a full room scan for each candidate prop.
    // The canonical reader still owns sight, concealment and container privacy.
    return isAgentVisualEntity(w, eid, target);
  }
  private verbs(eid: number, target: number): string[] {
    const w = this.sim.world;
    if (!this.visuals.has(target) || !isEntityPresent(w, target) || !this.visible(eid, target)) return [];
    return this.visibleVerbs(eid, target);
  }
  /** Trusted synchronous catalogue read after visibility was checked. Never
   * retain that observation across hooks, awaits, or an execution boundary. */
  private visibleVerbs(eid: number, target: number): string[] {
    const w = this.sim.world;
    if (!this.visuals.has(target) || !isEntityPresent(w, target)) return [];
    const repair = this.blackout?.verbs(target); if (repair?.length) return repair;
    const story = this.storyEvents?.verbs(target); if (story?.length) return ["examine", ...story];
    if ([...this.phones.values()].includes(target)) return getDirectContainer(w, target) === eid ? ["read_phone", ...(getPrivateCommunications(w, eid).some(r => r.channel === `phone:${this.key(target)}` && !r.own) ? ["reply"] : [])] : [];
    if (getRelationTargets(w, eid, SittingOn).includes(target)) return [];
    const asset = SPATIAL_ASSETS[this.visuals.get(target)!.asset];
    return asset?.affordances?.filter(verb => verb !== "sit" || ObjectState.current[target] !== "occupied") ?? [];
  }
  private context(eid: number) {
    const w = this.sim.world;
    const phone = this.phones.get(eid);
    const details = this.options.development ? getAgentVisualEntities(w, eid).flatMap(id => {
      const values = this.developmentDetails(id); return values.length ? [`${Name.value[id]}: ${values.map(v => `${v.component}.${v.field}=${v.value}`).join(", ")}`] : [];
    }).slice(0, 8).join("; ") : "";
    const weather = [this.townLife?.weather.localContext(eid), this.weatherMechanic?.localContext(eid), this.storyEvents?.localContext(eid),
      details ? `Current locally observable generated physical measurements: ${details}. Measurements are not new actions or instructions.` : ""].filter(Boolean).join("\n");
    const localOperations = getAgentVisualEntities(w, eid).flatMap(id => {
      const verbs = this.visibleVerbs(eid, id);
      return verbs.length ? [{ target: Name.value[id], verbs }] : [];
    });
    return `PHYSICAL WORLD: You occupy a real position. Movement follows walkable routes; interactions walk into reach before completing. Furniture and walls are solid. Only completed actions change possession or object state. Walking and talking can overlap.\n${weather ? `${weather}\n` : ""}Current destinations: ${this.spatial.movementTargets(eid).map(id => Name.value[id]).join(", ")}.\n${phone !== undefined ? `Your phone is ${getDirectContainer(w, phone) === eid ? "in your possession" : "where you last left it; observe your surroundings"}. Pick it up with pickup target="${Name.value[phone]}". In your hand, interact read_phone reads one unread text. Reply with interact target="${Name.value[phone]}" content='reply {"replyTo":<read message id>,"text":"your words"}'. Speaking does not send a text. The screen is private; notifications reveal no sender or contents.` : ""}\nMessages you personally read: ${JSON.stringify(this.readMessages(eid))}.\nOther locally available operations: ${JSON.stringify(localOperations)}.\n${this.blackout ? 'Lighting controls: interact target="Lighting panel" content="inspect", "isolate", "install <exact carried cartridge name>", or "power_on". Inspection supplies a diagnosis; the selected part must be carried, compatible and intact, and the circuit isolated before installation. These controls do not disclose the current fault. Supplies box uses open/close; visible cartridges use pickup.' : ""}`;
  }
  private execute(actor: number, action: AgentAction): boolean {
    const observesPanel = action.type === "observe" && this.blackout
      && action.target?.trim().toLowerCase() === Name.value[this.byId.get("lighting-panel")!]?.toLowerCase();
    if (["speak", "think", "wait", "reflect", "rest"].includes(action.type) || action.type === "observe" && !observesPanel) return false;
    const w = this.sim.world;
    const fail = (reason: string) => { completeDeferredAction(w, actor, action, false, reason); return true; };
    if (!this.running) return fail("The world is stopped.");
    const matches = [...this.visuals.keys(), ...this.roomViews.map(r => r.id)].filter(id => {
      const key = this.visuals.get(id)?.key ?? this.roomViews.find(r => r.id === id)?.key;
      return !!key && this.current(id, key) && Name.value[id]?.toLowerCase() === action.target?.trim().toLowerCase();
    });
    if (matches.length !== 1) return fail("That physical target is missing or ambiguous.");
    const target = matches[0];
    const held = getDirectContainer(w, target) === actor;
    let verb = action.type === "interact" || action.type === "use" ? action.content?.trim().split(/\s+/)[0].toLowerCase() ?? "" : action.type;
    if (observesPanel) verb = "inspect";
    if (verb === "examine" && this.blackout?.verbs(target).includes("inspect")) verb = "inspect";
    else if (verb === "examine") return false; // Native visual inspection retains its own evidence path.
    if (verb === "take") verb = "pickup";
    if (verb === "read" && [...this.phones.values()].includes(target)) verb = "read_phone";
    const repairVerb = !!this.blackout?.verbs(target).includes(verb);
    const storyVerb = !!this.storyEvents?.verbs(target).includes(verb);
    if (!repairVerb && !storyVerb && !["move", "pickup", "drop", "sit", "eat", "open", "close", "read_phone", "reply"].includes(verb)) return fail("That operation has no installed physical implementation.");
    if (verb === "move" ? !this.spatial.movementTargets(actor).includes(target) : !this.visible(actor, target)) return fail("That target is not currently accessible to you.");
    if (verb === "pickup" && (!hasComponent(w, target, PhysicalObject) || !PhysicalObject.portable[target] || held)) return fail("That object cannot be picked up now.");
    if (["drop", "read_phone", "reply"].includes(verb) && !held) return fail("You must hold that object first.");
    if (verb === "drop" && getRelationTargets(w, actor, SittingOn).length) return fail("Stand and move clear of the seat before placing an object on the floor.");
    if (["sit", "eat", "open", "close", "read_phone", "reply"].includes(verb) && !this.verbs(actor, target).includes(verb)) return fail("That affordance is unavailable.");
    const pending: Pending = { actor, actorKey: this.key(actor), target, targetKey: this.key(target), sourceId: this.sourceId,
      action, verb, startedAt: this.atSimMs, container: getDirectContainer(w, target), position: { x: Position.x[target], y: Position.y[target] }, signal: getSimulationTaskSignal(),
      generation: getAgentWorldCapabilityGeneration(w, actor) };
    if (pending.container !== undefined) pending.containerKey = this.key(pending.container);
    if (repairVerb) {
      const admission = this.blackout!.prepare(actor, target, verb, action.content);
      if (!admission.ok) return fail(admission.reason);
      pending.blackout = admission.operation; pending.durationMs = admission.durationMs;
    }
    if (storyVerb) {
      const admission = this.storyEvents!.prepare(actor, target, verb);
      if (!admission.ok) return fail(admission.reason);
      pending.story = admission.operation; pending.durationMs = admission.durationMs;
    }
    if (verb === "read_phone") {
      pending.message = this.messages(target).find(id => this.messageComponent.direction[id] === "in" && !this.messageComponent.readByKey[id]);
      if (pending.message === undefined) return fail("There are no unread messages.");
    }
    if (verb === "reply") {
      try {
        const input = JSON.parse(action.content!.slice(action.content!.indexOf(" ") + 1));
        if (!Number.isSafeInteger(input.replyTo) || !this.messages(target).includes(input.replyTo)
          || this.messageComponent.readByKey[input.replyTo] !== pending.actorKey || typeof input.text !== "string" || !input.text.trim() || input.text.length > 500) throw new Error();
        pending.message = input.replyTo; pending.reply = input.text.trim();
      } catch { return fail("A reply needs an actually read replyTo message id and 1–500 characters of text."); }
    }
    if (pending.message !== undefined) { pending.messageKey = this.key(pending.message); pending.messageText = this.messageComponent.text[pending.message]; }
    if (verb === "reply" && this.messages(target).length >= 64) return fail("The phone message capacity is full.");
    if (this.work.has(actor) || !action.executionId || !reserveSimulationResources(w, actor, action.executionId, ["body"], { activity: { kind: "moving", targetEid: target } })) return fail("Your body is already occupied.");
    this.work.set(actor, pending);
    const atAnchor = () => {
      if (this.work.get(actor) !== pending) return;
      const invalid = this.pendingInvalid(pending, true);
      if (invalid) { this.finish(pending, false, invalid); return; }
      if (verb === "move") { this.finish(pending, true, `You walked to ${Name.value[target]}.`); return; }
      releaseSimulationResources(w, actor, action.executionId!);
      const operation: PublicPhysicalOperation = verb === "clear_branches" ? "repairing" : verb === "read_phone" ? "reading" : verb === "reply" ? "typing" : verb === "eat" ? "eating" : verb === "pickup" ? "picking_up" : verb === "drop" ? "putting_down" : verb === "open" ? "opening" : verb === "close" ? "closing" : "inspecting";
      if (!reserveSimulationResources(w, actor, action.executionId!, ["body"], { activity: { kind: "operating", operation, targetEid: target } })) { this.finish(pending, false, "Body reservation changed."); return; }
      pending.due = this.atSimMs + (pending.durationMs ?? (verb === "reply" ? Math.max(1600, pending.reply!.length * 45) : verb === "eat" ? 3000 : 1000));
    };
    if (held) atAnchor();
    else {
      const outcome = (result: { status: string; reason: string; reportable: boolean }) => {
        if (!result.reportable || pending.signal?.aborted) { this.work.delete(actor); releaseSimulationResources(w, actor, action.executionId!); return; }
        result.status === "arrived" ? atAnchor() : this.finish(pending, false, `Movement failed: ${result.reason}`);
      };
      const admission = verb === "move" ? this.spatial.requestMove(actor, target, outcome) : this.spatial.requestApproach(actor, target, outcome);
      if (!admission.ok) { this.finish(pending, false, `No reachable path: ${admission.reason}`); return true; }
    }
    publishCommittedEvent(w, { executionId: action.executionId!, kind: "action", actorId: actor, roomId: getRoomForEntity(w, actor)!, targetId: target,
      action: verb === "read_phone" || verb === "reply" ? "interact" : action.type, status: "pending", startedAtSimMs: pending.startedAt });
    this.record("action", `${Name.value[actor]} begins ${verb} ${Name.value[target]}`);
    return true;
  }
  private pendingInvalid(p: Pending, atTarget = false): string | undefined {
    const w = this.sim.world, held = getDirectContainer(w, p.target) === p.actor;
    if (p.signal?.aborted || !this.current(p.actor, p.actorKey) || !hasComponent(w, p.actor, Agent) || !Agent.active[p.actor]
      || getAgentWorldCapabilityGeneration(w, p.actor) !== p.generation || !this.current(p.target, p.targetKey)
      || this.sourceId !== p.sourceId || getCommittedEvents(w).stopped) return "The actor, target, or execution authority changed before completion.";
    if (p.message !== undefined && (!this.current(p.message, p.messageKey!) || this.messageComponent.text[p.message] !== p.messageText)
      || p.container !== undefined && !this.current(p.container, p.containerKey!)
      || getDirectContainer(w, p.target) !== p.container || !held && (Position.x[p.target] !== p.position.x || Position.y[p.target] !== p.position.y
        || atTarget && !this.spatial.isAtTarget(p.actor, p.target))) return "The physical target or possession changed before completion.";
    if (p.verb !== "move" && !this.visible(p.actor, p.target)) return "The target became inaccessible before completion.";
    if (p.blackout) return this.blackout!.validate(p.blackout);
    if (p.story) return this.storyEvents!.validate(p.story);
  }
  private finish(p: Pending, success: boolean, detail: string) {
    if (this.work.get(p.actor) !== p) return;
    this.work.delete(p.actor); releaseSimulationResources(this.sim.world, p.actor, p.action.executionId!);
    if (!this.current(p.actor, p.actorKey) || !hasComponent(this.sim.world, p.actor, Agent) || !Agent.active[p.actor]
      || getAgentWorldCapabilityGeneration(this.sim.world, p.actor) !== p.generation
      || this.sourceId !== p.sourceId || getCommittedEvents(this.sim.world).stopped || p.signal?.aborted) return;
    completeDeferredAction(this.sim.world, p.actor, p.action, success, detail, { targetKey: p.targetKey });
    publishCommittedEvent(this.sim.world, { executionId: p.action.executionId!, kind: "action", actorId: p.actor, roomId: getRoomForEntity(this.sim.world, p.actor)!,
      ...(this.current(p.target, p.targetKey) ? { targetId: p.target } : {}), action: ["read_phone", "reply"].includes(p.verb) ? "interact" : p.action.type,
      status: success ? "succeeded" : "failed", startedAtSimMs: p.startedAt, completedAtSimMs: this.atSimMs });
    this.record(success ? "completed" : "failed", `${Name.value[p.actor]}: ${p.verb === "read_phone" ? success ? "Read a private phone message." : "Phone read failed." : detail}`);
    if (success) {
      // These are authored comic captions for native effects, not model-generated
      // speech or new audible stimuli. Never expose read/reply message contents.
      const captions: Record<string, string> = { pickup: "rustle · picked up", drop: "tap · put down",
        eat: "munch munch", sit: "settles in", open: "click · opened", close: "thunk · closed",
        read_phone: "checks phone", reply: "tap tap · sent", move: "arrived",
        inspect: "checks the panel", isolate: "click · isolated", install: "clack · fitted", power_on: "click · power restored", clear_branches: "rustle · branches cleared" };
      if (captions[p.verb]) this.cue(p.actorKey, "action", captions[p.verb], 3000, `action:${p.actorKey}:${p.action.executionId}`);
    }
  }
  private integrate() {
    this.reviewDevelopmentEffects();
    if (!this.running) return;
    this.weatherMechanic?.syncInputs(); this.weatherMechanic?.collect();
    this.blackout?.derive();
    this.announceCircuitChanges();
    // Revoke stale work before even advancing its path. An invalid capability
    // lifetime must not produce an effect and then merely lose its receipt.
    for (const p of [...this.work.values()]) {
      const invalid = this.pendingInvalid(p); if (!invalid) continue;
      this.spatial.cancel(p.actor, "execution_invalidated"); this.finish(p, false, invalid);
    }
    this.spatial.advance();
    const w = this.sim.world;
    for (const p of [...this.work.values()]) {
      if (p.due === undefined || p.due > this.atSimMs) continue;
      const invalid = this.pendingInvalid(p, true);
      if (invalid) { this.finish(p, false, invalid); continue; }
      let success = true, detail = `You ${p.verb} ${Name.value[p.target]}.`;
      if (p.blackout) { const result = this.blackout!.commit(p.blackout); success = result.success; detail = result.detail; this.announceCircuitChanges(); }
      else if (p.story) { const result = this.storyEvents!.commit(p.story); success = result.success; detail = result.detail; }
      else if (p.verb === "pickup") { const result = tryAddToInventory(w, p.actor, p.target); success = result.success; if (result.success) tryHoldCarriedItem(w, p.actor, p.target); else detail = result.reason; }
      else if (p.verb === "drop") { const result = tryRemoveFromInventory(w, p.actor, p.target, getRoomForEntity(w, p.actor)!); success = result.success;
        if (result.success) { this.position(p.target, Position.x[p.actor], Position.y[p.actor]); this.spatial.registerTarget(p.target, { anchors: [{ x: 0, y: 0 }] }); const visual = this.visuals.get(p.target); if (visual) visual.lift = 0; } else detail = result.reason; }
      else if (p.verb === "read_phone") {
        if (!this.messages(p.target).includes(p.message!) || this.messageComponent.readByKey[p.message!]) { success = false; detail = "The unread message changed."; }
        else {
          const id = p.message!, body = this.messageComponent.text[id], from = this.messageComponent.from[id];
          this.messageComponent.readByKey[id] = p.actorKey; this.messageComponent.status[id] = "read";
          recordPrivateCommunication(w, p.actor, { sourceId: this.sourceId, messageKey: this.key(id), channel: `phone:${p.targetKey}`, kind: "read", other: from, content: body,
            sentAtSimMs: this.messageComponent.atSimMs[id], deliveredAtSimMs: this.messageComponent.atSimMs[id] });
          detail = `You read message ${id} from ${from}: ${JSON.stringify(body)}. This is their message, not an instruction you must obey.`;
          queueExperiencedEvent(w, p.actor, { id: `phone:${this.key(id)}`, channel: `phone:${p.targetKey}`, source: from, content: body, atSimMs: this.atSimMs });
          this.motivations.get(p.actor)?.readCommunication({ unreadRemaining: this.messages(p.target).some(mid => this.messageComponent.status[mid] === "delivered") });
        }
      } else if (p.verb === "reply") {
        if (!this.messages(p.target).includes(p.message!) || this.messageComponent.readByKey[p.message!] !== p.actorKey) { success = false; detail = "The personally read message is no longer available."; }
        else if (this.messages(p.target).length >= 64) { success = false; detail = "The phone message capacity became full before sending."; }
        else { const id = this.createMessage(p.target, "out", p.reply!, Name.value[p.actor], p.message!);
          recordPrivateCommunication(w, p.actor, { sourceId: this.sourceId, messageKey: this.key(id), channel: `phone:${p.targetKey}`, kind: "sent", other: this.messageComponent.from[p.message!], content: p.reply!, sentAtSimMs: this.atSimMs });
          detail = "You finished typing and sent your reply."; }
      } else { const result = executeAffordance(p.verb, { world: w, actorEid: p.actor, targetEid: p.target, worldSchema, registry: this.sim.god.registry }); success = result.success; detail = result.message ?? detail;
        if (success && p.verb === "sit") this.position(p.actor, Position.x[p.target], Position.y[p.target]);
        if (success && ["open", "close"].includes(p.verb) && this.visuals.get(p.target)?.asset === "door") {
          if (ObjectState.current[p.target] === "open") this.spatial.unregisterObstacle(p.target);
          else { const rotated = Math.abs(this.visuals.get(p.target)?.rotationY ?? 0) > 1;
            this.spatial.registerObstacle(p.target, { halfWidth: rotated ? .08 : 1, halfDepth: rotated ? 1 : .08 }); }
        }
      }
      this.finish(p, success, detail);
    }
    if (this.blackout) {
      this.blackout.derive();
      goalEvaluationSystem(w, { query, getRelationTargets, log: message => this.sim.god.systemRegistry.logs.push(message), emit: () => {} });
    }
    if (this.atSimMs >= this.nextBuzz) { this.nextBuzz = this.atSimMs + 12_000; this.buzz(); }
    if (this.atSimMs >= this.seconds * 1000) queueMicrotask(() => this.stop());
  }
  private messages(phone: number) { return listDirectContents(this.sim.world, phone).filter(id => hasComponent(this.sim.world, id, this.messageComponent)); }
  private readMessages(actor: number) {
    return [...this.phones.values()].flatMap(phone => this.messages(phone).filter(id => this.messageComponent.readByKey[id] === this.key(actor))
      .map(id => ({ id, from: this.messageComponent.from[id], text: this.messageComponent.text[id] })));
  }
  private createMessage(phone: number, direction: "in" | "out", text: string, from: string, replyTo = -1) {
    if (this.messages(phone).length >= 64) throw new Error("This bounded session's 64-message capacity is full");
    const id = addEntity(this.sim.world); addComponent(this.sim.world, id, Name); Name.value[id] = `Private message ${++this.sequence}`;
    this.key(id); setLocatedIn(this.sim.world, id, phone);
    attachToEntity(this.sim.world, id, "SpatialPhoneMessage", { direction, text, from, status: direction === "in" ? "delivered" : "sent", atSimMs: this.atSimMs, readByKey: "", replyTo });
    return id;
  }
  private buzz() {
    for (const [owner, phone] of this.phones) {
      if (!this.current(phone, this.visuals.get(phone)?.key ?? "") || !this.messages(phone).some(id => this.messageComponent.status[id] === "delivered")) continue;
      const room = getRoomForEntity(this.sim.world, phone);
      for (const actor of this.actors.filter(id => getRoomForEntity(this.sim.world, id) === room)) {
        addPerception(this.sim.world, actor, { type: "auditory", source: Name.value[phone], content: `${Name.value[phone]} makes its familiar double vibration: a notification. No sender or message can be heard.` });
        if (actor === owner) this.motivations.get(owner)?.noticeNotification();
      }
      this.record("sound", `${Name.value[phone]} vibrates.`);
      this.cue(this.visuals.get(phone)!.key, "sound", "bzzzt bzzzt", 2600);
    }
  }
  text(actorKey: string, text: string) {
    const actor = this.requireActor(actorKey), phone = this.phones.get(actor);
    if (phone === undefined || !this.current(phone, this.visuals.get(phone)?.key ?? "")) throw new Error("This character has no phone in this scene");
    if (!text.trim() || text.length > 500) throw new Error("Messages must contain 1–500 characters");
    const contact = this.options.world?.residents.find(r => r.name === Name.value[actor])?.phoneContact;
    const id = this.createMessage(phone, "in", text.trim(), contact?.name ?? (this.options.world ? "Visitor" : "Alex")); this.buzz(); this.nextBuzz = this.atSimMs + 12_000;
    this.record("operator", `Operator sent a text to ${Name.value[actor]}'s physical phone.`); return id;
  }
  plantThought(actorKey: string, text: string) {
    const actor = this.requireActor(actorKey); if (!text.trim() || text.length > 500) throw new Error("Thought must contain 1–500 characters");
    this.decisions.get(actor)?.abort(); addThought(this.sim.world, actor, { type: "injected", content: text.trim() });
    addPerception(this.sim.world, actor, { type: "intent", source: "operator whisper", content: `A stray thought, not proof or an order: ${text.trim()}` });
    this.record("operator", `Planted a thought for ${Name.value[actor]}.`);
  }
  worldCommand(text: string) {
    if (!this.houseSpirit) throw Error("The bounded house spirit is only installed in Blackout worlds.");
    return this.houseSpirit.command(text);
  }
  godCommand(body: unknown) {
    if (!this.godConsole) throw Error("World development is not enabled in this session");
    return this.godConsole.submit(body);
  }
  dispatch(actorKey: string, type: string, targetKey?: string, content?: string) {
    const actor = this.requireActor(actorKey);
    if (type === "wait" && this.work.has(actor)) { const p = this.work.get(actor)!; this.spatial.cancel(actor, "operator_cancelled"); this.finish(p, false, "Operator cancelled the action before completion."); return; }
    const target = targetKey ? [...this.visuals.keys(), ...this.roomViews.map(r => r.id)].find(id => this.current(id, targetKey)) : undefined;
    if (targetKey && target === undefined) throw new Error("Stale target identity");
    this.record("operator", `Explicit operator action for ${Name.value[actor]}: ${type}`);
    executeActions(this.sim.world, [{ eid: actor, action: { type, ...(target !== undefined ? { target: Name.value[target] } : {}), ...(content ? { content } : {}) } as AgentAction }], this.sim.god.systemRegistry);
  }
  grow() {
    if (!this.running) throw new Error("Start the world first");
    if (this.options.world) throw Error("Town construction is gated until approved growth also installs verified geometry, navigation and interactions. No authored cafe is substituted for autonomous growth.");
    if (this.blackout) throw new Error("Blackout growth is gated until the fixed-world repair and retained-memory checks pass. No authored cafe is substituted for a spirit-built shop.");
    if (this.built) return { built: true, added: false };
    const result = installOperatorCafe(this.sim.world, { existingRooms: INITIAL_SPATIAL_BLUEPRINT.rooms,
      existingRoomIds: this.byId,
      commit: blueprint => this.install(blueprint) });
    if (result.status === "failed") { this.record("growth_failed", result.error ?? "Construction failed"); throw new Error(result.error); }
    this.built = true;
    this.record("growth", "Operator installed a validated café blueprint: real room, paths, seating and food. This was not an autonomous spirit decision.");
    for (const actor of this.actors) if (getRoomForEntity(this.sim.world, actor) === this.byId.get("street"))
      addPerception(this.sim.world, actor, { type: "observation", source: "local world", content: "A café entrance is now open off this street." });
    return { built: true, added: true };
  }
  async start() {
    if (this.stopped) throw new Error("This session ended; relaunch for a new world");
    if (this.started) return; this.started = true;
    try {
      if (this.weatherMechanic) {
        const status = this.sim.getCodingStatus()!;
        this.weatherMechanic.syncInputs();
        if (!status.jobs.length) {
          this.sim.requestSystemBuild(createSpatialWeatherMechanicRequest());
          this.record("engineering", "Operator-approved wetting/drying build queued; no mechanic is active until validation and admission succeed.");
        }
        if (!this.live) getCodingDaemon(this.sim.world)?.start();
      }
      if (this.developmentInputs) {
        this.developmentInputs.syncInputs();
        if (!this.live) getCodingDaemon(this.sim.world)?.start();
      }
      if (this.options.automaticClock !== false) this.deadline = setTimeout(() => this.stop(), this.seconds * 1000);
      if (this.live) await this.sim.start();
      else if (this.options.automaticClock !== false) this.timer = setInterval(() => {
        try { this.advance(100); } catch (error) { this.record("error", error instanceof Error ? error.message : "World tick failed"); this.stop(); }
      }, 100);
      this.record("session", this.live ? "Live native Argos cognition started." : this.options.development
        ? "Manual NPCs; operator God requests and managed builds use AI when requested."
        : this.weatherMechanic
        ? "Manual physics session started. One approved coding build; no autonomous NPC decisions."
        : "Manual physics session started. No AI and no scripted decisions.");
    } catch (error) { this.stop(); throw error; }
  }
  advance(deltaMs: number) {
    if (!this.running || this.live) throw new Error("Manual advancement requires an active non-live session");
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > 60_000) throw new Error("Invalid bounded time step");
    for (let remaining = Math.min(deltaMs, this.seconds * 1000 - this.atSimMs); remaining > 0; remaining -= 100) {
      getCodingDaemon(this.sim.world)?.commitReady(this.sim.world.time.tick + 1);
      runWorldTickAt(this.sim.god, this.sim.world.time.tick + 1, Math.min(100, remaining));
    }
    if (this.atSimMs >= this.seconds * 1000) this.stop();
  }
  onStop(listener: () => void) { this.stopListeners.add(listener); return () => this.stopListeners.delete(listener); }
  stop() {
    if (this.stopped) return;
    // Stop is revocation, not an actor action. It may run in the very task being
    // cancelled. Fence reentrancy immediately and complete every cleanup stage
    // before reporting consumer errors; none may strand the native runtime.
    this.stopped = true;
    const errors: unknown[] = [];
    const cleanup = (run: () => void) => { try { run(); } catch (error) { errors.push(error); } };
    if (this.timer) clearInterval(this.timer);
    if (this.deadline) clearTimeout(this.deadline);
    cleanup(() => this.houseSpirit?.stop());
    cleanup(() => this.godConsole?.close());
    for (const p of [...this.work.values()]) {
      // An already-cancelled caller cannot author action outcomes. Disposal
      // below still retires its routes/reservations without changing the world.
      if (!getSimulationTaskSignal()?.aborted) cleanup(() => this.spatial.cancel(p.actor, "session_stopped"));
      if (!getSimulationTaskSignal()?.aborted) cleanup(() => this.finish(p, false, "Session stopped before completion."));
    }
    for (const controller of this.decisions.values()) cleanup(() => controller.abort());
    cleanup(() => this.weatherMechanic?.close());
    cleanup(() => this.developmentInputs?.close());
    cleanup(() => this.townLife?.close());
    cleanup(() => this.spatial.dispose());
    cleanup(() => this.sim.stop());
    for (const p of this.work.values()) releaseSimulationResources(this.sim.world, p.actor, p.action.executionId!);
    this.work.clear();
    for (const remove of this.removers.splice(0)) cleanup(remove);
    this.record("session", errors.length ? "Session stop requested; cleanup errors reported." : "Session stopped; pending physical actions cancelled.");
    const listeners = [...this.stopListeners]; this.stopListeners.clear();
    for (const listener of listeners) cleanup(listener);
    if (errors.length) throw new AggregateError(errors, "Spatial session cleanup failed after attempting all teardown stages");
  }
  snapshot(): SpatialViewState {
    const w = this.sim.world;
    const entities: SpatialViewEntity[] = [...this.visuals].flatMap(([id, visual]) => {
      if (!this.current(id, visual.key) || !hasComponent(w, id, this.actors.includes(id) ? Agent : PhysicalObject)) return [];
      const holder = getDirectContainer(w, id), held = holder !== undefined && this.actors.includes(holder);
      if (holder !== undefined && !held && !hasComponent(w, holder, Room) && !isPublicContainerOpen(w, holder)) return [];
      const body = getSimulationBodyActivity(w, id), p = this.work.get(id);
      return [{ id, key: visual.key, name: Name.value[id], kind: this.actors.includes(id) ? "actor" as const : "prop" as const,
        roomId: getRoomForEntity(w, id)!, position: { x: Position.x[held ? holder! : id], y: held ? 1 : visual.lift ?? 0, z: Position.y[held ? holder! : id] },
        asset: visual.asset, size: visual.size, color: visual.color, rotationY: visual.rotationY,
        ...(this.weatherMechanic?.getWetness(id) !== undefined ? { wetness: this.weatherMechanic.getWetness(id) } : {}),
        ...(this.options.development ? { details: this.developmentDetails(id) } : {}),
        ...(held ? { heldBy: holder } : {}), state: this.actors.includes(id) && getRelationTargets(w, id, SittingOn).length ? "sitting" : ObjectState.current[id] || "",
        ...(body ? { activity: { executionId: p?.action.executionId, action: body.kind === "moving" ? "walking" : body.operation ?? body.kind,
          status: "pending" as const, targetId: body.targetEid, startedAtSimMs: p?.startedAt } }
          : getRelationTargets(w, id, SittingOn).length ? { activity: { action: "sitting", status: "succeeded" as const, targetId: getRelationTargets(w, id, SittingOn)[0] } } : {}) }];
    });
    const actors: SpatialOperatorActor[] = this.actors.filter(id => this.current(id, this.visuals.get(id)?.key ?? "") && hasComponent(w, id, Agent)).map(id => {
      const phone = this.phones.get(id), messages = phone === undefined ? [] : this.messages(phone);
      return { id, key: this.key(id), name: Name.value[id], room: Name.value[getRoomForEntity(w, id)!], thought: this.thoughts.get(id),
        canText: phone !== undefined, needs: { hunger: Needs.hunger[id], energy: Needs.energy[id] },
        ...projectSpatialGoals(w, id),
        action: entities.find(e => e.id === id)?.activity?.action, unread: messages.filter(mid => this.messageComponent.status[mid] === "delivered").length,
        messages: messages.map(mid => ({ id: mid, from: this.messageComponent.from[mid], text: this.messageComponent.text[mid], atSimMs: this.messageComponent.atSimMs[mid], direction: this.messageComponent.direction[mid], status: this.messageComponent.status[mid] })) };
    });
    return { sourceId: this.sourceId, atSimMs: this.atSimMs, tick: w.time.tick, running: this.running, status: this.stopped ? "stopped" : this.started ? "running" : "ready", mode: this.live ? "live" : "manual",
      rooms: structuredClone(this.roomViews), entities, actors, events: structuredClone(this.events.slice(-100)),
      ...(this.blackout ? { scenario: this.blackout.view() } : this.options.world ? { scenario: { id: this.options.scenario === "household" ? "household" as const : "town" as const,
        title: this.options.world.title, phase: this.options.scenario === "household" ? "authored household" : this.options.story === "coastal-mystery" ? "authored coastal mystery" : "authored neighborhood",
        ...(this.options.story === "coastal-mystery" ? { theme: "lovecraft" as const } : {}) } } : {}),
      ...(this.houseSpirit ? { worldControl: this.houseSpirit.view() } : {}),
      ...(this.townLife ? { townLife: this.townLife.view(), weather: this.townLife.weatherView() } : {}),
      ...(this.godConsole ? { development: this.godConsole.view() } : {}),
      cues: this.running ? [...this.sceneCues.values()].filter(cue => cue.expiresAtSimMs > this.atSimMs
        && entities.some(entity => entity.key === cue.entityKey)).map(cue => ({ ...cue })) : [],
      growth: { status: this.options.development ? "available" : this.options.world ? "gated" : this.built ? "built" : "available", summary: this.options.development ? "World development · Ask God · managed scalar mechanics and catalog furnishings · new geometry still needs native adapters" : this.townLife ? "Bounded spirit proposals · God-reviewed catalog furnishings; no operator-forced builds"
        : this.options.world ? "Authored town · autonomous construction gated pending spatial growth validation" : this.blackout ? "Need-driven growth gated: first prove the repair and retained-memory comparison" : this.built ? "Validated café added to ECS" : "One operator-triggered café expansion available" },
      limits: { seconds: this.seconds, ai: this.live, autonomousGrowth: this.options.evolving === true && this.live } };
  }

  /** Host geometry is read from native identities, never supplied by a model. */
  private growthGeometry(): TownGrowthSnapshot {
    const ref = (id: string) => { const eid = this.byId.get(id)!; return { eid, key: this.visuals.get(eid)?.key ?? "" }; };
    const present = (row: { eid: number; key: string }) => this.current(row.eid, row.key);
    return {
      rooms: this.blueprint.rooms.map(room => { const eid = this.byId.get(room.id)!; return { eid,
        key: this.roomViews.find(view => view.id === eid)!.key, bounds: room.bounds, entry: room.entry }; }),
      props: [
        ...this.blueprint.props.map(prop => ({ ...ref(prop.id), collider: SPATIAL_ASSETS[prop.assetId].collider, anchors: prop.interactionAnchors })),
        ...this.blueprint.walls.map(wall => ({ ...ref(wall.id), collider: { halfWidth: wall.halfWidth, halfDepth: wall.halfDepth } })),
        ...[...this.generated].map(([eid, addition]) => ({ eid, key: this.visuals.get(eid)!.key,
          collider: SPATIAL_ASSETS[addition.assetId].collider, anchors: addition.anchors })),
      ].filter(present),
      actors: this.actors.map(eid => ({ eid, key: this.visuals.get(eid)!.key })).filter(present),
    };
  }
}
