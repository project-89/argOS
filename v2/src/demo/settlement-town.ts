/** The walkable settlement carried across sessions: what stands, what is owed,
 * what people hold. Minds start each session fresh (memories are not carried);
 * skills and habits carry in their own files; this carries the town itself.
 *
 * Everything is keyed by stable names from the land ("House plot 1", "Birch 2",
 * "Tent 3", resident names), never by entity ids, which differ per session. A
 * new session opens at dawn of the next day. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod/v3";
import type { WovenPatch } from "../spirits/recipe-weaver";

const name = z.string().trim().min(1).max(120);
const count = z.number().int().min(0).max(1_000_000);
export const settlementTownSchema = z.object({
  version: z.literal(1),
  scenario: name,
  savedAt: z.string().max(40),
  /** Days the town has lived through, across sessions. */
  days: count,
  treasury: z.number().finite().min(0),
  prices: z.record(name, z.number().finite().positive().max(10_000)),
  dailyShare: z.number().finite().min(0).max(10_000),
  builtCount: z.record(name, count),
  plots: z.array(z.object({ name, parts: z.array(name).max(16), raised: name.optional() }).strict()).max(64),
  /** Uses left in limited sources, by thing name. */
  sources: z.record(name, count),
  residents: z.record(name, z.object({
    trade: name, coins: z.number().finite().min(0), hunger: z.number().finite().min(0).max(100), home: name.optional(),
    holding: z.array(z.object({ kind: name, wear: count.optional() }).strict()).max(32),
    /** Body conditions still on them (a drink not yet slept off), 0..1 by kind. */
    conditions: z.record(name, z.number().finite().min(0).max(1)).optional(),
  }).strict()),
  stall: z.array(name).max(200),
  /** What the Weaver grew (replayed on load: the land keeps its new recipes and sources). */
  grown: z.array(z.unknown()).max(64),
  /** Opportunities the Surveyor has already taken up (not proposed again). */
  surveyed: z.array(z.string().max(120)).max(200).optional(),
}).strict();
export type SettlementTown = Omit<z.infer<typeof settlementTownSchema>, "grown"> & { grown: WovenPatch[] };

export function readSettlementTown(path: string): SettlementTown | undefined {
  if (!existsSync(path)) return undefined;
  return settlementTownSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as SettlementTown;
}
export function writeSettlementTown(path: string, town: SettlementTown): void {
  writeFileSync(path, JSON.stringify(settlementTownSchema.parse(town), null, 1) + "\n");
}
/** The town file beside a skills file (as habits are). */
export const townPathFor = (skills: string) => skills.replace(/(\.json)?$/, ".town.json");
