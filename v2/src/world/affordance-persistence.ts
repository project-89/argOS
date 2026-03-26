/**
 * Affordance Persistence - Save/load runtime affordances to JSON
 *
 * Runtime affordances are those registered at runtime by genesis, spirits,
 * or generated systems. Base affordances (from BASE_AFFORDANCES) are not
 * persisted here -- they are baked into the code.
 *
 * File format: `{dir}/affordances.json` containing an array of
 * AffordanceDefinition objects.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  worldSchema,
  type AffordanceDefinition,
} from "./schema";

const AFFORDANCES_FILENAME = "affordances.json";

/**
 * Save all current runtime affordances to `{dir}/affordances.json`.
 * Creates the directory if it does not exist.
 */
export async function saveRuntimeAffordances(dir: string): Promise<void> {
  const runtimeDefs = worldSchema.getRuntimeAffordances();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, AFFORDANCES_FILENAME);
  await fs.writeFile(filePath, JSON.stringify(runtimeDefs, null, 2), "utf-8");
}

/**
 * Load runtime affordances from `{dir}/affordances.json` and register
 * them with the world schema. Existing runtime affordances are NOT cleared
 * first -- loaded definitions are merged in (last-write wins on name
 * collisions).
 *
 * If the file does not exist, this is a no-op (returns empty array).
 *
 * @returns The list of affordance definitions that were loaded and registered.
 */
export async function loadRuntimeAffordances(
  dir: string
): Promise<AffordanceDefinition[]> {
  const filePath = path.join(dir, AFFORDANCES_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const defs: AffordanceDefinition[] = JSON.parse(raw);
  for (const def of defs) {
    worldSchema.defineAffordance(def);
  }
  return defs;
}
