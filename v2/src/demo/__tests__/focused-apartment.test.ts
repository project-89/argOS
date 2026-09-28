import { jest } from "@jest/globals";
import { query } from "bitecs";
import { Agent, Goal, Name, Plan, WikiDoc, WorkDocument, WorkingMemoryIdentity } from "../../ecs/components";
import { createPlanEntity, checkStepPrerequisites } from "../../cognition/planning-system";
import { buildAvailableActionsContext } from "../../cognition/action-registry";
import { createGeneratedIntention, getGoalCompletionOptions, maintainGoalLifecycles } from "../../cognition/goal-lifecycle";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { buildAgentContext, getAgentMemory } from "../../cognition/agent-mind";
import { snapshotAttentionSignals } from "../../cognition/unresolved-attention";
import { estimateSpeechDurationMs } from "../../cognition/timed-speech";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { ApartmentSitcom } from "../apartment-sitcom";

let testbed: ApartmentSitcom | undefined;
beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Focused fixtures must not call models or H3."));
});
afterEach(() => {
  testbed?.stop(); testbed = undefined;
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function create() {
  testbed = await ApartmentSitcom.create({ live: false, scenario: "duet" });
  await testbed.start(); return testbed;
}
function takePhone(t: ApartmentSitcom) {
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.kitchen);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  expect(getDirectContainer(t.sim.world, t.ids.phone)).toBe(t.ids.Elaine);
}
function startRead(t: ApartmentSitcom) {
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
}
function notificationKey(t: ApartmentSitcom, message: number) {
  return `notification:${WorkingMemoryIdentity.id[t.ids.phone]}:${WorkingMemoryIdentity.id[message]}`;
}
function notificationKeys(t: ApartmentSitcom, actor: "Elaine" | "Jerry") {
  return snapshotAttentionSignals(t.sim.world, t.ids[actor]).filter(signal => signal.source === "phone vibration").map(signal => signal.signalKey);
}

test("duet creates exactly two real inhabitants, not a four-agent world hidden by the UI", async () => {
  const t = await create(), world = t.sim.world;
  expect([...query(world, [Agent])].map(eid => Name.value[eid]).sort()).toEqual(["Elaine", "Jerry"]);
  expect(t.characters).toEqual(["Elaine", "Jerry"]);
  expect(t.ids.George).toBeUndefined(); expect(t.ids.Kramer).toBeUndefined();
  expect(t.snapshot().actors.map(actor => actor.name)).toEqual(["Elaine", "Jerry"]);
  expect(t.scenes().flatMap(scene => scene.actors.map(actor => actor.name)).sort()).toEqual(["Elaine", "Jerry"]);
  expect(world.meta.aiEnabled).toBe(false);
  expect(world.meta.narrativeMind).toBe(true); expect(world.meta.experienceReconsideration).toBe(true);
});

test("the native phone keeps reply available but never lends its wording to an automatic plan", async () => {
  const t = await create(), message = t.text("What is happening?"); t.advance(200);
  takePhone(t); startRead(t); t.advance(1200);
  const content = `reply ${JSON.stringify({ replyTo: message, text: "I am still deciding." })}`;
  expect(checkStepPrerequisites(t.sim.world, t.ids.Elaine, { description: "Reply with old wording", actionType: "interact",
    target: "Elaine's phone", content })).toBe(false);
  // A deliberate native caller still exercises normal physical typing/read
  // prerequisites; the policy is not a ban on communication or its content.
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content }); t.advance(3000);
  expect(t.snapshot().phone).toEqual(expect.arrayContaining([expect.objectContaining({ direction: "out", text: "I am still deciding.", status: "delivered" })]));
});

test("duet exposes native document work through the shared brain and executor, without scripting its adoption", async () => {
  const t = await create(), world = t.sim.world;
  const document = [...query(world, [WorkDocument])][0];
  expect(Name.value[document]).toBe("Evening notes");
  expect(buildAvailableActionsContext(world, t.ids.Elaine).objectAffordances.some(a => a.affordanceName === "write_document")).toBe(true);
  expect(getGoalCompletionOptions(world, t.ids.Elaine).some(o => o.description === "Finalize Evening notes")).toBe(true);
  t.dispatch("Elaine", { type: "interact", target: "Evening notes", content: 'write_document {"revision":0,"text":"PRIVATE_NOTE_77"}' });
  t.advance(1999); expect(WikiDoc.body[document]).toBe("");
  t.advance(1); expect(WikiDoc.body[document]).toBe("PRIVATE_NOTE_77");
  expect(buildAgentContext(world, t.ids.Jerry)).not.toContain("PRIVATE_NOTE_77");
  expect(JSON.stringify(t.scenes())).not.toContain("PRIVATE_NOTE_77");
  t.dispatch("Elaine", { type: "interact", target: "Evening notes", content: 'review_document {"revision":1}' }); t.advance(2000);
  t.dispatch("Elaine", { type: "interact", target: "Evening notes", content: 'finish_document {"revision":1}' }); t.advance(600);
  expect(WikiDoc.status[document]).toBe("finished");
});

