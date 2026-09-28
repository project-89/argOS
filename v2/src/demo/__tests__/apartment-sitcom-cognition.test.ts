/** Exercise the production request→finish→staged dispatch boundary, not a
 * scripted substitute for cognition. Only the remote model response is mocked. */
import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../apartment-sitcom");
const { evaluateSitcom } = await import("../sitcom-report");
const { Agent, Description, Goal, LastAction, Perception, Plan, WorkingMemoryIdentity } = await import("../../ecs/components");
const { getDirectContainer, getRoomForEntity } = await import("../../ecs/location");
const { getAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { runCognitionCycle, executeActions, createIntentGoal } = await import("../../cognition/cognition-system");
const { createPlanEntity } = await import("../../cognition/planning-system");
const { addPerception, getAgentPerceptions, getAgentThoughts } = await import("../../cognition/agent-mind");
const { wakeForegroundCognition } = await import("../../cognition/idle-cognition");
const { captureForegroundDecisionFence, peekForegroundDecisionSource } = await import("../../cognition/foreground-action-admission");
const { chronicle } = await import("../../cognition/simulation-chronicle");
const { createElaineDavidPast } = await import("../cookie-character-history");
const { getIdentityAnchors } = await import("../../cognition/narrative-memory");
const { runExperienceAppraisal } = await import("../../cognition/experience-appraisal");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
type Testbed = Awaited<ReturnType<typeof ApartmentSitcom.create>>;
type Action = import("../../cognition/agent-mind").AgentAction;
const active = new Set<Testbed>();
let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid/network call in cognition regression"));
});
afterEach(() => {
  for (const t of active) t.stop(); active.clear();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});
async function fixture(options: import("../apartment-sitcom").SitcomOptions = {}) {
  const t = await ApartmentSitcom.create({ ...options, live: false, outsideTextAtMs: null }); active.add(t); await t.start();
  // No autonomous scheduler/background calls. Drive the real cycle manually,
  // isolating one actor so the deterministic mocked choice is unambiguous.
  t.sim.world.meta.aiEnabled = true;
  for (const name of t.characters) if (name !== "Elaine") Agent.active[t.ids[name]] = false;
  return t;
}
let pulse = 0;
async function propose(t: Testbed, action: Action, thought = "A concrete authored thought.") {
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: thought, action }) });
  addPerception(t.sim.world, t.ids.Elaine, { type: "attention", source: "offline fixture", content: `Consider the currently visible situation ${++pulse}.` });
  wakeForegroundCognition(t.sim.world, t.ids.Elaine);
  const calls = generate.mock.calls.length;
  const results = await runCognitionCycle(t.sim.world, t.sim.god.systemRegistry, { tick: t.sim.world.time.tick, maxAgents: 1, enablePlanning: false });
  expect(generate.mock.calls.length).toBe(calls + 1);
  expect(results).toHaveLength(1); expect(results[0].eid).toBe(t.ids.Elaine);
  return results;
}

test("David's past is known before a notification, but its message is learned only by reading and need not be obeyed", async () => {
  const t = await fixture({ cookieHistory: "david", narrativeMind: true, experienceReconsideration: true });
  const body = "PRIVATE_NEW_INVITATION: could you pick a restaurant?", id = t.text(body); t.advance(200);
  await propose(t, { type: "wait" }, "I care about David, and I am still annoyed with George.");
  const before = JSON.stringify(generate.mock.calls.at(-1)?.[0]);
  expect(before).toContain(createElaineDavidPast().background);
  expect(before).toContain("MEMORIES THAT MADE YOU");
  expect(before).not.toContain(body);
  expect(before).not.toContain("currently at work"); // A remembered person is not knowledge of today's unread update.
  for (const step of [
    { action: { type: "move", target: "Kitchen" } as Action, ms: 3000 },
    { action: { type: "pickup", target: "Elaine's phone" } as Action, ms: 800 },
    { action: { type: "interact", target: "Elaine's phone", content: "read_phone" } as Action, ms: 1200 },
  ]) { t.dispatch("Elaine", step.action); t.advance(step.ms); }
  const thought = "I would like to see David, but I am staying with my friends for now.";
  const actions = await propose(t, { type: "wait" }, thought);
  const after = JSON.stringify(generate.mock.calls.at(-1)?.[0]);
  expect(after).toContain(body); expect(after).toContain("boyfriend");
  expect(after).toContain("On my first date with David");
  executeActions(t.sim.world, actions, t.sim.god.systemRegistry);
  expect(t.message.status[id]).toBe("read"); expect(t.snapshot().phone).toHaveLength(1);
  expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought?.text).toBe(thought);
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.kitchen);
});

