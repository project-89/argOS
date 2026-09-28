/** Offline editorial comparison over an unchanged recorded world. No cognition,
 * network calls, generated speech, or claims about H3's visual performance. */
import { readFile, mkdtemp, writeFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { CommittedSceneHistory } from "../rendering/committed-scene-history";
import { SitcomScreenwriter, type Screenplay, type PhoneSound } from "./sitcom-screenplay";

const input = process.argv[2];
if (!input || process.argv.length !== 3) throw new Error("Usage: tsx src/demo/sitcom-ensemble-check.ts RECORDING_DIRECTORY");
const source = resolve(input);
const saved = JSON.parse(await readFile(join(source, "scene-history.json"), "utf8"));
const before: Screenplay[] = JSON.parse(await readFile(join(source, "screenplay.json"), "utf8"));
const history = CommittedSceneHistory.restore(saved.history), writer = new SitcomScreenwriter();
const after: Screenplay[] = [];
for (const prior of before) {
  assert.equal(prior.performance.clock, "realtime");
  const roomIds = [...new Set(prior.performance.shots.map(s => s.roomId))];
  assert.equal(roomIds.length, 1); assert.ok(Number.isSafeInteger(roomIds[0]));
  const window = history.assembleWorld(prior.sourceStartSimMs, prior.sourceEndSimMs);
  assert.equal(window.status, "ready");
  if (window.status !== "ready") throw new Error("Saved source unavailable");
  const compiled = writer.compileWorld(window.window, (saved.sounds as PhoneSound[])
    .filter(s => s.atSimMs + 800 > prior.sourceStartSimMs && s.atSimMs < prior.sourceEndSimMs), prior.version,
    { mediaDurationMs: prior.performance.durationMs, promptStyle: prior.promptStyle,
      realtimeRoomId: roomIds[0], allowSpeechSlices: true, allowWordCuts: true });
  // A camera simplification must not become a rewritten or sped-up episode.
  assert.deepEqual(compiled.script.beats, prior.beats);
  for (const field of ["sourceMap", "cues", "coverage", "durationMs", "endingSilenceMs"] as const)
    assert.deepEqual(compiled.script.performance[field], prior.performance[field]);
  compiled.commit(); after.push(compiled.script);
}
const count = (s: Screenplay) => s.prompt.split("\n").filter(l => l.startsWith("Camera:")).length;
const report = { source, noNetwork: true, noH3: true, sameRecordedWorld: true,
  unchanged: ["beats", "dialogue", "cue times", "source/media mapping", "coverage", "duration"],
  segments: after.map((s, i) => ({ version: s.version, beforeCameraInstructions: count(before[i]), afterCameraInstructions: count(s),
    sourceStartSimMs: s.sourceStartSimMs, sourceEndSimMs: s.sourceEndSimMs })),
  totalBefore: before.reduce((n, s) => n + count(s), 0), totalAfter: after.reduce((n, s) => n + count(s), 0),
  caution: "Camera-instruction counts are not observed H3 cuts. Wider framing still needs visual and voice-attribution evaluation." };
const output = await mkdtemp(resolve("recordings", "sitcom-ensemble-check-")); await chmod(output, 0o700);
for (const [name, data] of [["report.json", JSON.stringify(report, null, 2)], ["screenplay.json", JSON.stringify(after, null, 2)],
  ["prompts.md", after.map(s => `## Version ${s.version}\n\n${s.prompt}\n`).join("\n")]])
  await writeFile(join(output, name), data, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output, ...report }));
