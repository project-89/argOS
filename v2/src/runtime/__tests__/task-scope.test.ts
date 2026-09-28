import { withSimulationTask, getSimulationTaskSignal, assertSimulationTaskActive } from "../task-scope";
import { simulationTaskMiddleware } from "../../llm/config";

test("cancellation is scoped to one async task and combines with the provider's own deadline", async () => {
    const first = new AbortController(), second = new AbortController();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const task = withSimulationTask(first.signal, async () => {
        const params = await simulationTaskMiddleware.transformParams!({ params: { abortSignal: second.signal } as any, type: "generate", model: {} as any });
        expect(params.abortSignal).not.toBe(first.signal);
        expect(getSimulationTaskSignal()).toBe(first.signal);
        await gate;
        expect(params.abortSignal?.aborted).toBe(true);
        expect(assertSimulationTaskActive).toThrow();
    });
    expect(getSimulationTaskSignal()).toBeUndefined();
    first.abort(); finish(); await task;
    expect(assertSimulationTaskActive).not.toThrow();
});

test("a provider response arriving after stop is discarded before returning to a world mutator", async () => {
    const abort = new AbortController();
    const task = withSimulationTask(abort.signal, async () => simulationTaskMiddleware.wrapGenerate!({
        doGenerate: async () => { abort.abort(); return {} as any; },
        doStream: async () => ({} as any), params: {} as any, model: {} as any,
    }));
    await expect(task).rejects.toThrow();
});
