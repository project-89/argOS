/** A small native event catalogue, not a narrative controller. The Narrator may
 * damage an approved existing tree; residents still choose whether to respond.
 * Only loose branches within the tree's existing footprint change. No new
 * obstacle, actor, inventory, injury or completed resident action is invented. */
import { hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Description, Name, ObjectState, PhysicalObject, Position, Room, WorkingMemoryIdentity } from "../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { filterPerceivableStimuli } from "../cognition/sensory-capabilities";
import { queueGuardedStimulus } from "../cognition/stimulus-queue";
import { isAgentVisualEntity } from "../cognition/world-capabilities";

export type SpatialStoryCommand = Readonly<{ operation: "tree_damage"; tree: string }>;
export type SpatialStoryReceipt = { status: "applied" | "unchanged" | "rejected"; detail: string;
  operation: "tree_damage" | "tree_cleared"; treeId: number; roomId: number; atSimMs: number; revision?: number; actorKey?: string;
  origin?: "narrator" | "operator" };
export type SpatialStoryOperation = Readonly<{ actor: number; actorKey: string; target: number; targetKey: string;
  sourceId: string; verb: "clear_branches"; revision: number; startedAtSimMs: number }>;
export type SpatialStoryTree = Readonly<{ id: number; key: string; roomId: number; roomKey: string }>;
const MAX_EVENTS = 2, COOLDOWN_MS = 90_000, CLEAR_DURATION_MS = 6_000;
const owners = new WeakMap<World, object>();
type Phase = "normal" | "branch_damage" | "pruned";