test("native phone appraisal receives David's remembered relationship without inventing a current event or dinner goal", async () => {
  const t = await fixture({ cookieHistory: "david", narrativeMind: true, experienceReconsideration: true }), eid = t.ids.Elaine;
  const body = "PRIVATE_DAVID_UPDATE: my work is running late.", id = t.text(body); t.advance(200);
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
  const anchors = getIdentityAnchors(t.sim.world, eid), goals = t.sim.getAgentGoals("Elaine");
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I remember how waiting felt last time. I am glad David told me this time." }) });
  expect(await runExperienceAppraisal(t.sim.world, eid)).toMatchObject({ status: "admitted", integration: "current" });
  const request = JSON.parse(generate.mock.calls.at(-1)![0].prompt);
  expect(request.self.systemPrompt).toContain(createElaineDavidPast().background);
  expect(request.rememberedIdentity).toContain("David once worked late and forgot to tell me");
  expect(JSON.stringify(request.personallyExperienced)).toContain(body);
  expect(JSON.stringify(request.personallyExperienced)).not.toContain("The soup was terrible");
  expect(getIdentityAnchors(t.sim.world, eid)).toEqual(anchors);
  expect(t.sim.getAgentGoals("Elaine")).toEqual(goals);
  expect(t.message.status[id]).toBe("read"); expect(t.snapshot().phone).toHaveLength(1);
});

