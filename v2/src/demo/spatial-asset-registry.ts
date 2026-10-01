/** Data-driven spatial catalog. A manifest names a model and binds it to a
 * native object type and verbs the spatial host really executes; the mesh only
 * changes appearance. Registered kinds become buildable by spirits, God and the
 * operator through the same validated growth path as the built-in furniture. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v3";
import { worldSchema } from "../world/schema";
import { installSpatialAsset, SPATIAL_ASSETS, type SpatialAsset, type SpatialPoint } from "./spatial-catalog";

/** Verbs the spatial host executes natively for catalog objects. */
export const SPATIAL_HOST_VERBS = ["examine", "sit", "open", "close", "eat", "take"] as const;
export type SpatialHostVerb = typeof SPATIAL_HOST_VERBS[number];

export interface SpatialAssetEntry {
  id: string; name: string; description: string; tags: readonly string[];
  /** Path under the client's assets/ directory, served at /assets/<model>. */
  model?: string;
  solid: boolean; portable: boolean; growable: boolean;
  anchors?: readonly SpatialPoint[];
  placement: { indoor: boolean; outdoor: boolean };
  license: { source: string; license: string };
  builtin: boolean;
}

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const dimension = z.number().finite().min(.01).max(6);
export const spatialAssetManifestSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)).max(12).default([]),
  model: z.string().max(200).regex(/^[A-Za-z0-9_./-]+\.glb$/).optional(),
  size: z.object({ x: dimension, y: z.number().finite().min(.005).max(5), z: dimension }).strict(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#9a8a74"),
  objectType: z.string().min(1).max(64),
  initialState: z.string().min(1).max(40).optional(),
  affordances: z.array(z.enum(SPATIAL_HOST_VERBS)).min(1).max(6),
  solid: z.boolean().default(true),
  collider: z.object({ halfWidth: z.number().finite().positive().max(3), halfDepth: z.number().finite().positive().max(3) }).strict().optional(),
  anchors: z.array(z.object({ x: z.number().finite().min(-4).max(4), y: z.number().finite().min(-4).max(4) }).strict()).min(1).max(8).optional(),
  portable: z.boolean().default(false),
  placement: z.object({ indoor: z.boolean(), outdoor: z.boolean() }).strict().default({ indoor: true, outdoor: true }),
  growable: z.boolean().default(true),
  license: z.object({ source: z.string().trim().min(1).max(200), license: z.string().trim().min(1).max(60) }).strict(),
}).strict();
export type SpatialAssetManifest = z.input<typeof spatialAssetManifestSchema>;

const entries = new Map<string, SpatialAssetEntry>();
const KENNEY = { source: "Kenney Furniture Kit (kenney.nl)", license: "CC0-1.0" };
const AUTHORED = { source: "Argos-authored primitive", license: "CC0-1.0" };

/** Growable built-ins keep their original native definitions; this adds only
 * what a builder needs to choose them and what the client needs to draw them. */
const BUILTIN: Record<string, Omit<SpatialAssetEntry, "id" | "builtin" | "solid" | "portable">> = {
  chair: { name: "Chair", description: "A plain wooden chair someone can sit on.", tags: ["seat", "indoor", "outdoor"], model: "furniture/chairCushion.glb", growable: true, placement: { indoor: true, outdoor: true }, license: KENNEY },
  table: { name: "Table", description: "A low table to gather around.", tags: ["table", "gathering"], model: "furniture/tableCoffee.glb", growable: true, placement: { indoor: true, outdoor: true }, license: KENNEY },
  plant: { name: "Potted plant", description: "A potted plant.", tags: ["decor", "greenery"], model: "furniture/plantSmall1.glb", growable: true, placement: { indoor: true, outdoor: true }, license: KENNEY },
  lamp: { name: "Floor lamp", description: "A standing lamp for reading by.", tags: ["light", "indoor"], model: "furniture/lampRoundFloor.glb", growable: true, placement: { indoor: true, outdoor: false }, license: KENNEY },
  "supply-box": { name: "Lidded box", description: "A wooden box with a lid, for storing or hiding things.", tags: ["storage", "container"], growable: true, placement: { indoor: true, outdoor: true }, license: AUTHORED },
  sofa: { name: "Sofa", description: "A long upholstered sofa.", tags: ["furniture", "indoor"], model: "furniture/loungeSofa.glb", growable: true, placement: { indoor: true, outdoor: false }, license: KENNEY },
  ...SETTLEMENT_BUILTINS(),
};

