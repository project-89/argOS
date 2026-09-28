import type { SystemDiagnosticCoverage } from "../ecs/dynamic-systems";

/** A retained tail (including an empty/drained tail) is not proof of an error-free
 * run. Only use for gates that already require zero errors, not repair/recovery
 * tests whose intended history includes a fault. Callers persist the coverage. */
export function systemDiagnosticsAreClean(coverage: SystemDiagnosticCoverage): boolean {
  return coverage.errors.total === 0 && coverage.observerFailures === 0;
}
