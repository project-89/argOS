import type { World } from "../ecs/world";

// Requirements survive teardown: stopped exports must not pretend their native
// executable behavior can be reconstructed from component data alone.
const requirements = new WeakMap<World, Set<string>>();
export function requireRuntimePackage(world: World, name: string): void {
  if (typeof name !== "string" || !name.trim() || name.length > 200) throw new Error("Invalid runtime package requirement");
  let names = requirements.get(world);
  if (!names) { names = new Set(); requirements.set(world, names); }
  names.add(name);
}
export function getRuntimePackageRequirements(world: World): string[] {
  return [...requirements.get(world) ?? []].sort();
}
