/** The asset workshop daemon: when the world grows a kind of thing nobody has
 * drawn yet (a Weaver's new berry source, a new station), a model is made for it.
 *
 * 1. A code model writes `def build(p): ...` against the restricted Blender kit
 *    (box, cylinder, lathe, tube, ring, sheet, material) — never free Python.
 * 2. scripts/blender/workshop_build.py checks that source against a syntax
 *    allowlist before anything runs, builds it with a parts cap and a time limit,
 *    and admits it only within the triangle budget and the thing's proportions.
 *    A refusal goes back to the model once.
 * 3. The model is registered in the asset catalog (its own validation: a real
 *    GLB inside the asset root) and saved with its manifest and source, so it
 *    loads in every later session.
 *
 * A model only changes how a kind looks; behaviour stays with the world. */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { codeModel } from "../llm/config";
import { DEFAULT_SPATIAL_ASSET_ROOT, getSpatialAssetEntry, registerSpatialAsset, type SpatialAssetEntry, type SpatialAssetManifest } from "./spatial-asset-registry";

export type AssetRequest = { id: string; name: string; description: string; size: { x: number; y: number; z: number }; color: string; portable?: boolean; tags?: string[] };
export type WorkshopResult = { ok: true; tris: number; width: number; depth: number; height: number } | { ok: false; error: string };
export type WorkshopGenerator = (input: { system: string; prompt: string }) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
export type WorkshopStats = { requested: number; built: number; refused: number; failed: number; calls: number; tokensIn: number; tokensOut: number };

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "blender", "workshop_build.py");
const ID = /^[a-z][a-z0-9-]{0,63}$/;

/** Where Blender is, if it is installed (ARGOS_BLENDER, then PATH, then the macOS app). */
export function findBlender(env: Record<string, string | undefined> = process.env): string | undefined {
  const candidates = [env.ARGOS_BLENDER, ...(env.PATH ?? "").split(":").map(dir => join(dir, "blender")), "/Applications/Blender.app/Contents/MacOS/Blender"];
  return candidates.find(path => !!path && existsSync(path));
}

export const WORKSHOP_SYSTEM = `You write small low-poly 3D models for a game, as Python code against a restricted kit. Output only one Python code block.

Write \`def build(p):\` (and, if useful, small helper functions). No imports, no other statements. You may use: math (pi, sin, cos, tan, atan2, sqrt, radians, hypot, floor, ceil), jitter(seed, i, amount) for deterministic irregularity, range, len, abs, min, max, enumerate, zip, round, float, int, list, tuple, sum, and these kit methods on p:
- p.material(hex_colour, roughness=0.9, metallic=0.0, emission=None, double_sided=False) -> material ('#rrggbb'; emission a hex colour to glow)
- p.box((sx, sy, sz), (x, y, z), mat, rot=(rx, ry, rz), bevel=0.0)       axis box centred at (x, y, z)
- p.box_between((x0, y0, z0), (x1, y1, z1), mat, bevel=0.0)
- p.cylinder(radius, depth, (x, y, z), mat, segments=8, rot=(0, 0, 0), radius_top=None)   along Z; radius_top=0 makes a cone
- p.lathe([(radius, z), ...], mat, segments=12, at=(x, y, z), rot=(0, 0, 0))   solid of revolution about Z
- p.tube([(x, y, z), ...], radius, mat, sides=6)   rope, branch, bent bar
- p.ring(radius, thickness, (x, y, z), mat, segments=10, sides=5, rot=(0, 0, 0), arc=2*pi)
- p.sheet(fn, nu, nv, mat)   thin surface; fn(u, v) -> (x, y, z), u, v in [0, 1] (cloth, nets, leaves; give it double_sided=True)
Conventions: metres, Z is up, the base sits on z = 0, centred on x = y = 0; the front faces -Y. Build it close to the size you are given (width along X, depth along Y, height along Z). Flat colours, a few dozen parts, under 2000 triangles. Make it recognisable at a glance: its silhouette and colours matter more than detail.

Example (a bramble thicket, 1.6 wide x 1.6 deep x 1.1 tall):
\`\`\`python
def blob(p, r, at, mat, segments=6, squash=1.0):
    profile = [(0.0, -r * squash)] + [(r * math.sin(math.pi * k / 4), -r * squash * math.cos(math.pi * k / 4)) for k in range(1, 4)] + [(0.0, r * squash)]
    return p.lathe(profile, mat, segments=segments, at=at)

def build(p):
    leaf, dark, berry = p.material('#4f7a3f'), p.material('#3d6331'), p.material('#7b2f4f')
    for k, (x, y, z, r) in enumerate([(0, 0, 0.55, 0.45), (0.4, 0.2, 0.4, 0.35), (-0.4, 0.15, 0.38, 0.36), (0.1, -0.42, 0.36, 0.34)]):
        blob(p, r, (x, y, z), leaf if k % 2 else dark, segments=7, squash=0.85)
    for k in range(12):
        a = 2 * math.pi * k / 12
        blob(p, 0.045, (0.6 * math.cos(a), 0.6 * math.sin(a), 0.35 + 0.3 * abs(jitter(16, k, 1))), berry, segments=5)
\`\`\``;

export function workshopPrompt(request: AssetRequest, refusal?: string): string {
  return `Make: ${request.name} — ${request.description}
Size: ${request.size.x} m wide (X) x ${request.size.z} m deep (Y) x ${request.size.y} m tall (Z). Choose colours that suit what it is and what it is made of (iron is grey, coals glow, wood is brown).${request.portable ? " It is a small thing carried by hand, shown lying down." : ""}${refusal ? `\nYour last version was refused: ${refusal}. Fix that.` : ""}`;
}

