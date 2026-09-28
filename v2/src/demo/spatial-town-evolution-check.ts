/** One prospectively bounded live observation, not an acceptance/endurance gate.
 * Against an already-ready local test server. Never forces weather, builds or
 * NPC actions. World/session saving remains the server's normal stop path. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SpatialViewState } from "./spatial-contract";

const url = new URL(process.argv[2] ?? ""), output = process.argv[3];
if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || !/^[a-f0-9]{48}$/.test(url.hash.slice(1)) || !output)
  throw Error("Supply an exact local session URL and evidence directory");
const headers = { authorization: `Bearer ${url.hash.slice(1)}`, "content-type": "application/json" };
const request = async (path: string, post = false): Promise<SpatialViewState> => {
  const result = await fetch(new URL(path, url.origin), { headers, signal: AbortSignal.timeout(5000),
    ...(post ? { method: "POST", body: "{}" } : {}) });
  if (!result.ok) throw Error(`Local ${path} returned ${result.status}`);
  return result.json() as Promise<SpatialViewState>;
};
const initial = await request("/api/state");
if (initial.status !== "ready" || initial.limits.seconds !== 120 || !initial.townLife?.enabled)
  throw Error("This check requires an untouched 120-second evolving live town");
const samples: unknown[] = [], events = new Map<number, SpatialViewState["events"][number]>(), moved = new Set<string>();
let final = initial, failure: string | undefined;
const started = performance.now();
try {
  await request("/api/start", true);
  while (performance.now() - started < 130_000) {
    final = await request("/api/state");
    if (final.sourceId !== initial.sourceId) throw Error("Source changed during observation");
    for (const event of final.events) events.set(event.id, event);
    for (const actor of final.entities.filter(e => e.kind === "actor")) {
      const before = initial.entities.find(e => e.key === actor.key);
      if (before && Math.hypot(actor.position.x - before.position.x, actor.position.z - before.position.z) > .2) moved.add(actor.name);
    }
    samples.push({ wallMs: performance.now() - started, simMs: final.atSimMs, entities: final.entities.length,
      thoughtCount: final.actors.filter(a => a.thought).length, weather: final.weather,
      actors: final.entities.filter(e => e.kind === "actor").map(e => ({ key: e.key, position: e.position, activity: e.activity })) });
    if (!final.running) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} catch (error) { failure = String(error); }
finally {
  try { final = await request("/api/stop", true); } catch (error) { failure = `${failure ?? ""} Save/stop: ${String(error)}`; }
  const wallMs = performance.now() - started;
  const evidence = { kind: "bounded-observation-not-endurance", wallMs, sourceId: initial.sourceId, simulationMs: final.atSimMs,
    realtimeFactor: final.atSimMs / wallMs, moved: [...moved], failure, final, events: [...events.values()], samples };
  await writeFile(resolve(output, "evolution-check.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ kind: evidence.kind, wallMs, simulationMs: final.atSimMs, realtimeFactor: evidence.realtimeFactor,
    moved: evidence.moved, failure, weather: final.weather, life: final.townLife, evidenceFile: resolve(output, "evolution-check.json") }));
}
if (failure) process.exitCode = 1;
