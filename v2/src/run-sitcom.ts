/** Opt-in, bounded live cognition. No renderer, world evolution, or server. */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline";
import { ApartmentSitcom, type SitcomCharacter } from "./demo/apartment-sitcom";
import { evaluateSitcom, renderSitcomReplay, sitcomFrame, type SitcomFrame } from "./demo/sitcom-report";
import { getCommittedEvents, subscribeCommittedEvents } from "./runtime/committed-events";
import { serializeWorld } from "./persistence/world-persistence";
import { getWorkingMemory } from "./cognition/working-memory";
import { getSocialDialogue, getSocialExchanges } from "./cognition/social-memory";
import { MODEL_IDS } from "./llm/config";

const live = process.argv.includes("--live");
const seconds = Number(process.argv.find(arg => arg.startsWith("--seconds="))?.split("=")[1] ?? 120);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) throw new Error("Choose --seconds=5..120; each run is bounded to two minutes.");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for --live");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "sitcom-"));
const originals = { log: console.log, warn: console.warn, error: console.error };
const log = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
let logBytes = 0;
for (const method of ["log", "warn", "error"] as const) console[method] = (...args: unknown[]) => {
  const text = format(...args) + "\n"; if (logBytes < 5_000_000) { log.write(text); logBytes += Buffer.byteLength(text); }
};
originals.log(`${live ? "LIVE PRODUCTION ARGOS" : "PASSIVE OFFLINE PHYSICS FIXTURE"} · The Last Cookie · H3/evolution disabled\nArtifacts: ${directory}`);
let testbed: ApartmentSitcom | undefined, terminal: ReturnType<typeof createInterface> | undefined;
let unsubscribe: (() => void) | undefined, stoppedByOperator = false, error: string | null = null;
const frames: SitcomFrame[] = [];
let droppedFrames = 0;
const capture = () => { if (!testbed) return; if (frames.length < 6000) frames.push(sitcomFrame(testbed)); else droppedFrames++; };
const onInterrupt = () => { stoppedByOperator = true; testbed?.stop(); };
process.once("SIGINT", onInterrupt);
try {
  testbed = await ApartmentSitcom.create({ live });
  testbed.onEvent(event => {
    capture();
    if (event.kind === "thought" && event.thoughtType === "reasoning" || event.kind === "speech" && event.status === "succeeded"
      || ["operator_text", "phone_read", "reply_delivered"].includes(event.kind) || event.status === "failed")
      originals.log(`[${(event.atSimMs / 1000).toFixed(1)}s] ${event.actor ?? "World"} ${event.kind}: ${event.text}`);
  });
  unsubscribe = subscribeCommittedEvents(testbed.sim.world, capture);
  capture(); await testbed.start();
  if (live && process.stdin.isTTY) {
    terminal = createInterface({ input: process.stdin, output: process.stdout });
    originals.log("Commands: /text your message; /thought Elaine | subtle thought; /state; /stop");
    terminal.on("line", line => {
      try {
        if (line === "/stop") { onInterrupt(); return; }
        if (line === "/state") { originals.log(testbed!.snapshot().facts); return; }
        if (line.startsWith("/text ")) { testbed!.text(line.slice(6)); return; }
        const match = /^\/thought\s+(Jerry|George|Elaine|Kramer)\s*\|\s*(.+)$/.exec(line);
        if (!match) throw new Error("Use /text message, /thought Elaine | thought, /state or /stop");
        testbed!.plantThought(match[1] as SitcomCharacter, match[2]);
      } catch (error) { originals.error(String(error)); }
    });
  }
  const began = performance.now(); let nextState = 15_000;
  if (live) while (testbed.running && testbed.elapsedMs < seconds * 1000 && performance.now() - began < seconds * 1000) {
    capture();
    if (testbed.elapsedMs >= nextState) { originals.log(`STATE ${(testbed.elapsedMs / 1000).toFixed(1)}s ${JSON.stringify(testbed.snapshot().facts)}`); nextState += 15_000; }
    await sleep(250);
  }
  else { // No NPC intention/dialogue script: explicit causal fixtures are in tests.
    for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 500) { testbed.advance(Math.min(500, seconds * 1000 - elapsed)); capture(); }
  }
  testbed.stop(); capture();
  const snapshot = testbed.snapshot(), evaluation = evaluateSitcom(testbed), publicEvents = getCommittedEvents(testbed.sim.world).events;
  const actors = testbed.characters.map(name => ({ name, goals: testbed!.sim.getAgentGoals(name), memories: testbed!.sim.getAgentMemories(name),
    workingMemory: getWorkingMemory(testbed!.sim.world, testbed!.ids[name]), dialogue: getSocialDialogue(testbed!.sim.world, testbed!.ids[name]),
    exchanges: getSocialExchanges(testbed!.sim.world, testbed!.ids[name]) }));
  const result = { ...evaluation, models: live ? MODEL_IDS : null, limitSeconds: seconds, stoppedByOperator, droppedFrames,
    final: { facts: snapshot.facts, actors: snapshot.actors, phone: snapshot.phone }, cognitiveState: actors };
  const save = (name: string, text: string) => writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
  await Promise.all([
    save("result.json", JSON.stringify(result, null, 2)), save("events.jsonl", snapshot.events.map(event => JSON.stringify(event)).join("\n") + "\n"),
    save("public-events.jsonl", publicEvents.map(event => JSON.stringify(event)).join("\n") + "\n"),
    save("frames.json", JSON.stringify(frames)), save("replay.html", renderSitcomReplay(frames, publicEvents, snapshot.events)),
    save("world.json", JSON.stringify(serializeWorld(testbed.sim.world, testbed.sim.god.systemRegistry), null, 2)),
    save("report.md", `# The Last Cookie\n\n${live ? "Live production Argos cognition" : "Passive offline physics fixture — NOT autonomous cognition evidence"}. Four characters, one real cookie and a real phone. H3 and world evolution disabled.\n\n${(snapshot.atSimMs / 1000).toFixed(1)} simulated seconds; max ${seconds} wall seconds after startup. The text at 25s is an explicit operator stimulus, not autonomous narration.\n\nOpen replay.html for one latest authored thought per actor, actually spoken partial words, phone conversation and simple ECS facts at the same source playhead. Injected and background thoughts never replace the authored-thought cards.\n\n## Observed gates\n\n${Object.entries(evaluation.gates).map(([key, value]) => `- ${key}: ${value ? "observed" : "not observed"}`).join("\n")}\n\n## Limitations\n\nA single short trial does not prove social naturalness. result.json includes concrete causal chains, failed actions, exact simultaneous voice intervals and quoted repetition candidates for review. Read-before-reply and unread-body checks are bounded diagnostics, not a proof against all possible paraphrased knowledge leakage. The ECS checkpoint is not a resumable package session.\n\nArtifacts contain operator-visible private thoughts and seeded memories; do not treat them as another NPC's knowledge or publish them accidentally.\n`),
  ]);
  originals.log(`RESULT ${JSON.stringify({ directory, live, atSimMs: snapshot.atSimMs, gates: evaluation.gates, actors: evaluation.actors })}`);
} catch (caught) {
  error = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
  await writeFile(join(directory, "failure.json"), JSON.stringify({ error, events: testbed?.snapshot().events ?? [] }, null, 2), { flag: "wx", mode: 0o600 });
} finally {
  process.removeListener("SIGINT", onInterrupt); terminal?.close(); unsubscribe?.(); testbed?.stop();
  Object.assign(console, originals); await new Promise<void>(done => log.end(done));
}
if (error) { console.error(error); process.exitCode = 1; }
