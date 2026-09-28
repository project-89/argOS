/** Headless renderer-bridge check. No H3 session or video spending. Default is a
 * scripted offline fixture; --live explicitly enables bounded NPC model calls. */
import "dotenv/config";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ApartmentSitcom } from "./apartment-sitcom";
import { SitcomDirector, type SitcomRenderSegment } from "./sitcom-director";
const live = process.argv.includes("--live");
const seconds = Number(process.argv.find(a => a.startsWith("--seconds="))?.split("=")[1] ?? (live ? 110 : 240));
if (!Number.isInteger(seconds) || seconds < 20 || seconds > (live ? 120 : 1800)) throw new Error("Invalid bounded check duration");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Live NPC check requires the configured Google key");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "sitcom-renderer-check-"));
console.log(`RENDERER_CHECK ${live ? "live NPCs; H3 disabled" : "scripted offline physics; not autonomous cognition"} ${directory}`);
const t = await ApartmentSitcom.create({ live, narrativeMind: true, experienceReconsideration: true, outsideTextAtMs: null });
const director = new SitcomDirector(t), scripts: SitcomRenderSegment[] = [];
let failure: unknown = null, textSent = false, message: number | undefined, nextIssue = 17000;
const remove = t.onEvent(e => { if (["phone_read", "reply_delivered"].includes(e.kind)) console.log(`RENDERER_CHECK_EVENT ${e.atSimMs} ${e.kind}`); });
const issue = () => {
  const next = director.next(scripts.at(-1)?.version);
  if ("segment" in next) { if (scripts.at(-1)?.version !== next.segment.version) scripts.push(next.segment); }
  else if ("ended" in next && next.reason) throw new Error(JSON.stringify({ ...next, status: director.status() }));
  return next;
};
try {
  await t.start(); const started = performance.now();
  while (t.elapsedMs < seconds * 1000 && (!live || performance.now() - started < seconds * 1000 + 5000)) {
    const ms = t.elapsedMs;
    if (!textSent && ms >= 25000) { message = t.text("Please check your phone and tell me where you are.", "renderer check"); textSent = true; }
    if (!live) {
      if (ms === 35000) t.dispatch("Elaine", { type: "move", target: "Kitchen" });
      if (ms === 39000) t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" });
      if (ms === 42500) t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
      if (ms === 47000) t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: message, text: "I am in Jerry's kitchen." })}` });
      if (ms % 10000 === 0) t.dispatch(ms % 20000 === 0 ? "Jerry" : "George", { type: "speak", content: `We can discuss item ${ms / 1000} after you put that down.` });
      t.advance(500);
    } else await delay(250);
    if (t.elapsedMs >= nextIssue) { issue(); nextIssue += 17000; }
  }
  t.stop(); while ("segment" in issue()) { /* drain all already-lived evidence */ }
} catch (error) { failure = String(error); process.exitCode = 1; }
finally {
  const status = director.status(); director.stop(); remove(); t.stop();
  const snapshot = t.snapshot();
  const report = { live, h3: false, atSimMs: t.elapsedMs, failure, status,
    segments: scripts.length, sourceThroughMs: scripts.at(-1)?.sourceEndSimMs ?? 0,
    promptCharacters: scripts.map(s => s.prompt.length), speechLines: scripts.flatMap(s => s.script.beats).filter(b => b.kind === "speech").length,
    phone: snapshot.phone, facts: snapshot.facts };
  await Promise.all([writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 }),
    writeFile(resolve(directory, "screenplay.json"), JSON.stringify(director.screenplay(), null, 2), { flag: "wx", mode: 0o600 }),
    writeFile(resolve(directory, "prompts.md"), `# Actual renderer instructions\n\n${live ? "Live NPC cognition" : "Scripted offline physics fixture"}; no H3 calls.\n\n` + scripts.map(s =>
      `## Version ${s.version} · ${s.sourceStartSimMs / 1000}–${s.sourceEndSimMs / 1000}s\n\n\`\`\`text\n${s.prompt}\n\`\`\`\n`).join("\n"), { flag: "wx", mode: 0o600 })]);
  console.log(`RENDERER_CHECK_RESULT ${JSON.stringify({ ...report, phone: report.phone.map(m => ({ direction: m.direction, status: m.status })), directory })}`);
}