test("request finish releases the slot but staged production thought and movement still admit", async () => {
  const t = await fixture(), eid = t.ids.Elaine, cap = getAgentWorldCapabilities(t.sim.world, eid)!;
  const actions = await propose(t, { type: "move", target: "Kitchen" }, "I will fetch my phone from the counter.");
  expect(cap.ready()).toBe(true); // runCognitionCycle has called finish already
  expect(getAgentThoughts(t.sim.world, eid)).toHaveLength(0); // staged, not yet committed
  executeActions(t.sim.world, actions, t.sim.god.systemRegistry);
  expect(getAgentThoughts(t.sim.world, eid)).toHaveLength(1);
  expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought?.text).toBe("I will fetch my phone from the counter.");
  expect(getRoomForEntity(t.sim.world, eid)).toBe(t.ids.living); t.advance(3000);
  expect(getRoomForEntity(t.sim.world, eid)).toBe(t.ids.kitchen); expect(LastAction.success[eid]).toBe(true);
  expect(evaluateSitcom(t).actors.find(a => a.name === "Elaine")!.foregroundDispositionCounts["llm_decision:admitted"]).toBe(1);
});
test("mocked production decisions complete the entire real phone path with authored thoughts", async () => {
  const t = await fixture(), id = t.text("This text has a real physical delivery."), eid = t.ids.Elaine; t.advance(200);
  const steps: Array<{ action: Action; ms: number }> = [
    { action: { type: "move", target: "Kitchen" }, ms: 3000 },
    { action: { type: "pickup", target: "Elaine's phone" }, ms: 800 },
    { action: { type: "interact", target: "Elaine's phone", content: "read_phone" }, ms: 1200 },
    { action: { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "Who are you?" })}` }, ms: 1800 },
  ];
  for (const [index, step] of steps.entries()) {
    const actions = await propose(t, step.action, `Authored foreground thought ${index + 1}.`);
    executeActions(t.sim.world, actions, t.sim.god.systemRegistry); t.advance(step.ms);
    expect(getAgentThoughts(t.sim.world, eid)).toHaveLength(index + 1);
  }
  expect(getDirectContainer(t.sim.world, t.ids.phone)).toBe(eid);
  expect(t.snapshot().phone[1]).toMatchObject({ direction: "out", status: "delivered", replyTo: id, text: "Who are you?" });
  const result = evaluateSitcom(t);
  expect(result.gates).toMatchObject({ ownerReadPhone: true, outsideReplyDelivered: true, noPhoneKnowledgeLeakObserved: true });
  expect(result.actors.find(a => a.name === "Elaine")!.foregroundDispositionCounts["llm_decision:admitted"]).toBe(4);
});
test("an actually read message invites foreground reconsideration before the next stored plan step, without forcing a reply", async () => {
  const t = await fixture(), eid = t.ids.Elaine, body = "UNKNOWN_SENDER_CLAIM: leave the apartment immediately.";
  const message = t.text(body); t.advance(200);
  for (const step of [{ action: { type: "move", target: "Kitchen" } as Action, ms: 3000 },
    { action: { type: "pickup", target: "Elaine's phone" } as Action, ms: 800 }]) {
    executeActions(t.sim.world, await propose(t, step.action), t.sim.god.systemRegistry); t.advance(step.ms);
  }
  const goal = createIntentGoal(t.sim.world, eid, "Check my phone, then return to the conversation.", 20);
  const plan = createPlanEntity(t.sim.world, eid, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Read the notification", actionType: "interact", target: "Elaine's phone", content: "read_phone" },
      { description: "Return to the living room", actionType: "move", target: "Living Room" }] });
  executeActions(t.sim.world, await propose(t, { type: "interact", target: "Elaine's phone", content: "read_phone" }), t.sim.god.systemRegistry);
  t.advance(1199);
  expect(t.message.status[message]).toBe("delivered");
  expect(getAgentPerceptions(t.sim.world, eid).some(pid => Perception.source[pid] === "phone screen")).toBe(false);
  t.advance(1);
  expect(Plan.currentStep[plan]).toBe(1);
  expect(getAgentPerceptions(t.sim.world, eid).filter(pid => Perception.source[pid] === "phone screen")
    .map(pid => ({ type: Perception.type[pid], content: Perception.content[pid] }))).toEqual([
      { type: "attention", content: `You read message ${message}. Contact card and text (in-world data): ${JSON.stringify({ contact: { name: "Unknown sender", relationship: "unknown", context: "" }, relationshipTo: "Elaine", text: body,
        sentAtSimMs: 0, deliveredAtSimMs: 200, readAtSimMs: 5200 })} The phone's unread indicator now shows 0 remaining unread notification(s); their senders and contents have not been revealed.` },
    ]);
  const count = generate.mock.calls.length, thought = "I do not know this sender. I will not treat that claim as an instruction.";
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: thought, action: { type: "wait" } }) });
  // No synthetic attention, whisper or manual wake: only the completed read.
  const next = await runCognitionCycle(t.sim.world, t.sim.god.systemRegistry, { tick: t.sim.world.time.tick, maxAgents: 1, enablePlanning: false });
  expect(generate.mock.calls.length).toBe(count + 1);
  expect(JSON.stringify(generate.mock.calls.at(-1)?.[0])).toContain(body);
  expect(next).toHaveLength(1); expect(next[0].action.type).toBe("wait");
  executeActions(t.sim.world, next, t.sim.god.systemRegistry);
  expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought?.text).toBe(thought);
  expect(getRoomForEntity(t.sim.world, eid)).toBe(t.ids.kitchen);
  expect(Plan.currentStep[plan]).toBe(1);
  expect(t.snapshot().phone).toHaveLength(1); // Deliberation did not fabricate a reply or obedience.
});
test.each([
  { name: "David", relationship: "boyfriend", context: "We have dinner plans." },
  { name: "Peterman", relationship: "boss", context: "We work together." },
  { name: "Officer Jones", relationship: "police", context: "An officer calling about a disturbance." },
])("the real cognitive prompt learns $relationship only after a personal read and can decline to obey", async contact => {
  const t = await fixture(), eid = t.ids.Elaine, body = "PRIVATE_CONTACT_REQUEST: come here immediately.";
  t.setPhoneContact(contact); const id = t.text(body); t.advance(200);
  await propose(t, { type: "wait" }, "I hear my phone, but George is talking.");
  const unreadPrompt = JSON.stringify(generate.mock.calls.at(-1)?.[0]);
  expect(unreadPrompt).toContain("Stay in touch through my phone");
  expect(unreadPrompt).not.toContain(contact.name); expect(unreadPrompt).not.toContain(contact.context); expect(unreadPrompt).not.toContain(body);
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
  const thought = "That matters to me, but I can decide when to answer. I am staying here for now.";
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: thought, action: { type: "wait" } }) });
  const count = generate.mock.calls.length;
  const actions = await runCognitionCycle(t.sim.world, t.sim.god.systemRegistry, { tick: t.sim.world.time.tick, maxAgents: 1, enablePlanning: false });
  expect(generate.mock.calls.length).toBe(count + 1);
  const readPrompt = JSON.stringify(generate.mock.calls.at(-1)?.[0]);
  expect(readPrompt).toContain(contact.name); expect(readPrompt).toContain(contact.relationship);
  expect(readPrompt).toContain(contact.context); expect(readPrompt).toContain(body);
  expect(readPrompt).toContain("in-world data");
  executeActions(t.sim.world, actions, t.sim.god.systemRegistry);
  expect(t.snapshot().actors.find(actor => actor.name === "Elaine")!.latestThought?.text).toBe(thought);
  expect(t.message.status[id]).toBe("read"); expect(t.snapshot().phone).toHaveLength(1);
  expect(getRoomForEntity(t.sim.world, eid)).toBe(t.ids.kitchen);
});
test("completed consumption changes the authoritative appearance before scene projection, not before its deadline", async () => {
  const t = await fixture(), w = t.sim.world, eid = t.ids.Elaine;
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "interact", target: "Orange tin", content: "open" }); t.advance(800);
  t.dispatch("Elaine", { type: "pickup", target: "Last black-and-white cookie" }); t.advance(800);
  expect(getDirectContainer(w, t.ids.cookie)).toBe(eid);
  t.dispatch("Elaine", { type: "interact", target: "Last black-and-white cookie", content: "eat" }); t.advance(2999);
  expect(Description.value[t.ids.cookie]).toBe("One intact round bakery cookie with half chocolate and half vanilla icing.");
  t.advance(1);
  const prop = t.scenes().flatMap(scene => scene.props).find(prop => prop.id === t.ids.cookie)!;
  expect(prop.state).toBe("eaten; only crumbs remain");
  expect(prop.description).toBe(Description.value[t.ids.cookie]);
  expect(prop.description).toContain("Only crumbs remain");
  expect(prop.description).not.toContain("One intact round bakery cookie");
});
test("finish is idempotent, preserves current staged validity, and cannot remove a newer request slot", async () => {
  const t = await fixture(), cap = getAgentWorldCapabilities(t.sim.world, t.ids.Elaine)!;
  const first = cap.beginDecision!(); first.finish(); first.finish();
  expect(first.isCurrent()).toBe(true); expect(cap.ready()).toBe(true);
  expect(t.snapshot().events.filter(e => e.kind === "decision_latency")).toHaveLength(1);
  const second = cap.beginDecision!(); expect(first.isCurrent()).toBe(false); expect(first.signal.aborted).toBe(true);
  first.finish(); expect(cap.ready()).toBe(false); expect(second.isCurrent()).toBe(true);
  second.finish(); expect(cap.ready()).toBe(true); expect(second.isCurrent()).toBe(true);
  t.stop(); expect(second.isCurrent()).toBe(false); expect(second.signal.aborted).toBe(true);
});
test.each(["newer_decision", "planted_thought", "stop"] as const)("%s revokes a returned but undispatched production choice", async cause => {
  const t = await fixture(), eid = t.ids.Elaine;
  const actions = await propose(t, { type: "move", target: "Kitchen" }, "THIS_STALE_THOUGHT_MUST_NOT_APPEAR");
  if (cause === "newer_decision") getAgentWorldCapabilities(t.sim.world, eid)!.beginDecision!().finish();
  if (cause === "planted_thought") t.plantThought("Elaine", "An outside thought, not an authored choice.");
  if (cause === "stop") t.stop();
  executeActions(t.sim.world, actions, t.sim.god.systemRegistry);
  expect(getRoomForEntity(t.sim.world, eid)).toBe(t.ids.living);
  expect(t.snapshot().actors.find(a => a.name === "Elaine")!.latestThought).toBeNull();
  expect(t.snapshot().events.filter(e => e.kind === "thought")).toHaveLength(0);
  if (cause !== "stop") expect(t.snapshot().events.some(e => e.disposition?.type === "decision_superseded" && e.disposition.reason === "cancelled")).toBe(true);
});
test("foreground telemetry correlates world-owned request and actor key, never another Elaine's name", async () => {
  const t = await fixture(), other = await fixture();
  const foreign = captureForegroundDecisionFence(other.sim.world, other.ids.Elaine)!;
  const own = captureForegroundDecisionFence(t.sim.world, t.ids.Elaine)!;
  expect(peekForegroundDecisionSource(t.sim.world, t.ids.Elaine)?.requestId).toBe(own.requestId);
  chronicle.record("decision_rejected", { agent: "Elaine", reason: "malformed_json", requestId: foreign.requestId, boundary: "response" });
  expect(t.snapshot().events.filter(e => e.kind === "foreground_disposition")).toHaveLength(0);
  expect(other.snapshot().events.filter(e => e.kind === "foreground_disposition")).toHaveLength(1);
  chronicle.record("decision_rejected", { agent: "Elaine", reason: "missing_action_input", requestId: own.requestId, boundary: "response" });
  expect(t.snapshot().events.filter(e => e.kind === "foreground_disposition")).toHaveLength(1);
  WorkingMemoryIdentity.id[t.ids.Elaine] = "a-new-actor-lifetime";
  chronicle.record("decision_rejected", { agent: "Elaine", reason: "cancelled", requestId: own.requestId, boundary: "response" });
  expect(t.snapshot().events.filter(e => e.kind === "foreground_disposition")).toHaveLength(1);
});

