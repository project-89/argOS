import { CodexJsonFrames, CodingWorkerError, runCodexWorker, type WorkerDiagnostics } from "../codex-transport";

describe("bounded coding worker protocol", () => {
  test("drains oversized tool output across fragments and retains actual completion", () => {
    const events: string[] = [];
    const frames = new CodexJsonFrames(event => events.push(event.type), 100, 10000);
    const tool = JSON.stringify({ type: "item.completed", item: { type: "command_execution", output: "private text ".repeat(100) } });
    for (let i = 0; i < tool.length; i += 17) frames.push(tool.slice(i, i + 17));
    frames.push('\n{"type":"turn.completed"}\n'); frames.end();
    expect(events).toEqual(["turn.completed"]);
    expect(frames.diagnostics).toMatchObject({ completed: true, oversizedFrames: 1, frames: 2 });
    expect(JSON.stringify(frames.diagnostics)).not.toContain("private text");
  });
  test("a large aggregate chunk of small frames is not a large frame", () => {
    const frames = new CodexJsonFrames(() => {}, 60, 10000);
    frames.push('{"type":"item.started"}\n'.repeat(100) + '{"type":"turn.completed"}\n');
    expect(frames.diagnostics).toMatchObject({ frames: 101, oversizedFrames: 0, completed: true });
  });
  test("never drops oversized completion/error or malformed events", () => {
    for (const type of ["turn.completed", "turn.failed", "error"]) {
      const frames = new CodexJsonFrames(() => {}, 80);
      expect(() => frames.push(JSON.stringify({ type, payload: "x".repeat(1000) }) + "\n")).toThrow(/protocol_error/);
    }
    expect(() => new CodexJsonFrames(() => {}).push("not json\n")).toThrow(/protocol_error/);
    expect(() => new CodexJsonFrames(() => {}).push('{"type":"turn.failed"}\n')).toThrow(/turn_failed/);
  });
  test("total-output budget remains independent and explicit", () => {
    const frames = new CodexJsonFrames(() => {}, 100, 200);
    expect(() => frames.push('{"type":"item.started"}\n'.repeat(100))).toThrow(/output_budget/);
  });
  async function child(code: string, signal = new AbortController().signal) {
    let diagnostics: WorkerDiagnostics | undefined;
    let error: unknown;
    try {
      await runCodexWorker({ command: process.execPath, args: ["-e", code], directory: process.cwd(), env: {}, input: "",
        signal, progress: () => {}, maxFrameBytes: 100, diagnostics: async value => { diagnostics = value; } });
    } catch (caught) { error = caught; }
    return { error, diagnostics };
  }
  test("real subprocess survives oversized advisory output without paid inference", async () => {
    const { error, diagnostics } = await child('console.log(JSON.stringify({type:"item.completed",item:{output:"x".repeat(5000)}})); console.log(JSON.stringify({type:"turn.completed"}));');
    expect(error).toBeUndefined(); expect(diagnostics).toMatchObject({ completed: true, oversizedFrames: 1, failureCode: null });
  });
  test("real subprocess distinguishes cancellation, unsuccessful exit, and missing completion", async () => {
    const abort = new AbortController(); abort.abort();
    expect((await child('setInterval(()=>{},1000)', abort.signal)).diagnostics?.failureCode).toBe("cancelled");
    expect((await child('process.exitCode=2')).diagnostics?.failureCode).toBe("process_failed");
    const incomplete = await child('console.log(JSON.stringify({type:"item.completed"}))');
    expect(incomplete.error).toBeInstanceOf(CodingWorkerError); expect(incomplete.diagnostics?.failureCode).toBe("incomplete_turn");
  });
});
