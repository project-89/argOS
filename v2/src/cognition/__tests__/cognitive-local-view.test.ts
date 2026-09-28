import { jest } from "@jest/globals";
import { addComponent, hasComponent, removeEntity } from "bitecs";
import { Agent, Appearance, Container, ObjectState, Removed, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { captureCognitiveLocalView, formatCognitiveLocalView, isCognitiveLocalViewCurrent, getLocalDependencyCatalog,
  validateLocalDependencies, areLocalDependenciesCurrent, getLocalDependencyChange } from "../cognitive-local-view";
import { getWorkingMemory } from "../working-memory";
import { registerAgentWorldCapabilities, type AgentWorldCapabilities } from "../world-capabilities";
import { configureCharacterAppearance, registerGarment, tryWearGarment } from "../../rendering/character-appearance";

function fixture() {
  const world = createArgosWorld("Local evidence"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" }), remote = createRoomEntity(world, { name: "Store" });
  const actor = createAgentEntity(world, { name: "Rin", role: "resident", roomId: room, systemPrompt: "Observe." });
  const peer = createAgentEntity(world, { name: "Sol", role: "resident", roomId: room, systemPrompt: "Observe." });
  const panel = createObjectEntity(world, { name: "Signal", roomId: room, portable: false });
  const secret = createObjectEntity(world, { name: "Private display", roomId: remote, portable: false });
  ObjectState.current[panel] = "off"; ObjectState.current[secret] = "secret code 1927";
  let busy = false, phase: "moving" | "holding" | "operating" | undefined;
  let extra: number[] = [], routes = [remote], active = false;
  let target = remote;
  const caps: AgentWorldCapabilities = { context: () => "", ready: () => true, execute: () => false, busy: () => busy,
    visibleEntities: () => extra, movementTargets: () => routes,
    publicActivity: () => busy ? { kind: "moving", targetEid: remote } : undefined,
    observableState: eid => eid === panel ? [{ key: "active", type: "boolean", value: active }] : [] };
  const unregister = registerAgentWorldCapabilities(world, actor, caps);
  registerAgentWorldCapabilities(world, peer, { context: () => "", ready: () => true, execute: () => false, busy: () => !!phase,
    publicActivity: () => phase ? { kind: phase, targetEid: target } : undefined });
  const capture = () => captureCognitiveLocalView(world, actor)!;
  return { world, room, remote, actor, peer, panel, secret, caps, unregister, capture,
    busy: (value: boolean) => { busy = value; }, phase: (value: typeof phase) => { phase = value; },
    target: (value: number) => { target = value; }, active: (value: boolean) => { active = value; },
    extra: (value: number[]) => { extra = value; }, routes: (value: number[]) => { routes = value; } };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Local-view tests never use a model"));
});
test("current sight retains supplied clothing without inventing unspecified color or leaking possessions", () => {
  const f = fixture(); configureCharacterAppearance(f.world, f.peer, { clothing: "plaid shirt, tan trousers" });
  const secret = createObjectEntity(f.world, { name: "Hidden pocket diary", roomId: f.room, portable: true });
  setLocatedIn(f.world, secret, f.peer);
  const view = f.capture(), text = formatCognitiveLocalView(view);
  expect(text).toContain('"clothing":"plaid shirt, tan trousers"');
  expect(text).not.toContain("Hidden pocket diary"); expect(text).not.toContain("suede");
  const key = WorkingMemoryIdentity.id[f.peer], memory = getWorkingMemory(f.world, f.actor);
  Appearance.clothing[f.peer] = "blue raincoat";
  expect(formatCognitiveLocalView(view)).toBe(text); // Detached issued evidence.
  expect(getLocalDependencyChange(f.world, f.actor, view, [`entity:${key}`])).toMatchObject({
    changed: [{ id: `entity:${key}`, fields: ["public_fields"] }],
  });
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [`presence:${key}`])).toBe(true);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(formatCognitiveLocalView(f.capture())).toContain("blue raincoat");
});

test("visible clothing follows actual worn garments, not merely carried ones", () => {
  const f = fixture(); configureCharacterAppearance(f.world, f.peer, { clothing: "plain shirt" });
  const coat = createObjectEntity(f.world, { name: "Green coat", roomId: f.room, portable: true });
  setLocatedIn(f.world, coat, f.peer); registerGarment(f.world, coat, { slot: "outerwear" });
  expect(formatCognitiveLocalView(f.capture())).not.toContain("Green coat");
  expect(tryWearGarment(f.world, f.peer, coat).success).toBe(true);
  expect(formatCognitiveLocalView(f.capture())).toContain('"clothing":"plain shirt; Green coat"');
  setLocatedIn(f.world, coat, f.remote);
  expect(formatCognitiveLocalView(f.capture())).not.toContain("Green coat");
});