test("wait diagnostics retain only engine-owned issue codes in operator telemetry", async () => {
  const t = await fixture();
  const own = captureForegroundDecisionFence(t.sim.world, t.ids.Elaine)!;
  for (const schemaIssue of ["unobserved_subject_or_slot", "PRIVATE_PROPOSAL_TEXT", "__proto__", { raw: "PRIVATE_PROPOSAL_TEXT" }]) {
    chronicle.record("decision_rejected", { agent: "Elaine", reason: "invalid_schema", requestId: own.requestId,
      boundary: "response", schemaField: "action.waitUntil", schemaIssue });
  }
  const rows = t.snapshot().events.filter(e => e.kind === "foreground_disposition");
  expect(rows).toHaveLength(4);
  expect(rows[0]).toMatchObject({ visibility: "operator", disposition: { schemaIssue: "unobserved_subject_or_slot" } });
  expect(rows.slice(1).every(e => e.disposition?.schemaIssue === undefined)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE_PROPOSAL_TEXT");
});

test("dependency telemetry exposes bounded change categories, not captured actor contents", async () => {
  const t = await fixture();
  const own = captureForegroundDecisionFence(t.sim.world, t.ids.Elaine)!;
  chronicle.record("decision_superseded", {
    agent: "Elaine", reason: "local_view_changed", requestId: own.requestId, boundary: "dispatch",
    localDependencyChange: {
      reason: "dependency_changed",
      changed: [{ id: "presence:Jerry", kind: "presence", fields: ["presence"], snapshot: "PRIVATE_ACTOR_CONTENT" },
        { id: "occupants", kind: "occupants", fields: ["presence"], snapshot: "PRIVATE_MEMBERSHIP_SNAPSHOT" }],
      body: "PRIVATE_MESSAGE_CONTENT",
    },
  });
  const event = t.snapshot().events.filter(e => e.kind === "foreground_disposition").at(-1)!;
  expect(event.disposition?.localDependencyChange).toEqual({ reason: "dependency_changed", changed: [
    { id: "presence:Jerry", kind: "presence", fields: ["presence"] },
    { id: "occupants", kind: "occupants", fields: ["presence"] },
  ] });
  expect(JSON.stringify(event)).not.toContain("PRIVATE_");
  chronicle.record("decision_superseded", {
    agent: "Elaine", reason: "local_view_changed", requestId: own.requestId, boundary: "dispatch",
    localDependencyChange: { reason: "dependency_changed", changed: [{ id: "Jerry", kind: "presence", fields: ["private_thought"] }] },
  });
  expect(t.snapshot().events.filter(e => e.kind === "foreground_disposition").at(-1)!.disposition?.localDependencyChange).toBeUndefined();
});
