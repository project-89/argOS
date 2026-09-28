import { jest } from "@jest/globals";
import { request, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpatialDemo } from "../spatial-demo";
import { createSpatialDemoApp } from "../spatial-server";
import { withSimulationTask } from "../../runtime/task-scope";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
function get(server: Server) {
  const port = (server.address() as { port: number }).port;
  return new Promise<{ status: number; value: any }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/api/state", headers: { authorization: `Bearer ${token}` } }, response => {
      let text = ""; response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, value: JSON.parse(text) }));
    });
    req.setTimeout(5000, () => req.destroy(Error("Local observation timed out"))); req.on("error", reject); req.end();
  });
}

test("a stopped crisis remains inspectable without reviving cancelled work", async () => {
  const noProvider = jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No providers in crisis observation tests"));
  const controller = new AbortController(), directory = await mkdtemp(join(tmpdir(), "argos-crisis-observer-"));
  let demo: SpatialDemo | undefined, receiver: Awaited<ReturnType<typeof createSpatialDemoApp>> | undefined, server: Server | undefined;
  try {
    demo = await withSimulationTask(controller.signal, () => SpatialDemo.create({ live: false, automaticClock: false }));
    // Match the crisis harness: observation has its own lifetime; creation and
    // simulation work still inherit cancellation, including delayed callbacks.
    receiver = await createSpatialDemoApp({ demo, directory, token });
    server = receiver.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    await withSimulationTask(controller.signal, async () => {
      await demo!.start(); demo!.advance(1000); demo!.stop();
      controller.abort(Error("bounded test complete"));
    });
    const observed = await get(server!);
    expect(observed.status).toBe(200);
    expect(observed.value).toMatchObject({ status: "stopped", running: false, atSimMs: 1000 });
    await receiver.stop();
    expect(JSON.parse(await readFile(join(directory, "session.json"), "utf8"))).toMatchObject({ status: "stopped", atSimMs: 1000 });
    expect(() => demo!.advance(100)).toThrow();
    await expect(withSimulationTask(controller.signal, async () => demo!.start())).rejects.toThrow("bounded test complete");
  } finally {
    if (receiver) await receiver.stop().catch(() => {}); else demo?.stop();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    expect(noProvider).not.toHaveBeenCalled(); noProvider.mockRestore();
  }
});