test.each(["remote", "blind", "unspecified"])("%s clothing is not filled from character identity", mode => {
  const f = fixture(); configureCharacterAppearance(f.world, f.peer, { clothing: mode === "unspecified" ? "" : "purple robe" });
  if (mode === "remote") setLocatedIn(f.world, f.peer, f.remote);
  if (mode === "blind") Traits.active[f.actor] = '["blind"]';
  expect(formatCognitiveLocalView(f.capture())).not.toContain('"clothing"');
});
test("a retained tombstone invalidates current sight without erasing last-known memory",()=>{
  const f=fixture(),view=f.capture(),memory=getWorkingMemory(f.world,f.actor);
  addComponent(f.world,f.panel,Removed);
  expect(isCognitiveLocalViewCurrent(f.world,f.actor,view)).toBe(false);
  expect(getWorkingMemory(f.world,f.actor)).toEqual(memory);
  expect(formatCognitiveLocalView(f.capture())).not.toContain("Signal");
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

test("optional occupant membership detects an arrival, not unrelated object or posture changes", () => {
  const f = fixture(); setLocatedIn(f.world, f.peer, f.remote);
  const view = f.capture();
  expect(validateLocalDependencies(view, ["occupants"])).toEqual(["occupants"]);
  const memory = getWorkingMemory(f.world, f.actor);
  ObjectState.current[f.panel] = "on";
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, ["occupants"])).toBe(true);
  setLocatedIn(f.world, f.peer, f.room);
  expect(getLocalDependencyChange(f.world, f.actor, view, ["occupants"])).toMatchObject({
    reason: "dependency_changed", changed: [{ id: "occupants", kind: "occupants", fields: ["presence"] }],
  });
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [])).toBe(true);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  const together = f.capture(); f.phase("moving");
  expect(areLocalDependenciesCurrent(f.world, f.actor, together, ["occupants"])).toBe(true);
  setLocatedIn(f.world, f.peer, f.remote);
  expect(areLocalDependenciesCurrent(f.world, f.actor, together, ["occupants"])).toBe(false);
});

test.each(["blind", "truncated"])("%s view cannot certify local occupant membership", mode => {
  const f = fixture();
  if (mode === "blind") Traits.active[f.actor] = JSON.stringify(["blind"]);
  else for (let i = 0; i < 40; i++) createAgentEntity(f.world, { name: `Crowd ${i}`, role: "visitor", roomId: f.room, systemPrompt: "Observe." });
  const view = f.capture();
  expect(getLocalDependencyCatalog(view).some(row => row.id === "occupants")).toBe(false);
  expect(validateLocalDependencies(view, ["occupants"])).toBeUndefined();
});

test("scoped dependencies survive unrelated activity but preserve selected evidence and producer identity", () => {
  const f = fixture(), view = f.capture(), panel = `entity:${WorkingMemoryIdentity.id[f.panel]}`;
  expect(getLocalDependencyCatalog(view).some(row => row.description === "Private display")).toBe(false);
  expect(validateLocalDependencies(view, [panel])).toEqual([panel]);
  const memory = getWorkingMemory(f.world, f.actor);
  f.phase("moving");
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [panel])).toBe(true);
  f.active(true);
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [panel])).toBe(false);
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [])).toBe(true);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  f.caps.observableState = () => [];
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [])).toBe(false);
});

test("empty dependencies cannot bypass identity, modality, room or actor/world issuance", () => {
  const f = fixture(), view = f.capture();
  expect(areLocalDependenciesCurrent(f.world, f.peer, view, [])).toBe(false);
  expect(areLocalDependenciesCurrent(f.world, f.actor, { ...view }, [])).toBe(false);
  setLocatedIn(f.world, f.actor, f.remote);
  expect(areLocalDependenciesCurrent(f.world, f.actor, view, [])).toBe(false);
});

test("capture is a sensing boundary; format/current checks create no receipts or identities", () => {
  const f = fixture(), view = f.capture();
  expect(view).toBeDefined(); expect(hasComponent(f.world, f.panel, WorkingMemoryIdentity)).toBe(true);
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor).receipts.every(r => r.kind === "observation")).toBe(true);
  const memory = getWorkingMemory(f.world, f.actor);
  for (let i = 0; i < 3; i++) { expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true); formatCognitiveLocalView(view); }
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
});