export function createSpatialStoryEvents(options: { world: World; trees: readonly SpatialStoryTree[];
  running(): boolean; record(receipt: SpatialStoryReceipt): void }) {
  assertSimulationTaskActive();
  const { world } = options, sourceId = getCommittedEvents(world).sourceId, createdAt = readSimulationTime(world);
  const trees = options.trees.map(row => ({ ...row, name: Name.value[row.id], x: Position.x[row.id], y: Position.y[row.id] }));
  function key(id: number) { return isEntityPresent(world, id) && hasComponent(world, id, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[id] : undefined; }
  const bound = (tree: typeof trees[number]) => key(tree.id) === tree.key && key(tree.roomId) === tree.roomKey
    && hasComponent(world, tree.roomId, Room) && hasComponent(world, tree.id, PhysicalObject)
    && hasComponent(world, tree.id, ObjectState) && hasComponent(world, tree.id, Description) && hasComponent(world, tree.id, Position)
    && hasComponent(world, tree.id, Name) && Name.value[tree.id] === tree.name && getRoomForEntity(world, tree.id) === tree.roomId
    && PhysicalObject.portable[tree.id] === false && Number.isFinite(tree.x) && Number.isFinite(tree.y)
    && Position.x[tree.id] === tree.x && Position.y[tree.id] === tree.y;
  if (!sourceId || getCommittedEvents(world).stopped || owners.has(world) || !Number.isFinite(createdAt) || createdAt < 0
    || !trees.length || trees.length > 32 || new Set(trees.map(t => t.id)).size !== trees.length
    || new Set(trees.map(t => t.name)).size !== trees.length || trees.some(t => !t.key || !t.roomKey || !t.name || !bound(t)))
    throw Error("Story events require distinct, exact current approved immovable trees and one native owner.");
  extendDynamicComponent({ name: "SpatialStoryTree", description: "Native branch damage, completed clearing and persistent event budget", properties: {
    ownerKey: "string", roomKey: "string", phase: "string", revision: "number", eventCount: "number", changedAtSimMs: "number", damagedAtSimMs: "number", baseDescription: "string",
  } });
  const component = getComponent("SpatialStoryTree")!;
  const description = (id: number, phase: Phase) => phase === "normal" ? component.baseDescription[id]
    : phase === "branch_damage" ? "The tree remains standing. A brittle branch has snapped and slumped against its trunk, with loose twigs at its base. The loose branches can be cleared by hand. The path beside it remains open."
    : "The tree remains standing with a visibly shortened, pruned crown. Its loose broken branches have been cleared; the path beside it is open.";
  const stateCurrent = (tree: typeof trees[number]) => bound(tree) && hasComponent(world, tree.id, component)
    && component.ownerKey[tree.id] === tree.key && component.roomKey[tree.id] === tree.roomKey
    && ["normal", "branch_damage", "pruned"].includes(component.phase[tree.id])
    && ObjectState.current[tree.id] === component.phase[tree.id]
    && typeof component.baseDescription[tree.id] === "string" && Description.value[tree.id] === description(tree.id, component.phase[tree.id])
    && component.eventCount[tree.id] === (component.phase[tree.id] === "normal" ? 0 : 1)
    && component.revision[tree.id] === (component.phase[tree.id] === "normal" ? 0 : component.phase[tree.id] === "branch_damage" ? 1 : 2)
    && Number.isFinite(component.changedAtSimMs[tree.id]) && Number.isFinite(component.damagedAtSimMs[tree.id])
    && (component.phase[tree.id] === "normal" ? component.changedAtSimMs[tree.id] === -1 && component.damagedAtSimMs[tree.id] === -1
      : component.damagedAtSimMs[tree.id] >= 0 && component.changedAtSimMs[tree.id] >= component.damagedAtSimMs[tree.id]);
  // Validate every row before attaching anything. Reload must preserve damage,
  // completed repair, event budget and cooldown; a corrupt row cannot reset them.
  for (const tree of trees) {
    if (hasComponent(world, tree.id, component) ? !stateCurrent(tree) : ObjectState.current[tree.id] !== "normal")
      throw Error("Existing story-tree state is invalid or replaced; it cannot be reset.");
  }
  for (const tree of trees) if (!hasComponent(world, tree.id, component)) attachToEntity(world, tree.id, "SpatialStoryTree", {
    ownerKey: tree.key, roomKey: tree.roomKey, phase: "normal", revision: 0, eventCount: 0, changedAtSimMs: -1, damagedAtSimMs: -1, baseDescription: Description.value[tree.id],
  });
  let closed = false;
  const owner = {}; owners.set(world, owner);
  const current = () => !closed && owners.get(world) === owner && options.running() && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === sourceId && Number.isFinite(readSimulationTime(world)) && readSimulationTime(world) >= createdAt
    && trees.every(t => stateCurrent(t) && component.changedAtSimMs[t.id] <= readSimulationTime(world));
  const count = () => trees.reduce((sum, t) => sum + component.eventCount[t.id], 0);
  const lastDamage = () => Math.max(...trees.map(t => component.damagedAtSimMs[t.id]));
  const stamp = () => JSON.stringify(trees.map(t => [t.id, t.key, t.name, t.roomId, t.roomKey, Position.x[t.id], Position.y[t.id],
    Description.value[t.id], ObjectState.current[t.id], component.phase[t.id], component.revision[t.id], component.eventCount[t.id], component.changedAtSimMs[t.id], component.damagedAtSimMs[t.id]]));
  function close() { if (closed) return; closed = true; if (owners.get(world) === owner) owners.delete(world); removeStop(); }
  const removeStop = subscribeCommittedSourceStop(world, close);
  function record(receipt: SpatialStoryReceipt) {
    try { options.record(receipt); } catch { receipt.detail += " Native state committed; receipt recording failed."; }
    return receipt;
  }
  function signal(tree: typeof trees[number], clearing: boolean): boolean {
    const revision = component.revision[tree.id]; let failed = false;
    const signals = [{ type: "environmental", modality: "visual" as const, source: "local environment", intensity: .85,
      content: clearing ? `The loose broken branches against ${tree.name} have been cleared. Its crown remains visibly pruned.`
        : `A brittle branch on ${tree.name} snaps and slumps against its trunk. The tree remains standing, with loose branches that can be cleared by hand. The path remains open.` },
    ...(!clearing ? [{ type: "sound", modality: "auditory" as const, source: "local environment", intensity: .85,
      content: "You hear a sharp wooden crack and a rustle of falling twigs nearby." }] : [])];
    for (const actor of query(world, [Agent])) {
      if (!Agent.active[actor] || getRoomForEntity(world, actor) !== tree.roomId) continue;
      for (const row of filterPerceivableStimuli(world, actor, signals).filter(row => row.modality !== "visual" || isAgentVisualEntity(world, actor, tree.id))) {
        try { if (!queueGuardedStimulus(world, { targetEid: actor, ...row }, () => current() && component.revision[tree.id] === revision
          && getRoomForEntity(world, actor) === tree.roomId && (row.modality !== "visual" || isAgentVisualEntity(world, actor, tree.id)))) failed = true; }
        catch { failed = true; }
      }
    }
    return failed;
  }
  function damage(treeName: string, roomId: number, expectedStamp?: string, origin: "narrator" | "operator" = "narrator"): SpatialStoryReceipt {
    assertSimulationTaskActive();
    const tree = trees.find(t => t.name === treeName), atSimMs = readSimulationTime(world);
    const receipt = (status: SpatialStoryReceipt["status"], detail: string): SpatialStoryReceipt => ({ status, detail, operation: "tree_damage", treeId: tree?.id ?? -1, roomId, atSimMs, origin });
    if (!current() || !tree || tree.roomId !== roomId || expectedStamp !== undefined && stamp() !== expectedStamp)
      return receipt("rejected", "Tree, room, state or source changed; nothing applied.");
    if (component.phase[tree.id] !== "normal") return receipt("unchanged", "This tree has already been damaged in this bounded session; its prior consequence remains.");
    if (count() >= MAX_EVENTS) return receipt("rejected", "The two-event story budget is exhausted.");
    if (lastDamage() >= 0 && atSimMs - lastDamage() < COOLDOWN_MS) return receipt("rejected", "Tree events require ninety simulated seconds between them.");
    component.phase[tree.id] = "branch_damage"; component.revision[tree.id] = 1; component.eventCount[tree.id] = 1;
    component.changedAtSimMs[tree.id] = atSimMs; component.damagedAtSimMs[tree.id] = atSimMs;
    ObjectState.current[tree.id] = "branch_damage"; Description.value[tree.id] = description(tree.id, "branch_damage");
    const failed = signal(tree, false);
    return record({ ...receipt("applied", `A branch snapped against ${tree.name}; it can be cleared. The standing trunk and walkable routes are unchanged.${failed ? " Some observation delivery failed." : ""}`), revision: 1 });
  }
  function capture() {
    const captured = stamp(), signal = getSimulationTaskSignal();
    const leaseCurrent = () => !signal?.aborted && current() && stamp() === captured;
    return { description: `Native story event: content exactly {"operation":"tree_damage","tree":"exact tree name"}. Target that tree's listed outdoor room and cite issued place evidence. A branch snaps against the standing trunk, creating a real clear_branches action; no injury or path blockage. At most two events and ninety simulation seconds apart. Each tree can be damaged only once. Remaining: ${Math.max(0, MAX_EVENTS - count())}. Earliest next event: ${lastDamage() < 0 ? createdAt : lastDamage() + COOLDOWN_MS}ms. Eligible trees: ${JSON.stringify(trees.filter(t => component.phase[t.id] === "normal").map(t => ({ name: t.name, room: Name.value[t.roomId] })))}.`,
      current: leaseCurrent,
      execute: (command: SpatialStoryCommand, roomId: number) => leaseCurrent() && command?.operation === "tree_damage" && typeof command.tree === "string"
        && Object.keys(command).length === 2 ? damage(command.tree, roomId, captured)
        : { status: "rejected" as const, detail: "Unknown native story operation." } };
  }
  const issued = new WeakMap<SpatialStoryOperation, AbortSignal | undefined>();
  function validate(operation: SpatialStoryOperation): string | undefined {
    if (!operation || !issued.has(operation) || issued.get(operation)?.aborted || !current() || operation.sourceId !== sourceId)
      return "The story operation or its world is expired.";
    const tree = trees.find(t => t.id === operation.target);
    if (!tree || operation.targetKey !== tree.key || component.revision[tree.id] !== operation.revision || component.phase[tree.id] !== "branch_damage")
      return "The admitted tree no longer has those loose branches.";
    if (key(operation.actor) !== operation.actorKey || !hasComponent(world, operation.actor, Agent) || !Agent.active[operation.actor])
      return "The admitted resident is no longer active.";
  }
  function verbs(target: number) { return current() && trees.some(t => t.id === target) && component.phase[target] === "branch_damage" ? ["clear_branches"] : []; }
  function prepare(actor: number, target: number, verb: string): { ok: true; operation: SpatialStoryOperation; durationMs: number } | { ok: false; reason: string } {
    assertSimulationTaskActive();
    const actorKey = key(actor), tree = trees.find(t => t.id === target);
    if (!current() || !tree || !actorKey || !verbs(target).includes(verb) || !isAgentVisualEntity(world, actor, target))
      return { ok: false, reason: "There is no visible loose-branch work available on this tree." };
    const operation: SpatialStoryOperation = Object.freeze({ actor, actorKey, target, targetKey: tree.key, sourceId: sourceId!,
      verb: "clear_branches", revision: component.revision[target], startedAtSimMs: readSimulationTime(world) });
    issued.set(operation, getSimulationTaskSignal());
    const reason = validate(operation);
    if (reason) { issued.delete(operation); return { ok: false, reason }; }
    return { ok: true, operation, durationMs: CLEAR_DURATION_MS };
  }
  function commit(operation: SpatialStoryOperation): { success: boolean; detail: string } {
    assertSimulationTaskActive();
    const reason = validate(operation); issued.delete(operation);
    if (reason) return { success: false, detail: reason };
    const tree = trees.find(t => t.id === operation.target)!;
    if (readSimulationTime(world) - operation.startedAtSimMs < CLEAR_DURATION_MS || getRoomForEntity(world, operation.actor) !== tree.roomId
      || !hasComponent(world, operation.actor, Position) || !Number.isFinite(Position.x[operation.actor]) || !Number.isFinite(Position.y[operation.actor])
      || Math.hypot(Position.x[operation.actor] - tree.x, Position.y[operation.actor] - tree.y) > 2.2)
      return { success: false, detail: "Clearing branches requires physical approach and six seconds of native action time." };
    component.phase[tree.id] = "pruned"; component.revision[tree.id] = 2; component.changedAtSimMs[tree.id] = readSimulationTime(world);
    ObjectState.current[tree.id] = "pruned"; Description.value[tree.id] = description(tree.id, "pruned");
    const failed = signal(tree, true);
    const receipt = record({ status: "applied", operation: "tree_cleared", treeId: tree.id, roomId: tree.roomId,
      atSimMs: readSimulationTime(world), revision: 2, actorKey: operation.actorKey,
      detail: `You cleared the loose broken branches from ${tree.name}. Its crown remains pruned; nothing regrew.${failed ? " Some observation delivery failed." : ""}` });
    return { success: true, detail: receipt.detail };
  }
  function localContext(actor: number): string | undefined {
    if (!current() || !key(actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]) return;
    const rows = trees.filter(t => component.phase[t.id] !== "normal" && isAgentVisualEntity(world, actor, t.id));
    return rows.length ? `Current visible tree conditions: ${rows.map(t => `${t.name}: ${description(t.id, component.phase[t.id])}`).join(" ")}` : undefined;
  }
  function view() {
    const valid = trees.every(stateCurrent), used = valid ? count() : MAX_EVENTS;
    return { available: current() && used < MAX_EVENTS, events: used, remainingEvents: Math.max(0, MAX_EVENTS - used),
      nextEventAtSimMs: lastDamage() < 0 ? createdAt : lastDamage() + COOLDOWN_MS,
      trees: trees.filter(stateCurrent).map(t => ({ id: t.id, key: t.key, roomId: t.roomId, name: t.name,
        phase: component.phase[t.id] as Phase, revision: component.revision[t.id] as number })) };
  }
  return { component, capture, damage, verbs, prepare, validate, commit, localContext, view, close };
}
