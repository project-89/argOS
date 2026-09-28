import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { addComponent, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Mind, ObjectState, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { attachToEntity, extendDynamicComponent, getComponent } from "../../ecs/component-registry";
import { setLocatedIn } from "../../ecs/location";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { captureEntities } from "../../engineering/system-sandbox";
import { createSpatialDevelopmentInputs, registerSpatialDevelopmentInputSchema } from "../spatial-development-inputs";
import { SPATIAL_DEVELOPMENT_INPUT } from "../spatial-development-policy";

function fixture() {
  const world = createArgosWorld("Development inputs"); initializePrefabs(world); startCommittedEvents(world);
  const square = createRoomEntity(world, { name: "Square" }), house = createRoomEntity(world, { name: "House" });
  const actor = createAgentEntity(world, { name: "Ada", role: "PRIVATE_ROLE", systemPrompt: "PRIVATE_PAST_DO_NOT_LEAK", roomId: square });
  const plant = createObjectEntity(world, { name: "Plant", description: "A public potted plant" }); setLocatedIn(world, plant, square);
  const outsider = createObjectEntity(world, { name: "UNAPPROVED_TARGET" }); setLocatedIn(world, outsider, square);
  const key = (id: number) => workingMemoryEntityRef(world, id)!.key;
  const targets = [{ id: actor, key: key(actor), kind: "resident" as const, asset: "person" }, { id: plant, key: key(plant), kind: "object" as const, asset: "plant" }];
  const rooms = [{ id: square, key: key(square), outdoor: true }, { id: house, key: key(house), outdoor: false }];
  let running = true, condition: "clear" | "cloudy" | "rain" = "rain";
  const options = { world, targets, rooms, running: () => running, weather: () => [{ id: square, key: rooms[0].key, condition }] };
  const inputs = createSpatialDevelopmentInputs(options);
  return { world, square, house, actor, plant, outsider, targets, rooms, inputs, options,
    setRunning: (value: boolean) => { running = value; }, setWeather: (value: typeof condition) => { condition = value; } };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline development input test")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("projects only exact public physical inputs, detached from authored private cognition", () => {
  const f = fixture(), arousal = Mind.arousal[f.actor];
  try {
    expect(f.inputs.permits(f.actor)).toBe(false);
    f.inputs.syncInputs();
    const rows = f.inputs.snapshotTargets();
    expect(rows).toHaveLength(2); expect(f.inputs.permits(f.outsider)).toBe(false);
    expect(rows[0].input).toMatchObject({ eligible: true, kind: "resident", outdoors: true, weather: "rain", publicState: "" });
    const captured = JSON.stringify(captureEntities(f.world, [SPATIAL_DEVELOPMENT_INPUT]));
    expect(captured).not.toContain("PRIVATE"); expect(captured).not.toContain("UNAPPROVED");
    expect(captured).not.toContain("arousal"); expect(captured).not.toContain("systemPrompt");
    rows[0].input.weather = "clear"; rows[0].key = "replacement";
    expect(f.inputs.snapshotTargets()[0].input.weather).toBe("rain");
    expect(Mind.arousal[f.actor]).toBe(arousal);
    expect(hasComponent(f.world, f.outsider, f.inputs.input)).toBe(false);
  } finally { f.inputs.close(); }
});

test("movement, weather and native exterior state invalidate stale input before the next projection", () => {
  const f = fixture();
  try {
    f.inputs.syncInputs(); setLocatedIn(f.world, f.actor, f.house);
    expect(f.inputs.permits(f.actor)).toBe(false); f.inputs.syncInputs();
    expect(f.inputs.snapshotTargets()[0]).toMatchObject({ roomId: f.house, input: { outdoors: false, weather: "sheltered" } });
    f.setWeather("clear"); expect(f.inputs.permits(f.plant)).toBe(false); f.inputs.syncInputs();
    expect(f.inputs.permits(f.plant)).toBe(true);
    addComponent(f.world, f.plant, ObjectState); ObjectState.current[f.plant] = "wilted";
    expect(f.inputs.permits(f.plant)).toBe(false); f.inputs.syncInputs();
    expect(f.inputs.snapshotTargets()[1].input.publicState).toBe("wilted");
  } finally { f.inputs.close(); }
});

