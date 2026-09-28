import express from "express";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDirectorRecording } from "../director-recording";

test("saves only after stop, rejects malformed MIME, and never overwrites a recording", async () => {
  const directory = await mkdtemp(join(tmpdir(), "argos-recorder-test-"));
  const app = express();
  app.use(express.json());
  let stopped = false;
  installDirectorRecording(app, () => stopped, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const upload = (type = "video/mp4", body = "test media") => fetch(`http://127.0.0.1:${address.port}/recording`, {
    method: "POST", headers: { "Content-Type": type }, body,
  });
  try {
    expect((await upload()).status).toBe(409);
    stopped = true;
    // MediaRecorder's unquoted codec list is NOT a valid HTTP Content-Type.
    expect((await upload("video/mp4;codecs=avc1.42001E,mp4a.40.2")).status).toBe(400);
    expect((await upload("video/mp4", "")).status).toBe(400);
    const response = await upload();
    expect(response.status).toBe(200);
    const result = await response.json() as { path: string; bytes: number };
    expect(result.path.startsWith(directory)).toBe(true);
    expect(await readFile(result.path, "utf8")).toBe("test media");
    expect(result.bytes).toBe(10);
    expect((await upload()).status).toBe(409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
