import { jest } from "@jest/globals";
import { PhoneDemo, PHONE_BUZZ_MS, PHONE_REMINDER_MS, type PhoneChoice, type PhoneDecider } from "../phone-demo";
import { PhoneCameraDirector } from "../phone-director";
import { ObjectState } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";

const wait: PhoneDecider = async () => ({ action: "wait", thought: "I will listen for a moment." });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const act = (d: PhoneDemo, action: PhoneChoice["action"]) => d.applyChoice({ action, thought: `I intend to ${action}.` });

test("a genuine first decision is prepared at source zero, without advancing physical time", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "open_basement", thought: "I'll have a look at that door." }));
    try {
        d.start(); await d.prepareOpening();
        expect(d.snapshot()).toMatchObject({ elapsedMs: 0, phase: "opening", door: "closed", decisions: 1 });
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        const first = camera.next();
        expect(first.presentation.thoughts.at(-1)).toMatchObject({ atMs: 0, text: "I'll have a look at that door." });
        d.advance(4999); expect(d.snapshot().door).toBe("closed");
        d.advance(1); expect(d.snapshot().door).toBe("open");
    } finally { d.stop(); }
});

test("a stuck opening decider is bounded, cannot return an injected thought as a prepared decision, and rejects late work", async () => {
    const d = await PhoneDemo.create(async () => new Promise(() => {}));
    jest.useFakeTimers();
    try {
        d.start(); d.injectThought("This is not a completed decision.");
        const prepared = expect(d.prepareOpening()).rejects.toThrow("No video session was allocated");
        await jest.advanceTimersByTimeAsync(20000);
        await prepared;
        expect(d.snapshot()).toMatchObject({ elapsedMs: 0, phase: "idle", thinking: false });
    } finally { d.stop(); jest.useRealTimers(); }
});

test("unread reminders pulse repeatedly, identify her phone, and never disclose the unread body", async () => {
    const d = await PhoneDemo.create(wait);
    try {
        d.start(); d.sendMessage("UNREAD_SECRET_42");
        expect(d.snapshot().phone).toMatchObject({ buzzing: true, reminding: true, unread: 1 });
        d.advance(PHONE_BUZZ_MS); await flush();
        expect(d.snapshot().phone.buzzing).toBe(false);
        d.advance(PHONE_REMINDER_MS - PHONE_BUZZ_MS); await flush();
        expect(d.snapshot().phone.buzzing).toBe(true);
        d.advance(PHONE_REMINDER_MS); await flush();
        expect(d.snapshot().receipts.filter(r => r.kind === "phone_vibrated")).toHaveLength(3);
        expect(d.snapshot().receipts.filter(r => r.kind === "delivered")).toHaveLength(1);
        expect(d.observe().lastPhoneSound).toMatchObject({ source: "your phone", direction: "upstairs, from the bedroom" });
        expect(d.observe().perceptions.at(-1)).toContain("YOUR smartphone");
        expect(JSON.stringify(d.observe())).not.toContain("UNREAD_SECRET_42");
    } finally { d.stop(); }
});

test("an open basement doorway transmits recognizable phone sound; a closed door does not", async () => {
    const d = await PhoneDemo.create(wait);
    try {
        d.start(); setLocatedIn(d.sim.world, d.ids.mara, d.ids.basement);
        d.sendMessage("SECRET_BEHIND_DOOR");
        expect(d.observe().lastPhoneSound).toBeNull();
        ObjectState.current[d.ids.door] = "open";
        d.advance(1000); await flush();
        expect(d.observe().lastPhoneSound?.source).toBe("your phone");
        expect(JSON.stringify(d.observe())).not.toContain("SECRET_BEHIND_DOOR");
    } finally { d.stop(); }
});

test.each(["silent", "power", "read"])("%s stops reminders; unread notifications resume after unmute or power restoration", async gate => {
    const d = await PhoneDemo.create(wait);
    try {
        d.start(); d.sendMessage("Check this.");
        if (gate === "read") {
            act(d, "go_phone"); d.advance(12000); act(d, "take_phone"); d.advance(4000);
            act(d, "read_phone"); d.advance(5000);
        } else d.controlPhone(gate === "silent" ? { silent: true } : { battery: 0 });
        const count = d.snapshot().receipts.filter(r => r.kind === "phone_vibrated").length;
        d.advance(PHONE_REMINDER_MS); await flush();
        expect(d.snapshot().phone).toMatchObject({ buzzing: false, reminding: false });
        expect(d.snapshot().receipts.filter(r => r.kind === "phone_vibrated")).toHaveLength(count);
        if (gate !== "read") {
            d.controlPhone(gate === "silent" ? { silent: false } : { battery: 72 });
            expect(d.snapshot().phone).toMatchObject({ buzzing: true, reminding: true });
        }
    } finally { d.stop(); }
});

test("reminders do not starve a slow decision; an actual new notification still invalidates it", async () => {
    let finish!: (c: PhoneChoice) => void;
    const d = await PhoneDemo.create(async () => new Promise(resolve => { finish = resolve; }));
    try {
        d.start(); d.sendMessage("First text"); d.advance(1000);
        d.advance(12000); // further reminder while cognition is still pending
        finish({ action: "go_phone", thought: "That's my phone. I'll fetch it." }); await flush();
        expect(d.snapshot().phase).toBe("walking");
        d.advance(12000); // arrival starts next decision immediately
        d.sendMessage("Second text");
        finish({ action: "take_phone", thought: "Stale intention." }); await flush();
        expect(d.snapshot().phase).toBe("arrived");
        expect(d.snapshot().mara.thought).not.toBe("Stale intention.");
    } finally { d.stop(); }
});

test("waiting context exposes a stall without forcing her to obey a text or choose an action", async () => {
    const d = await PhoneDemo.create(wait);
    try {
        d.start(); await d.prepareOpening();
        d.advance(3000); await flush(); d.advance(3000); await flush();
        expect(d.observe()).toMatchObject({ consecutiveWaits: 3, waitingMs: 6000 });
        expect(d.snapshot().door).toBe("closed");
    } finally { d.stop(); }
});

test("repeated pulses do not create extra video beats; redundant unissued waits coalesce without rewriting history", async () => {
    const d = await PhoneDemo.create(wait), camera = new PhoneCameraDirector();
    try {
        d.start(); d.sendMessage("Hello"); await d.prepareOpening(); camera.observe(d.snapshot());
        const issued = camera.next();
        expect(issued.prompt).toContain("repeated every six seconds");
        act(d, "wait"); camera.observe(d.snapshot());
        act(d, "wait"); camera.observe(d.snapshot());
        expect(camera.snapshot()).toMatchObject({ issued: 1, pending: 1, coalesced: [2] });
        expect(camera.next(1).version).toBe(3);
        expect(issued.presentation.thoughts.at(-1)?.text).toBe("I will listen for a moment.");
        const before = camera.snapshot().shots.length;
        d.advance(PHONE_BUZZ_MS); camera.observe(d.snapshot());
        expect(camera.snapshot().shots).toHaveLength(before);
        d.controlPhone({ battery: 0 }); camera.observe(d.snapshot());
        expect(camera.next(3).prompt).toContain("No audible phone vibration");
    } finally { d.stop(); }
});