/** The first Python code block (or the whole answer if it is bare code). */
export function extractPython(text: string): string {
  const fenced = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim() + "\n";
}

export class AssetWorkshop {
  readonly stats: WorkshopStats = { requested: 0, built: 0, refused: 0, failed: 0, calls: 0, tokensIn: 0, tokensOut: 0 };
  private readonly inFlight = new Map<string, Promise<{ ok: true; entry: SpatialAssetEntry } | { ok: false; reason: string }>>();
  private readonly assetRoot: string;
  constructor(private readonly options: { assetRoot?: string; blender?: string; timeoutMs?: number; generate?: WorkshopGenerator;
    /** Build one spec into a GLB (default: the Blender workshop script). */
    run?: (spec: { id: string; size: AssetRequest["size"]; source: string }, out: string) => Promise<WorkshopResult> } = {}) {
    this.assetRoot = options.assetRoot ?? DEFAULT_SPATIAL_ASSET_ROOT;
  }

  /** Make (or find) a model for this kind. Concurrent requests for one kind share the work. */
  build(request: AssetRequest): Promise<{ ok: true; entry: SpatialAssetEntry } | { ok: false; reason: string }> {
    const existing = getSpatialAssetEntry(request.id);
    if (existing?.model) return Promise.resolve({ ok: true, entry: existing });
    if (existing) return Promise.resolve({ ok: false, reason: `${request.id} is a built-in kind` });
    if (!ID.test(request.id)) return Promise.resolve({ ok: false, reason: `not a usable id: ${request.id}` });
    let job = this.inFlight.get(request.id);
    if (!job) { job = this.make(request).finally(() => this.inFlight.delete(request.id)); this.inFlight.set(request.id, job); }
    return job;
  }

  private async make(request: AssetRequest): Promise<{ ok: true; entry: SpatialAssetEntry } | { ok: false; reason: string }> {
    this.stats.requested++;
    const model = `generated/grown/${request.id}.glb`, glb = join(this.assetRoot, model);
    mkdirSync(dirname(glb), { recursive: true });
    const generate = this.options.generate ?? (async ({ system, prompt }) => generateText({ model: codeModel, maxRetries: 1, maxOutputTokens: 4000,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } }, system, messages: [{ role: "user", content: prompt }] }));
    let refusal: string | undefined, source = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const answer = await generate({ system: WORKSHOP_SYSTEM, prompt: workshopPrompt(request, refusal) });
        this.stats.calls++; this.stats.tokensIn += Number(answer.usage?.inputTokens ?? 0) || 0; this.stats.tokensOut += Number(answer.usage?.outputTokens ?? 0) || 0;
        source = extractPython(answer.text);
      } catch (error) { refusal = `the request failed (${error instanceof Error ? error.message : error})`; continue; }
      const result = await this.runSpec({ id: request.id, size: request.size, source }, glb);
      if (result.ok) {
        const manifest: SpatialAssetManifest = { id: request.id, name: request.name.slice(0, 80), description: request.description.slice(0, 400),
          tags: ["grown", ...(request.tags ?? [])].slice(0, 12), model, size: request.size, color: request.color, objectType: "object", initialState: "normal",
          affordances: ["examine"], solid: !request.portable, portable: !!request.portable, placement: { indoor: true, outdoor: true }, growable: false,
          license: { source: "Argos asset workshop (generated kit code, scripts/blender/workshop_build.py)", license: "CC0-1.0" } };
        try {
          const entry = registerSpatialAsset(manifest, { assetRoot: this.assetRoot });
          // Saved with its source, so it loads in later sessions and can be rebuilt or reviewed.
          mkdirSync(join(this.assetRoot, "catalog"), { recursive: true });
          writeFileSync(join(this.assetRoot, "catalog", `grown-${request.id}.json`), JSON.stringify({ assets: [manifest] }, null, 2) + "\n");
          writeFileSync(join(this.assetRoot, "generated", "grown", `${request.id}.py`), source);
          this.stats.built++;
          return { ok: true, entry };
        } catch (error) { this.stats.failed++; return { ok: false, reason: `not admitted: ${error instanceof Error ? error.message : error}` }; }
      }
      if (result.error.startsWith("refused")) this.stats.refused++;
      refusal = result.error;
    }
    this.stats.failed++;
    return { ok: false, reason: refusal ?? "no model was made" };
  }

  private runSpec(spec: { id: string; size: AssetRequest["size"]; source: string }, out: string): Promise<WorkshopResult> {
    if (this.options.run) return this.options.run(spec, out);
    const blender = this.options.blender ?? findBlender();
    if (!blender) return Promise.resolve({ ok: false, error: "Blender is not installed" });
    const dir = mkdtempSync(join(tmpdir(), "argos-workshop-")), specPath = join(dir, "spec.json"), resultPath = join(dir, "result.json");
    writeFileSync(specPath, JSON.stringify(spec));
    return new Promise(resolvePromise => {
      execFile(blender, ["--background", "--factory-startup", "--python", SCRIPT, "--", "--spec", specPath, "--out", out, "--result", resultPath],
        { timeout: this.options.timeoutMs ?? 90_000, maxBuffer: 4 * 1024 * 1024 }, error => {
          try { resolvePromise(JSON.parse(readFileSync(resultPath, "utf8")) as WorkshopResult); }
          catch { resolvePromise({ ok: false, error: error ? `the workshop did not finish (${error.message.slice(0, 160)})` : "the workshop left no result" }); }
        });
    });
  }
}
