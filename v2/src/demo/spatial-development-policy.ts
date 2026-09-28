/** Operator-enabled environmental engineering profile. These limits grant
 * scalar mechanics, not new entities, native affordances or arbitrary ECS access. */
import type { PreparedRelease } from "../engineering/release";

export const SPATIAL_DEVELOPMENT_INPUT = "SpatialDevelopmentInput";
export const SPATIAL_DEVELOPMENT_LIMITS = Object.freeze({
  maxTotalJobs: 8, maxQueue: 2, maxTargets: 256, maxRooms: 32,
  systemsPerRelease: 3, componentsPerRelease: 4, fieldsPerComponent: 8,
  minFrequencyTicks: 10, maxFrequencyTicks: 600, maxAbsoluteValue: 1_000_000,
});
const NAMESPACE = /^SpatialDev[A-Z][A-Za-z0-9_]{0,49}$/;
export function isSpatialDevelopmentComponent(name: string): boolean { return NAMESPACE.test(name); }

/** Runtime values, including attachment defaults, must obey the same physical
 * scalar bounds as authored schemas. No coercion or silent clipping. */
export function permitsSpatialDevelopmentValue(_component: string, _field: string, value: unknown): boolean {
  return typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
    && Math.abs(value) <= SPATIAL_DEVELOPMENT_LIMITS.maxAbsoluteValue;
}

/** Called on the exact independently tested release, again at activation and
 * during restore. Runtime entity/value admission is a separate required fence. */
export function assertSpatialDevelopmentRelease(release: PreparedRelease, allowedReadComponents: ReadonlySet<string> = new Set()): void {
  const { systems } = release.manifest, components = release.components, limits = SPATIAL_DEVELOPMENT_LIMITS;
  const fail = (reason: string): never => { throw Error(`Spatial development release rejected: ${reason}`); };
  if (!systems.length || systems.length > limits.systemsPerRelease
    || !components.length || components.length > limits.componentsPerRelease) fail("bounded system/component count exceeded");
  const declared = new Map(components.map(component => [component.name, component]));
  if (declared.size !== components.length || new Set(systems.map(system => system.name)).size !== systems.length)
    fail("duplicate names");
  for (const component of components) {
    if (!isSpatialDevelopmentComponent(component.name)) fail("components must use the SpatialDev namespace, excluding host inputs");
    const fields = Object.values(component.fields);
    if (!fields.length || fields.length > limits.fieldsPerComponent) fail("bounded component field count exceeded");
    for (const field of fields) {
      if (field.type === "number" ? typeof field.default !== "number" || !Number.isFinite(field.default)
        || Math.abs(field.default) > limits.maxAbsoluteValue : field.type !== "boolean" || typeof field.default !== "boolean")
        fail("only bounded numeric and boolean physical outputs are allowed; generated prose is not a world event");
    }
  }
  for (const system of systems) {
    if (!NAMESPACE.test(system.name) || !Number.isSafeInteger(system.frequency)
      || system.frequency < limits.minFrequencyTicks || system.frequency > limits.maxFrequencyTicks)
      fail("system name or managed logical-tick cadence is outside the development profile");
    if (!system.reads.includes(SPATIAL_DEVELOPMENT_INPUT)
      || system.reads.some(name => name !== SPATIAL_DEVELOPMENT_INPUT && (!isSpatialDevelopmentComponent(name)
        || !declared.has(name) && !allowedReadComponents.has(name))))
      fail("reads must include host development inputs and otherwise only declared or host-admitted development outputs");
    if (new Set(system.reads).size !== system.reads.length || new Set(system.writes).size !== system.writes.length || !system.writes.length)
      fail("duplicate or empty access declaration");
    for (const write of system.writes) {
      const parts = write.split("."), component = declared.get(parts[0]);
      if (parts.length !== 2 || !component || !Object.hasOwn(component.fields, parts[1]) || !system.reads.includes(component.name))
        fail("writes must address fields of declared development components, never native or host input state");
    }
  }
  // A declaration cannot smuggle unused schemas into a later, less constrained
  // writer. Every exported field must have an explicit owner in this release.
  for (const component of components) for (const field of Object.keys(component.fields)) {
    if (systems.filter(system => system.writes.includes(`${component.name}.${field}`)).length !== 1)
      fail("each generated field needs exactly one declared system owner");
  }
}

/** This is authoring guidance, not enforcement and not a request to generate a
 * particular mechanic. The host separately applies the release/runtime policy. */
export const SPATIAL_DEVELOPMENT_BUILDER_CONTEXT = `World development is operator-enabled for bounded public physical mechanics on existing host-projected entities. Build useful environmental detail, such as moisture, growth, decay, or temperature, using SpatialDevelopmentInput plus already admitted SpatialDev outputs. Host inputs are read-only: eligible, ownerKey, sourceKey, kind, asset, roomKey, outdoors, weather, publicState. They contain no private cognition, messages, needs, inventories, or positions. Generated components and systems must be named SpatialDev followed by an uppercase word, with numeric or boolean output fields only. Use simulation elapsed ctx.deltaMs for rates. Managed release frequency is logical ECS ticks, between 10 and 600 (one to sixty simulation seconds in this 10Hz spatial host), not milliseconds. At most 3 systems, 4 components and 8 fields per component per release; numbers must remain finite within +/-1000000. Declare every written component and field, preserve previously committed values, and include meaningful positive, boundary and excluded-target tests. Only eligible host-projected entities may change. Native movement, collision, ownership, state, weather, affordances, thoughts and decisions remain native-authoritative. Generated physical values can be inspected and locally observed; they do not automatically create visible geometry, a usable action, an emotion, a goal or a narrative event. Eight admitted jobs total, including failed builds and repairs, share a queue of two; validation, real committed effects and recovery are distinct outcomes.`;
