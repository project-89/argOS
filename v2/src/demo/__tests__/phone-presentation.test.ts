import { PhoneDemo } from "../phone-demo";
import { PhoneCameraDirector } from "../phone-director";
import { audienceMessages, capturePresentation, currentThought, isChunkDurationConfigureRejection,
    phoneSyncMeasurements, PhonePlaybackDisplayTracker, PhonePlaybackTimeline, PhonePromptDeliveryTracker,
    PhonePromptFlow, presentationAtPlayback, renderHorizonFromChunk, sendPromptTransaction,
    shotAtPlayback } from "../phone-presentation";

test("chunk clock is indexed, duplicate-safe, and waits for missing metadata", () => {
    const t = new PhonePlaybackTimeline();
    const chunk = (i: number, v: number, s = 5) => ({ chunk_index: i, prompt_version: v, playback_seconds: s });
    expect(t.add(chunk(1, 2))).toBe(true);
    expect(t.snapshot()).toEqual([]);
    expect(t.frontier()).toBeNull();
    expect(t.add(chunk(0, 1))).toBe(true);
    expect(t.add(chunk(0, 99, 900))).toBe(false);
    expect(t.snapshot()).toEqual([{ index: 0, start: 0, end: 5, version: 1 }, { index: 1, start: 5, end: 10, version: 2 }]);
    expect(t.frontier()).toEqual({ index: 1, start: 5, end: 10, version: 2 });
    for (const invalid of [chunk(2, 0), chunk(-1, 2), chunk(2, 2, -5), chunk(2, 2, NaN), chunk(2.2, 2)]) expect(t.add(invalid)).toBe(false);
    const shots = [{ version: 1, thought: "Past" }, { version: 2, thought: "Later" }, { version: 3, thought: "Future" }];
    expect(shotAtPlayback(shots, [], 0).shot).toBeNull();
    expect(shotAtPlayback(shots, t.snapshot(), 4.999).shot?.thought).toBe("Past");
    expect(shotAtPlayback(shots, t.snapshot(), 5).shot?.thought).toBe("Later");
    expect(shotAtPlayback(shots, t.snapshot(), 40)).toEqual({ shot: shots[1], matched: false });
    // Pauses don't advance the clock. Seeking/replaying backwards cannot retain future thoughts.
    expect(shotAtPlayback(shots, t.snapshot(), 1).shot?.thought).toBe("Past");
    expect(shotAtPlayback(shots, t.snapshot(), 1).shot?.thought).toBe("Past");
    expect(shotAtPlayback(shots, t.snapshot(), -1).shot).toBeNull();
    expect(shotAtPlayback([], t.snapshot(), 5).shot).toBeNull();
});

test("display crossings are contiguous, frame-clocked, and emitted exactly once", () => {
    const timeline = new PhonePlaybackTimeline(), display = new PhonePlaybackDisplayTracker();
    timeline.add({ chunk_index: 1, prompt_version: 2, playback_seconds: 5 });
    expect(display.crossed(timeline.snapshot(), 9)).toEqual([]); // metadata gap
    timeline.add({ chunk_index: 0, prompt_version: 1, playback_seconds: 5 });
    expect(display.crossed(timeline.snapshot(), 0)).toEqual([{ index: 0, start: 0, end: 5, version: 1 }]);
    expect(display.crossed(timeline.snapshot(), 4.999)).toEqual([]);
    expect(display.crossed(timeline.snapshot(), 5.02)).toEqual([{ index: 1, start: 5, end: 10, version: 2 }]);
    expect(display.crossed(timeline.snapshot(), 20)).toEqual([]);
    expect(display.crossed(timeline.snapshot(), 1)).toEqual([]); // seeking back never duplicates audit events
});

