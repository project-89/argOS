import { addComponent, query } from "bitecs";
import { createSimulation } from "../../index";
import { PhoneDemo } from "../phone-demo";
import { Agent, Goal, LastAction, Name, Plan, Memory, Perception, Mind } from "../../ecs/components";
import { createIntentGoal, executeActions, runCognitionCycle, queueStimulus, findEntityByName } from "../../cognition/cognition-system";
import { createPlanEntity, getNextPlannedAction, checkStepPrerequisites } from "../../cognition/planning-system";
import { addPerception, addThought, getAgentPerceptions, getAgentThoughts, type AgentAction } from "../../cognition/agent-mind";
import { gatherArchitectContext } from "../../spirits/architect-spirit";
import { collectEcsSnapshot } from "../../spirits/spirit-cognition";
import { getAgentWorldCapabilities, getAgentVisibleEntities } from "../../cognition/world-capabilities";
import { createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { getDirectContainer } from "../../ecs/location";
import { PhoneCameraDirector } from "../phone-director";
import { createStoryScaffoldEntity, getStoryScaffold } from "../../nle/story-scaffold";
import { startBeatDetection, stopBeatDetection, getBeatCandidates } from "../../nle/beat-detector";
import { chronicle } from "../../cognition/simulation-chronicle";

async function house() {
    // No model calls: test the actual shared cognition, planning records, action
    // executor and physics against a package attached to a normal library world.
    const sim = await createSimulation({ name: "Phone integration test", enableAI: false, enableServer: false, preset: "minimal",
        rooms: ["Landing", "Stairs", "Bedroom", "Basement"].map((name, i) => ({ name, description: `Interior ${name}`, x: 50 + i * 200, y: 50 })),
        agents: [{ name: "Mara", role: "resident", startRoom: "Landing" }],
        objects: [{ name: "Mara's phone", room: "Bedroom", portable: true, traits: ["takeable"] },
            { name: "Bedroom desk", room: "Bedroom" }, { name: "Green basement door", room: "Landing" }] });
    return PhoneDemo.inhabit(sim);
}
function execute(d: PhoneDemo, action: AgentAction) { executeActions(d.sim.world, [{ eid: d.ids.mara, action }], d.sim.god.systemRegistry); }

test("a new notification cancels stale cognition immediately, but a soft whisper does not starve it", async () => {
    const d = await house();
    try {
        d.start();
        const capability = getAgentWorldCapabilities(d.sim.world, d.ids.mara)!;
        const decision = capability.beginDecision!();
        addPerception(d.sim.world, d.ids.mara, { type: "daemon_whisper", content: "Take a breath before deciding.", source: "inner voice" });
        expect(decision.signal.aborted).toBe(false);
        expect(decision.isCurrent()).toBe(true);
        d.sendMessage("New information on your phone.");
        expect(decision.signal.aborted).toBe(true);
        expect(decision.isCurrent()).toBe(false);
        decision.finish();
        expect(capability.ready()).toBe(true);
    } finally { d.stop(); }
});

test("legacy custom movement cannot promote a story beat through global chronicle prose", async () => {
    const d = await house();
    try {
        createStoryScaffoldEntity(d.sim.world, { seed: "The phone", currentAct: "setup", adaptations: [], npcRoles: [], tensions: [
            { id: "phone", description: "A phone call", status: "active", involvedNpcs: ["Mara"], beats: [
                { id: "arrive", description: "Mara reaches Bedroom", act: "setup", status: "pending", triggerCondition: "Mara arrives in Bedroom" },
                { id: "later", description: "Later, she returns to Bedroom", act: "resolution", status: "pending", triggerCondition: "Mara arrives in Bedroom" },
            ] },
        ] });
        startBeatDetection(d.sim.world);
        chronicle.record("llm_decision", { agent: "Mara", action: "move", target: "Bedroom", content: "Mara arrives in Bedroom" });
        expect(getStoryScaffold(d.sim.world)?.tensions[0].beats.map(b => b.status)).toEqual(["pending", "pending"]);
        d.start(); execute(d, { type: "move", target: "Bedroom" }); d.advance(12000);
        expect(getStoryScaffold(d.sim.world)?.tensions[0].beats.map(b => b.status)).toEqual(["pending", "pending"]);
        expect(d.observe().location).toBe("Bedroom");
        // This legacy package has no public committed executor publisher.
        // Its real movement is not license to infer a free-form beat trigger.
        expect(getBeatCandidates(d.sim.world)).toEqual([]);
        expect(getStoryScaffold(d.sim.world)?.tensions[0].status).toBe("active");
        expect(d.sim.god.systemRegistry.systems.get("GoalProgress")?.active).toBe(false);
    } finally { stopBeatDetection(d.sim.world); d.stop(); }
});

test("ambient stimuli cannot crowd out a notification, and a new priority does not resume an old plan", async () => {
    const d = await house();
    try {
        Mind.arousal[d.ids.mara] = 0.4;
        addPerception(d.sim.world, d.ids.mara, { type: "attention", content: "My phone is buzzing.", source: "phone" });
        for (let i = 0; i < 40; i++) addPerception(d.sim.world, d.ids.mara, { type: "visual", content: `A box ${i}`, source: "room" });
        expect(Mind.arousal[d.ids.mara]).toBeCloseTo(0.5);
        addPerception(d.sim.world, d.ids.mara, { type: "attention", content: "My phone is buzzing.", source: "phone" });
        expect(Mind.arousal[d.ids.mara]).toBeCloseTo(0.5);
        const perceptions = getAgentPerceptions(d.sim.world, d.ids.mara);
        expect(perceptions.length).toBeLessThanOrEqual(20);
        expect(perceptions.map(id => Perception.content[id])).toContain("My phone is buzzing.");
        const goal = createIntentGoal(d.sim.world, d.ids.mara, "Inspect the landing", 8);
        createPlanEntity(d.sim.world, d.ids.mara, goal, { goalDescription: "Inspect the landing", estimatedCompletion: "short", potentialObstacles: [], steps: [
            { description: "I'll look around the landing.", actionType: "observe", target: "Landing" },
        ] });
        expect(getNextPlannedAction(d.sim.world, d.ids.mara)?.target).toBe("Landing");
        createIntentGoal(d.sim.world, d.ids.mara, "Check the notification first", 10);
        expect(getNextPlannedAction(d.sim.world, d.ids.mara)).toBeNull();
        d.start(); execute(d, { type: "move", target: "Bedroom" }); d.advance(12000);
        expect(findEntityByName(d.sim.world, "mara's phone", { preferRoomEid: d.ids.bedroom })).toBe(d.ids.phone);
    } finally { d.stop(); }
});

test("spirits and the architect read real ECS goals, arousal and thoughts", async () => {
    const d = await house();
    try {
        const eid = d.ids.mara;
        Mind.arousal[eid] = 0.87;
        addThought(d.sim.world, eid, { content: "I should find out who is downstairs.", type: "reasoning" });
        const context = await gatherArchitectContext(d.sim.world, d.sim.god.systemRegistry);
        expect(context.agentStates.find(a => a.name === "Mara")).toMatchObject({ arousal: 0.87, goalCount: 2 });
        const snapshot = collectEcsSnapshot(d.sim.world, d.sim.god.registry).agents.find(a => a.eid === eid)!;
        expect(snapshot.goals).toHaveLength(2);
        expect(snapshot.recentThoughts).toContain("I should find out who is downstairs.");
    } finally { d.stop(); }
});

test("the phone package preserves normal systems, exposes native capabilities, and never uses a vignette decider", async () => {
    const d = await house();
    try {
        for (const name of ["Movement", "RoomArrival", "ScheduleSystem", "GoalEvaluationSystem", "PhoneDemoPhysics"])
            expect(d.sim.god.systemRegistry.systems.get(name)?.active).toBe(true);
        d.start();
        const goal = createIntentGoal(d.sim.world, d.ids.mara, "Check my phone", 10);
        const plan = createPlanEntity(d.sim.world, d.ids.mara, goal, { goalDescription: "Check my phone", estimatedCompletion: "short", potentialObstacles: [], steps: [
            { description: "I'll go upstairs for my phone.", actionType: "move", target: "Bedroom" },
            { description: "I'll lift it from the desk.", actionType: "interact", target: "Mara's phone", content: "take" },
            { description: "I'll read the notification.", actionType: "interact", target: "Mara's phone", content: "read_phone" },
        ] });
        const id = d.sendMessage("UNREAD_PRIVATE_661");
        const cycle = async () => {
            Mind.arousal[d.ids.mara] = 0.1; // physical readiness must not depend on wall-clock millisecond parity
            const actions = await runCognitionCycle(d.sim.world, d.sim.god.systemRegistry, { enablePlanning: false, tick: d.ids.mara + 1, agentEids: [d.ids.mara] });
            executeActions(d.sim.world, actions, d.sim.god.systemRegistry);
        };
        await cycle();
        expect(d.snapshot().phase).toBe("walking");
        // Deterministic plan execution is not a newly generated inner thought.
        expect(d.snapshot().mara.thought).toBe("");
        expect(getAgentThoughts(d.sim.world, d.ids.mara)).toHaveLength(0);
        expect(JSON.parse(Plan.steps[plan])[0].description).toBe("I'll go upstairs for my phone.");
        expect(Plan.currentStep[plan]).toBe(0); // accepted movement is not arrival
        expect(JSON.stringify(getAgentWorldCapabilities(d.sim.world, d.ids.mara)?.context())).not.toContain("UNREAD_PRIVATE_661");
        d.advance(12000); expect(Plan.currentStep[plan]).toBe(1);
        expect(getAgentVisibleEntities(d.sim.world, d.ids.mara)).toContain(d.ids.phone);
        expect(getAgentVisibleEntities(d.sim.world, d.ids.mara)).not.toContain(id);
        await cycle(); expect(d.snapshot().phase).toBe("picking_up");
        expect(Plan.currentStep[plan]).toBe(1);
        d.advance(4000); expect(Plan.currentStep[plan]).toBe(2);
        expect(getAvailableAffordances(d.sim.world, d.ids.mara, d.ids.phone).map(a => a.name)).toContain("read_phone");
        await cycle(); expect(d.snapshot().phase).toBe("reading");
        expect(Plan.status[plan]).toBe("active");
        d.advance(5000);
        expect(d.snapshot().messages[0].status).toBe("read");
        expect(Plan.status[plan]).toBe("completed");
        expect(getAgentThoughts(d.sim.world, d.ids.mara)).toHaveLength(0);
        expect(LastAction.success[d.ids.mara]).toBe(true);
        expect(JSON.stringify(getAgentWorldCapabilities(d.sim.world, d.ids.mara)?.context())).toContain("UNREAD_PRIVATE_661");
        expect([...query(d.sim.world, [Memory])].some(e => Memory.content[e]?.includes("UNREAD_PRIVATE_661"))).toBe(true);
        expect(getAvailableAffordances(d.sim.world, d.ids.mara, d.ids.phone))
            .toEqual(expect.arrayContaining([expect.objectContaining({ name: "reply", requiresFreshDecision: true })]));
        const content = `reply ${JSON.stringify({ replyTo: id, text: "Who are you?" })}`;
        expect(checkStepPrerequisites(d.sim.world, d.ids.mara, { description: "Send old wording", actionType: "interact", target: "Mara's phone", content })).toBe(false);
        execute(d, { type: "interact", target: "Mara's phone", content });
        d.advance(6999); expect(d.snapshot().messages).toHaveLength(1);
        d.advance(1); expect(d.snapshot().messages[1]).toMatchObject({ direction: "out", status: "delivered", body: "Who are you?" });
    } finally { d.stop(); }
});

test("a deferred pickup failure invalidates its native plan and preserves the actual phone location", async () => {
    const d = await house();
    try {
        d.start(); execute(d, { type: "move", target: "Bedroom" }); d.advance(12000);
        const goal = createIntentGoal(d.sim.world, d.ids.mara, "Pick up phone", 10);
        const plan = createPlanEntity(d.sim.world, d.ids.mara, goal, { goalDescription: "Pick up phone", estimatedCompletion: "short", potentialObstacles: [], steps: [
            { description: "Take the phone", actionType: "interact", target: "Mara's phone", content: "take" },
        ] });
        execute(d, { type: "interact", target: "Mara's phone", content: "take" });
        d.advance(2000); d.controlPhone({ location: "Basement" }); d.advance(2000);
        expect(Plan.status[plan]).toBe("failed");
        expect(Goal.status[goal]).toBe("active");
        expect(getDirectContainer(d.sim.world, d.ids.phone)).toBe(d.ids.basement);
        expect(LastAction.success[d.ids.mara]).toBe(false);
    } finally { d.stop(); }
});

test("normal room-arrival systems preserve the completed room and cannot undo a journey mid-flight", async () => {
    const d = await house();
    try {
        d.start(); execute(d, { type: "interact", target: "Green basement door", content: "open" });
        d.advance(5000);
        for (let i = 0; i < 3; i++) await d.sim.step();
        expect(d.snapshot().location).toBe("Basement");
        execute(d, { type: "move", target: "Bedroom" });
        for (let i = 0; i < 3; i++) await d.sim.step();
        expect(d.snapshot()).toMatchObject({ location: "Stairs", phase: "walking" });
        d.advance(9000);
        for (let i = 0; i < 3; i++) await d.sim.step();
        expect(d.snapshot().location).toBe("Bedroom");
    } finally { d.stop(); }
});

test("daemon stimuli are retained while Mara walks with her voice free; they do not teleport or force her", async () => {
    const d = await house();
    try {
        d.start(); execute(d, { type: "move", target: "Bedroom" });
        queueStimulus(d.sim.world, { targetEid: d.ids.mara, type: "daemon_whisper", source: "inner_voice", modality: "cognitive", content: "Perhaps the basement can wait." });
        const actions = await runCognitionCycle(d.sim.world, d.sim.god.systemRegistry, { enablePlanning: false });
        expect(actions).toEqual([{ eid: d.ids.mara, action: { type: "wait" } }]); // Offline cognition can yield without replacing the body operation.
        const perceptions = getAgentPerceptions(d.sim.world, d.ids.mara).map(e => Perception.content[e]);
        expect(perceptions).toContain("Perhaps the basement can wait.");
        expect(d.snapshot().receipts.some(r => r.kind === "daemon_whisper")).toBe(true);
        expect(d.snapshot()).toMatchObject({ phase: "walking", door: "closed", destination: "Bedroom" });
    } finally { d.stop(); }
});

test("normal new-room and new-object actions remain usable; the camera receives generated local objects", async () => {
    const d = await house();
    try {
        d.start();
        createRoomEntity(d.sim.world, { name: "Attic", description: "A low interior attic with rafters." });
        execute(d, { type: "move", target: "Attic" });
        d.advance(12000);
        expect(d.snapshot().location).toBe("Attic");
        const object = createObjectEntity(d.sim.world, { name: "Brass clue", description: "A brass disc bearing a spiral.", roomId: getDirectContainer(d.sim.world, d.ids.mara), portable: true, traits: ["takeable"] });
        expect(getAgentVisibleEntities(d.sim.world, d.ids.mara)).toContain(object);
        execute(d, { type: "observe", target: "Brass clue" });
        expect(d.snapshot().nativeAction).toMatchObject({ type: "observe", target: "Brass clue" });
        const camera = new PhoneCameraDirector(); camera.observe(d.snapshot());
        expect(camera.next().prompt).toContain("brass disc bearing a spiral");
        expect(camera.next().prompt).not.toContain("inside the enclosed stairwell");
        d.stop(); const location = d.snapshot().location;
        execute(d, { type: "move", target: "Landing" }); d.advance(12000);
        expect(d.snapshot().location).toBe(location);
    } finally { d.stop(); }
});
