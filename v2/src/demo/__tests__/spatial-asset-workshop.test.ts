import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AssetWorkshop, extractPython, findBlender, workshopPrompt } from "../spatial-asset-workshop";
import { getSpatialAssetEntry, spatialAssetModel } from "../spatial-asset-registry";
import { SPATIAL_ASSETS } from "../spatial-catalog";

const STRAWBERRIES = `def build(p):
    leaf, berry, soil = p.material('#4f7a3f'), p.material('#c0392b'), p.material('#6a523a')
    p.box((1.4, 1.4, 0.05), (0, 0, 0.025), soil)
    for i in range(4):
        for j in range(4):
            x, y = -0.5 + 0.33 * i, -0.5 + 0.33 * j
            p.cylinder(0.12, 0.25, (x, y, 0.17), leaf, segments=6, radius_top=0.05)
            p.cylinder(0.04, 0.06, (x + 0.06, y - 0.06, 0.33), berry, segments=5)
`;
const unique = (base: string) => `${base}-${Math.random().toString(36).slice(2, 8)}`;
const fakeGlb = (out: string) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(64)])); };
const request = (id: string) => ({ id, name: "Wild strawberries", description: "Low strawberry plants in a sunny clearing.", size: { x: 1.4, y: .4, z: 1.4 }, color: "#c0392b" });

test("a grown kind gets a model: the code model writes kit code, the workshop builds it, the catalog admits and keeps it", async () => {
  const root = mkdtempSync(join(tmpdir(), "argos-assets-")), id = unique("strawberries");
  const prompts: string[] = [];
  const workshop = new AssetWorkshop({ assetRoot: root,
    generate: async ({ prompt }) => { prompts.push(prompt); return { text: "Here:\n```python\n" + STRAWBERRIES + "```", usage: { inputTokens: 900, outputTokens: 300 } }; },
    run: async (spec, out) => { expect(spec.source).toBe(STRAWBERRIES); fakeGlb(out); return { ok: true, tris: 400, width: 1.4, depth: 1.4, height: .38 }; } });
  const result = await workshop.build(request(id));
  expect(result.ok).toBe(true);
  expect(spatialAssetModel(id)).toBe(`generated/grown/${id}.glb`);
  expect(SPATIAL_ASSETS[id].size).toEqual({ x: 1.4, y: .4, z: 1.4 }); // a native kind now: the world can place it
  expect(getSpatialAssetEntry(id)!.growable).toBe(false);
  // Kept for later sessions, with its source.
  expect(JSON.parse(readFileSync(join(root, "catalog", `grown-${id}.json`), "utf8")).assets[0].model).toBe(`generated/grown/${id}.glb`);
  expect(readFileSync(join(root, "generated", "grown", `${id}.py`), "utf8")).toBe(STRAWBERRIES);
  expect(prompts[0]).toMatch(/Wild strawberries.*1\.4 m wide/s);
  expect(workshop.stats).toMatchObject({ requested: 1, built: 1, calls: 1, tokensIn: 900 });
  // Asked again: already drawn, no new work.
  expect((await workshop.build(request(id))).ok).toBe(true);
  expect(workshop.stats.calls).toBe(1);
});

test("a refusal goes back to the code model once; twice refused, no model (the stand-in look stays)", async () => {
  const root = mkdtempSync(join(tmpdir(), "argos-assets-")), id = unique("thornbush");
  const prompts: string[] = [];
  const workshop = new AssetWorkshop({ assetRoot: root, generate: async ({ prompt }) => { prompts.push(prompt); return { text: "def build(p):\n    import os\n" }; },
    run: async () => ({ ok: false, error: "refused: Import is not allowed (line 2)" }) });
  const result = await workshop.build(request(id));
  expect(result).toEqual({ ok: false, reason: "refused: Import is not allowed (line 2)" });
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toMatch(/Your last version was refused: refused: Import is not allowed/);
  expect(getSpatialAssetEntry(id)).toBeUndefined();
  expect(workshop.stats).toMatchObject({ requested: 1, refused: 2, failed: 1 });
});

test("concurrent requests for one kind share the work; a built-in kind or a bad id is not drawn", async () => {
  const root = mkdtempSync(join(tmpdir(), "argos-assets-")), id = unique("reed-bed");
  let runs = 0;
  const workshop = new AssetWorkshop({ assetRoot: root, generate: async () => ({ text: STRAWBERRIES }),
    run: async (_spec, out) => { runs++; await new Promise(r => setTimeout(r, 20)); fakeGlb(out); return { ok: true, tris: 100, width: 1, depth: 1, height: 1 }; } });
  const [a, b] = await Promise.all([workshop.build(request(id)), workshop.build(request(id))]);
  expect(a.ok && b.ok).toBe(true);
  expect(runs).toBe(1);
  expect(await workshop.build(request("tent"))).toEqual({ ok: true, entry: getSpatialAssetEntry("tent") }); // already has its model
  expect(await workshop.build(request("Not An Id"))).toEqual({ ok: false, reason: "not a usable id: Not An Id" });
  expect(workshopPrompt(request(id), "flat along y")).toMatch(/refused: flat along y/);
  expect(extractPython("```py\ndef build(p):\n    pass\n```")).toBe("def build(p):\n    pass\n");
});

const blender = findBlender();
(blender ? test : test.skip)("end to end with Blender: kit code becomes a real model; code that reaches outside the kit is refused before it runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "argos-assets-")), id = unique("strawberries");
  const good = new AssetWorkshop({ assetRoot: root, blender, generate: async () => ({ text: STRAWBERRIES }) });
  const built = await good.build(request(id));
  expect(built.ok).toBe(true);
  expect(readFileSync(join(root, "generated", "grown", `${id}.glb`)).subarray(0, 4).toString("latin1")).toBe("glTF");
  // Building up a list of points is ordinary kit code (a live boat design needed it).
  const listy = new AssetWorkshop({ assetRoot: root, blender, generate: async () => ({ text: "def build(p):\n    wood = p.material('#7a5a3a')\n    pts = []\n    for i in range(5):\n        pts.append((-0.7 + 0.35 * i, 0, 0.2))\n    p.tube(pts, 0.05, wood)\n    for x, y, z in pts:\n        p.box((0.1, 0.1, 0.4), (x, y, 0.2), wood)\n" }) });
  expect((await listy.build({ ...request(unique("rail")), size: { x: 1.5, y: .4, z: .1 } })).ok).toBe(true);
  const sneaky = new AssetWorkshop({ assetRoot: root, blender, generate: async () => ({ text: "def build(p):\n    p.box.__globals__['os'].system('touch /tmp/argos-pwned')\n" }) });
  const refused = await sneaky.build(request(unique("sneaky")));
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.reason).toMatch(/^refused: attribute/);
  expect(existsSync("/tmp/argos-pwned")).toBe(false);
}, 240_000);