test("five-second configure fallback is restricted to schema rejection", () => {
    expect(isChunkDurationConfigureRejection({ type: "error", code: "invalid_message" })).toBe(false);
    expect(isChunkDurationConfigureRejection({ type: "invalid_message", message: "additional property" })).toBe(false);
    expect(isChunkDurationConfigureRejection({ type: "invalid_message", message: "Additional property chunk_duration" })).toBe(true);
    expect(isChunkDurationConfigureRejection({ type: "error", message: "Unknown chunk_duration" })).toBe(true);
    expect(isChunkDurationConfigureRejection({ type: "error", code: "generation_failed" })).toBe(false);
    expect(isChunkDurationConfigureRejection({ type: "error", code: "generation_failed",
        message: "chunk duration generation failed" })).toBe(false);
    expect(isChunkDurationConfigureRejection({ type: "prompt_rejected", reason: "chunk duration" })).toBe(false);
});

test("actual playback calibrates a guarded projection horizon before requested duration", () => {
    expect(renderHorizonFromChunk(5000, { playback_seconds: 8.5, requested_duration_seconds: 10 })).toBe(8000);
    expect(renderHorizonFromChunk(8000, { playback_seconds: 5.167 })).toBe(4500);
    expect(renderHorizonFromChunk(4500, { playback_seconds: 3.542 })).toBe(3000);
    expect(renderHorizonFromChunk(10000, { playback_seconds: 5, requested_duration_seconds: 15 })).toBe(4500);
    expect(renderHorizonFromChunk(5000, { requested_duration_seconds: 10 })).toBe(9500);
    expect(renderHorizonFromChunk(8000, { playback_seconds: 2, requested_duration_seconds: "10" })).toBe(1500);
});

test("the longer opening cannot enlarge the forecast for trimmed continuations", () => {
    let horizon = renderHorizonFromChunk(8000, { playback_seconds: 8.5 });
    horizon = renderHorizonFromChunk(horizon, { chunk_index: 0, playback_seconds: 10.125,
        requested_duration_seconds: 10 });
    expect(horizon).toBe(8000);
    expect(renderHorizonFromChunk(horizon, { chunk_index: 1, playback_seconds: 8.5 })).toBe(8000);
    // The conservative 5s-request estimate must survive its untrimmed opening,
    // then actual continuation metadata can calibrate it in either direction.
    expect(renderHorizonFromChunk(3000, { chunk_index: 0, playback_seconds: 5.167 })).toBe(3000);
    expect(renderHorizonFromChunk(3000, { chunk_index: 1, playback_seconds: 8.5 })).toBe(8000);
    expect(renderHorizonFromChunk(8000, { chunk_index: 0, playback_seconds: 3.542 })).toBe(3000);
});

test("persisted telemetry measures source through prompt, chunk readiness and displayed media", () => {
    const telemetry = [
        { type: "world_clock_started", atMs: 100, wallMs: 10_100, sourceEpochWallMs: 10_000 },
        { type: "configure_sent", atMs: 20, wallMs: 10_020, promptVersion: 1, sourceMs: 0,
            sourceCapturedWallMs: 10_010 },
        { type: "provider_prompt_applied", atMs: 200, wallMs: 10_200, promptVersion: 1, sourceMs: 0 },
        { type: "provider_chunk", atMs: 900, wallMs: 10_900, promptVersion: 1, sourceMs: 0 },
        { type: "segment_displayed", atMs: 1_000, wallMs: 11_000, promptVersion: 1, sourceMs: 0,
            playbackTime: 0, sourceToFilmOffsetMs: 0 },
    ];
    expect(phoneSyncMeasurements(telemetry)).toEqual([{
        promptVersion: 1, sourceMs: 0, sourceCapturedWallMs: 10_010,
        sourceToSentMs: 10, sentToAppliedMs: 180,
        sourceToAppliedMs: 190, appliedToChunkReadyMs: 700, chunkReadyToDisplayMs: 100,
        sourceToDisplayMs: 990, sourceToFilmOffsetMs: 0,
    }]);
});

