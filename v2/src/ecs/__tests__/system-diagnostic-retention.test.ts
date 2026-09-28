// Match the library's prefab bootstrap order; direct dynamic-system imports
// alone encounter the legacy ActionRegistry/deterministic-system import cycle.
await import("../prefabs");
const {
  createSystemRegistry, consumeLogs, consumeSystemErrors, consumeEvents, reportSystemError,
  registerSystem, getSystemDiagnosticCoverage, subscribeSystemDiagnostics,
  ensureSystemDiagnosticRetention,
} = await import("../dynamic-systems");

describe("registry-local operational evidence retention", () => {
  it("bounds append tails, supports legacy drains/replacements, and keeps lifetime coverage", () => {
    const registry = createSystemRegistry({ logs: { maxEntries: 2, maxBytes: 256 } });
    const archive: string[] = [];
    const unsubscribe = subscribeSystemDiagnostics(registry, entry => { if (entry.channel === "logs") archive.push(entry.value); });
    registry.logs.push("one", "two", "three");
    expect(Array.isArray(registry.logs)).toBe(true);
    expect(registry.logs).toEqual(["two", "three"]);
    expect(consumeLogs(registry)).toEqual(["two", "three"]);
    registry.logs.push("four");
    expect(registry.logs.splice(0)).toEqual(["four"]);
    registry.logs = ["five", "six", "seven"];
    expect(registry.logs).toEqual(["six", "seven"]);
    expect(archive).toEqual(["one", "two", "three", "four", "five", "six", "seven"]);
    expect(getSystemDiagnosticCoverage(registry).logs).toMatchObject({ total: 7, retained: 2, evicted: 2, consumed: 3, complete: false });
    unsubscribe(); registry.logs.push("eight"); expect(archive).toHaveLength(7);
  });

  it("preserves error authority and every append notification after retention fills", () => {
    const registry = createSystemRegistry({ errors: { maxEntries: 1, maxBytes: 4096 } });
    registerSystem(registry, { name: "failing", description: "", pseudocode: "", frequency: 1, active: true, lastRun: 0 });
    const sequences: number[] = [];
    subscribeSystemDiagnostics(registry, entry => { if (entry.channel === "errors") sequences.push(entry.sequence); });
    for (let i = 1; i <= 4; i++) reportSystemError(registry, "failing", `failure ${i}`);
    expect(sequences).toEqual([1, 2, 3, 4]);
    expect(consumeSystemErrors(registry).map(error => error.error)).toEqual(["failure 4"]);
    expect(registry.errorCounts.get("failing")).toBe(4);
    expect(registry.systems.get("failing")).toMatchObject({ active: false, consecutiveErrors: 4, totalErrors: 4, lastError: "failure 4" });
    expect(getSystemDiagnosticCoverage(registry).errors).toMatchObject({ total: 4, retained: 0, evicted: 3, consumed: 1 });
    // Pending world events remain lossless: these drive runtime consumers, not just diagnostics.
    expect(consumeEvents(registry).map(event => event.type)).toEqual(["system:auto_disabled", "system:auto_disabled"]);
  });

  it("isolates registry observers and bounds large diagnostic payloads without changing pending world events", () => {
    const registry = createSystemRegistry({ logs: { maxEntries: 2, maxBytes: 32 } });
    const other = createSystemRegistry();
    subscribeSystemDiagnostics(registry, () => { throw new Error("disk full"); });
    const delivered: string[] = [];
    subscribeSystemDiagnostics(registry, item => { if (item.channel === "logs") delivered.push(item.value); });
    registry.logs.push("x".repeat(1000)); other.logs.push("other");
    expect(registry.logs).toEqual([]);
    expect(delivered).toHaveLength(1);
    expect(getSystemDiagnosticCoverage(registry)).toMatchObject({ observerFailures: 1, logs: { total: 1, oversized: 1, complete: false }, events: { retention: "pending-delivery-unbounded" } });
    expect(getSystemDiagnosticCoverage(other)).toMatchObject({ observerFailures: 0, logs: { total: 1, retained: 1 } });
    for (let i = 0; i < 3000; i++) registry.events.push({ type: "native", data: { i }, timestamp: i });
    expect(consumeEvents(registry)).toHaveLength(3000);
  });

  it("adopts a legacy registry and preserves array clearing and later notifications", () => {
    const registry = { systems: new Map(), logs: ["old"], errors: [], errorCounts: new Map(), events: [] };
    ensureSystemDiagnosticRetention(registry, { logs: { maxEntries: 2, maxBytes: 128 } });
    const sequences: number[] = [];
    subscribeSystemDiagnostics(registry, record => sequences.push(record.sequence));
    registry.logs.length = 0;
    registry.logs.push("new", "again");
    expect(registry.logs.shift()).toBe("new");
    expect(registry.logs.pop()).toBe("again");
    registry.logs.push("last");
    expect(sequences).toEqual([2, 3, 4]);
    expect(getSystemDiagnosticCoverage(registry).logs).toMatchObject({ total: 4, retained: 1, consumed: 3 });
  });
});
