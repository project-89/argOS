import { PhoneDemo, type PhoneChoice } from "../phone-demo";
import { PhoneCameraDirector } from "../phone-director";
import { getDirectContainer } from "../../ecs/location";
import { Description } from "../../ecs/components";

const action = (d: PhoneDemo, action: PhoneChoice["action"]) => d.applyChoice({ action, thought: `Considering ${action}.` });
test("opening shot is an enclosed interior and reads the actual room description", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        expect(getDirectContainer(d.sim.world, d.ids.phone)).toBe(d.ids.desk);
        expect(d.snapshot().phone).toMatchObject({ location: "Bedroom desk", room: "Bedroom" });
        Description.value[d.ids.landing] += " A distinctive blue runner rug.";
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        const prompt = camera.next().prompt;
        expect(prompt).toContain("INTERIOR ONLY");
        expect(prompt).toContain("blue runner rug");
        expect(prompt).toContain("ground-floor hallway");
        expect(prompt).toContain("ceiling-cutaway");
        expect(prompt).toContain("Mara's hands and pockets contain NO phone");
        expect(prompt).toContain("lying face up on the wooden Bedroom desk");
    } finally { d.stop(); }
});
test("pickup has a physical source, duration and committed transfer, all retained in camera coverage", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); action(d, "go_phone"); d.advance(12000);
        const camera = new PhoneCameraDirector();
        action(d, "take_phone"); camera.observe(d.snapshot());
        const reaching = camera.next();
        expect(reaching.kind).toBe("pickup");
        expect(reaching.presentation.mara.heldPhone).toBe(false);
        expect(reaching.prompt).toContain("Her hands start empty");
        expect(reaching.prompt).toContain("do not complete the lift yet");
        expect(d.observe().allowedActions).not.toContain("read_phone");
        d.advance(3999);
        expect(getDirectContainer(d.sim.world, d.ids.phone)).toBe(d.ids.desk);
        d.advance(1); camera.observe(d.snapshot());
        expect(getDirectContainer(d.sim.world, d.ids.phone)).toBe(d.ids.mara);
        const holding = camera.next(reaching.version);
        expect(holding.presentation.mara.heldPhone).toBe(true);
        expect(holding.prompt).toContain("finish the lift into her hand");
        expect(reaching.presentation.phone.location).toBe("Bedroom desk");
        expect(d.snapshot().receipts.find(r => r.kind === "phone_picked_up")?.text).toContain("from Bedroom desk");
    } finally { d.stop(); }
});
test.each(["Basement", "Landing"] as const)("moving the phone to %s mid-reach cancels pickup, not a remote transfer", async location => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); action(d, "go_phone"); d.advance(12000); action(d, "take_phone");
        d.advance(2000); d.controlPhone({ location }); d.advance(2000);
        expect(d.snapshot().mara.heldPhone).toBe(false);
        expect(d.snapshot().phone.location).toBe(location);
        expect(d.snapshot().receipts.some(r => r.kind === "phone_picked_up")).toBe(false);
        expect(d.snapshot().receipts.at(-1)?.kind).toBe("action_failed");
    } finally { d.stop(); }
});
test("dead phone can still be picked up; a moved phone is prompted at its new physical surface", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); d.controlPhone({ location: "Landing", battery: 0 }); action(d, "take_phone");
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        expect(camera.next().prompt).toContain("lying on the floor inside Landing");
        d.advance(4000);
        expect(d.snapshot().mara.heldPhone).toBe(true);
        expect(d.snapshot().screen).toBeNull();
    } finally { d.stop(); }
});