test("prompt flow uses availability for fallback settlement but only frame crossings for display truth", () => {
    const flow = new PhonePromptFlow(), timeline = new PhonePlaybackTimeline();
    const chunk = (i: number, v: number) => ({ chunk_index: i, prompt_version: v, playback_seconds: 5 });
    expect(flow.markSent(1)).toBe(true);
    expect(flow.markSent(1)).toBe(false);
    expect(flow.settle({ type: "prompt_pending", prompt_version: 1 })).toBe(false);
    expect(flow.settle({ type: "prompt_applied", prompt_version: 2 })).toBe(false); // unsent
    expect(flow.settle({ type: "prompt_applied", prompt_version: 1 })).toBe(true);
    expect(flow.snapshot()).toEqual({ sent: 1, settled: 1, displayed: 0 });

    expect(flow.markSent(2)).toBe(true);
    expect(timeline.add(chunk(1, 2))).toBe(true); // data-channel gap
    expect(flow.markAvailable(timeline.frontier())).toBe(false);
    expect(flow.snapshot()).toEqual({ sent: 2, settled: 1, displayed: 0 });
    expect(flow.settle({ type: "prompt_rejected", prompt_version: 2 })).toBe(true);
    expect(flow.snapshot()).toEqual({ sent: 2, settled: 2, displayed: 0 });

    expect(timeline.add(chunk(0, 1))).toBe(true);
    expect(flow.markAvailable(timeline.frontier())).toBe(false); // already settled; still not displayed
    expect(flow.snapshot()).toEqual({ sent: 2, settled: 2, displayed: 0 });
    expect(flow.markDisplayed(timeline.snapshot()[0])).toBe(true);
    expect(flow.snapshot()).toEqual({ sent: 2, settled: 2, displayed: 1 });
    expect(flow.markDisplayed(timeline.snapshot()[1])).toBe(true);
    expect(flow.snapshot()).toEqual({ sent: 2, settled: 2, displayed: 2 });
});

test("a synchronous transport throw never commits the version as delivered", () => {
    const flow = new PhonePromptFlow();
    expect(sendPromptTransaction(flow, 1, () => { })).toBe(true);
    expect(flow.settle({ type: "prompt_applied", prompt_version: 1 })).toBe(true);
    expect(() => sendPromptTransaction(flow, 7, () => { throw new Error("data channel closed"); }))
        .toThrow("data channel closed");
    expect(flow.snapshot()).toEqual({ sent: 1, settled: 1, displayed: 0 });
});

test("pending is a receipt but not settlement, and both delivery stages have terminal bounds", () => {
    const delivery = new PhonePromptDeliveryTracker(1000, 2000);
    expect(delivery.begin(7, 100)).toBe(true);
    expect(delivery.due(1099)).toBe("awaiting-receipt");
    expect(delivery.due(1100)).toBe("receipt-timeout");
    expect(delivery.markPending(7, 1200)).toBe(true);
    expect(delivery.due(3199)).toBe("awaiting-settlement");
    expect(delivery.due(3200)).toBe("settlement-timeout");
    expect(delivery.settle(6)).toBe(false);
    expect(delivery.settle(7)).toBe(true);
    expect(delivery.due(9999)).toBe("idle");
});

