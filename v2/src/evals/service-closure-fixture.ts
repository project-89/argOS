/** Explicit host-owned evaluation setup. No actor policy, model prompt patch,
 * runtime capability or evaluator-written goal-success flag. */
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { registerSystem } from "../ecs/dynamic-systems";
import { Agent, Appearance, Goal, Name, Needs, Room } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../ecs/location";
import { setGoalContract, type GoalSuccessV1 } from "../cognition/goal-contract";
import { getSocialDialogue } from "../cognition/social-memory";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { ObjectManager } from "../world/object-manager";
import { configureCharacterAppearance, tryHoldCarriedItem } from "../rendering/character-appearance";
import { getCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "../cognition/working-memory";

export const SERVICE_MEAL_INTENTION = "Visit a staffed local bakery and eat a serving of fresh food there";
// A new prospective growth fixture, not a rewrite of the historical baseline.
export const GENERATED_SERVICE_MEAL_INTENTION = "Visit a staffed local bakery, ask the baker to serve me two fresh servings, and eat there until comfortably fed";
type ServiceFixtureInput={ actor: number; goal: number; room: number; baker: number; foodIds: number[] };
export function prepareServiceClosure(world: World, registry: SystemRegistry,
  input: ServiceFixtureInput) {
  return bindServiceClosure(world,registry,input,false);
}

/** Eval-only prospective target binding immediately after native construction,
 * before any action involving these new entities. Stock custody is read, never
 * assigned; this does not claim autonomous semantic goal-contract generation. */
export function prepareGeneratedServiceClosure(world:World,registry:SystemRegistry,input:ServiceFixtureInput) {
  return bindServiceClosure(world,registry,input,true);
}
function bindServiceClosure(world:World,registry:SystemRegistry,input:ServiceFixtureInput,generated:boolean) {
  const { actor, goal, room, baker, foodIds } = input;
  const intention = generated ? GENERATED_SERVICE_MEAL_INTENTION : SERVICE_MEAL_INTENTION;
  const exists = (eid: number, component: object) => entityExists(world, eid) && hasComponent(world, eid, component);
  if ((!generated && (world.time.elapsed !== 0 || getCommittedEvents(world).events.length)) || getCommittedEvents(world).stopped
    || !exists(actor, Agent) || !exists(baker, Agent) || actor === baker || !exists(room, Room)
    || !exists(goal, Goal) || !getRelationTargets(world, actor, HasGoal).includes(goal)
    || Goal.status[goal] !== "active" || Goal.description[goal] !== intention
    || getRoomForEntity(world, baker) !== room || getRoomForEntity(world, actor) === room
    || !exists(actor, Needs) || (generated ? Needs.hunger[actor]<70 || Goal.progress[goal]!==0 : Needs.hunger[actor] !== 70)
    || !foodIds.length || foodIds.length > 12 || new Set(foodIds).size !== foodIds.length
    || (!generated && registry.systems.has("GoalEvaluationSystem"))) throw Error("Service setup requires an untouched, explicit pre-choice fixture");
  const objects = new ObjectManager(world);
  if (foodIds.some(id => !entityExists(world, id) || !Name.value[id]?.trim() || !objects.hasTrait(id, "edible")
    || getDirectContainer(world, id) !== (generated?baker:room))) throw Error("Generated stock must be real edible food in the declared initial custody");
  if(generated) {
    const keys=new Set([room,baker,...foodIds].map(id=>workingMemoryEntityRef(world,id)!.key));
    if(getCommittedEvents(world).events.some(event=>keys.has(event.actorKey)||keys.has(event.targetKey!)||keys.has(event.roomKey)))
      throw Error("Generated service contract must be bound before any activity involving the new place");
  }
  const names = [Name.value[room], Name.value[baker], ...foodIds.map(id => Name.value[id])];
  if (names.some(name => !name?.trim()) || new Set(names).size !== names.length) throw Error("Unambiguous generated bindings required");
  const success: GoalSuccessV1 = { type: "all_of", conditions: [
    { type: "in_room", roomName: Name.value[room] },
    { type: "entity_in_room", entityName: Name.value[baker], roomName: Name.value[room] },
    { type: "any_of", conditions: foodIds.map(id => ({ type: "did_interact", targetName: Name.value[id], affordance: "eat" })) },
    { type: "need_at_most", need: "hunger", atMost: 40 },
  ] };
  const before = foodIds.map(id => ({ eid: id, name: Name.value[id], holder: getDirectContainer(world, id) }));
  // This is declared initial state, not a successful NPC pickup/give event.
  if(!generated) {
    if (!hasComponent(world, baker, Appearance)) configureCharacterAppearance(world, baker, {});
    for (const id of foodIds) { setLocatedIn(world, id, baker); tryHoldCarriedItem(world, baker, id); }
  }
  setGoalContract(world, goal, { version: 1, kind: "custom", params: {}, success, description: intention });
  if(!registry.systems.has("GoalEvaluationSystem"))registerSystem(registry, createGoalEvaluationSystem());
  return { actor, goal, room, baker, foodIds, success, stockBefore: before,
    stockAfter: foodIds.map(id => ({ eid: id, name: Name.value[id], holder: getDirectContainer(world, id) })),
    authority: generated ? "Builder-authored initial custody, read-only stock validation; host binds prospective native target names before any new-place activity, never completion or NPC choices"
      : "Host-authored initial custody and prospectively declared goal contract; no NPC action has occurred" };
}

/** Complete turns in BOTH actors' actual heard ledgers, not speech proposals,
 * partial audio tokens, claims of service, or the host's omniscient transcript. */
export function serviceExchangeOccurred(world: World, actor: number, baker: number): boolean {
  const visitor = getSocialDialogue(world, actor), resident = getSocialDialogue(world, baker);
  return visitor.some(turn => turn.own && turn.speaker === Name.value[actor]
    && resident.some(heard => heard.id === turn.id && !heard.own))
    && resident.some(turn => turn.own && turn.speaker === Name.value[baker]
      && visitor.some(heard => heard.id === turn.id && !heard.own));
}