test("duet remains viewer-only beyond the old automatic text deadline", async () => {
  const t = await create(); t.advance(120_000);
  expect(t.options.outsideTextAtMs).toBeNull(); expect(t.snapshot().phone).toEqual([]);
  expect(t.snapshot().facts.buzzes).toBe(0);
  expect(t.snapshot().provenance.outsideText).toBe("viewer only; no scheduled text");
  expect(t.snapshot().events.some(event => ["operator_text", "phone_delivered", "phone_buzz"].includes(event.kind))).toBe(false);
  const message = t.text("I will be a little late.", "explicit viewer"); t.advance(200);
  expect(t.snapshot().phone).toEqual([expect.objectContaining({ id: message, status: "delivered" })]);
});

test("startup notification knowledge is conditional; only a real delivery creates an attention cue", async () => {
  const t = await create();
  for (const actor of ["Elaine", "Jerry"] as const) {
    const context = buildAgentContext(t.sim.world, t.ids[actor]);
    expect(context).toContain("AVAILABLE OPERATIONS (rules, not events):");
    expect(context).toContain("CURRENT LOCAL OBSERVATIONS:");
    expect(context).toContain("WHAT YOU'VE JUST SENSED:");
    expect(context).not.toContain("means I have a notification");
    expect(context).not.toContain("Phone display in your hand");
    expect(notificationKeys(t, actor)).toEqual([]);
  }
  expect(t.snapshot().facts.buzzes).toBe(0);
  t.text("PRIVATE_NEW_NOTIFICATION"); t.advance(200);
  for (const actor of ["Elaine", "Jerry"] as const) {
    expect(notificationKeys(t, actor)).toHaveLength(1);
    expect(buildAgentContext(t.sim.world, t.ids[actor])).not.toContain("PRIVATE_NEW_NOTIFICATION");
  }
  expect(t.snapshot().facts.buzzes).toBe(1);
});

test("finishing the route to coffee leaves the larger intention available for newly discovered work", async () => {
  const t = await create(), world = t.sim.world, actor = t.ids.Jerry;
  const goal = createGeneratedIntention(world, actor, { description: "Get a cup of coffee from the kitchen", priority: 10 }, "foreground")!;
  const plan = createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal], estimatedCompletion: "soon", potentialObstacles: [],
    steps: [{ description: "Go where coffee is available", actionType: "move", target: "Kitchen" }] });
  t.dispatch("Jerry", { type: "move", target: "Kitchen" }); t.advance(3000);
  expect(Plan.status[plan]).toBe("completed"); maintainGoalLifecycles(world, actor);
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBeLessThan(100);
  t.dispatch("Jerry", { type: "pickup", target: "Blue mug" }); t.advance(800);
  t.dispatch("Jerry", { type: "interact", target: "Coffee pot", content: "pour" }); t.advance(2000);
  expect(t.cup.filled[t.ids.blueMug]).toBe(true); expect(t.coffee.portions[t.ids.coffee]).toBe(3);
  t.dispatch("Jerry", { type: "interact", target: "Blue mug", content: "drink" }); t.advance(3000);
  expect(t.cup.drinks[t.ids.blueMug]).toBe(1);
  // The fixture chose these actions to test the engine. This is not a claim
  // of autonomous adoption or certification of arbitrary intention prose.
  expect(Goal.status[goal]).not.toBe("completed");
});

test("duet refuses the incompatible automatic four-person cookie stimulus", async () => {
  await expect(ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: 25_000 })).rejects.toThrow("viewer-only");
});

