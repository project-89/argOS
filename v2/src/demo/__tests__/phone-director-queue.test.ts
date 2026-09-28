import { PhoneDemo, type PhoneDecider, type PhoneSnapshot } from "../phone-demo";
import { PhoneCameraDirector } from "../phone-director";

const wait: PhoneDecider = async () => ({ action: "wait", thought: "I will listen." });

test("the render deck stays at one while the immutable source tape and causal audit keep growing", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const camera = new PhoneCameraDirector();
        camera.observe(demo.snapshot());
        expect(camera.next().version).toBe(1);
        demo.sendMessage("BRIDGE_SECRET_MUST_NOT_ENTER_PROMPTS");
        const source = demo.snapshot();

        // More than the former 128-shot cap, all while H3 is still rendering v1.
        // Alternating committed facts also pressure the bounded continuity bridge.
        for (let index = 1; index <= 140; index++) {
            const snapshot: PhoneSnapshot = structuredClone(source);
            snapshot.elapsedMs = index * 100;
            snapshot.phone.battery = index % 2 ? 0 : 72;
            snapshot.door = index % 3 ? "closed" : "open";
            snapshot.mara.thought = `Thought ${index}`;
            snapshot.thoughts = [{ sequence: index + 100, atMs: snapshot.elapsedMs, kind: "thought",
                text: snapshot.mara.thought, perceived: true }];
            camera.observe(snapshot);
        }

        const queued = camera.snapshot();
        expect(queued.shots).toHaveLength(141);
        expect(queued).toMatchObject({ issued: 1, acknowledged: 0, pending: 1,
            pendingVersions: [141], coalesced: expect.arrayContaining([2, 140]) });
        expect(queued.coalesced).toHaveLength(139);
        expect(queued.shots.at(-1)).toMatchObject({ version: 141, replaces: 140, compactedCount: 139 });
        expect(queued.shots.at(-1)?.continuityBridge).toHaveLength(6);
        expect(queued.metrics).toMatchObject({ sourceShots: 141, renderDeckCapacity: 1,
            renderDeckDepth: 1, maxRenderDeckDepth: 1, issuedShots: 1, supersededShots: 139,
            inFlight: 1, outstanding: 2, latestSourceMs: 14000, issuedSourceMs: 0,
            acknowledgedSourceMs: null, sourceToIssuedLagMs: 14000,
            sourceToAcknowledgedLagMs: null, oldestPendingAgeMs: 0 });

        // Settling v1 jumps directly to the latest viable render projection.
        const latest = camera.next(1);
        expect(latest.version).toBe(141);
        expect(latest.prompt).toContain("CONTINUITY BRIDGE FROM 139 COMPACTED SOURCE CHECKPOINTS");
        expect(latest.prompt).toContain("133 earlier compacted checkpoints remain preserved on the source audit tape");
        expect(latest.prompt).not.toContain("BRIDGE_SECRET_MUST_NOT_ENTER_PROMPTS");
        expect(camera.snapshot().metrics).toMatchObject({ renderDeckDepth: 0, inFlight: 1,
            outstanding: 1, sourceToIssuedLagMs: 0, sourceToAcknowledgedLagMs: 14000 });

        // Neither delivery surface can rewrite archived source facts.
        latest.continuityBridge[0] = "mutated";
        latest.presentation.phone.battery = 1;
        expect(camera.snapshot().shots.at(-1)?.continuityBridge[0]).not.toBe("mutated");
        expect(camera.snapshot().shots.at(-1)?.presentation.phone.battery).not.toBe(1);

        camera.next(141);
        expect(camera.snapshot().metrics).toMatchObject({ inFlight: 0, outstanding: 0,
            sourceToAcknowledgedLagMs: 0 });
    } finally { demo.stop(); }
});

test("accepted trajectories create purposeful conditional beats without becoming presentation facts", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        demo.applyChoice({ action: "go_phone", thought: "I am going upstairs for my phone." });
        const camera = new PhoneCameraDirector();
        camera.observe(demo.snapshot());
        const initial = camera.next();
        expect(initial.prompt).toContain("No completion is scheduled inside this 5000ms render horizon");
        expect(initial.prompt).toContain("Show immediate, purposeful progress at normal speed");

        demo.advance(8000);
        camera.observe(demo.snapshot());
        const horizon = camera.next(initial.version);
        expect(horizon.version).toBe(2);
        expect(horizon.prompt).toContain("SCHEDULED TRAJECTORY (conditional forecast, NOT committed current state)");
        expect(horizon.prompt).toContain("event=\"arrive\"");
        expect(horizon.prompt).toContain("no earlier than +4000ms");
        expect(horizon.prompt).toContain("never begin as though it already happened");
        expect(horizon.prompt).toContain("Mara's hands and pockets contain NO phone");
        expect("projection" in horizon.presentation).toBe(false);
        expect(camera.snapshot().shots[1].projection).toMatchObject({ milestone: { event: "arrive" } });

        // Once a completion enters the horizon, the one-slot deck refreshes its
        // relative cue so a not-yet-issued prompt cannot go stale.
        demo.advance(1000);
        camera.observe(demo.snapshot());
        expect(camera.snapshot().shots).toHaveLength(3);
        expect(camera.snapshot().pendingVersions).toEqual([3]);
        expect(camera.next(horizon.version).prompt).toContain("no earlier than +3000ms");
    } finally { demo.stop(); }
});

