import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { runLoadedSystems, type LoadedSystem } from "../system-loader";

describe("system-loader quarantine", () => {
  it("moves a repeatedly failing generated system into _quarantine so it won't load next run", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argos-sys-quarantine-"));
    process.env.ARGOS_GENERATED_SYSTEMS_DIR = tmpRoot;

    const filePath = path.join(tmpRoot, "failing-system.ts");
    fs.writeFileSync(filePath, "export const name='FailingSystem'; export const active=true; export function run(){ throw new Error('boom'); }", "utf8");

    const world = createArgosWorld("QuarantineTestWorld");
    const registry = createSystemRegistry();

    const sys: LoadedSystem = {
      name: "FailingSystem",
      description: "Always throws",
      frequency: 1,
      active: true,
      filePath,
      source: "export function run() { throw new Error('boom') }",
      run: () => {
        throw new Error("boom");
      },
      lastRun: 0,
      consecutiveErrors: 0,
      lastError: null,
      fixAttempts: 0,
    };

    runLoadedSystems(world, [sys], registry, 1, 1);
    runLoadedSystems(world, [sys], registry, 2, 1);
    runLoadedSystems(world, [sys], registry, 3, 1);

    expect(sys.active).toBe(false);

    const qDir = path.join(tmpRoot, "_quarantine");
    expect(fs.existsSync(qDir)).toBe(true);
    const qFiles = fs.readdirSync(qDir).filter((f) => f.endsWith(".ts"));
    expect(qFiles.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

