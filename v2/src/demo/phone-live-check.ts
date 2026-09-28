/** Opt-in live cognition integration check. No FAL session or video spend. */
import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PhoneDemo } from "./phone-demo";
import { getAgentWorldCapabilities } from "../cognition/world-capabilities";
import { evaluatePhoneRun } from "./phone-evaluation";
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");
const demo = await PhoneDemo.createLivingWorld();
const directory = resolve("recordings", `phone-live-check-${Date.now()}`);
const began = Date.now();
const durationMs = Math.min(300_000, Math.max(30_000, Number(process.env.ARGOS_PHONE_CHECK_SECONDS || 180) * 1000));
const messageAtMs = Math.max(0, Number(process.env.ARGOS_PHONE_CHECK_MESSAGE_SECONDS || 8) * 1000);
const scenario = process.env.ARGOS_PHONE_CHECK_SCENARIO || "normal";
if (!["normal", "moved", "power"].includes(scenario)) throw new Error("Unknown scenario: use normal, moved or power");
let success = false, accepted = false, lastSequence = 0, sent = false;
const history: ReturnType<typeof demo.snapshot>["receipts"] = [];
const privacyViolations: string[] = [];
let changed = false, restored = false;
try {
    demo.start();
    if (scenario === "power") demo.controlPhone({ battery: 0 });
    await demo.prepareOpening();
    demo.sim.start();
    const runningAt = Date.now();
    while (Date.now() - runningAt < durationMs) {
        const s = demo.snapshot();
        if (scenario === "moved" && sent && !changed && s.phase === "walking" && ["Bedroom", "Stairs"].includes(s.destination || "")) {
            demo.controlPhone({ location: "Landing" }); changed = true;
        }
        if (scenario === "power" && !restored && s.elapsedMs >= 15000) { demo.controlPhone({ battery: 72 }); restored = true; }
        if (!sent && s.elapsedMs >= messageAtMs) {
            demo.sendMessage("Mara, it's me. Please read this and text me back before going further. There is someone down there.");
            sent = true;
        }
        for (const r of s.receipts.filter(r => r.sequence > lastSequence)) {
            history.push(r);
            console.log(JSON.stringify({ atMs: r.atMs, kind: r.kind, text: r.text }));
        }
        lastSequence = s.receipts.at(-1)?.sequence ?? 0;
        const context = getAgentWorldCapabilities(demo.sim.world, demo.ids.mara)?.context() || "";
        for (const message of s.messages.filter(m => m.direction === "in" && m.status !== "read")) {
            if (context.includes(message.body)) privacyViolations.push(`Unread message ${message.id} in NPC context at ${s.elapsedMs}ms`);
        }
        if (s.messages.some(m => m.direction === "out" && m.status === "delivered")) {
            success = true;
            break;
        }
        await sleep(250);
    }
}
finally {
    demo.stop();
    await mkdir(directory, { recursive: true });
    const snapshot = demo.snapshot();
    const evaluation = evaluatePhoneRun(snapshot, history, privacyViolations);
    accepted = Object.values(evaluation.gates).every(value => value === true);
    await writeFile(resolve(directory, "result.json"), JSON.stringify({ success, scenario, interventionApplied: changed || restored, wallMs: Date.now() - began, ...snapshot, history, evaluation }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ evaluation }));
}
console.log(JSON.stringify({ success, accepted, directory }));
if (!success || !accepted)
    process.exitCode = 1;
