import { mkdirSync, realpathSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Exclusive hosted store ownership. Never guess that an existing lease is stale. */
export function claimEngineeringDirectory(directory: string): () => void {
  mkdirSync(directory, { recursive: true });
  const file = path.join(realpathSync(directory), ".argos-host-owner");
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  let fd: number;
  try { fd = openSync(file, "wx", 0o600); }
  catch (error: any) {
    if (error.code === "EEXIST") throw new Error("Engineering directory already owned; close its host or explicitly recover the stale .argos-host-owner file before reuse");
    throw error;
  }
  try { writeFileSync(fd, owner); } finally { closeSync(fd); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Do not remove another owner's lease if an operator replaced it.
    try { if (readFileSync(file, "utf8") === owner) unlinkSync(file); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
  };
}
