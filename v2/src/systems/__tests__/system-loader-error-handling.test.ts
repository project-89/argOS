import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { runLoadedSystems, getSystemsNeedingFix, clearSystemsNeedingFix, type LoadedSystem } from "../system-loader";

describe("system-loader error handling", () => {
  afterEach(() => {
    clearSystemsNeedingFix();
  });

  it("deactivates a repeatedly failing system even if already queued for fix", () => {
    const world = createArgosWorld("TestWorld");
    const registry = createSystemRegistry();

    const sys: LoadedSystem = {
      name: "FailingSystem",
      description: "Always throws",
      frequency: 1,
      active: true,
      filePath: "/tmp/failing-system.ts",
      source: "export function run() { throw new Error('boom') }",
      run: () => {
        throw new Error("boom");
      },
      lastRun: 0,
      consecutiveErrors: 0,
      lastError: null,
      fixAttempts: 0,
    };

    // Hit the threshold to queue + deactivate.
    runLoadedSystems(world, [sys], registry, 1, 1);
    runLoadedSystems(world, [sys], registry, 2, 1);
    runLoadedSystems(world, [sys], registry, 3, 1);

    expect(sys.active).toBe(false);
    expect(sys.consecutiveErrors).toBeGreaterThanOrEqual(3);
    expect(getSystemsNeedingFix().length).toBe(1);

    // If something re-activates it while still queued, it should immediately be deactivated again.
    sys.active = true;
    runLoadedSystems(world, [sys], registry, 4, 1);

    expect(sys.active).toBe(false);
    expect(getSystemsNeedingFix().length).toBe(1); // no duplicates
  });
});

