import express from "express";
import { build } from "esbuild";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Read-only playback of one explicitly selected local run. No model, world loop,
 * proxy, or write routes are created. The same capability boundary protects media. */
export async function createPhoneReplayApp(directory: string, token: string) {
    const root = await realpath(resolve("recordings"));
    const run = await realpath(resolve(directory));
    if (dirname(run) !== root || !basename(run).startsWith("phone-")) throw new Error("Choose one phone-* run directly inside recordings.");
    const snapshot = JSON.parse(await readFile(resolve(run, "demo.json"), "utf8"));
    const playback = JSON.parse(await readFile(resolve(run, "playback.json"), "utf8"));
    if (!snapshot.camera?.shots?.every((s: { presentation?: unknown }) => s.presentation) || !Array.isArray(playback.chunks))
        throw new Error("This run does not contain synchronized presentation metadata.");
    const media = (await readdir(run)).filter(name => /^director-.*\.(mp4|webm)$/.test(name));
    if (media.length !== 1) throw new Error("The selected run must contain one saved video.");
    const video = await realpath(resolve(run, media[0]));
    if (dirname(video) !== run) throw new Error("The recording must be inside the selected run.");
    const asset = (name: string) => fileURLToPath(new URL(name, import.meta.url));
    const bundle = await build({ entryPoints: [asset("phone-client.mjs")], bundle: true, write: false, platform: "browser", format: "esm" });
    const app = express();
    app.get("/", async (_req, res) => res.type("html").send(await readFile(asset("phone-demo.html"), "utf8")));
    app.get("/demo.css", async (_req, res) => res.type("css").send(await readFile(asset("phone-demo.css"), "utf8")));
    app.get("/client.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
    app.use((req, res, next) => {
        const supplied = Buffer.from(req.get("x-argos-token") ?? ""), expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.sendStatus(403); return; }
        res.set("Cache-Control", "no-store"); next();
    });
    app.get("/state", (_req, res) => res.json({ ...snapshot, running: false, replay: true, videoAvailable: true }));
    app.get("/replay", (_req, res) => res.json(playback));
    app.get("/replay/video", (_req, res) => res.sendFile(video));
    app.post("/stop", (_req, res) => res.sendStatus(204)); // page cleanup is a no-op
    app.post("/telemetry", (_req, res) => res.sendStatus(204));
    app.use((_req, res) => res.status(405).json({ error: "Read-only replay. Start a fresh live run to interact." }));
    return app;
}
export async function servePhoneReplay(directory: string) {
    const token = randomBytes(24).toString("hex");
    const app = await createPhoneReplayApp(directory, token);
    const port = Number(process.env.ARGOS_DEMO_PORT ?? 3462);
    const server = app.listen(port, "127.0.0.1", () => console.log(`PHONE_REPLAY_READY http://127.0.0.1:${port}/#${token}`));
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
}
