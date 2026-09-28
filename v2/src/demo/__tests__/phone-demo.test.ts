import { addComponent, addEntity, Prefab } from "bitecs";
import { PhoneDemo, phoneFixture, type PhoneChoice, type PhoneDecider } from "../phone-demo";
import { PhoneCameraDirector } from "../phone-director";
import { inspectEcs } from "../ecs-inspector";
import { serializeWorld } from "../../persistence/world-persistence";
import { getDirectContainer } from "../../ecs/location";
import { Name, Inventory } from "../../ecs/components";
import { attachToEntity, registryCreateComponent } from "../../ecs/component-registry";
const wait: PhoneDecider = async () => ({ action: "wait", thought: "Wait and listen." });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const action = (demo: PhoneDemo, action: PhoneChoice["action"], extra: Partial<PhoneChoice> = {}) => demo.applyChoice({ action, thought: `Consider ${action}.`, ...extra });
function fetchPhone(demo: PhoneDemo) { action(demo, "go_phone"); demo.advance(12000); action(demo, "take_phone"); demo.advance(4000); }
test("delivery is not knowledge: the full physical read/type/reply chain writes actual ECS and memories", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const message = demo.sendMessage("Don't open the basement door. THE_SECRET_947");
        expect(demo.snapshot().messages[0].status).toBe("delivered");
        expect(JSON.stringify(demo.observe())).not.toContain("THE_SECRET_947");
        expect(demo.observe().perceptions.at(-1)).toContain("buzzes");
        action(demo, "read_phone");
        expect(demo.snapshot().mara.readCount).toBe(0);
        fetchPhone(demo);
        expect(getDirectContainer(demo.sim.world, demo.ids.phone)).toBe(demo.ids.mara);
        expect(JSON.parse(Inventory.items[demo.ids.mara])).toContain(demo.ids.phone);
        action(demo, "read_phone");
        demo.advance(4000);
        expect(demo.observe().readMessages).toEqual([]);
        demo.advance(1000);
        expect(demo.observe().readMessages).toEqual([{ id: message, body: "Don't open the basement door. THE_SECRET_947", replied: false }]);
        action(demo, "reply", { reply: "Who is this?", replyTo: message });
        demo.advance(6000);
        expect(demo.snapshot().messages).toHaveLength(1);
        demo.advance(1000);
        expect(demo.snapshot().messages[1]).toMatchObject({ direction: "out", status: "delivered", body: "Who is this?", replyTo: message });
        const saved = serializeWorld(demo.sim.world, demo.sim.god.systemRegistry);
        expect(saved.entities.some(e => e.components.DemoMessage?.body === "Who is this?")).toBe(true);
        expect(saved.entities.some(e => String(e.components.Memory?.content).includes("THE_SECRET_947"))).toBe(true);
        expect(saved.componentDefinitions?.some(c => c.name === "DemoPhone")).toBe(true);
    }
    finally {
        demo.stop();
    }
});
test.each(["power", "network"])("%s gates delivery; restoring it delivers exactly once", async (gate) => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        demo.controlPhone(gate === "power" ? { battery: 0 } : { online: false });
        const before = demo.observe();
        demo.sendMessage("Unknown until delivered and read.");
        expect(demo.observe()).toEqual(before);
        expect(demo.snapshot()).toMatchObject({ phone: { unread: 0 }, messages: [{ status: "queued" }] });
        demo.controlPhone(gate === "power" ? { battery: 72 } : { online: true });
        demo.advance(1000);
        await flush();
        demo.advance(1000);
        expect(demo.snapshot().phone.unread).toBe(1);
        expect(demo.snapshot().receipts.filter(r => r.kind === "delivered")).toHaveLength(1);
        expect(demo.observe().readMessages).toEqual([]);
    }
    finally {
        demo.stop();
    }
});
test("silenced or isolated phones receive texts without broadcasting knowledge to a distant NPC", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        demo.controlPhone({ silent: true });
        const before = demo.observe();
        demo.sendMessage("SECRET IN SILENT MODE");
        expect(demo.observe()).toEqual(before);
        demo.controlPhone({ silent: false, location: "Basement" });
        const isolated = demo.observe();
        demo.sendMessage("SECRET BELOW FLOOR");
        expect(demo.observe()).toEqual(isolated);
        expect(demo.snapshot().phone.unread).toBe(2);
    }
    finally {
        demo.stop();
    }
});
test("moving the phone during a journey defeats remembered location; no remote pickup or invented reply", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        demo.sendMessage("A warning.");
        action(demo, "go_phone");
        const before = demo.observe();
        demo.controlPhone({ location: "Basement" });
        expect(demo.observe()).toEqual(before);
        demo.advance(12000);
        action(demo, "take_phone");
        action(demo, "reply", { reply: "I know your message.", replyTo: 123 });
        expect(demo.snapshot()).toMatchObject({ location: "Bedroom", mara: { heldPhone: false, readCount: 0 }, phone: { location: "Basement" } });
        expect(demo.snapshot().messages).toHaveLength(1);
        expect(demo.snapshot().receipts.filter(r => r.kind === "action_failed")).toHaveLength(2);
    }
    finally {
        demo.stop();
    }
});
test.each(["reading", "typing"])("power loss cancels %s without manufacturing completion", async (phase) => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const message = demo.sendMessage("Stop at the door.");
        fetchPhone(demo);
        action(demo, "read_phone");
        if (phase === "typing") {
            demo.advance(5000);
            action(demo, "reply", { reply: "Who are you?", replyTo: message });
        }
        demo.controlPhone({ battery: 0 });
        demo.advance(8000);
        await flush();
        expect(demo.snapshot().messages).toHaveLength(1);
        expect(demo.snapshot().messages[0].status).toBe(phase === "reading" ? "delivered" : "read");
        expect(demo.snapshot().screen).toBeNull();
        expect(demo.snapshot().receipts.some(r => r.kind === "action_failed")).toBe(true);
    }
    finally {
        demo.stop();
    }
});
test("offline reading is valid; outgoing texts queue until network recovery, with no duplicate replies", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const id = demo.sendMessage("Don't go downstairs.");
        fetchPhone(demo);
        demo.controlPhone({ online: false });
        action(demo, "read_phone");
        demo.advance(5000);
        action(demo, "reply", { reply: "Why?", replyTo: id });
        demo.advance(7000);
        expect(demo.snapshot().messages[1]).toMatchObject({ status: "queued", direction: "out" });
        expect(demo.observe().allowedActions).not.toContain("reply");
        demo.controlPhone({ online: true });
        demo.advance(1000);
        expect(demo.snapshot().messages[1].status).toBe("delivered");
        expect(demo.snapshot().receipts.filter(r => r.kind === "reply_delivered")).toHaveLength(1);
    }
    finally {
        demo.stop();
    }
});
test("thought injection is not a text message or a mandatory action", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        demo.injectThought("Open the door right now.");
        demo.advance(1000);
        await flush();
        expect(demo.snapshot().door).toBe("closed");
        expect(demo.snapshot().messages).toHaveLength(0);
        expect(demo.snapshot().entities.some(e => e.components.Thought?.type === "injected")).toBe(true);
    }
    finally {
        demo.stop();
    }
});
test("stale cognition is rejected when new perceived input arrives, and stop rejects late actions", async () => {
    let finish!: (c: PhoneChoice) => void, signal!: AbortSignal;
    const demo = await PhoneDemo.create(async (_o, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
    try {
        demo.start();
        demo.advance(6000);
        demo.sendMessage("Don't open it.");
        finish({ action: "open_basement", thought: "Old decision." });
        await flush();
        expect(demo.snapshot().phase).toBe("idle");
        demo.advance(1000);
        demo.stop();
        expect(signal.aborted).toBe(true);
        finish({ action: "open_basement", thought: "Late decision." });
        await flush();
        expect(demo.snapshot()).toMatchObject({ phase: "idle", running: false, door: "closed" });
    }
    finally {
        demo.stop();
    }
});
test("registered physics runs end to end through the library's sim.step entrypoint", async () => {
    const demo = await PhoneDemo.create(phoneFixture);
    try {
        demo.start();
        demo.sendMessage("Don't open the basement door.");
        for (let i = 0; i < 48; i++) {
            await demo.sim.step();
            await flush();
        }
        expect(demo.snapshot().messages.some(m => m.direction === "out" && m.status === "delivered")).toBe(true);
        expect(demo.snapshot().elapsedMs).toBe(48000);
        expect(demo.snapshot().door).toBe("closed");
    }
    finally {
        demo.stop();
    }
});
test("the inspector enumerates new entities/components without the cached empty-query trap, excluding prefabs", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        inspectEcs(demo.sim.world);
        const id = addEntity(demo.sim.world);
        addComponent(demo.sim.world, id, Name);
        Name.value[id] = "New sensor";
        registryCreateComponent({ name: "DemoLiveSensor", description: "Live inspector test", properties: { charge: "number" } });
        attachToEntity(demo.sim.world, id, "DemoLiveSensor", { charge: 12 });
        expect(inspectEcs(demo.sim.world).find(e => e.id === id)?.components.DemoLiveSensor).toEqual({ charge: 12 });
        attachToEntity(demo.sim.world, id, "DemoLiveSensor", { charge: 5 });
        expect(inspectEcs(demo.sim.world).find(e => e.id === id)?.components.DemoLiveSensor.charge).toBe(5);
        addComponent(demo.sim.world, id, Prefab);
        expect(inspectEcs(demo.sim.world).some(e => e.id === id)).toBe(false);
    }
    finally {
        demo.stop();
    }
});
test("camera coverage is read-only, ordered, chunk-gated, and keeps past phone text aligned to its source shot", async () => {
    const demo = await PhoneDemo.create(wait), camera = new PhoneCameraDirector();
    try {
        demo.start();
        demo.injectThought("PRIVATE THOUGHT NOT FOR VIDEO");
        camera.observe(demo.snapshot());
        const first = camera.next();
        expect(first.prompt).not.toContain("PRIVATE THOUGHT NOT FOR VIDEO");
        const id = demo.sendMessage("Don't open it.");
        camera.observe(demo.snapshot());
        expect(camera.next().version).toBe(first.version);
        expect(camera.next(first.version).kind).toBe("phone_insert");
        fetchPhone(demo);
        action(demo, "read_phone");
        const before = JSON.stringify(demo.snapshot());
        camera.observe(demo.snapshot());
        expect(JSON.stringify(demo.snapshot())).toBe(before);
        const readShot = camera.next(2);
        expect(readShot.kind).toBe("hands_insert");
        expect(readShot.screen).toBeNull();
        demo.advance(5000);
        camera.observe(demo.snapshot());
        const committedRead = camera.next(readShot.version);
        expect(committedRead.screen?.body).toBe("Don't open it.");
        action(demo, "reply", { reply: "Who is this?", replyTo: id });
        camera.observe(demo.snapshot());
        const typing = camera.next(committedRead.version);
        expect(typing.screen).toEqual({ body: "Who is this?", typing: true, receivedBody: "Don't open it." });
        demo.controlPhone({ battery: 0 });
        camera.observe(demo.snapshot());
        expect(readShot.screen).toBeNull();
        expect(committedRead.screen?.body).toBe("Don't open it.");
        expect(typing.screen?.typing).toBe(true);
        expect(camera.next(typing.version).screen).toBeNull();
    }
    finally {
        demo.stop();
    }
});