/** The walkable settlement's stations and goods: models from scripts/blender/settlement_props.py, built to each
 * kind's native size. Bound to the land's recipes, not offered as furnishings (growable: false). */
function SETTLEMENT_BUILTINS(): Record<string, Omit<SpatialAssetEntry, "id" | "builtin" | "solid" | "portable">> {
  const license = { source: "Argos-authored (Blender procedural, scripts/blender/settlement_props.py)", license: "CC0-1.0" };
  const rows: Array<[string, string, string, string[]]> = [
    ["tent", "Canvas tent", "An A-frame canvas tent pegged to the ground.", ["shelter", "outdoor"]],
    ["market-stall", "Market stall", "A plank counter under a striped awning.", ["trade", "outdoor"]],
    ["campfire", "Campfire", "A ring of stones around a low fire.", ["hearth", "outdoor"]],
    ["stump", "Chopping stump", "A broad stump for splitting wood.", ["work", "outdoor"]],
    ["stone-pile", "Loose stone", "A heap of quarried stone.", ["source", "outdoor"]],
    ["bramble", "Bramble", "A bramble thicket heavy with berries.", ["source", "outdoor"]],
    ["flax-patch", "Flax field", "Ridged rows of flax in flower.", ["source", "outdoor"]],
    ["fishing-water", "Fishing water", "The shallows where the fish run.", ["source", "outdoor"]],
    ["spring", "Well spring", "A stone ring around cold spring water.", ["source", "outdoor"]],
    ["workbench", "Workbench", "A plank bench with a vise and tools.", ["work"]],
    ["drying-rack", "Drying rack", "An A-frame rack for nets and fish.", ["work", "outdoor"]],
    ...([["axe", "Axe"], ["net", "Net"], ["torn-net", "Torn net"], ["log", "Log"], ["firewood", "Firewood"], ["planks", "Planks"],
      ["stone", "Stone"], ["raw-fish", "Fish"], ["cooked-fish", "Cooked fish"], ["berries", "Berries"], ["flax", "Flax"],
      ["twine", "Twine"], ["water", "Water"]] as const).map(([id, name]): [string, string, string, string[]] => [id, name, `${name}, carried by hand.`, ["goods"]]),
  ];
  return Object.fromEntries(rows.map(([id, name, description, tags]) => [id, { name, description, tags: ["settlement", ...tags],
    model: `generated/settlement/${id}.glb`, growable: false, placement: { indoor: tags[0] === "goods" || tags[0] === "work", outdoor: true }, license }]));
}

/** Kenney models the client already ships but the engine never registered. */
const SHIPPED: SpatialAssetManifest[] = [
  { id: "cafe-table", name: "Round cafe table", description: "A small round table for two or three.", tags: ["table", "gathering", "cafe"], model: "furniture/tableRound.glb",
    size: { x: .9, y: .75, z: .9 }, color: "#a47b55", objectType: "table", initialState: "normal", affordances: ["examine"], license: KENNEY },
  { id: "bookcase", name: "Open bookcase", description: "Shelves of books, papers and old records.", tags: ["storage", "books", "indoor"], model: "furniture/bookcaseOpen.glb",
    size: { x: 1, y: 1.8, z: .4 }, color: "#8a6a48", objectType: "object", initialState: "normal", affordances: ["examine"], placement: { indoor: true, outdoor: false }, license: KENNEY },
  { id: "cabinet", name: "Cabinet", description: "A cabinet with doors that open and close.", tags: ["storage", "container", "indoor"], model: "furniture/kitchenCabinet.glb",
    size: { x: .8, y: .9, z: .5 }, color: "#b9a88c", objectType: "chest", initialState: "closed", affordances: ["open", "close", "examine"], placement: { indoor: true, outdoor: false }, license: KENNEY },
  { id: "rug", name: "Rug", description: "A woven rug underfoot.", tags: ["decor", "indoor"], model: "furniture/rugRectangle.glb",
    size: { x: 2, y: .02, z: 1.3 }, color: "#8c5a4a", objectType: "object", initialState: "normal", affordances: ["examine"], solid: false, placement: { indoor: true, outdoor: false }, license: KENNEY },
];

