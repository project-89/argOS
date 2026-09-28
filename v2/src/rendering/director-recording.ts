import express, { type Express } from "express";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Install after authentication. One local recording per stopped session; no publishing. */
export function installDirectorRecording(app: Express, canSave: () => boolean, directory = resolve("recordings")) {
  let saved = false;
  app.post("/recording", express.raw({ type: ["video/mp4", "video/webm"], limit: "64mb" }), async (req, res) => {
    if (!canSave() || saved) { res.sendStatus(409); return; }
    if (!Buffer.isBuffer(req.body) || !req.body.length) { res.sendStatus(400); return; }
    saved = true;
    const extension = req.is("video/mp4") ? "mp4" : "webm";
    const path = resolve(directory, `director-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.${extension}`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path, req.body, { flag: "wx", mode: 0o600 });
      res.json({ path, bytes: req.body.length, mimeType: `video/${extension}` });
    } catch {
      saved = false;
      res.status(500).json({ error: "Could not save recording; use the browser download" });
    }
  });
}
