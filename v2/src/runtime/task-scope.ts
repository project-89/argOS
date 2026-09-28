import { AsyncLocalStorage } from "node:async_hooks";
/** Cancellation travels with a simulation's asynchronous work, including nested
 * model calls. It is not a process-wide flag affecting unrelated simulations. */
const scope = new AsyncLocalStorage<AbortSignal>();
export function withSimulationTask<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return scope.run(signal, async () => { signal.throwIfAborted(); return work(); });
}
export function getSimulationTaskSignal() { return scope.getStore(); }
export function assertSimulationTaskActive() { scope.getStore()?.throwIfAborted(); }