const verbFits: Record<SpatialHostVerb, (traits: readonly string[], manifest: z.infer<typeof spatialAssetManifestSchema>) => boolean> = {
  examine: traits => traits.includes("examinable"),
  sit: traits => traits.includes("sittable"),
  open: traits => traits.includes("openable"),
  close: traits => traits.includes("openable"),
  eat: traits => traits.includes("edible"),
  take: (traits, m) => m.portable || traits.includes("takeable"),
};

/** Validate against native semantics and the host's executors. Throws with a
 * readable reason; nothing is registered unless every check passes. */
export function validateSpatialAssetManifest(input: unknown, options: { assetRoot?: string } = {}) {
  const manifest = spatialAssetManifestSchema.parse(input);
  const type = worldSchema.getObjectType(manifest.objectType);
  if (!type) throw new Error(`${manifest.id}: unknown native object type ${manifest.objectType}`);
  const states = Object.keys(type.states ?? {});
  if (manifest.initialState && !states.includes(manifest.initialState)) throw new Error(`${manifest.id}: ${manifest.objectType} has no state ${manifest.initialState}`);
  const traits: readonly string[] = (type as any).traits ?? [];
  for (const verb of manifest.affordances) if (!verbFits[verb](traits, manifest)) throw new Error(`${manifest.id}: ${manifest.objectType} cannot support ${verb}`);
  if (manifest.portable && (manifest.solid || Math.max(manifest.size.x, manifest.size.y, manifest.size.z) > 1)) throw new Error(`${manifest.id}: portable items are small and never solid`);
  if (manifest.solid && Math.max(manifest.size.x, manifest.size.z) < .08) throw new Error(`${manifest.id}: a solid object needs a real footprint`);
  if (manifest.model && options.assetRoot) {
    const file = resolve(options.assetRoot, normalize(manifest.model));
    const inside = relative(resolve(options.assetRoot), file);
    if (!inside || inside.startsWith("..") || isAbsolute(inside) || extname(file) !== ".glb") throw new Error(`${manifest.id}: model must be a .glb inside the asset directory`);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${manifest.id}: model ${manifest.model} does not exist`);
    const size = statSync(file).size;
    if (size < 20 || size > 16 * 1024 * 1024) throw new Error(`${manifest.id}: model size ${size} bytes is outside 20 B–16 MiB`);
    const magic = readFileSync(file).subarray(0, 4).toString("latin1");
    if (magic !== "glTF") throw new Error(`${manifest.id}: ${manifest.model} is not a binary glTF`);
  }
  return manifest;
}

/** Register one validated kind. Re-registering an identical manifest is a no-op. */
export function registerSpatialAsset(input: unknown, options: { assetRoot?: string } = {}): SpatialAssetEntry {
  ensureBuiltins();
  const m = validateSpatialAssetManifest(input, options);
  const existing = entries.get(m.id);
  if (existing) {
    if (!existing.builtin && existing.model === m.model && JSON.stringify(SPATIAL_ASSETS[m.id]?.size) === JSON.stringify(m.size)) return existing;
    throw new Error(`${m.id}: already registered`);
  }
  if (SPATIAL_ASSETS[m.id]) throw new Error(`${m.id}: conflicts with a built-in spatial kind`);
  const collider = m.solid ? m.collider ?? { halfWidth: +(m.size.x / 2).toFixed(3), halfDepth: +(m.size.z / 2).toFixed(3) } : undefined;
  const asset: SpatialAsset = { id: m.id, size: m.size, color: m.color, objectType: m.objectType,
    initialState: m.initialState ?? Object.keys(worldSchema.getObjectType(m.objectType)!.states ?? {})[0], affordances: m.affordances, ...(collider ? { collider } : {}) };
  installSpatialAsset(asset);
  const entry: SpatialAssetEntry = Object.freeze({ id: m.id, name: m.name, description: m.description, tags: Object.freeze([...m.tags]),
    ...(m.model ? { model: m.model } : {}), solid: m.solid, portable: m.portable, growable: m.growable,
    ...(m.anchors ? { anchors: Object.freeze(m.anchors.map(a => ({ ...a }))) } : {}), placement: { ...m.placement }, license: { ...m.license }, builtin: false });
  entries.set(m.id, entry);
  return entry;
}

let builtinsReady = false;
function ensureBuiltins() {
  if (builtinsReady) return;
  builtinsReady = true;
  for (const [id, meta] of Object.entries(BUILTIN)) {
    const asset = SPATIAL_ASSETS[id]; if (!asset) continue;
    entries.set(id, Object.freeze({ id, ...meta, tags: Object.freeze([...meta.tags]), solid: !!asset.collider, portable: false, builtin: true }));
  }
  for (const manifest of SHIPPED) registerSpatialAsset(manifest);
}

export const DEFAULT_SPATIAL_ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "spatial-client", "assets");

/** Load every catalog/*.json under an asset root. Invalid manifests are skipped
 * and reported, never partially registered. */
export function loadSpatialAssetCatalog(assetRoot = DEFAULT_SPATIAL_ASSET_ROOT): { registered: string[]; rejected: Array<{ file: string; error: string }> } {
  ensureBuiltins();
  const registered: string[] = [], rejected: Array<{ file: string; error: string }> = [];
  const dir = join(assetRoot, "catalog");
  if (!existsSync(dir)) return { registered, rejected };
  for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
    const file = join(dir, name);
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { rejected.push({ file: name, error: `invalid JSON: ${String(error).slice(0, 200)}` }); continue; }
    const manifests = parsed && typeof parsed === "object" && Array.isArray((parsed as any).assets) ? (parsed as any).assets : [parsed];
    for (const manifest of manifests) {
      try { registered.push(registerSpatialAsset(manifest, { assetRoot }).id); }
      catch (error) { rejected.push({ file: `${name}${sep}${(manifest as any)?.id ?? "?"}`, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { registered, rejected };
}

export function getSpatialAssetEntry(id: string): SpatialAssetEntry | undefined { ensureBuiltins(); return entries.get(id); }
export function listSpatialAssetEntries(): SpatialAssetEntry[] { ensureBuiltins(); return [...entries.values()]; }
export function listGrowableSpatialAssets(): SpatialAssetEntry[] { return listSpatialAssetEntries().filter(entry => entry.growable); }
/** Client model path for a registered kind; undefined keeps the primitive fallback. */
export function spatialAssetModel(id: string): string | undefined { return getSpatialAssetEntry(id)?.model; }

/** A compact catalog line for builders' prompts. */
export function describeSpatialCatalog(filter: (entry: SpatialAssetEntry) => boolean = () => true) {
  return listSpatialAssetEntries().filter(entry => entry.growable && filter(entry)).map(entry => {
    const asset = SPATIAL_ASSETS[entry.id];
    return { assetId: entry.id, name: entry.name, what: entry.description || undefined, tags: entry.tags, objectType: asset?.objectType,
      affordances: asset?.affordances, footprint: asset ? `${asset.size.x}×${asset.size.z} m` : undefined,
      where: entry.placement.indoor && entry.placement.outdoor ? "anywhere" : entry.placement.indoor ? "indoors" : "outdoors" };
  });
}
