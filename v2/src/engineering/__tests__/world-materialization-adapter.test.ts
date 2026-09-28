import { getAllEntities } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { materializeApprovedEntity, type MaterializedEntitySpec } from "../entity-materialization";
import { describeWorldMaterialization, registerWorldMaterializationAdapter, type NativeMaterialize } from "../world-materialization-adapter";

function fixture() {
  const world = createArgosWorld("Materialization boundary"); initializeRegistry(world); startCommittedEvents(world);
  const room = materializeApprovedEntity(world, { name: "Room", description: "Room", type: "room", components: [] });
  const spec: MaterializedEntitySpec = { name: "Prop", description: "Prop", type: "object", roomEid: room, components: [] };
  return { world, room, spec };
}

test("host adapter decorates the same native constructor exactly once", () => {
  const f = fixture(); let observed: number | undefined;
  registerWorldMaterializationAdapter(f.world, { materialize(spec, create) { observed = create(spec); return observed; } });
  expect(materializeApprovedEntity(f.world, f.spec)).toBe(observed);
  expect(getAllEntities(f.world)).toHaveLength(2);
});

test("registration is unique, disposal stays restrictive, captured native callback expires", () => {
  const f = fixture(); let retained: NativeMaterialize | undefined;
  const remove = registerWorldMaterializationAdapter(f.world, { materialize(spec, create) { retained = create; return create(spec); } });
  expect(() => registerWorldMaterializationAdapter(f.world, { materialize: (_s, create) => create(f.spec) })).toThrow(/already/);
  materializeApprovedEntity(f.world, f.spec);
  expect(() => retained!(f.spec)).toThrow(/single-use/);
  remove();
  expect(() => materializeApprovedEntity(f.world, f.spec)).toThrow(/no longer current/);
  expect(getAllEntities(f.world)).toHaveLength(2);
});

test.each(["stopped", "restarted"])("source %s denies old adapter authority", state => {
  const f = fixture(); registerWorldMaterializationAdapter(f.world, { materialize: (spec, create) => create(spec) });
  stopCommittedEvents(f.world); if (state === "restarted") startCommittedEvents(f.world);
  expect(() => materializeApprovedEntity(f.world, f.spec)).toThrow(/no longer current/);
  expect(getAllEntities(f.world)).toHaveLength(1);
});

test.each(["fabricated", "duplicate", "reentrant"])("%s creation cannot bypass the one native allocation contract", mode => {
  const f = fixture();
  registerWorldMaterializationAdapter(f.world, { materialize(spec, create) {
    if (mode === "fabricated") return 999;
    if (mode === "reentrant") return materializeApprovedEntity(f.world, spec);
    create(spec); return create(spec);
  } });
  expect(() => materializeApprovedEntity(f.world, f.spec)).toThrow();
  expect(getAllEntities(f.world)).toHaveLength(mode === "duplicate" ? 2 : 1);
});

test("derived definitions still undergo native component/type preflight", () => {
  const f = fixture(); registerWorldMaterializationAdapter(f.world, { materialize: (spec, create) => create({ ...spec, components: [{ name: "Imaginary", values: {} }] }) });
  expect(() => materializeApprovedEntity(f.world, f.spec)).toThrow(/Unknown component/);
  expect(getAllEntities(f.world)).toHaveLength(1);
});

test("description is read-only, source-scoped and unavailable after disposal or replacement", () => {
  const f = fixture(), before = [...getAllEntities(f.world)];
  expect(describeWorldMaterialization(f.world)).toBe("");
  const remove = registerWorldMaterializationAdapter(f.world, { describe: () => "Public catalog", materialize: (spec, create) => create(spec) });
  expect(describeWorldMaterialization(f.world)).toBe("Public catalog"); expect([...getAllEntities(f.world)]).toEqual(before);
  remove(); expect(describeWorldMaterialization(f.world)).toBe("");
  registerWorldMaterializationAdapter(f.world, { describe: () => { stopCommittedEvents(f.world); return "expired"; }, materialize: (spec, create) => create(spec) });
  expect(describeWorldMaterialization(f.world)).toBe("");
});
