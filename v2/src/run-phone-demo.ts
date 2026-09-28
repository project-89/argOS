import "dotenv/config";
import express from "express";
import { build } from "esbuild";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PhoneDemo, phoneFixture } from "./demo/phone-demo";
import { PhoneCameraDirector } from "./demo/phone-director";
import { directorConfigure, isDirectorProxyTarget } from "./rendering/director-projection";
import { installDirectorRecording } from "./rendering/director-recording";
import { serializeWorld } from "./persistence/world-persistence";
import { z } from "zod";
import { servePhoneReplay } from "./demo/phone-replay";
if (process.env.ARGOS_DEMO_REPLAY) {
    await servePhoneReplay(process.env.ARGOS_DEMO_REPLAY);
} else {
const fixture = process.env.ARGOS_DEMO_COGNITION === "fixture";
const simulationOnly = process.env.ARGOS_DEMO_SIMULATION_ONLY === "1";
if (!fixture && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
const seconds = Number(process.env.ARGOS_DEMO_SECONDS ?? 120);
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 120)
    throw new Error("ARGOS_DEMO_SECONDS must be 10–120");
const directorChunkSeconds = Number(process.env.ARGOS_DIRECTOR_CHUNK_SECONDS ?? 10);
if (!Number.isInteger(directorChunkSeconds) || directorChunkSeconds < 5 || directorChunkSeconds > 15)
    throw new Error("ARGOS_DIRECTOR_CHUNK_SECONDS must be an integer from 5–15");
// Director trims 39 context frames from continuations (1.625s at 24fps in the
// measured contract). Start conservatively; provider playback metadata replaces
// this estimate as soon as real chunks arrive.
const initialRenderHorizonMs = Math.max(1000, (directorChunkSeconds - 2) * 1000);
const demo = fixture ? await PhoneDemo.create(phoneFixture) : await PhoneDemo.createLivingWorld();
const camera = new PhoneCameraDirector();
const token = randomBytes(24).toString("hex");
const runDirectory = resolve("recordings", `phone-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`);
const asset = (name: string) => fileURLToPath(new URL(`./demo/${name}`, import.meta.url));
const bundle = await build({ entryPoints: [asset("phone-client.mjs")], bundle: true, write: false, platform: "browser", format: "esm" });
const app = express();
app.get("/", async (_req, res) => res.type("html").send(await readFile(asset("phone-demo.html"), "utf8")));
app.get("/demo.css", async (_req, res) => res.type("css").send(await readFile(asset("phone-demo.css"), "utf8")));
app.get("/client.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
app.use((req, res, next) => {
    const supplied = Buffer.from(req.get("x-argos-token") ?? ""), expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.sendStatus(403);
        return;
    }
    res.set("Cache-Control", "no-store");
    next();
});
// Playback carries bounded per-frame-boundary telemetry and can legitimately
// exceed a control request. Authenticate before paying the larger parse cost;
// all other JSON endpoints retain the tighter ceiling.
app.use("/playback", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "32kb" }));
let started = false, prepared = false, stopped = false, render = false, allocated = false, allocating = false, tickBusy = false;
let clock: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined, startupDeadline: NodeJS.Timeout | undefined;
let savePromise: Promise<void> | undefined;
function startClock() {
    if (clock || stopped)
        return;
    if (demo.fullRuntime) {
        // The library owns both loops, not a wrapper repeatedly awaiting sim.step().
        // Its fast ECS clock continues while cognition/spirits/builders are busy.
        if (!demo.sim.running) void demo.sim.start().catch(error => { console.error(error); void stop(); });
        return;
    }
    clock = setInterval(() => {
        if (tickBusy || stopped)
            return;
        tickBusy = true;
        void demo.sim.step().then(() => { state(); }).catch(error => { console.error("Phone tick failed:", error.message); void stop(); }).finally(() => { tickBusy = false; });
    }, 1000);
}
function state() {
    const s = demo.snapshot();
    if (prepared) camera.observe(s);
    return { ...s, fixture, videoAvailable: !simulationOnly && Boolean(process.env.FAL_KEY), camera: camera.snapshot() };
}
async function stop() {
    if (savePromise)
        return savePromise;
    stopped = true;
    clearInterval(clock);
    clearTimeout(deadline);
    clearTimeout(startupDeadline);
    demo.stop();
    savePromise = (async () => {
        await mkdir(runDirectory, { recursive: true });
        await writeFile(resolve(runDirectory, "world.json"), JSON.stringify(serializeWorld(demo.sim.world, demo.sim.god.systemRegistry), null, 2), { flag: "wx", mode: 0o600 });
        await writeFile(resolve(runDirectory, "demo.json"), JSON.stringify(state(), null, 2), { flag: "wx", mode: 0o600 });
    })();
    return savePromise;
}
app.get("/state", (_req, res) => res.json(state()));
app.post("/start", async (req, res) => {
    if (started || stopped) {
        res.status(409).json({ error: "Restart the server for a fresh world." });
        return;
    }
    render = req.body.render === true;
    if (render && simulationOnly) {
        res.status(403).json({ error: "H3 is disabled for cognition validation. Use simulation-only mode." });
        return;
    }
    if (render && !process.env.FAL_KEY) {
        res.status(400).json({ error: "FAL_KEY is required for video." });
        return;
    }
    started = true;
    demo.start();
    try {
        // Prepare a genuine intention at source time zero, before spending on H3.
        // Neither travel nor the video clock runs while this decision is pending.
        await demo.prepareOpening();
    } catch (error) {
        await stop();
        res.status(503).json({ error: error instanceof Error ? error.message : "Opening cognition failed." });
        return;
    }
    prepared = true;
    demo.setProjectionHorizonMs(initialRenderHorizonMs);
    state();
    // Advance physical actions only once the first frame is playing.
    if (!render)
        startClock();
    const shot = camera.next();
    const configure = { ...directorConfigure(shot.prompt, shot.version), chunk_duration: directorChunkSeconds };
    // Video duration starts with its first playable frame. Keep a separate setup
    // bound so a browser that never completes WebRTC cannot leave the run open.
    if (render) startupDeadline = setTimeout(() => { void stop(); }, 60000);
    else deadline = setTimeout(() => { void stop(); }, seconds * 1000 + 2000);
    res.json({ maxSessionMs: seconds * 1000, render, configure, renderHorizonMs: initialRenderHorizonMs, sourceMs: shot.sourceMs,
        sourceCapturedWallMs: shot.capturedWallMs });
});
let ready = false, worldClockStartedWallMs: number | undefined;
app.post("/ready", (_req, res) => {
    if (!prepared || stopped || !render || ready) {
        res.sendStatus(409);
        return;
    }
    ready = true;
    clearTimeout(startupDeadline);
    worldClockStartedWallMs = Date.now();
    startClock();
    deadline = setTimeout(() => { void stop(); }, seconds * 1000 + 2000);
    res.json({ worldClockStartedWallMs });
});
app.post("/control", (req, res) => {
    try {
        if (req.body.action === "message")
            demo.sendMessage(String(req.body.text ?? ""));
        else if (req.body.action === "thought")
            demo.injectThought(String(req.body.text ?? ""));
        else if (req.body.action === "phone" && req.body.edit && typeof req.body.edit === "object")
            demo.controlPhone(req.body.edit);
        else
            throw new Error("Unknown control");
        res.json(state());
    }
    catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Control failed" });
    }
});
app.post("/next", (req, res) => {
    if (!prepared || stopped) {
        res.sendStatus(409);
        return;
    }
    const renderHorizonMs = Number(req.body.renderHorizonMs ?? 5000);
    try { demo.setProjectionHorizonMs(renderHorizonMs); }
    catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid projection horizon" });
        return;
    }
    state();
    // Applied/rejected prompt acknowledgements release transport flow. The
    // browser separately maps displayed state from chunk.prompt_version only.
    const version = Number(req.body.settledVersion ?? req.body.renderedVersion ?? 0);
    if (!Number.isInteger(version) || version < 0 || version > camera.snapshot().issued) {
        res.status(400).json({ error: "Invalid settled prompt version" });
        return;
    }
    const shot = camera.next(version);
    res.json({ type: "prompt", prompt: shot.prompt, prompt_version: shot.version, sourceMs: shot.sourceMs,
        sourceCapturedWallMs: shot.capturedWallMs });
});
app.post("/telemetry", (req, res) => { console.log(JSON.stringify({ phoneDirector: req.body })); res.sendStatus(204); });
app.post("/stop", async (_req, res) => { await stop(); res.sendStatus(204); });
const telemetrySchema = z.object({
    type: z.string().min(1).max(64), atMs: z.number().finite().min(0).max(600000), wallMs: z.number().finite().min(0),
    mediaTime: z.number().finite().min(0).max(600), playbackTime: z.number().finite().min(0).max(600), worldMs: z.number().finite().min(0).max(600000),
    sent: z.number().int().min(0), settled: z.number().int().min(0), displayed: z.number().int().min(0),
    promptVersion: z.number().int().positive().optional(), sourceMs: z.number().finite().min(0).max(600000).optional(),
    sourceCapturedWallMs: z.number().finite().min(0).optional(),
    chunkIndex: z.number().int().min(0).max(255).optional(), playbackSeconds: z.number().finite().positive().max(30).optional(),
    chunkStartSeconds: z.number().finite().min(0).max(600).optional(), sourceEpochWallMs: z.number().finite().min(0).optional(),
    requestedDurationSeconds: z.number().finite().min(5).max(15).optional(), generationSeconds: z.number().finite().min(0).max(600).optional(),
    bufferDepthSeconds: z.number().finite().min(0).max(600).optional(), reason: z.string().max(160).optional(), code: z.string().max(80).optional(),
    chunkDuration: z.number().finite().min(5).max(15).optional(), minChunkDuration: z.number().finite().min(1).max(30).optional(),
    maxChunkDuration: z.number().finite().min(1).max(30).optional(), defaultChunkDuration: z.number().finite().min(1).max(30).optional(),
    continuationPlaybackSeconds: z.number().finite().min(0).max(30).optional(), schedulingLeadMs: z.number().finite().optional(),
    schedulingSlackMs: z.number().finite().optional(), sourceToDisplayMs: z.number().finite().min(-600000).max(600000).optional(),
    sourceToFilmOffsetMs: z.number().finite().min(-600000).max(600000).optional(), frameCrossingLateMs: z.number().finite().min(0).max(600000).optional(),
}).strict();
const playbackSchema = z.object({ recordingStart: z.number().finite().min(0).max(300), recordingEnd: z.number().finite().min(0).max(300),
    transportBeganWallMs: z.number().finite().min(0), telemetry: z.array(telemetrySchema).max(2048), chunks: z.array(z.object({
    index: z.number().int().min(0), start: z.number().finite().min(0), end: z.number().finite().positive(), version: z.number().int().positive(),
})).max(256) });
let playbackSaved = false;
app.post("/playback", async (req, res) => {
    if (!started || !stopped || playbackSaved) { res.sendStatus(409); return; }
    const parsed = playbackSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.recordingEnd < parsed.data.recordingStart || parsed.data.chunks.some((c, i, chunks) => c.index !== i || c.start !== (i ? chunks[i - 1].end : 0) || c.end <= c.start || c.version > camera.snapshot().issued)) {
        res.status(400).json({ error: "Invalid playback timeline" }); return;
    }
    playbackSaved = true;
    try {
        await stop();
        await writeFile(resolve(runDirectory, "playback.json"), JSON.stringify({ ...parsed.data,
            alignment: "provider chunk versions with requestVideoFrameCallback segment crossings; visual semantics remain best-effort" }, null, 2), { flag: "wx", mode: 0o600 });
        res.sendStatus(204);
    } catch { res.status(500).json({ error: "Could not save playback metadata" }); }
});
installDirectorRecording(app, () => started && stopped, runDirectory);
app.post("/proxy", async (req, res) => {
    const target = req.get("x-fal-target-url") ?? "";
    if (!render || !prepared || stopped || !isDirectorProxyTarget(target)) {
        res.sendStatus(403);
        return;
    }
    if ((target.endsWith("/ice") || target.endsWith("/session")) && req.body.app_id !== "minimax/h3-max/director") {
        res.sendStatus(403);
        return;
    }
    const sessionAllocation = target.endsWith("/session");
    if (sessionAllocation) {
        if (allocated || allocating) {
            res.sendStatus(409);
            return;
        }
        allocating = true;
    }
    try {
        const response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
            headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
        if (sessionAllocation && response.ok)
            allocated = true;
        res.status(response.status).type("json").send(await response.text());
    }
    catch {
        res.status(502).json({ error: "Director connection failed" });
    }
    finally {
        if (sessionAllocation)
            allocating = false;
    }
});
const port = Number(process.env.ARGOS_DEMO_PORT ?? 3462);
const server = app.listen(port, "127.0.0.1", () => console.log(`PHONE_DEMO_READY http://127.0.0.1:${port}/#${token}`));
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
        void stop().finally(() => server.close());
        setTimeout(() => process.exit(0), 3000).unref();
    });
}
