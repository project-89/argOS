import "dotenv/config";
import express from "express";
import { build } from "esbuild";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { OilDemo, OIL_THOUGHT, type OilDecider } from "./demo/oil-demo";
import { decideOilAction } from "./demo/oil-cognition";
import { editDemoWorld } from "./demo/world-editor";
import { oilSceneKey, projectOilScene } from "./demo/oil-projection";
import { directorConfigure, isDirectorProxyTarget } from "./rendering/director-projection";
import { installDirectorRecording } from "./rendering/director-recording";
import { serializeWorld } from "./persistence/world-persistence";

const fixture = process.env.ARGOS_DEMO_COGNITION === "fixture";
if (!fixture && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
const fixtureDecider: OilDecider = async o => {
  if (o.rememberedOil === "missing") return { action: "speak", thought: "My earlier observation is outdated.", speech: "The shelf is empty. Where did the oil go?" };
  if (o.location === "Beacon room") return { action: o.rememberedOil === "carried" ? "refuel" : "go_kitchen", thought: "The beacon needs oil." };
  if (o.rememberedOil === "carried") return { action: "go_beacon", thought: "I have the oil." };
  return { action: o.observation.includes("within reach") ? "take_oil" : "inspect_shelf", thought: "Check the shelf." };
};
const demo = await OilDemo.create(fixture ? fixtureDecider : decideOilAction);
const token = randomBytes(24).toString("hex");
const seconds = Number(process.env.ARGOS_DEMO_SECONDS ?? 90);
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 120) throw new Error("ARGOS_DEMO_SECONDS must be 10–120");
const maxSessionMs = seconds * 1000;
const runDirectory = resolve("recordings", `missing-oil-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`);
const asset = (name: string) => fileURLToPath(new URL(`./demo/${name}`, import.meta.url));
const bundle = await build({ entryPoints: [asset("oil-client.mjs")], bundle: true, write: false, platform: "browser", format: "esm" });
const app = express();
app.use(express.json({ limit: "64kb" }));
app.get("/", async (_req, res) => res.type("html").send(await readFile(asset("oil-demo.html"), "utf8")));
app.get("/demo.css", async (_req, res) => res.type("css").send(await readFile(asset("oil-demo.css"), "utf8")));
app.get("/client.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
app.use((req, res, next) => {
  const supplied = Buffer.from(req.get("x-argos-token") ?? "");
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.sendStatus(403); return; }
  next();
});
let started = false, stopped = false, render = false, allocated = false, tickBusy = false;
let clock: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
let editing = false, editorSummary = "", editorError = "";
let editAbort: AbortController | undefined;
let savePromise: Promise<void> | undefined;
let version = 0, key = "", projectedSpeech = "", cachedPrompt = "";
const renderVersions = new Map<number, { sourceMs: number; phase: string; location: string }>();
function projection() {
  const state = demo.snapshot();
  const nextKey = oilSceneKey(state);
  if (nextKey !== key) {
    key = nextKey; version++;
    cachedPrompt = projectOilScene(state, state.mara.speech !== projectedSpeech);
    projectedSpeech = state.mara.speech;
    renderVersions.set(version, { sourceMs: state.elapsedMs, phase: state.phase, location: state.location });
  }
  return { type: "prompt", prompt: cachedPrompt, prompt_version: version, sourceMs: state.elapsedMs };
}
async function stop() {
  if (savePromise) return savePromise;
  stopped = true; clearInterval(clock); clearTimeout(deadline); editAbort?.abort(); demo.stop();
  savePromise = (async () => {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, "world.json"), JSON.stringify(serializeWorld(demo.sim.world, demo.sim.god.systemRegistry), null, 2), { flag: "wx", mode: 0o600 });
    await writeFile(resolve(runDirectory, "demo.json"), JSON.stringify({ ...demo.snapshot(), renderVersions: Object.fromEntries(renderVersions), cognition: fixture ? "test-fixture" : "live-model" }, null, 2), { flag: "wx", mode: 0o600 });
  })();
  return savePromise;
}
app.get("/state", (_req, res) => res.json({ ...demo.snapshot(), fixture, videoAvailable: Boolean(process.env.FAL_KEY),
  editing, editorSummary, editorError, renderVersions: Object.fromEntries(renderVersions) }));