test("a notification reveals neither its private body nor contact to either character before reading", async () => {
  const t = await create(), body = "PRIVATE_VIEWER_BODY_77", contact = { name: "Private Contact R77", relationship: "private relationship R77", context: "private context R77" };
  t.setPhoneContact(contact); t.text(body); t.advance(200);
  for (const actor of t.characters) {
    const knowledge = [t.context(actor), buildAgentContext(t.sim.world, t.ids[actor]), JSON.stringify(getAgentMemory(t.sim.world, t.ids[actor]))].join("\n");
    for (const secret of [body, ...Object.values(contact)]) expect(knowledge).not.toContain(secret);
    expect(snapshotAttentionSignals(t.sim.world, t.ids[actor])).toEqual([expect.objectContaining({ source: "phone vibration", status: "unreviewed" })]);
  }
  for (const secret of [body, ...Object.values(contact)]) expect(JSON.stringify(t.scenes())).not.toContain(secret);
});

test("reading teaches Elaine privately; Jerry learns a message only through actual subsequent disclosure", async () => {
  const t = await create(), body = "The blue envelope is in my coat.";
  const message = t.text(body); t.advance(200); takePhone(t); startRead(t); t.advance(1200);
  expect(t.message.status[message]).toBe("read"); expect(t.context("Elaine")).toContain(body);
  expect(buildAgentContext(t.sim.world, t.ids.Elaine)).toContain(body);
  expect(buildAgentContext(t.sim.world, t.ids.Jerry)).not.toContain(body);
  expect(JSON.stringify(getAgentMemory(t.sim.world, t.ids.Jerry))).not.toContain(body);
  expect(JSON.stringify(t.scenes())).not.toContain(body);
  t.dispatch("Elaine", { type: "move", target: "Living Room" }); t.advance(3000);
  t.dispatch("Elaine", { type: "speak", target: "Jerry", content: body });
  // Starting speech is not proof that its later words have been heard.
  expect(buildAgentContext(t.sim.world, t.ids.Jerry)).not.toContain(body);
  t.advance(estimateSpeechDurationMs(body) + 1);
  expect(buildAgentContext(t.sim.world, t.ids.Jerry)).toContain(body);
  expect(t.snapshot().events.some(event => event.actor === "Elaine" && event.kind === "speech" && event.status === "succeeded" && event.text === body)).toBe(true);
  expect(t.snapshot().events.some(event => event.kind === "reply_typed" || event.kind === "reply_delivered")).toBe(false);
});

test("reading one of several messages resolves exactly its own notification, not the entire backlog or another observer's cues", async () => {
  const t = await create(), first = t.text("FIRST_PRIVATE_BODY"), second = t.text("SECOND_PRIVATE_BODY"); t.advance(200);
  const firstKey = notificationKey(t, first), secondKey = notificationKey(t, second);
  expect(notificationKeys(t, "Elaine")).toEqual([firstKey, secondKey]);
  expect(notificationKeys(t, "Jerry")).toEqual([firstKey, secondKey]);
  takePhone(t); startRead(t); t.advance(1199);
  expect(notificationKeys(t, "Elaine")).toEqual([firstKey, secondKey]);
  t.advance(1);
  expect(notificationKeys(t, "Elaine")).toEqual([secondKey]);
  expect(notificationKeys(t, "Jerry")).toEqual([firstKey, secondKey]);
  expect(t.snapshot().facts.unread).toBe(1);
  expect(t.context("Elaine")).toContain("FIRST_PRIVATE_BODY"); expect(t.context("Elaine")).not.toContain("SECOND_PRIVATE_BODY");
  t.advance(6000); expect(notificationKeys(t, "Elaine")).toEqual([secondKey]);
  startRead(t); t.advance(1200);
  expect(notificationKeys(t, "Elaine")).toEqual([]); expect(t.snapshot().facts.unread).toBe(0);
  expect(notificationKeys(t, "Jerry")).toEqual([firstKey, secondKey]);
});

test("interrupted reading cannot resolve the notification or reveal its message", async () => {
  const t = await create(), body = "NOT_READ_AFTER_INTERRUPTION", message = t.text(body); t.advance(200); takePhone(t);
  startRead(t); t.advance(500); setLocatedIn(t.sim.world, t.ids.phone, t.ids.counter); t.advance(700);
  expect(t.message.status[message]).toBe("delivered");
  expect(notificationKeys(t, "Elaine")).toEqual([notificationKey(t, message)]);
  expect(t.context("Elaine")).not.toContain(body);
});

test("operator actions cannot address absent cookie-cast actors in a duet", async () => {
  const t = await create();
  expect(() => t.dispatch("George", { type: "move", target: "Kitchen" })).toThrow();
  expect(() => t.plantThought("Kramer", "An absent actor cannot receive this.")).toThrow();
  expect(t.snapshot().events.some(event => event.actor === "George" || event.actor === "Kramer")).toBe(false);
});