test("a projected cue reveals a committed read only at the matching film instant", () => {
    const message = { id: 41, direction: "in", body: "Do not open the door.", status: "delivered",
        createdMs: 0, deliveredMs: 0, readMs: -1, replyTo: -1 };
    const other = { id: 42, direction: "in", body: "This is a later message.", status: "delivered",
        createdMs: 1, deliveredMs: 1, readMs: -1, replyTo: -1 };
    const base = {
        elapsedMs: 0, location: "Bedroom", phase: "reading", decisions: 1,
        mara: { thought: "I should check it.", heldPhone: true, phoneAudible: true, readCount: 0 },
        phone: { location: "Mara", room: "Bedroom", placement: "held", battery: 72, online: true,
            silent: false, unread: 2, reminding: true, buzzing: false },
        door: "closed", messages: [message, other], screen: null, thoughts: [], actionCommits: [],
    } as ReturnType<typeof capturePresentation>;
    const committed = structuredClone(base);
    committed.elapsedMs = 6000;
    committed.phase = "typing"; // proof arrived in a later snapshot; draft must not leak backward
    committed.mara.readCount = 2;
    committed.messages[0].status = "read";
    committed.messages[0].readMs = 3000;
    committed.messages[1].status = "read";
    committed.messages[1].readMs = 5500;
    committed.phone.unread = 0;
    committed.phone.reminding = false;
    committed.screen = { body: "FUTURE DRAFT", typing: true, receivedBody: message.body };
    committed.actionCommits = [
        { basisSequence: 8, atMs: 3000, event: "read", messageId: message.id },
        { basisSequence: 9, atMs: 5500, event: "read", messageId: other.id },
    ];
    committed.door = "open"; // unrelated future state must not leak through the read patch
    const shots = [{ version: 1, sourceMs: 0, presentation: base,
        projection: { basisSequence: 8, destination: null,
            milestone: { atMs: 3000, inMs: 3000, event: "read" as const } } },
    { version: 2, sourceMs: 6000, presentation: committed, projection: null }];
    const chunks = [{ index: 0, start: 0, end: 5, version: 1 }];
    expect(presentationAtPlayback(shots, chunks, 2.999).presentation?.screen).toBeNull();
    const atCue = presentationAtPlayback(shots, chunks, 3);
    expect(atCue.presentation?.screen?.body).toBe("Do not open the door.");
    expect(atCue.presentation?.screen?.typing).toBe(false);
    expect(atCue.presentation?.phase).toBe("read");
    expect(atCue).toMatchObject({ presentationVersion: 2, projectedTransition: true, matched: true });
    expect(atCue.presentation?.door).toBe("closed");
    expect(atCue.presentation?.mara.readCount).toBe(1);
    expect(atCue.presentation?.phone).toMatchObject({ unread: 1, reminding: true });
    expect(atCue.presentation?.messages[1]).toMatchObject({ id: other.id, status: "delivered", readMs: -1 });
    // Once the known segment has ended, a metadata gap cannot expose future state.
    expect(presentationAtPlayback(shots, chunks, 5).presentation?.screen).toBeNull();
});

test("milestone patches move a held phone only with the exact projected action", () => {
    const presentation = (overrides: Partial<ReturnType<typeof capturePresentation>> = {}) => ({
        elapsedMs: 0, location: "Bedroom", phase: "picking_up", decisions: 1,
        mara: { thought: "Act.", heldPhone: false, phoneAudible: true, readCount: 0 },
        phone: { location: "Bedroom desk", room: "Bedroom", placement: "on desk", battery: 72,
            online: true, silent: false, unread: 0, reminding: false, buzzing: false },
        door: "closed", messages: [], screen: null, thoughts: [], actionCommits: [], ...overrides,
    }) as ReturnType<typeof capturePresentation>;
    const shown = (base: ReturnType<typeof capturePresentation>, candidate: ReturnType<typeof capturePresentation>,
        projection: { basisSequence: number; destination: string | null; milestone: { atMs: number; inMs: number;
            event: "arrive" | "pickup" | "read" | "send" | "open" } }) => presentationAtPlayback([
        { version: 1, sourceMs: 0, presentation: base, projection },
        { version: 2, sourceMs: candidate.elapsedMs, presentation: candidate, projection: null },
    ], [{ index: 0, start: 0, end: 5, version: 1 }], projection.milestone.inMs / 1000).presentation!;

    const pickupBase = presentation();
    const pickupProof = presentation({ elapsedMs: 4000, location: "Landing", phase: "arrived",
        mara: { ...pickupBase.mara, heldPhone: true },
        phone: { ...pickupBase.phone, location: "Mara", room: "Landing", placement: "held in Mara's hand" },
        actionCommits: [{ basisSequence: 10, atMs: 2000, event: "pickup" }] });
    expect(shown(pickupBase, pickupProof, { basisSequence: 10, destination: null,
        milestone: { atMs: 2000, inMs: 2000, event: "pickup" } }).phone).toMatchObject({
        location: "Mara", room: "Bedroom", placement: "held in Mara's hand, never in a pocket",
    });

    const arriveBase = presentation({ location: "Landing", phase: "walking",
        mara: { ...pickupBase.mara, heldPhone: true },
        phone: { ...pickupBase.phone, location: "Mara", room: "Landing", placement: "held" } });
    const arriveProof = presentation({ elapsedMs: 3000, location: "Bedroom", phase: "arrived",
        mara: { ...arriveBase.mara }, phone: { ...arriveBase.phone, room: "Bedroom" },
        actionCommits: [{ basisSequence: 11, atMs: 3000, event: "arrive" }] });
    expect(shown(arriveBase, arriveProof, { basisSequence: 11, destination: "Bedroom",
        milestone: { atMs: 3000, inMs: 3000, event: "arrive" } }).phone.room).toBe("Bedroom");

    const openBase = presentation({ location: "Landing", phase: "opening",
        mara: { ...pickupBase.mara, heldPhone: true },
        phone: { ...pickupBase.phone, location: "Mara", room: "Landing", placement: "held" } });
    const openProof = presentation({ elapsedMs: 3000, location: "Basement", phase: "basement", door: "open",
        mara: { ...openBase.mara }, phone: { ...openBase.phone, room: "Basement" },
        actionCommits: [{ basisSequence: 12, atMs: 3000, event: "open" }] });
    expect(shown(openBase, openProof, { basisSequence: 12, destination: "Basement",
        milestone: { atMs: 3000, inMs: 3000, event: "open" } }).phone.room).toBe("Basement");
});

