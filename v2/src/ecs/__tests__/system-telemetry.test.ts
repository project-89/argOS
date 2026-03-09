import { createArgosWorld } from "../world";
import { createSystemRegistry, registerSystem, runSystems, getSystemTelemetrySnapshot } from "../dynamic-systems";

describe("System telemetry", () => {
  it("tracks runs, emits, logs, and duration", () => {
    const world = createArgosWorld("TestWorld");
    const registry = createSystemRegistry();

    registerSystem(registry, {
      name: "TelemetryTestSystem",
      description: "test",
      pseudocode: "",
      frequency: 0,
      active: true,
      lastRun: 0,
      compiledFn: (_world, ctx) => {
        ctx.log("hello");
        ctx.emit("test:event", { ok: true });
      },
    });

    runSystems(world, registry, 1, 1);

    const t = getSystemTelemetrySnapshot().find(s => s.systemName === "TelemetryTestSystem");
    expect(t).toBeDefined();
    expect(t!.runs).toBeGreaterThanOrEqual(1);
    expect(t!.totalLogs).toBeGreaterThanOrEqual(1);
    expect(t!.totalEmits).toBeGreaterThanOrEqual(1);
    expect(t!.lastDurationMs).toBeGreaterThanOrEqual(0);
  });
});