test("new local view disambiguates current membership from retained last-seen locations", () => {
  const f = fixture(); f.capture(); setLocatedIn(f.world, f.peer, f.remote);
  const view = f.capture(), text = formatCognitiveLocalView(view);
  expect(text).not.toContain('"Sol"'); expect(text).toContain("current remote locations");
  expect(getWorkingMemory(f.world, f.actor).facts.some(fact => fact.subjectLabel === "Sol" && fact.predicate === "location" && fact.valueLabel === "Hall")).toBe(true);
  expect(getWorkingMemory(f.world, f.actor).facts.some(fact => fact.subjectLabel === "Sol" && fact.valueLabel === "Store")).toBe(false);
});

test("visible departure invalidates a busy actor's view without fetching the departed person's destination", () => {
  const f = fixture(); f.busy(true); f.phase("moving");
  const view = f.capture(); expect(formatCognitiveLocalView(view)).toContain("moving toward Store");
  const memory = getWorkingMemory(f.world, f.actor);
  setLocatedIn(f.world, f.peer, f.remote);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
});

test.each(["public_state", "typed_field", "activity", "own_body", "own_room", "routes", "persona"])("current local change retires a view: %s", change => {
  const f = fixture(), view = f.capture();
  if (change === "public_state") ObjectState.current[f.panel] = "on";
  if (change === "typed_field") f.active(true);
  if (change === "activity") f.phase("holding");
  if (change === "own_body") f.busy(true);
  if (change === "own_room") setLocatedIn(f.world, f.actor, f.remote);
  if (change === "routes") f.routes([]);
  if (change === "persona") Agent.systemPrompt[f.actor] = "A replacement persona";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
});

test("a changing private mind and remote state do not change current local evidence", () => {
  const f = fixture(), view = f.capture();
  Agent.systemPrompt[f.peer] = "Private changed intention"; ObjectState.current[f.peer] = "thinking about secret plans";
  ObjectState.current[f.secret] = "different remote secret";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
  expect(formatCognitiveLocalView(view)).not.toMatch(/secret|thinking about/);
});

test("switching between same-named public controls retires the view, but unseen target changes do not", () => {
  const f = fixture();
  const twin = createObjectEntity(f.world, { name: "Signal", roomId: f.room, portable: false });
  ObjectState.current[twin] = "off"; f.phase("holding"); f.target(f.panel);
  const first = f.capture(); f.target(twin);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, first)).toBe(false);
  f.target(f.secret); const hidden = f.capture();
  f.target(createObjectEntity(f.world, { name: "Another remote secret", roomId: f.remote, portable: false }));
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, hidden)).toBe(true);
  expect(formatCognitiveLocalView(hidden)).not.toMatch(/Private display|remote secret/);
});

test("reordering the same visible peers is not a new local view", () => {
  const f = fixture();
  const box = createObjectEntity(f.world, { name: "Open cabin", roomId: f.room, portable: false });
  addComponent(f.world, box, Container); ObjectState.current[box] = "open";
  const other = createAgentEntity(f.world, { name: "Arin", role: "resident", roomId: f.room, systemPrompt: "Observe." });
  setLocatedIn(f.world, f.peer, box); setLocatedIn(f.world, other, box);
  f.extra([f.peer, other]); const view = f.capture(); f.extra([other, f.peer]);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
});

test("public field enumeration order is not a change in the observed values", () => {
  const f = fixture(); let reversed = false;
  f.caps.observableState = target => target === f.panel
    ? (reversed ? ["beta", "alpha"] : ["alpha", "beta"]).map(key => ({ key, type: "boolean", value: key === "alpha" })) : [];
  const view = f.capture(); reversed = true;
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
});

test("only public activity, not stale generic idle, describes a visible person", () => {
  const f = fixture(); ObjectState.current[f.peer] = "idle"; f.phase("operating"); f.target(f.panel);
  const text = formatCognitiveLocalView(f.capture());
  expect(text).toContain("operating Signal"); expect(text).not.toContain("idle");
});

test("hidden controls, foreign inventory and opaque containers stay out even if the package advertises them", () => {
  const f = fixture();
  const hidden = createObjectEntity(f.world, { name: "Concealed control", roomId: f.room, portable: false });
  addComponent(f.world, hidden, Traits); Traits.active[hidden] = '["hidden"]';
  const box = createObjectEntity(f.world, { name: "Box", roomId: f.room, portable: false });
  addComponent(f.world, box, Container); ObjectState.current[box] = "closed";
  setLocatedIn(f.world, f.secret, box); f.extra([f.secret, hidden]); f.phase("holding"); f.target(hidden);
  let text = formatCognitiveLocalView(f.capture());
  expect(text).not.toMatch(/Concealed control|Private display|1927/); expect(text).toContain('"activity":"holding"');
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toMatch(/Concealed control|Private display|1927/);
  expect(hasComponent(f.world, hidden, WorkingMemoryIdentity)).toBe(false);
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
  setLocatedIn(f.world, f.secret, f.peer); text = formatCognitiveLocalView(f.capture());
  expect(text).not.toContain("Private display");
});

