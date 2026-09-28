export {};
await import("../../ecs/prefabs");
const { createSystemRegistry, consumeSystemErrors, getSystemDiagnosticCoverage, subscribeSystemDiagnostics } = await import("../../ecs/dynamic-systems");
const { systemDiagnosticsAreClean } = await import("../system-diagnostic-evidence");

test("drained or evicted errors cannot satisfy a zero-error run gate", () => {
  const registry = createSystemRegistry({ errors: { maxEntries: 1, maxBytes: 4096 } });
  expect(systemDiagnosticsAreClean(getSystemDiagnosticCoverage(registry))).toBe(true);
  for (let i = 0; i < 3; i++) registry.errors.push({ systemName: "native", error: `failure ${i}`, errorCount: i + 1, timestamp: i });
  expect(consumeSystemErrors(registry)).toHaveLength(1);
  expect(registry.errors).toHaveLength(0);
  expect(!registry.errors.length).toBe(true); // Historical gate falsely accepted this evidence loss.
  const evidence = getSystemDiagnosticCoverage(registry);
  expect(evidence.errors).toMatchObject({ total: 3, retained: 0, evicted: 2, consumed: 1 });
  expect(systemDiagnosticsAreClean(evidence)).toBe(false);
});

test("oversized error omission and archive observer failure fail the gate explicitly", () => {
  const registry = createSystemRegistry({ errors: { maxEntries: 1, maxBytes: 64 } });
  registry.errors.push({ systemName: "native", error: "x".repeat(1000), errorCount: 1, timestamp: 0 });
  expect(registry.errors).toHaveLength(0);
  expect(!registry.errors.length).toBe(true); // Oversized error was never present in the hot tail.
  const evidence = getSystemDiagnosticCoverage(registry);
  expect(evidence.errors).toMatchObject({ total: 1, retained: 0, oversized: 1 });
  expect(systemDiagnosticsAreClean(evidence)).toBe(false);

  const observerFailure = createSystemRegistry();
  subscribeSystemDiagnostics(observerFailure, () => { throw new Error("journal unavailable"); });
  observerFailure.logs.push("A normal log");
  expect(getSystemDiagnosticCoverage(observerFailure).observerFailures).toBe(1);
  expect(systemDiagnosticsAreClean(getSystemDiagnosticCoverage(observerFailure))).toBe(false);
});

test("bounded diagnostic log eviction alone is not misclassified as a system error", () => {
  const registry = createSystemRegistry({ logs: { maxEntries: 1, maxBytes: 4096 } });
  registry.logs.push("first", "second");
  const evidence = getSystemDiagnosticCoverage(registry);
  expect(evidence.logs).toMatchObject({ total: 2, retained: 1, evicted: 1, complete: false });
  expect(systemDiagnosticsAreClean(evidence)).toBe(true);
});