test("an offline send commit cannot borrow a later delivery receipt", () => {
    const base = {
        elapsedMs: 0, location: "Bedroom", phase: "typing", decisions: 1,
        mara: { thought: "Reply.", heldPhone: true, phoneAudible: true, readCount: 1 },
        phone: { location: "Mara", room: "Bedroom", placement: "held", battery: 72, online: false,
            silent: false, unread: 0, reminding: false, buzzing: false },
        door: "closed", messages: [], screen: { body: "Why?", typing: true, receivedBody: "Stay inside." },
        thoughts: [], actionCommits: [],
    } as ReturnType<typeof capturePresentation>;
    const later = structuredClone(base);
    later.elapsedMs = 9000;
    later.phone.online = true;
    later.messages = [{ id: 51, direction: "out", body: "Why?", status: "delivered",
        createdMs: 3000, deliveredMs: 9000, readMs: -1, replyTo: 50 }];
    later.actionCommits = [{ basisSequence: 13, atMs: 3000, event: "send", messageId: 51 }];
    const atCue = presentationAtPlayback([
        { version: 1, sourceMs: 0, presentation: base, projection: { basisSequence: 13, destination: null,
            milestone: { atMs: 3000, inMs: 3000, event: "send" as const } } },
        { version: 2, sourceMs: 9000, presentation: later, projection: null },
    ], [{ index: 0, start: 0, end: 5, version: 1 }], 3);
    expect(atCue).toMatchObject({ presentationVersion: 2, projectedTransition: true });
    expect(atCue.presentation?.messages).toMatchObject([{ id: 51, status: "queued", deliveredMs: -1 }]);
    expect(audienceMessages(later.messages, atCue.presentation)).toEqual([]);
});

test("an invalidated projected milestone holds the segment's pre-state", () => {
    const base = {
        elapsedMs: 0, location: "Bedroom", phase: "picking_up", decisions: 1,
        mara: { thought: "Pick it up.", heldPhone: false, phoneAudible: true, readCount: 0 },
        phone: { location: "Bedroom desk", room: "Bedroom", placement: "on desk", battery: 72,
            online: true, silent: false, unread: 0, reminding: false, buzzing: false },
        door: "closed", messages: [], screen: null, thoughts: [], actionCommits: [],
    } as ReturnType<typeof capturePresentation>;
    const invalidated = structuredClone(base);
    invalidated.elapsedMs = 2500;
    invalidated.phase = "waiting";
    invalidated.phone.location = "Landing";
    const muchLaterPickup = structuredClone(invalidated);
    muchLaterPickup.elapsedMs = 9000;
    muchLaterPickup.phase = "holding";
    muchLaterPickup.mara.heldPhone = true;
    muchLaterPickup.actionCommits = [{ basisSequence: 13, atMs: 9000, event: "pickup" }];
    const shots = [{ version: 1, sourceMs: 0, presentation: base,
        projection: { basisSequence: 12, destination: null,
            milestone: { atMs: 2000, inMs: 2000, event: "pickup" as const } } },
    { version: 2, sourceMs: 1000, presentation: invalidated, projection: null },
    { version: 3, sourceMs: 9000, presentation: muchLaterPickup, projection: null }];
    const shown = presentationAtPlayback(shots, [{ index: 0, start: 0, end: 5, version: 1 }], 3);
    expect(shown.presentationVersion).toBe(1);
    expect(shown.presentation?.phase).toBe("picking_up");
    expect(shown.projectedTransition).toBe(false);
});