test("blind observation has only own possessions/body and no other's visual state", () => {
  const f = fixture(); addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]';
  setLocatedIn(f.world, f.panel, f.actor); f.phase("moving");
  const view = f.capture(), text = formatCognitiveLocalView(view);
  expect(text).toContain('"name":"Signal"'); expect(text).not.toContain('"Sol"'); expect(text).not.toContain('"state":"off"');
  expect(text).not.toContain("Observable.active");
  setLocatedIn(f.world, f.peer, f.remote); ObjectState.current[f.panel] = "changed visual display";
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
});

test("a newcomer can invalidate pure admission without receiving an allocated identity", () => {
  const f = fixture(), view = f.capture();
  const newcomer = createObjectEntity(f.world, { name: "New lamp", roomId: f.room, portable: false });
  const memory = getWorkingMemory(f.world, f.actor);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
  expect(hasComponent(f.world, newcomer, WorkingMemoryIdentity)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
});

test.each(["copy", "other_actor", "other_world", "replace_owner", "time_backwards", "same_object_reload", "replace_hook"])("view provenance cannot migrate: %s", mode => {
  const f = fixture(); let view = f.capture();
  if (mode === "copy") view = JSON.parse(JSON.stringify(view));
  if (mode === "other_actor") { expect(isCognitiveLocalViewCurrent(f.world, f.peer, view)).toBe(false); return; }
  if (mode === "other_world") { expect(isCognitiveLocalViewCurrent(createArgosWorld("Other world"), f.actor, view)).toBe(false); return; }
  if (mode === "replace_owner") WorkingMemoryIdentity.id[f.actor] = "entity:new-owner";
  if (mode === "time_backwards") jest.setSystemTime(99_999);
  if (mode === "same_object_reload") { f.unregister(); registerAgentWorldCapabilities(f.world, f.actor, f.caps); }
  if (mode === "replace_hook") { const original = f.caps.visibleEntities!; f.caps.visibleEntities = () => original(); }
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
});

test("same-name object replacement is not the old view", () => {
  const f = fixture(), view = f.capture(); removeEntity(f.world, f.panel);
  createObjectEntity(f.world, { name: "Signal", roomId: f.room, portable: false });
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
});

test("captured fields and formatting stay immutable after the actual world changes", () => {
  const f = fixture(), view = f.capture(), text = formatCognitiveLocalView(view);
  expect(Object.isFrozen(view)).toBe(true); expect(Object.isFrozen(view.entities)).toBe(true);
  expect(Object.isFrozen(view.entities[0].fields)).toBe(true);
  f.active(true); f.phase("moving");
  expect(formatCognitiveLocalView(view)).toBe(text);
});

test.each(["room", "self"])("declared public %s fields are current evidence, not silently omitted", subject => {
  const f = fixture(); let powered = false;
  f.caps.observableState = target => target === (subject === "room" ? f.room : f.actor)
    ? [{ key: "powered", type: "boolean", value: powered }] : [];
  const view = f.capture(); expect(formatCognitiveLocalView(view)).toContain('"Observable.powered":"false"');
  const before = getWorkingMemory(f.world, f.actor); powered = true;
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("room ambient state participates in the view but private actor mental state does not", () => {
  const f = fixture(); ObjectState.current[f.room] = "dry"; const view = f.capture();
  expect(formatCognitiveLocalView(view)).toContain('"state":"dry"');
  ObjectState.current[f.actor] = "private worry"; expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
  ObjectState.current[f.room] = "flooding"; expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
});

test("declared route identity is admitted once at capture, not by comparison", () => {
  const f = fixture(); expect(hasComponent(f.world, f.remote, WorkingMemoryIdentity)).toBe(false);
  const view = f.capture(); expect(hasComponent(f.world, f.remote, WorkingMemoryIdentity)).toBe(true);
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(true);
});

test("a throwing package projection cannot validate a stale view or invent evidence", () => {
  const f = fixture(), view = f.capture();
  f.caps.visibleEntities = () => { throw new Error("Broken generated projection"); };
  const before = getWorkingMemory(f.world, f.actor);
  expect(isCognitiveLocalViewCurrent(f.world, f.actor, view)).toBe(false);
  expect(captureCognitiveLocalView(f.world, f.actor)).toBeUndefined();
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});
