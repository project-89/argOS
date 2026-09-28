import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { createPhoneReplayApp } from "../phone-replay";

test("saved replay serves only the selected recording behind auth and exposes no simulation writes", async () => {
    await mkdir(resolve("recordings"), { recursive: true });
    const directory = await mkdtemp(resolve("recordings", "phone-replay-test-"));
    let server: Server | undefined;
    try {
        const snapshot = { running: true, camera: { shots: [{ version: 1, presentation: { elapsedMs: 0 } }] } };
        await writeFile(resolve(directory, "demo.json"), JSON.stringify(snapshot));
        await writeFile(resolve(directory, "playback.json"), JSON.stringify({ recordingStart: 0, chunks: [{ index: 0, start: 0, end: 10, version: 1 }] }));
        await writeFile(resolve(directory, "director-test.mp4"), "test media bytes");
        const app = await createPhoneReplayApp(directory, "test-capability");
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
        const headers = { "x-argos-token": "test-capability" };
        expect((await fetch(`${base}/state`)).status).toBe(403);
        expect((await fetch(`${base}/replay/video`)).status).toBe(403);
        expect(await (await fetch(`${base}/state`, { headers })).json()).toMatchObject({ running: false, replay: true });
        expect(await (await fetch(`${base}/replay/video`, { headers })).text()).toBe("test media bytes");
        expect(await (await fetch(`${base}/replay`, { headers })).json()).toMatchObject({ recordingStart: 0, chunks: [{ version: 1 }] });
        for (const path of ["/control", "/start", "/proxy", "/recording"]) expect((await fetch(`${base}${path}`, { method: "POST", headers })).status).toBe(405);
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});
test("replay refuses directories outside the recording-run boundary", async () => {
    await expect(createPhoneReplayApp("src/demo", "test")).rejects.toThrow("Choose one phone-*");
});
