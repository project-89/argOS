import { PhoneDemo, type PhoneChoice, type PhoneDecider } from "../phone-demo";
import { ObjectState } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";

const wait: PhoneDecider = async () => ({ action: "wait", thought: "I will listen." });
const act = (demo: PhoneDemo, action: PhoneChoice["action"], extra: Partial<PhoneChoice> = {}) =>
    demo.applyChoice({ action, thought: `I intend to ${action}.`, ...extra });

test("the render horizon forecasts only an accepted action's imminent physical milestone", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        act(demo, "go_phone");
        expect(demo.snapshot().projection).toMatchObject({
            phase: "walking", remainingMs: 12000, destination: "Bedroom", milestone: null,
        });

        demo.advance(6999);
        expect(demo.snapshot().projection?.milestone).toBeNull();
        demo.advance(1);
        const accepted = demo.snapshot().projection!;
        expect(accepted).toMatchObject({
            phase: "walking",
            remainingMs: 5000,
            milestone: { event: "arrive", atMs: 12000, inMs: 5000 },
        });

        demo.advance(5000);
        expect(demo.snapshot()).toMatchObject({
            location: "Bedroom", phase: "arrived", projection: null,
            actionCommits: [{ basisSequence: accepted.basisSequence, atMs: 12000, event: "arrive" }],
        });
    } finally { demo.stop(); }
});

test("a canonical phone move immediately kills a now-impossible pickup and its forecast", async () => {
    const demo = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        demo.start();
        act(demo, "go_phone"); demo.advance(1);
        act(demo, "take_phone");
        expect(demo.snapshot().projection).toMatchObject({
            phase: "picking_up",
            target: "Mara's phone",
            milestone: { event: "pickup", inMs: 4000 },
        });

        demo.controlPhone({ location: "Basement" });
        expect(demo.snapshot()).toMatchObject({
            phase: "idle",
            projection: null,
            mara: { heldPhone: false },
            phone: { room: "Basement" },
        });
        expect(demo.snapshot().actionCommits.some(commit => commit.event === "pickup")).toBe(false);
        expect(demo.snapshot().receipts.at(-2)?.kind === "action_failed" || demo.snapshot().receipts.at(-1)?.kind === "action_failed").toBe(true);
    } finally { demo.stop(); }
});

test("a cancelled trajectory cannot borrow the commit proof of a later retry", async () => {
    const demo = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        demo.start();
        act(demo, "go_phone"); demo.advance(1);
        act(demo, "take_phone");
        const cancelledBasis = demo.snapshot().projection!.basisSequence;
        demo.controlPhone({ location: "Basement" });

        demo.controlPhone({ location: "Bedroom" });
        act(demo, "take_phone");
        const retryBasis = demo.snapshot().projection!.basisSequence;
        expect(retryBasis).not.toBe(cancelledBasis);
        demo.advance(4000);

        const pickupCommits = demo.snapshot().actionCommits.filter(commit => commit.event === "pickup");
        expect(pickupCommits).toEqual([{ basisSequence: retryBasis, atMs: 4001, event: "pickup" }]);
    } finally { demo.stop(); }
});

test("a read forecast never leaks an unread body and power loss invalidates it immediately", async () => {
    const demo = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        demo.start();
        demo.sendMessage("PROJECTION_MUST_NOT_KNOW_947");
        act(demo, "go_phone"); demo.advance(1);
        act(demo, "take_phone"); demo.advance(4000);
        act(demo, "read_phone");

        const projection = demo.snapshot().projection;
        expect(projection).toMatchObject({ phase: "reading", milestone: { event: "read", inMs: 5000 } });
        expect(JSON.stringify(projection)).not.toContain("PROJECTION_MUST_NOT_KNOW_947");
        expect(demo.snapshot().screen).toBeNull();

        demo.controlPhone({ battery: 0 });
        expect(demo.snapshot()).toMatchObject({ phase: "idle", projection: null, mara: { readCount: 0 } });
        expect(demo.snapshot().messages[0].status).toBe("delivered");
    } finally { demo.stop(); }
});

test("the conditional horizon follows the renderer's negotiated segment duration without advancing ECS", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        act(demo, "go_phone");
        demo.setProjectionHorizonMs(10000);
        const snapshot = demo.snapshot();
        expect(snapshot).toMatchObject({ elapsedMs: 0, location: "Stairs", phase: "walking" });
        expect(snapshot.projection).toMatchObject({
            horizonMs: 10000,
            remainingMs: 12000,
            milestone: null,
        });
        demo.advance(2000);
        expect(demo.snapshot().projection).toMatchObject({
            horizonMs: 10000,
            remainingMs: 10000,
            milestone: { event: "arrive", inMs: 10000 },
        });
        expect(() => demo.setProjectionHorizonMs(999)).toThrow(/1000 to 15000ms/);
    } finally { demo.stop(); }
});

test("external ECS edits invalidate accepted actor, door and message preconditions before commit", async () => {
    const moved = await PhoneDemo.create(wait);
    try {
        moved.start(); act(moved, "go_phone");
        setLocatedIn(moved.sim.world, moved.ids.mara, moved.ids.basement);
        moved.advance(1);
        expect(moved.snapshot()).toMatchObject({ location: "Basement", phase: "idle", projection: null });
        expect(moved.snapshot().receipts.some(r => r.kind === "action_failed" && r.text.includes("journey did not finish"))).toBe(true);
    } finally { moved.stop(); }

    const opened = await PhoneDemo.create(wait);
    try {
        opened.start(); act(opened, "open_basement");
        ObjectState.current[opened.ids.door] = "open";
        opened.advance(1);
        expect(opened.snapshot()).toMatchObject({ location: "Landing", phase: "idle", door: "open", projection: null });
        expect(opened.snapshot().receipts.some(r => r.kind === "action_failed" && r.text.includes("opening finished"))).toBe(true);
    } finally { opened.stop(); }

    const message = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        message.start();
        const id = message.sendMessage("Do not force a stale read.");
        act(message, "go_phone"); message.advance(1);
        act(message, "take_phone"); message.advance(4000);
        act(message, "read_phone");
        message.message.status[id] = "read";
        message.advance(1);
        expect(message.snapshot()).toMatchObject({ phase: "idle", projection: null, phone: { unread: 1 } });
        expect(message.snapshot().receipts.some(r => r.kind === "message_read")).toBe(false);
        expect(message.snapshot().receipts.some(r => r.kind === "action_failed" && r.text.includes("No read was committed"))).toBe(true);
    } finally { message.stop(); }
});
