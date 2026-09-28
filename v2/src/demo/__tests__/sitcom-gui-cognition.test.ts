/** GUI transport + native decisions/actions; only remote model output is scripted. */
import { jest } from "@jest/globals";
import { request as httpRequest, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../apartment-sitcom");
const { createSitcomDemoApp } = await import("../sitcom-server");
const { sitcomLaunchProfile } = await import("../sitcom-launch-profile");
const { Agent } = await import("../../ecs/components");
const { addPerception } = await import("../../cognition/agent-mind");
const { wakeForegroundCognition } = await import("../../cognition/idle-cognition");
const { runCognitionCycle, executeActions } = await import("../../cognition/cognition-system");
const { getNativeRuntimeServices } = await import("../../runtime/native-services");
const token = "scripted-gui-test-local-session-token";
function request(server: Server, path: string, body?: unknown) {
  const address = server.address(); if (!address || typeof address === "string") throw Error("No server");
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: bytes ? "POST" : "GET",
      headers: { "x-argos-token": token, ...(bytes ? { "content-type": "application/json", "content-length": String(bytes.length) } : {}) } }, res => {
      let text = ""; res.on("data", c => { text += c; }); res.on("end", () => resolve({ status: res.statusCode!, json: text ? JSON.parse(text) : null }));
    }); req.on("error", reject); req.end(bytes);
  });
}
beforeEach(() => { generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No external network")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("the live launch profile installs cognition and God-reviewed maintenance without starting any actors", async () => {
  generate.mockResolvedValue({ text: "{}" }); // Scaffold fixture, not an NPC response.
  const t = await ApartmentSitcom.create(sitcomLaunchProfile([]));
  try {
    expect(t.running).toBe(false);
    expect(getNativeRuntimeServices(t.sim.world).filter(s => s.id.startsWith("npc-")).every(s => s.enabled)).toBe(true);
    expect(t.sim.getEvolutionStatus().enabled).toBe(true);
    expect(t.sim.god.autopilot?.config).toMatchObject({ enabled: true, minPriority: "normal" });
    expect(t.sim.world.meta).toMatchObject({ narrativeMind: true, experienceReconsideration: true, cognitionController: "priority" });
    expect(generate.mock.calls.some(([call]) => String(call.prompt).startsWith("You are Elaine."))).toBe(false);
  } finally { t.stop(); }
});

test("a GUI text reaches the physical phone and real scripted cognition returns thoughts/read/reply through the GUI state", async () => {
  const t = await ApartmentSitcom.create({ ...sitcomLaunchProfile([]), live: false });
  const directory = await mkdtemp(join(tmpdir(), "argos-gui-cognition-"));
  const receiver = await createSitcomDemoApp({ testbed: t, directory, token, seconds: 60, allowVideo: false });
  const server = receiver.app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  try {
    const initial = (await request(server, "/state")).json;
    expect(initial.engine).toMatchObject({ narrativeMind: true, cookieHistory: "david", openNeighborhood: true });
    expect(initial.latest.contact).toMatchObject({ name: "David", relationship: "boyfriend" });
    expect((await request(server, "/start", { render: false, seconds: 60 })).status).toBe(200);
    t.sim.pause(); // Test explicitly drives native time; receiver's sampler cannot race it.
    const body = "PRIVATE_GUI_MESSAGE: Would you like to meet for dinner?";
    expect((await request(server, "/control", { type: "message", text: body })).status).toBe(200);
    t.advance(200);
    const id = t.snapshot().phone[0].id, eid = t.ids.Elaine;
    t.sim.world.meta.aiEnabled = true;
    for (const name of t.characters) if (name !== "Elaine") Agent.active[t.ids[name]] = false;
    const steps: Array<{ action: import("../../cognition/agent-mind").AgentAction; ms: number }> = [
      { action: { type: "move", target: "Kitchen" }, ms: 3000 },
      { action: { type: "pickup", target: "Elaine's phone" }, ms: 800 },
      { action: { type: "interact", target: "Elaine's phone", content: "read_phone" }, ms: 1200 },
      { action: { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "Yes, David. Where?" })}` }, ms: 1800 },
    ];
    for (const [index, step] of steps.entries()) {
      generate.mockResolvedValue({ text: JSON.stringify({ innerThought: `PRIVATE_AUTHORED_GUI_THOUGHT_${index}`, action: step.action }) });
      addPerception(t.sim.world, eid, { type: "attention", source: "offline test", content: `Current situation ${index}` });
      wakeForegroundCognition(t.sim.world, eid);
      const actions = await runCognitionCycle(t.sim.world, t.sim.god.systemRegistry, { tick: t.sim.world.time.tick, agentEids: [eid], enablePlanning: false });
      expect(actions).toHaveLength(1); executeActions(t.sim.world, actions, t.sim.god.systemRegistry); t.advance(step.ms);
      const view = (await request(server, "/state")).json;
      expect(view.latest.actors.find((a: any) => a.name === "Elaine").latestThought.text).toBe(`PRIVATE_AUTHORED_GUI_THOUGHT_${index}`);
      expect(JSON.stringify(view.publicEvents)).not.toMatch(/PRIVATE_GUI_MESSAGE|PRIVATE_AUTHORED_GUI_THOUGHT/);
    }
    const state = (await request(server, "/state")).json;
    expect(state.render).toBe(false);
    expect(state.latest.phone).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, status: "read" }),
      expect.objectContaining({ direction: "out", replyTo: id, status: "delivered", text: "Yes, David. Where?" }),
    ]));
    expect((await request(server, "/control", { type: "thought", actor: "Elaine", text: "PRIVATE_PLANTED_GUI_IMPULSE" })).status).toBe(200);
    expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought!.text).toBe("PRIVATE_AUTHORED_GUI_THOUGHT_3");
  } finally {
    await receiver.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  }
});