test.each(["source-stop", "source-replaced", "actor-replaced", "actor-removed", "room-replaced", "inactive", "hidden", "unlisted-room"])("%s revokes worker access, including surviving output-only membership", cause => {
  const f = fixture();
  try {
    f.inputs.syncInputs();
    extendDynamicComponent({ name: "SpatialDevMoisture", description: "Confirmed fixture output", properties: { level: "number" } });
    attachToEntity(f.world, f.actor, "SpatialDevMoisture", { level: .4 });
    if (cause === "source-stop") stopCommittedEvents(f.world);
    if (cause === "source-replaced") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (cause === "actor-replaced") WorkingMemoryIdentity.id[f.actor] = "different-resident";
    if (cause === "actor-removed") removeEntity(f.world, f.actor);
    if (cause === "room-replaced") WorkingMemoryIdentity.id[f.square] = "different-place";
    if (cause === "inactive") Agent.active[f.actor] = false;
    if (cause === "hidden") { addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["hidden"]'; }
    if (cause === "unlisted-room") setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Unapproved room" }));
    expect(f.inputs.permits(f.actor)).toBe(false); f.inputs.syncInputs();
    expect(f.inputs.permits(f.actor)).toBe(false); expect(hasComponent(f.world, f.actor, f.inputs.input)).toBe(false);
    if (cause !== "actor-removed") expect(getComponent("SpatialDevMoisture").level[f.actor]).toBe(.4);
    // This predicate must be wired into native worker capture and final writes;
    // asking generated code to check eligible is not a security boundary.
    expect(captureEntities(f.world, ["SpatialDevMoisture"]).filter(row => f.inputs.permits(row.id))).toEqual([]);
  } finally { f.inputs.close(); }
});

test("a stopped adapter cannot reattach input or erase confirmed output when source restarts", () => {
  const f = fixture(); f.inputs.syncInputs();
  f.inputs.close(); f.inputs.close(); f.inputs.syncInputs();
  expect(f.inputs.isCurrent()).toBe(false); expect(f.inputs.snapshotTargets()).toEqual([]);
  expect(hasComponent(f.world, f.actor, f.inputs.input)).toBe(false);
});

test("input ownership conflicts and malformed targets fail before membership changes", () => {
  const f = fixture();
  try {
    f.inputs.close(); registerSpatialDevelopmentInputSchema();
    attachToEntity(f.world, f.plant, SPATIAL_DEVELOPMENT_INPUT, { ownerKey: "other", sourceKey: "other-source" });
    expect(() => createSpatialDevelopmentInputs(f.options)).toThrow(/different entity or source/);
    expect(hasComponent(f.world, f.actor, f.inputs.input)).toBe(false);
    expect(() => createSpatialDevelopmentInputs({ ...f.options, targets: [f.targets[0], f.targets[0]] })).toThrow(/bounded exact/);
    expect(() => createSpatialDevelopmentInputs({ ...f.options, targets: [{ ...f.targets[0], kind: "other" as any }] })).toThrow(/bounded exact/);
  } finally { f.inputs.close(); }
});

test.each(["closed", "locked", "hidden-parent", "invisible-parent", "inventory"])("%s never exposes contained public-state fields to builders", condition => {
  const f = fixture();
  try {
    const box = condition === "inventory" ? f.actor : createObjectEntity(f.world, { name: "Container" });
    if (condition !== "inventory") {
      setLocatedIn(f.world, box, f.square); addComponent(f.world, box, ObjectState);
      ObjectState.current[box] = condition === "locked" ? "locked" : condition === "closed" ? "closed" : "open";
      if (condition.endsWith("parent")) { addComponent(f.world, box, Traits); Traits.active[box] = JSON.stringify([condition === "hidden-parent" ? "hidden" : "INVISIBLE"]); }
    }
    setLocatedIn(f.world, f.plant, box); ObjectState.current[f.plant] = "PRIVATE_CONCEALED_STATE";
    f.inputs.syncInputs(); expect(f.inputs.permits(f.plant)).toBe(false);
    expect(JSON.stringify(captureEntities(f.world, [SPATIAL_DEVELOPMENT_INPUT]))).not.toContain("PRIVATE_CONCEALED_STATE");
  } finally { f.inputs.close(); }
});

test("opening public containment exposes only exterior state and later closing revokes it", () => {
  const f = fixture();
  try {
    const box = createObjectEntity(f.world, { name: "Open supplies box" }); setLocatedIn(f.world, box, f.square);
    addComponent(f.world, box, ObjectState); ObjectState.current[box] = "open";
    setLocatedIn(f.world, f.plant, box); f.inputs.syncInputs(); expect(f.inputs.permits(f.plant)).toBe(true);
    ObjectState.current[box] = "closed"; expect(f.inputs.permits(f.plant)).toBe(false);
    f.inputs.syncInputs(); expect(hasComponent(f.world, f.plant, f.inputs.input)).toBe(false);
  } finally { f.inputs.close(); }
});

test("native furnishing can join the bounded projection without resetting earlier physical values", () => {
  const f = fixture();
  try {
    f.inputs.syncInputs();
    const target = { id: f.outsider, key: workingMemoryEntityRef(f.world, f.outsider)!.key, kind: "object" as const, asset: "chair" };
    expect(f.inputs.addTarget(target)).toBe(true); expect(f.inputs.permits(target.id)).toBe(true);
    expect(f.inputs.addTarget(target)).toBe(false); expect(f.inputs.snapshotTargets()).toHaveLength(3);
    expect(() => f.inputs.addTarget({ ...target, asset: "plant" })).toThrow(/reassigned/);
    f.inputs.close(); expect(() => f.inputs.addTarget(target)).toThrow(/current source/);
  } finally { f.inputs.close(); }
});