app.post("/start", (req, res) => {
  if (started || stopped) { res.status(409).json({ error: "Restart the server for a fresh world." }); return; }
  render = req.body.render === true;
  if (render && !process.env.FAL_KEY) { res.status(400).json({ error: "FAL_KEY is required for live video." }); return; }
  started = true; demo.start();
  clock = setInterval(() => {
    if (tickBusy || stopped) return;
    tickBusy = true;
    void demo.sim.step().catch(error => console.error("Demo tick failed:", error.message)).finally(() => { tickBusy = false; });
  }, 1000);
  deadline = setTimeout(() => { void stop(); }, maxSessionMs + 2000);
  const initial = projection();
  res.json({ maxSessionMs, render, configure: directorConfigure(initial.prompt, initial.prompt_version), thought: OIL_THOUGHT });
});
app.post("/control", (req, res) => {
  try {
    if (req.body.action === "thought") demo.injectThought(String(req.body.text ?? OIL_THOUGHT));
    else if (req.body.action === "talk") demo.talk(String(req.body.text ?? ""));
    else if (req.body.action === "remove-oil") demo.removeOil();
    else throw new Error("Unknown control");
    res.json(demo.snapshot());
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Control failed" }); }
});
app.post("/edit-world", async (req, res) => {
  if (!started || stopped || editing) { res.status(409).json({ error: "Start the demo and wait for the current edit to finish." }); return; }
  const instruction = req.body.instruction;
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 800) { res.status(400).json({ error: "Use an instruction of 1–800 characters." }); return; }
  if (fixture) { res.status(400).json({ error: "Natural-language world edits need live cognition mode." }); return; }
  editing = true; editorError = ""; editAbort = new AbortController();
  const timer = setTimeout(() => editAbort?.abort(), 35000);
  try {
    const result = await editDemoWorld(demo, instruction, editAbort.signal);
    editorSummary = result.summary || result.applied.map(a => a.description).join("; ");
    res.json(result);
  } catch (error) { editorError = error instanceof Error ? error.message : "World edit failed"; res.status(400).json({ error: editorError }); }
  finally { editing = false; clearTimeout(timer); }
});
app.post("/next", (_req, res) => {
  if (!started || stopped) { res.sendStatus(409); return; }
  res.json(projection());
});
app.post("/telemetry", (req, res) => { console.log(JSON.stringify({ director: req.body })); res.sendStatus(204); });
app.post("/stop", async (_req, res) => { await stop(); res.sendStatus(204); });
installDirectorRecording(app, () => started && stopped, runDirectory);
app.post("/proxy", async (req, res) => {
  const target = req.get("x-fal-target-url") ?? "";
  if (!render || !started || stopped || !isDirectorProxyTarget(target)) { res.sendStatus(403); return; }
  if ((target.endsWith("/ice") || target.endsWith("/session")) && req.body.app_id !== "minimax/h3-max/director") { res.sendStatus(403); return; }
  if (target.endsWith("/session")) { if (allocated) { res.sendStatus(409); return; } allocated = true; }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 45000);
  res.on("close", () => { if (!res.writableEnded) abort.abort(); });
  try {
    const response = await fetch(target, { method: "POST", redirect: "error", signal: abort.signal,
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    res.status(response.status).type("json").send(await response.text());
  } catch { res.status(502).json({ error: "Director connection failed" }); }
  finally { clearTimeout(timeout); }
});
const port = Number(process.env.ARGOS_DEMO_PORT ?? 3461);
const server = app.listen(port, "127.0.0.1", () => console.log(`OIL_DEMO_READY http://127.0.0.1:${port}/#${token}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void stop().finally(() => server.close());
  setTimeout(() => process.exit(0), 3000).unref();
});
