import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, GridPosition, LastAction, Name, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { AdjacentTo } from "../../ecs/relations";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeActions } from "../../cognition/cognition-system";
import { buildAvailableActionsContext } from "../../cognition/action-registry";
import { getAgentWorldCapabilities, getAgentWorldCapabilityGeneration, registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { captureCognitiveLocalView } from "../../cognition/cognitive-local-view";
import { createRoomArrivalSystem, createMovementSystem, setMovementTarget } from "../../systems/builtin-systems";
import { clearSimulationTimeline, advanceSimulationTimeline, isSimulationResourceBusy } from "../simulation-timeline";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../committed-events";
import { captureRoomTraversal, connectRoomRoute, disconnectRoomRoute, enableRoomRouteTopology,
  getRoomRouteTargets, getRoomRouteTopologyGeneration, isRoomTraversalCurrent, observeRoomRouteExits, captureRoomRouteEvidence } from "../room-routes";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { withSimulationTask } from "../task-scope";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { validateGeneratedPlan, checkStepPrerequisites } from "../../cognition/planning-system";

const worlds: ReturnType<typeof createArgosWorld>[] = [];
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Route tests are offline")));
afterEach(() => { for (const world of worlds.splice(0)) { clearSimulationTimeline(world); stopCommittedEvents(world); }
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture(optIn = true) {
  const world = createArgosWorld("Room routes"); worlds.push(world); initializePrefabs(world);
  const living = createRoomEntity(world, { name: "Living Room" });
  const hallway = createRoomEntity(world, { name: "Hallway" });
  const street = createRoomEntity(world, { name: "Street" });
  const kitchen = createRoomEntity(world, { name: "Kitchen" });
  const secret = createRoomEntity(world, { name: "Disconnected vault" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "fixture", roomId: living });
  const disable = optIn ? enableRoomRouteTopology(world) : undefined;
  if (optIn) { connectRoomRoute(world, living, hallway); connectRoomRoute(world, hallway, street); connectRoomRoute(world, living, kitchen); }
  const registry = createSystemRegistry();
  const move = (target: string) => executeActions(world, [{ eid: actor, action: { type: "move", target } }], registry);
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, living, hallway, street, kitchen, secret, actor, disable, registry, move, advance };
}

test("author route observations distinguish an unavailable policy from a known empty direct exit set", () => {
  const f=fixture(false);
  addComponent(f.world,f.living,AdjacentTo(f.hallway));
  expect(observeRoomRouteExits(f.world,f.living)).toEqual({status:"not_installed",targets:[],omittedTargets:0});
  enableRoomRouteTopology(f.world,{travelMs:2400});
  expect(observeRoomRouteExits(f.world,f.secret)).toEqual({status:"available",travelMs:2400,targets:[],omittedTargets:0});
  expect(observeRoomRouteExits(f.world,f.actor)).toEqual({status:"invalid_room",targets:[],omittedTargets:0});
  expect(observeRoomRouteExits(f.world,f.living).targets).toEqual([{eid:f.hallway,name:"Hallway"}]);
  stopCommittedEvents(f.world);
  expect(observeRoomRouteExits(f.world,f.living).status).toBe("stale_source");
  startCommittedEvents(f.world);
  expect(observeRoomRouteExits(f.world,f.living).status).toBe("stale_source");
});

test("bounded route facts are copied observations, not a global NPC map or an entity-creating read", () => {
  const f=fixture();
  const before=JSON.stringify(serializeWorld(f.world,f.registry).entities);
  const snapshot=observeRoomRouteExits(f.world,f.living,1);
  expect(snapshot).toEqual({status:"available",travelMs:3000,targets:[{eid:f.hallway,name:"Hallway"}],omittedTargets:1});
  expect(JSON.stringify(serializeWorld(f.world,f.registry).entities)).toBe(before);
  Name.value[f.hallway]="Renamed hall";
  expect(snapshot.targets[0].name).toBe("Hallway");
  expect(observeRoomRouteExits(f.world,f.living,1).targets[0].name).toBe("Renamed hall");
  expect(getRoomRouteTargets(f.world,f.actor)).toEqual([f.hallway,f.kitchen]);
  expect(JSON.stringify(captureCognitiveLocalView(f.world,f.actor))).not.toContain("Disconnected vault");
  for(const limit of [0,-1,1.5,65,NaN])expect(()=>observeRoomRouteExits(f.world,f.living,limit)).toThrow(/limit/);
});

test("route observation keeps raw directionality, missing targets and world ownership aligned with native movement", () => {
  const f=fixture(), other=fixture(false);
  expect(observeRoomRouteExits(other.world,other.living).status).toBe("not_installed");
  disconnectRoomRoute(f.world,f.living,f.hallway,{bidirectional:false});
  expect(observeRoomRouteExits(f.world,f.living).targets.map(t=>t.eid)).toEqual(getRoomRouteTargets(f.world,f.actor));
  expect(observeRoomRouteExits(f.world,f.hallway).targets.map(t=>t.eid)).toContain(f.living);
  removeEntity(f.world,f.kitchen);
  expect(observeRoomRouteExits(f.world,f.living).targets).toEqual([]);
  expect(getRoomRouteTargets(f.world,f.actor)).toEqual([]);
});

test.each(["closed", "reopened", "new_exit", "absent_roundtrip", "raw_closed", "removed_target", "replaced_target", "renamed_target", "renamed_source", "source", "policy", "cancelled", "unrelated", "no_op", "movement", "current"])(
  "captured author exit evidence is local and revocable: %s", async boundary => {
    const f=fixture(), controller=new AbortController();
    const evidence=await withSimulationTask(controller.signal,async()=>captureRoomRouteEvidence(f.world,[f.living],1));
    const current=evidence.bind([f.living]);
    expect(current()).toBe(true); expect(evidence.observations.get(f.living)?.omittedTargets).toBe(1);
    if(boundary==="closed"||boundary==="reopened") {
      disconnectRoomRoute(f.world,f.living,f.hallway);
      if(boundary==="reopened") connectRoomRoute(f.world,f.living,f.hallway);
    }
    if(boundary==="new_exit"||boundary==="absent_roundtrip") {
      connectRoomRoute(f.world,f.living,f.secret);
      if(boundary==="absent_roundtrip") disconnectRoomRoute(f.world,f.living,f.secret);
    }
    if(boundary==="raw_closed") removeComponent(f.world,f.living,AdjacentTo(f.hallway));
    if(boundary==="removed_target") addComponent(f.world,f.hallway,Removed);
    if(boundary==="replaced_target") WorkingMemoryIdentity.id[f.hallway]="a-different-room";
    if(boundary==="renamed_target") Name.value[f.hallway]="Different hall";
    if(boundary==="renamed_source") Name.value[f.living]="Different source";
    if(boundary==="source") {stopCommittedEvents(f.world);startCommittedEvents(f.world);}
    if(boundary==="policy") {f.disable!();enableRoomRouteTopology(f.world);}
    if(boundary==="cancelled") controller.abort();
    if(boundary==="unrelated") connectRoomRoute(f.world,f.street,f.secret);
    if(boundary==="no_op") connectRoomRoute(f.world,f.living,f.hallway);
    if(boundary==="movement") setLocatedIn(f.world,f.actor,f.street);
    expect(current()).toBe(["unrelated","no_op","movement","current"].includes(boundary));
  });

test("native assembly can add only its exact new-room exits without excusing another route change", () => {
  const f=fixture(), evidence=captureRoomRouteEvidence(f.world,[f.living,f.street]);
  const current=evidence.bind([f.living,f.street]);
  const newRoom=createRoomEntity(f.world,{name:"Workshop"}), ref=workingMemoryEntityRef(f.world,newRoom)!;
  const additions=[{from:f.living,to:newRoom,key:ref.key},{from:f.street,to:newRoom,key:ref.key}];
  expect(current(additions)).toBe(true);
  connectRoomRoute(f.world,f.living,newRoom); connectRoomRoute(f.world,f.street,newRoom);
  expect(current()).toBe(false); expect(current(additions)).toBe(true);
  expect(current([{...additions[0],key:"wrong-room"}])).toBe(false);
  expect(current([...additions,additions[0]])).toBe(false);
  expect(current([{from:f.living,to:f.secret,key:workingMemoryEntityRef(f.world,f.secret)!.key}])).toBe(false);
  disconnectRoomRoute(f.world,f.living,f.hallway); connectRoomRoute(f.world,f.living,f.hallway);
  expect(current(additions)).toBe(false);
});

test("new-room additions do not excuse closing and reopening that same newly authored exit", () => {
  const f=fixture(), current=captureRoomRouteEvidence(f.world,[f.living]).bind([f.living]);
  const to=createRoomEntity(f.world,{name:"Workshop"}), ref=workingMemoryEntityRef(f.world,to)!;
  const additions=[{from:f.living,to,key:ref.key}];
  connectRoomRoute(f.world,f.living,to); expect(current(additions)).toBe(true);
  disconnectRoomRoute(f.world,f.living,to); connectRoomRoute(f.world,f.living,to);
  expect(current(additions)).toBe(false);
});

test("author observation copies cannot refresh bindings or grant an unobserved source room", () => {
  const f=fixture(), captured=captureRoomRouteEvidence(f.world,[f.living]);
  const eids=[f.living], current=captured.bind(eids); eids.splice(0);
  captured.observations.clear(); expect(current()).toBe(true);
  expect(()=>captured.bind([f.secret])).toThrow(/observed rooms/);
  disconnectRoomRoute(f.world,f.living,f.kitchen); expect(current()).toBe(false);
});

test("a native-policy absence observation expires on installation instead of claiming legacy routes were known", () => {
  const f=fixture(false); startCommittedEvents(f.world);
  const captured=captureRoomRouteEvidence(f.world,[f.living]);
  expect(captured.observations.get(f.living)?.status).toBe("not_installed");
  const current=captured.bind([f.living]); expect(current()).toBe(true);
  enableRoomRouteTopology(f.world); expect(current()).toBe(false);
});

test("capturing author route evidence never starts or revives a missing committed source", () => {
  const f=fixture(false), captured=captureRoomRouteEvidence(f.world,[f.living]);
  expect(captured.bind([f.living])()).toBe(false);
  expect(getCommittedEvents(f.world).sourceId).toBeNull();
  startCommittedEvents(f.world); expect(captured.bind([f.living])()).toBe(false);
});

test("the same one-step topology supplies menus, local cognition and two timed native traversals", () => {
  const f = fixture();
  expect(getRoomRouteTargets(f.world, f.actor)).toEqual([f.hallway, f.kitchen]);
  expect(buildAvailableActionsContext(f.world, f.actor).availableLocations.map(x => x.name)).toEqual(["Hallway", "Kitchen"]);
  expect(JSON.stringify(captureCognitiveLocalView(f.world, f.actor))).not.toContain("Disconnected vault");
  f.move("Street"); expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  expect(LastAction.success[f.actor]).toBe(false); expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
  f.move("Hallway"); expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(true);
  f.advance(2999); expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  f.advance(1); expect(getRoomForEntity(f.world, f.actor)).toBe(f.hallway);
  expect(getRoomRouteTargets(f.world, f.actor)).toEqual([f.living, f.street]);
  f.move("Street"); f.advance(3000); expect(getRoomForEntity(f.world, f.actor)).toBe(f.street);
  const moves = getCommittedEvents(f.world).events.filter(e => e.action === "move");
  expect(moves.map(e => [e.status, e.atSimMs, e.targetId])).toEqual([
    ["pending", 0, f.hallway], ["succeeded", 3000, f.hallway], ["pending", 3000, f.street], ["succeeded", 6000, f.street] ]);
});

test("a newly connected room appears, disconnection removes it, and labels cannot bypass adjacency or ambiguity", () => {
  const f = fixture(), garden = createRoomEntity(f.world, { name: "Garden" });
  expect(getRoomRouteTargets(f.world, f.actor)).not.toContain(garden);
  connectRoomRoute(f.world, f.living, garden, { bidirectional: false });
  expect(buildAvailableActionsContext(f.world, f.actor).availableLocations.map(x => x.name)).toContain("Garden");
  expect(getRelationTargets(f.world, garden, AdjacentTo)).toEqual([]);
  disconnectRoomRoute(f.world, f.living, garden, { bidirectional: false });
  expect(getRoomRouteTargets(f.world, f.actor)).not.toContain(garden);
  f.move("Disconnected vault"); f.move("Hall");
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  const twin = createRoomEntity(f.world, { name: "Hallway" }); connectRoomRoute(f.world, f.living, twin);
  f.move("Hallway"); expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.living); expect(LastAction.success[f.actor]).toBe(false);
});

test("actual numeric room reuse does not inherit the removed room's incoming edge", () => {
  const f = fixture(); removeEntity(f.world, f.hallway);
  const replacement = createRoomEntity(f.world, { name: "Replacement Hall" });
  expect(replacement).toBe(f.hallway); // Exercise bitecs' real recycled target ID.
  expect(getRelationTargets(f.world, f.living, AdjacentTo)).not.toContain(replacement);
  expect(getRoomRouteTargets(f.world, f.actor)).not.toContain(replacement);
  f.move("Replacement Hall"); expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  connectRoomRoute(f.world, f.living, replacement); expect(getRoomRouteTargets(f.world, f.actor)).toContain(replacement);
});

test("planning validation and deterministic move prerequisites share one-step routes, not global names", () => {
  const f = fixture();
  const plan = (target: string) => ({ goalDescription: "Travel", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Travel", actionType: "move" as const, target }] });
  expect(validateGeneratedPlan(f.world, f.actor, "Travel", plan("Hallway")).ok).toBe(true);
  expect(validateGeneratedPlan(f.world, f.actor, "Travel", plan("Disconnected vault")).ok).toBe(false);
  expect(validateGeneratedPlan(f.world, f.actor, "Travel", plan("Street")).ok).toBe(false);
  expect(checkStepPrerequisites(f.world, f.actor, { id: 0, ...plan("Street").steps[0], status: "pending" } as any)).toBe(false);
  f.move("Hallway"); f.advance(3000);
  expect(checkStepPrerequisites(f.world, f.actor, { id: 0, ...plan("Street").steps[0], status: "pending" } as any)).toBe(true);
});

test.each(["disconnect", "raw edge removal", "helper ABA", "room identity", "room removed", "policy replaced", "package replaced"])(
  "a %s during traversal fails without teleporting or producing success", mutation => {
    const f = fixture(); f.move("Hallway"); f.advance(1000);
    if (mutation === "disconnect") disconnectRoomRoute(f.world, f.living, f.hallway);
    if (mutation === "raw edge removal") removeComponent(f.world, f.living, AdjacentTo(f.hallway));
    if (mutation === "helper ABA") { disconnectRoomRoute(f.world, f.living, f.hallway); connectRoomRoute(f.world, f.living, f.hallway); }
    if (mutation === "room identity") WorkingMemoryIdentity.id[f.hallway] = "replacement-room";
    if (mutation === "room removed") removeEntity(f.world, f.hallway);
    if (mutation === "policy replaced") { f.disable!(); enableRoomRouteTopology(f.world); }
    if (mutation === "package replaced") registerAgentWorldCapabilities(f.world, f.actor, { context: () => "new package", ready: () => true, busy: () => false, execute: () => false });
    f.advance(2000);
    expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
    expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
    expect(LastAction.success[f.actor]).toBe(false);
    expect(getCommittedEvents(f.world).events.filter(e => e.action === "move").map(e => e.status)).toEqual(["pending", "failed"]);
  });

test.each(["source restart", "actor replacement", "actor removed", "stop"])("%s cannot deliver an old traversal to a new owner", mutation => {
  const f = fixture(); f.move("Hallway"); f.advance(1000); const prior = LastAction.timestamp[f.actor];
  if (mutation === "source restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (mutation === "actor replacement") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (mutation === "actor removed") removeEntity(f.world, f.actor);
  if (mutation === "stop") { clearSimulationTimeline(f.world); stopCommittedEvents(f.world); }
  f.advance(2000);
  if (mutation !== "actor removed") expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  expect(LastAction.timestamp[f.actor]).toBe(prior);
  expect(getCommittedEvents(f.world).events.some(e => e.action === "move" && e.status === "succeeded")).toBe(false);
});

test("opaque traversal proof rejects copies, another actor/world, moved owner and clock rewind", () => {
  const f = fixture(), other = fixture(), proof = captureRoomTraversal(f.world, f.actor, "Hallway")!;
  expect(isRoomTraversalCurrent(f.world, f.actor, proof)).toBe(true);
  expect(isRoomTraversalCurrent(f.world, f.actor, { ...proof })).toBe(false);
  expect(isRoomTraversalCurrent(other.world, other.actor, proof)).toBe(false);
  f.advance(1000); const later = captureRoomTraversal(f.world, f.actor, "Hallway")!;
  f.world.time.elapsed = 999; expect(isRoomTraversalCurrent(f.world, f.actor, later)).toBe(false);
  f.world.time.elapsed = 1000; setLocatedIn(f.world, f.actor, f.kitchen);
  expect(isRoomTraversalCurrent(f.world, f.actor, proof)).toBe(false);
});

test("the capability wrapper is stable, owns grid locomotion, and never grants a package bypass", () => {
  const f = fixture(false), execute = jest.fn(() => { setLocatedIn(f.world, f.actor, f.secret); return true; });
  const base = Object.freeze({ context: () => "package context", ready: () => true, busy: () => false, execute, movementTargets: () => [f.secret] });
  const unregister = registerAgentWorldCapabilities(f.world, f.actor, base);
  const oldGeneration = getAgentWorldCapabilityGeneration(f.world, f.actor), disable = enableRoomRouteTopology(f.world);
  connectRoomRoute(f.world, f.living, f.hallway);
  const wrapped = getAgentWorldCapabilities(f.world, f.actor), generation = getAgentWorldCapabilityGeneration(f.world, f.actor);
  expect(wrapped).not.toBe(base); expect(wrapped).toBe(getAgentWorldCapabilities(f.world, f.actor));
  expect(generation).not.toBe(oldGeneration); expect(generation).toBe(getAgentWorldCapabilityGeneration(f.world, f.actor));
  expect(wrapped?.context()).toBe("package context"); expect(wrapped?.ownsMovement).toBe(true);
  f.move("Disconnected vault"); expect(execute).not.toHaveBeenCalled(); expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  addComponent(f.world, f.actor, GridPosition); addComponent(f.world, f.secret, GridPosition);
  GridPosition.x[f.actor] = 100; GridPosition.y[f.actor] = 100; GridPosition.x[f.secret] = 100; GridPosition.y[f.secret] = 100;
  setMovementTarget(f.actor, f.secret);
  const context = { query: (awaitQuery: unknown, components: unknown[]) => components.includes(Agent) ? [f.actor] : [f.secret], emit: () => {} } as any;
  createMovementSystem().compiledFn!(f.world, context); createRoomArrivalSystem().compiledFn!(f.world, context);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  disable(); expect(getAgentWorldCapabilities(f.world, f.actor)).toBe(base);
  expect(getAgentWorldCapabilityGeneration(f.world, f.actor)).toBe(oldGeneration); unregister();
});

test("unopted legacy room movement remains immediate and source stop does not resurrect topology", () => {
  const legacy = fixture(false); legacy.move("Disconnected vault"); expect(getRoomForEntity(legacy.world, legacy.actor)).toBe(legacy.secret);
  expect(getRoomRouteTopologyGeneration(legacy.world)).toBeUndefined();
  const f = fixture(); stopCommittedEvents(f.world);
  expect(getRoomRouteTargets(f.world, f.actor)).toEqual([]); expect(getAgentWorldCapabilities(f.world, f.actor)?.movementTargets?.()).toEqual([]);
  expect(() => enableRoomRouteTopology(f.world)).toThrow(); f.disable!();
  expect(() => enableRoomRouteTopology(f.world)).toThrow(/stopped/); expect(getCommittedEvents(f.world).stopped).toBe(true);
});

test("route relations survive exact endpoint remapping; runtime opt-in and in-flight authority do not persist", () => {
  const f = fixture(), saved = serializeWorld(f.world, f.registry);
  const restored = createArgosWorld("Restored routes"); worlds.push(restored); initializePrefabs(restored);
  for (let index = 0; index < 12; index++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), JSON.parse(JSON.stringify(saved)));
  const living = oldToNewId.get(f.living)!, hallway = oldToNewId.get(f.hallway)!, actor = oldToNewId.get(f.actor)!;
  expect(living).not.toBe(f.living); expect(getRelationTargets(restored, living, AdjacentTo)).toContain(hallway);
  expect(getRoomRouteTopologyGeneration(restored)).toBeUndefined(); enableRoomRouteTopology(restored);
  expect(getRoomRouteTargets(restored, actor)).toEqual([hallway, oldToNewId.get(f.kitchen)!]);
  expect(getRoomRouteTargets(restored, actor)).not.toContain(oldToNewId.get(f.street)!);
  const missing = { ...saved, entities: saved.entities.filter(e => e.id !== f.hallway) };
  const recovered = createArgosWorld("Partial routes"); worlds.push(recovered); initializePrefabs(recovered);
  const r = deserializeWorld(recovered, createSystemRegistry(), missing); enableRoomRouteTopology(recovered);
  expect(getRoomRouteTargets(recovered, r.oldToNewId.get(f.actor)!)).toEqual([r.oldToNewId.get(f.kitchen)!]);
});

test("canceled callers cannot install, edit or issue route authority", async () => {
  const f = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort(new Error("canceled route task"));
    expect(() => connectRoomRoute(f.world, f.living, f.secret)).toThrow(/canceled/);
    expect(() => captureRoomTraversal(f.world, f.actor, "Hallway")).toThrow(/canceled/);
    expect(() => disconnectRoomRoute(f.world, f.living, f.hallway)).toThrow(/canceled/);
  });
  expect(getRoomRouteTargets(f.world, f.actor)).toEqual([f.hallway, f.kitchen]);
});

test("cancellation after issuance revokes that exact walk before another task advances time", async () => {
  const f = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => { f.move("Hallway"); });
  controller.abort(); f.advance(3000);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.living);
  expect(LastAction.success[f.actor]).toBe(false);
  expect(getCommittedEvents(f.world).events.filter(e => e.action === "move").map(e => e.status)).toEqual(["pending", "failed"]);
});