test("shot snapshots freeze thoughts, phone facts, read receipts and replies; own text is immediate", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        const initial = camera.next();
        const id = d.sendMessage("Stay inside.");
        const act = (action: "go_phone" | "take_phone" | "read_phone") => d.applyChoice({ action, thought: `I will ${action}.` });
        act("go_phone"); d.advance(12000); act("take_phone"); d.advance(4000); act("read_phone");
        camera.observe(d.snapshot()); const reading = camera.next(initial.version);
        expect(reading.presentation.mara.readCount).toBe(0);
        expect(reading.presentation.screen).toBeNull();
        d.advance(5000);
        const read = capturePresentation(d.snapshot());
        expect(read.screen).toEqual({ body: "Stay inside.", typing: false, receivedBody: null });
        d.applyChoice({ action: "reply", thought: "A future thought.", reply: "Who is this?", replyTo: id });
        const typing = capturePresentation(d.snapshot());
        expect(typing.screen).toEqual({ body: "Who is this?", typing: true, receivedBody: "Stay inside." });
        d.advance(7000); d.controlPhone({ battery: 0 });
        const live = d.snapshot();
        expect(audienceMessages(live.messages, null)).toMatchObject([{ body: "Stay inside.", status: "awaiting scene", readMs: -1 }]);
        expect(audienceMessages(live.messages, initial.presentation)).toHaveLength(1);
        expect(audienceMessages(live.messages, reading.presentation)).toMatchObject([{ status: "delivered" }]);
        expect(audienceMessages(live.messages, typing)).toHaveLength(1); // draft is NOT a delivered reply
        expect(audienceMessages(live.messages, capturePresentation(live))).toHaveLength(2);
        expect(reading.presentation.phone.battery).toBe(72);
        expect(reading.presentation.screen).toBeNull();
        expect(JSON.stringify(reading.presentation)).not.toContain("A future thought");
        expect(currentThought(reading.presentation)?.text).toBe("I will read_phone.");
        expect(currentThought(initial.presentation)).toBeNull();
        expect(currentThought(null)).toBeNull();
        expect(currentThought(typing)?.text).toBe("A future thought.");
        const exported = camera.snapshot(); exported.shots[0].presentation.phone.battery = 1;
        expect(camera.snapshot().shots[0].presentation.phone.battery).toBe(72);
    } finally { d.stop(); }
});

test("thought-only and delivery-only changes create new immutable presentation versions", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); d.controlPhone({ silent: true });
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot()); const first = camera.next();
        d.injectThought("A new impulse."); camera.observe(d.snapshot());
        const second = camera.next(first.version);
        expect(second.presentation.thoughts.at(-1)?.text).toBe("A new impulse.");
        expect(first.presentation.thoughts).toEqual([]);
        d.sendMessage("Silent text"); camera.observe(d.snapshot());
        expect(camera.next(second.version).presentation.messages).toHaveLength(1);
        expect(second.presentation.messages).toEqual([]);
    } finally { d.stop(); }
});

test("an offscreen buzz expiring does not add redundant walking coverage", async () => {
    const d = await PhoneDemo.create(async () => ({ action: "wait", thought: "Listen." }));
    try {
        d.start(); d.sendMessage("Hello."); d.applyChoice({ action: "go_phone", thought: "Upstairs." });
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        d.advance(6000); camera.observe(d.snapshot()); // reminder begins
        d.advance(2000); camera.observe(d.snapshot()); // pulse expires; unread remains
        expect(camera.snapshot().shots).toHaveLength(1);
        expect(d.snapshot().phone.buzzing).toBe(false);
        d.controlPhone({ battery: 0 }); camera.observe(d.snapshot());
        expect(camera.snapshot().shots).toHaveLength(2);
    } finally { d.stop(); }
});