test("an in-progress read keeps unread text out of the complete H3 prompt until ECS commits it", async () => {
    const demo = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        demo.start();
        demo.sendMessage("DIRECTOR_MUST_NOT_SEE_UNREAD_1138");
        demo.applyChoice({ action: "go_phone", thought: "I will go upstairs." });
        demo.advance(1);
        demo.applyChoice({ action: "take_phone", thought: "I will lift the phone." });
        demo.advance(4000);
        demo.applyChoice({ action: "read_phone", thought: "I will open the notification." });

        const camera = new PhoneCameraDirector();
        camera.observe(demo.snapshot());
        const reading = camera.next();
        expect(reading.kind).toBe("hands_insert");
        expect(reading.screen).toBeNull();
        expect(reading.prompt).toContain("holds the lit phone, checks the message and reads silently");
        expect(reading.prompt).toContain("Do not show or invent message text.");
        expect(reading.prompt).not.toContain("DIRECTOR_MUST_NOT_SEE_UNREAD_1138");

        demo.advance(5000);
        camera.observe(demo.snapshot());
        const committed = camera.next(reading.version);
        expect(committed.prompt).toContain("DIRECTOR_MUST_NOT_SEE_UNREAD_1138");
    } finally { demo.stop(); }
});

test("grown local context is bounded and present NPCs are not contradicted", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const snapshot: PhoneSnapshot = structuredClone(demo.snapshot());
        snapshot.sceneActors = [{ name: "Rowan", description: "A real neighbor in the room." }];
        snapshot.sceneObjects = Array.from({ length: 300 }, (_, index) => ({
            name: `Generated object ${index}`,
            description: "grown context ".repeat(250),
            state: "present",
        }));
        const camera = new PhoneCameraDirector();
        camera.observe(snapshot);
        const shot = camera.next();
        expect(shot.prompt.length).toBeLessThanOrEqual(50000);
        expect(shot.prompt).toContain("LOCAL WORLD CONTEXT TRUNCATED");
        expect(shot.prompt).toContain("do not invent unlisted characters");
        expect(shot.prompt).not.toContain("ACTUALLY PRESENT (no others)");
        expect(shot.prompt).toContain("COMMITTED FACTS");
        expect(shot.prompt).toContain("Camera directions depict this source state");
    } finally { demo.stop(); }
});

test("typing safely carries the committed incoming reveal if its read shot was compacted", async () => {
    const demo = await PhoneDemo.create(wait, { travelMs: 1 });
    try {
        demo.start();
        const id = demo.sendMessage("THE COMMITTED WARNING");
        demo.applyChoice({ action: "go_phone", thought: "Go upstairs." }); demo.advance(1);
        demo.applyChoice({ action: "take_phone", thought: "Lift it." }); demo.advance(4000);
        demo.applyChoice({ action: "read_phone", thought: "Read it." });
        const camera = new PhoneCameraDirector(); camera.observe(demo.snapshot()); const reading = camera.next();
        demo.advance(5000);
        // No camera observation of the transient `read` phase: it is compacted
        // directly into typing, but the body is now committed and safe to carry.
        demo.applyChoice({ action: "reply", thought: "Answer it.", reply: "WHO ARE YOU?", replyTo: id });
        camera.observe(demo.snapshot()); const typing = camera.next(reading.version);
        expect(typing.prompt).toContain("THE COMMITTED WARNING");
        expect(typing.prompt).toContain("WHO ARE YOU?");
        expect(typing.prompt).toContain("UNSENT draft");
    } finally { demo.stop(); }
});

test("ordinary Argos actions reach H3 with their real execution outcome", async () => {
    const demo = await PhoneDemo.create(wait);
    try {
        demo.start();
        const failed: PhoneSnapshot = structuredClone(demo.snapshot());
        failed.phase = "acting";
        failed.nativeAction = { type: "interact", target: "Locked cabinet", content: "open" };
        failed.nativeActionOutcome = "failed";
        const failedCamera = new PhoneCameraDirector(); failedCamera.observe(failed);
        expect(failedCamera.next().prompt).toContain("did not succeed");
        expect(failedCamera.next().prompt).toContain("do not depict the attempted outcome");

        const pending: PhoneSnapshot = structuredClone(failed);
        pending.nativeActionOutcome = "pending";
        const pendingCamera = new PhoneCameraDirector(); pendingCamera.observe(pending);
        expect(pendingCamera.next().prompt).toContain("result is still pending");

        const succeeded: PhoneSnapshot = structuredClone(failed);
        succeeded.nativeAction = { type: "use", target: "Brass key" };
        succeeded.nativeActionOutcome = "succeeded";
        const successCamera = new PhoneCameraDirector(); successCamera.observe(succeeded);
        expect(successCamera.next().prompt).toContain("Show only consequences already visible");
    } finally { demo.stop(); }
});
