/** One isolated live Narrator decision. This is NOT an autonomous town trial:
 * resident cognition and the simulation clock are deliberately not running. */
import "dotenv/config";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SpatialDemo } from "./spatial-demo";
import { STORY_TOWN_NARRATOR_PROMPT, STORY_TOWN_STYLE } from "./spatial-town-story";
import { NarratorDefinition } from "../spirits/narrator-spirit";
import { createSpirit, createSpiritRegistry } from "../spirits/spirit-registry";
import { runSpiritCognition } from "../spirits/spirit-cognition";
import { captureSpiritPublicEventReview, getSpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import { getSimulationTaskSignal, withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";

if (process.argv.slice(2).join(" ") !== "--live") throw Error("Use --live for one paid Narrator decision, one HTTP attempt, 30 seconds maximum. No NPC inference or retries.");
const root = resolve("recordings"); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "town-narrator-check-")); chmodSync(directory, 0o700);
const save = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
save("protocol.json", { kind: "isolated-spirit-decision-not-autonomous-town", maxWallMs: 30_000, maxHttpAttempts: 1,
  npcInference: false, advancingClock: false, retries: 0, evaluatorEffects: 0,
  warning: "A native applied effect here does not prove subsequent autonomous resident response or full-loop reliability." });
const demo = await SpatialDemo.create({ scenario: "town", evolving: true, story: "community-drama", live: false, automaticClock: false });
const registry = createSpiritRegistry(demo.sim.world);
const narrator = createSpirit(registry, { ...structuredClone(NarratorDefinition), systemPrompt: STORY_TOWN_NARRATOR_PROMPT,
  canCreateEntities: false, canBakeSystems: false, canModifyMood: false, observationInterval: 25_000 });
demo.townLife!.weather.registerNarrator(registry, narrator, demo.storyEvents);
await demo.start(); const initial = demo.snapshot(); save("initial.json", initial);
const controller = new AbortController(), originalFetch = globalThis.fetch;
let requests = 0, failure: string | undefined, output: unknown;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (++requests > 1) throw Error("Narrator check HTTP budget exhausted; retries disallowed");
  const signals = [controller.signal, getSimulationTaskSignal(), init?.signal, input instanceof Request ? input.signal : undefined].filter((s): s is AbortSignal => !!s);
  return originalFetch(input, { ...init, signal: AbortSignal.any(signals) });
}) as typeof fetch;
const began = performance.now();
let expire!: () => void;
const expired = new Promise<never>((_resolve, reject) => { expire = () => { controller.abort(); reject(Error("Narrator check deadline expired")); }; });
const deadline = setTimeout(expire, 30_000);
try {
  output = await Promise.race([withSimulationTask(controller.signal, () => runSpiritCognition(narrator, demo.sim.world,
    demo.sim.god.registry, registry, [], `${STORY_TOWN_STYLE.narratorContext}\n${STORY_TOWN_STYLE.premise}`)), expired]);
} catch (error) { failure = String(error); }
finally {
  // Dedicated diagnostic process: keep the exhausted/aborted request guard in
  // place even if the provider SDK has a late retry continuation after timeout.
  clearTimeout(deadline); controller.abort();
  const final = demo.snapshot(), feedback = captureSpiritPublicEventReview(demo.sim.world, narrator, registry, () => true).input;
  const actors = (s: typeof final) => s.entities.filter(e => e.kind === "actor").map(e => ({ key: e.key, position: e.position, roomId: e.roomId }));
  const summary = { kind: "isolated-spirit-decision-not-autonomous-town", wallMs: performance.now() - began, requests, failure,
    nativeChanges: final.townLife!.changes.filter(r => r.status === "applied"),
    actorTransformsUnchanged: JSON.stringify(actors(initial)) === JSON.stringify(actors(final)),
    feedbackReceipts: feedback.environment.receipts, review: getSpiritPublicEventReviewStatus(demo.sim.world, narrator) };
  save("result.json", { summary, output }); save("final.json", final);
  demo.stop(); save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
  console.log("NARRATOR_CHECK", directory, JSON.stringify(summary));
}
if (failure) process.exitCode = 1;
