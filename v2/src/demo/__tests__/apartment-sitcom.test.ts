import { jest } from "@jest/globals";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { captureForegroundDecisionFence } from "../../cognition/foreground-action-admission";
import { chronicle } from "../../cognition/simulation-chronicle";
import { Script } from "node:vm";
import { addComponent, removeComponent } from "bitecs";
import { Agent, Goal, LastAction, ObjectState, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { getActiveGoals } from "../../cognition/cognition-system";
import { createCommunicationMotivation } from "../../cognition/communication-motivation";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { addThought, getAgentMemory } from "../../cognition/agent-mind";
import { getAgentVisualEntities } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector } from "../sitcom-director";
import { snapshotExperienceAppraisal, isExperienceAppraisalPending } from "../../cognition/experience-appraisal";
import { getCommittedEvents, publishCommittedEvent } from "../../runtime/committed-events";
import { evaluateSitcom, renderSitcomReplay, sitcomFrame } from "../sitcom-report";

let testbed: ApartmentSitcom | undefined;
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid/network calls in apartment fixture")); });
afterEach(() => { testbed?.stop(); testbed = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function create(outsideTextAtMs: number | null = null) { testbed = await ApartmentSitcom.create({ live: false, outsideTextAtMs }); await testbed.start(); return testbed; }
function kitchen(t: ApartmentSitcom, who: "Elaine" | "George" = "Elaine") {
  t.dispatch(who, { type: "move", target: "Kitchen" }); t.advance(3000); expect(getRoomForEntity(t.sim.world, t.ids[who])).toBe(t.ids.kitchen);
}
function takePhone(t: ApartmentSitcom) { kitchen(t); t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800); expect(getDirectContainer(t.sim.world, t.ids.phone)).toBe(t.ids.Elaine); }
const read = (t: ApartmentSitcom) => t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" });
const boyfriend = { name: "David", relationship: "boyfriend", context: "We have dinner plans after this visit." };

test("public cast notes expose authored social roles, not private contact information or a recycled actor's former role", async () => {
  const t = await create();
  const actors = t.scenes().flatMap(s=>s.actors);
  expect(actors.find(a=>a.id===t.ids.Jerry)?.publicRole).toBe("the apartment host and a comedian");
  expect(actors.find(a=>a.id===t.ids.Elaine)?.publicRole).toBe("Jerry's friend");
  expect(actors.find(a=>a.id===t.ids.Kramer)?.publicRole).toBe("Jerry's neighbor and friend");
  expect(JSON.stringify(actors)).not.toMatch(/boyfriend|dinner plans|coreMemor|systemPrompt/);
  const key = WorkingMemoryIdentity.id[t.ids.Elaine];
  try {
    WorkingMemoryIdentity.id[t.ids.Elaine] = "replacement-actor";
    expect(t.scenes().flatMap(s=>s.actors).find(a=>a.id===t.ids.Elaine)?.publicRole).toBeUndefined();
  } finally { WorkingMemoryIdentity.id[t.ids.Elaine] = key; }
});
const police = { name: "Officer Davis", relationship: "police", context: "An officer investigating a reported disturbance." };

test("provider metrics enter only their owned request's operator journal with sanitized fields", async () => {
  const t = await create(), fence = captureForegroundDecisionFence(t.sim.world, t.ids.Elaine)!;
  const data = { agent: "Elaine", agentEid: t.ids.Elaine, requestId: fence.requestId,
    provider: { outcome: "returned", durationWallMs: 7000, inputTokens: 500, outputTokens: 80, raw: "PRIVATE_PROVIDER_OUTPUT" } };
  chronicle.record("foreground_provider_result", { ...data, requestId: "unrelated-request" });
  chronicle.record("foreground_provider_result", data);
  const rows = t.snapshot().events.filter(e => e.disposition?.type === "foreground_provider_result");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ visibility: "operator", disposition: { requestId: fence.requestId,
    provider: { outcome: "returned", durationWallMs: 7000, inputTokens: 500, outputTokens: 80 } } });
  expect(JSON.stringify(rows)).not.toContain("PRIVATE_PROVIDER_OUTPUT");
  expect(JSON.stringify(t.scenes())).not.toContain("foreground_provider_result");
});

test("a personally read conversation permits an acknowledgment followed by a separately chosen update", async () => {
  const t = await create(), id = t.text("Please let me know when it is ready.");
  t.advance(200); takePhone(t); read(t); t.advance(1200);
  const reply = (text: string) => t.dispatch("Elaine", { type: "interact", target: "Elaine's phone",
    content: `reply ${JSON.stringify({ replyTo: id, text })}` });
  reply("Got it."); t.advance(1800);
  expect(t.snapshot().phone.filter(m => m.direction === "out")).toHaveLength(1);
  expect(getAvailableAffordances(t.sim.world, t.ids.Elaine, t.ids.phone)
    .find(a => a.name === "reply")).toMatchObject({ requiresFreshDecision: true });
  reply("Done."); t.advance(1599);
  expect(t.snapshot().phone.filter(m => m.direction === "out")).toHaveLength(1);
  t.advance(201);
  expect(t.snapshot().phone.filter(m => m.direction === "out")).toMatchObject([
    { text: "Got it.", replyTo: id, status: "delivered" },
    { text: "Done.", replyTo: id, status: "delivered" },
  ]);
  expect(getPrivateCommunications(t.sim.world, t.ids.Elaine).filter(r => r.own).map(r => r.content)).toEqual(["Got it.", "Done."]);
  t.advance(5000);
  expect(t.snapshot().phone.filter(m => m.direction === "out")).toHaveLength(2);
});

test("reading one message preserves observed backlog salience without exposing the next body", async () => {
  const t = await create(), first = t.text("FIRST_READ"), second = t.text("STILL_PRIVATE"); t.advance(200); takePhone(t);
  read(t); t.advance(1200);
  const motivation = getActiveGoals(t.sim.world, t.ids.Elaine).find(g => g.description.startsWith("Stay in touch"))!.eid;
  expect(t.message.status[first]).toBe("read"); expect(t.message.status[second]).toBe("delivered");
  expect(Goal.priority[motivation]).toBe(8);
  expect(t.context("Elaine")).not.toContain("STILL_PRIVATE");
  expect(t.context("Elaine")).toContain('"unreadNotifications":1');
  expect(t.context("Jerry")).not.toContain('"unreadNotifications"');
  expect(t.snapshot().events.some(e => e.kind === "action" && e.status === "succeeded" && e.text.includes("1 remaining unread"))).toBe(true);
  read(t); t.advance(1200); expect(Goal.priority[motivation]).toBe(6);
  expect(t.context("Elaine")).toContain('"unreadNotifications":0');
  t.phone.battery[t.ids.phone] = 0;
  expect(t.context("Elaine")).not.toContain('"unreadNotifications"');
});

test("reminder vibrations are physical observations, new deliveries are new attention", async () => {
  const t = await create(); t.text("FIRST"); t.advance(200); t.advance(12000);
  const pulses = () => t.snapshot().events.filter(e => e.kind === "perception" && e.actor === "Elaine" && e.text.includes("double vibration"));
  expect(t.snapshot().facts.buzzes).toBe(3); expect(pulses()).toHaveLength(3);
  // Exact attention behavior is exercised by the controller regression; this
  // checks the world did not simply stop emitting its reminders.
  t.text("SECOND"); t.advance(200); expect(t.snapshot().facts.buzzes).toBe(4);
  expect(t.context("Elaine")).not.toContain("SECOND");
});

test("library controller option reaches the world without enabling AI or exposing a private message", async () => {
  testbed = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, cognitionController: "situated", experienceReconsideration: true, narrativeMind: true });
  expect(testbed.sim.world.meta.cognitionController).toBe("situated");
  expect(testbed.sim.world.meta.experienceReconsideration).toBe(true);
  expect(testbed.sim.world.meta.narrativeMind).toBe(true);
  expect(testbed.sim.world.meta.aiEnabled).toBe(false);
  await testbed.start(); testbed.setPhoneContact(boyfriend);
  testbed.text("Private situation-controller test"); testbed.advance(200);
  for (const name of testbed.characters) expect(testbed.context(name)).not.toContain("Private situation-controller test");
});

test("distinct seeded minds share actual opaque containment, not the secret location in public context", async () => {
  const t = await create(), w = t.sim.world;
  expect(t.snapshot().provenance).toMatchObject({ cognition: "offline physics fixture", rendering: "reported by receiver, not simulation", evolution: false });
  expect(getDirectContainer(w, t.ids.cookie)).toBe(t.ids.tin);
  expect(getAgentVisualEntities(w, t.ids.Elaine)).not.toContain(t.ids.cookie);
  expect(t.context("Elaine")).not.toContain('"name":"Last black-and-white cookie"');
  expect(JSON.stringify(t.scenes())).not.toContain('"name":"Last black-and-white cookie"');
  expect(t.sim.getAgentMemories("George")).not.toEqual(t.sim.getAgentMemories("Elaine"));
  kitchen(t); t.dispatch("Elaine", { type: "pickup", target: "Last black-and-white cookie" }); t.advance(800);
  expect(getDirectContainer(w, t.ids.cookie)).toBe(t.ids.tin);
  t.dispatch("Elaine", { type: "interact", target: "Orange tin", content: "open" }); t.advance(799);
  expect(ObjectState.current[t.ids.tin]).toBe("closed"); t.advance(1); expect(ObjectState.current[t.ids.tin]).toBe("open");
  expect(getAgentVisualEntities(w, t.ids.Elaine)).toContain(t.ids.cookie);
  t.advance(5001); // Native repeat-failure cooldown is separate from the new container law.
  t.dispatch("Elaine", { type: "pickup", target: "Last black-and-white cookie" }); t.advance(800);
  expect(getDirectContainer(w, t.ids.cookie)).toBe(t.ids.Elaine);
});
test("the 25s operator message buzzes repeatedly without teaching an unread body", async () => {
  const t = await create(25000);
  t.advance(24999); expect(t.snapshot().phone).toHaveLength(0);
  t.advance(1); expect(t.snapshot().phone[0].status).toBe("queued"); t.advance(200);
  const s = t.snapshot(); expect(s.phone[0].status).toBe("delivered"); expect(s.facts.buzzes).toBe(1);
  expect(s.events.some(e => e.kind === "operator_text" && e.text.includes("scheduled operator stimulus"))).toBe(true);
  expect(s.events.some(e => e.actor === "Elaine" && e.kind === "perception" && e.text.includes("Your phone's familiar"))).toBe(true);
  for (const name of t.characters) expect(t.context(name)).not.toContain(s.phone[0].text);
  expect(JSON.stringify(t.scenes())).not.toContain(s.phone[0].text);
  t.advance(12000); expect(t.snapshot().facts.buzzes).toBe(3);
});
test("the fallback scheduled stimulus owns its unknown identity instead of impersonating a configured contact", async () => {
  const t = await create(25000); t.setPhoneContact({ name: "Marion", relationship: "boss", context: "We have a 10 AM meeting." });
  t.advance(25200);
  expect(t.snapshot().contact.name).toBe("Marion");
  expect(t.snapshot().phone).toEqual([expect.objectContaining({
    status: "delivered", contact: { name: "Unknown sender", relationship: "unknown", context: "" }, contactRevision: 0,
  })]);
  takePhone(t); read(t); t.advance(1200);
  expect(t.context("Elaine")).toContain('"from":"Unknown sender"'); expect(t.context("Elaine")).not.toContain("Marion");
  const manual = t.text("Please confirm tomorrow's meeting.");
  expect(t.snapshot().phone.find(message => message.id === manual)?.contact.name).toBe("Marion");
});
test("an accepted human text suppresses the fallback stimulus even if it is still queued offline", async () => {
  const t = await create(25000); t.setPhoneContact(boyfriend); t.phone.online[t.ids.phone] = false;
  t.advance(5000); const id = t.text("Dinner still on?"); t.advance(22000);
  expect(t.snapshot().phone).toEqual([expect.objectContaining({ id, text: "Dinner still on?", contact: boyfriend, status: "queued" })]);
  expect(t.snapshot().events.some(event => event.kind === "operator_text" && event.text.includes("scheduled operator stimulus"))).toBe(false);
});
test("rejected human text attempts do not suppress the fallback stimulus", async () => {
  const t = await create(25000); t.setPhoneContact(boyfriend);
  for (const body of ["", " ", "x".repeat(501)]) expect(() => t.text(body)).toThrow();
  t.advance(25200);
  expect(t.snapshot().phone).toHaveLength(1);
  expect(t.snapshot().phone[0].contact).toEqual({ name: "Unknown sender", relationship: "unknown", context: "" });
  expect(t.snapshot().events.some(event => event.kind === "operator_text" && event.text.includes("scheduled operator stimulus"))).toBe(true);
});
test("a genuine fetch → pickup → read → type → delivery chain is finite and causally grounded", async () => {
  const t = await create(), id = t.text("SECRET_OUTSIDE_BODY"), w = t.sim.world; t.advance(200);
  read(t); t.advance(1200); expect(t.message.status[id]).toBe("delivered");
  takePhone(t); read(t); t.advance(1199); expect(t.context("Elaine")).not.toContain("SECRET_OUTSIDE_BODY");
  t.advance(1); expect(t.message.status[id]).toBe("read"); expect(t.context("Elaine")).toContain("SECRET_OUTSIDE_BODY");
  expect(t.context("Jerry")).not.toContain("SECRET_OUTSIDE_BODY");
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "Who is this?" })}` });
  t.advance(1599); expect(t.snapshot().phone).toHaveLength(1);
  expect(getPrivateCommunications(w, t.ids.Elaine).filter(r => r.own)).toEqual([]);
  t.advance(1); expect(t.snapshot().phone[1].status).toBe("queued");
  const sent = getPrivateCommunications(w, t.ids.Elaine).find(r => r.own)!;
  expect(sent).toMatchObject({ content: "Who is this?", medium: "text" });
  expect(getPrivateCommunications(w, t.ids.Jerry)).toEqual([]);
  t.advance(200); expect(t.snapshot().phone[1]).toMatchObject({ status: "delivered", replyTo: id, text: "Who is this?" });
  const result = evaluateSitcom(t); expect(result.gates.ownerReadPhone).toBe(true); expect(result.gates.outsideReplyDelivered).toBe(true);
  expect(result.gates.noPhoneKnowledgeLeakObserved).toBe(true);
  expect(LastAction.success[t.ids.Elaine]).toBe(true); expect(getDirectContainer(w, t.ids.phone)).toBe(t.ids.Elaine);
});
test("delayed reads retain message arrival and own reply chronology without leaking unread text", async () => {
  const t = await create(), first = t.text("FIRST_PRIVATE"); t.advance(200); takePhone(t);
  read(t); t.advance(1200);
  const second = t.text("SECOND_PRIVATE"); t.advance(200);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: first, text: "Yes." })}` });
  t.advance(2000);
  expect(t.context("Elaine")).not.toContain("SECOND_PRIVATE");
  read(t); t.advance(1200);
  const receipts = () => JSON.parse(t.context("Elaine").split("Messages YOU actually read: ")[1].slice(0, -1));
  const [a, b] = receipts();
  expect(a).toMatchObject({ id: first, sentAtSimMs: 0, deliveredAtSimMs: 200, repliedByYou: true });
  expect(b).toMatchObject({ id: second, sentAtSimMs: 5200, deliveredAtSimMs: 5400 });
  expect(b.deliveredAtSimMs).toBeLessThan(a.repliedAtSimMs);
  expect(b.readAtSimMs).toBeGreaterThan(a.repliedAtSimMs);
  expect(t.snapshot().events.filter(event => event.actor === "Elaine" && event.kind === "action").some(event =>
    event.text.includes(`Your earlier completed replies (your own remembered actions): ${JSON.stringify([{ replyToMessageId: first, sentAtSimMs: a.repliedAtSimMs }])}`))).toBe(true);
  expect(t.context("Jerry")).not.toContain("SECOND_PRIVATE");
  // Actor memory is the observed screen, not a live alias of mutable transport.
  t.message.createdMs[second] = 99999; t.message.deliveredMs[second] = 99999;
  expect(receipts()[1]).toEqual(b);
});

test("only a completed personal read queues appraisal, and offline appraisal never blocks the actor", async () => {
  const t = await create(), id = t.text("PRIVATE_EXPERIENCE"); t.advance(200); takePhone(t);
  expect(snapshotExperienceAppraisal(t.sim.world, t.ids.Elaine)).toBeUndefined();
  read(t); t.advance(1199); expect(snapshotExperienceAppraisal(t.sim.world, t.ids.Elaine)).toBeUndefined();
  t.advance(1); expect(t.message.status[id]).toBe("read");
  expect(snapshotExperienceAppraisal(t.sim.world, t.ids.Elaine)).toMatchObject({ pending: 1, handled: 0, inFlight: false });
  expect(isExperienceAppraisalPending(t.sim.world, t.ids.Elaine)).toBe(false);
  expect(snapshotExperienceAppraisal(t.sim.world, t.ids.Jerry)).toBeUndefined();
});
test("actual reading and typing carry public motor operations, not private phone arguments", async () => {
  const t = await create(), id = t.text("PRIVATE_READ_SENTINEL"); t.advance(200); takePhone(t);
  read(t); t.advance(400);
  const activity = () => t.scenes().flatMap(scene => scene.actors).find(actor => actor.id === t.ids.Elaine)?.activity;
  expect(activity()).toMatchObject({ action: "reading", status: "pending", targetId: t.ids.phone });
  expect(getCommittedEvents(t.sim.world).events.at(-1)).toMatchObject({ action: "interact", operation: "reading", status: "pending" });
  t.advance(800); expect(activity()).toBeUndefined();
  const objectActions = () => {
    const line = t.context("Elaine").split("\n").find(line => line.startsWith("Visible object facts: "))!;
    return JSON.parse(line.slice("Visible object facts: ".length)).find((object: any) => object.name === "Elaine's phone").actions;
  };
  expect(objectActions()).not.toContain("read_phone"); expect(objectActions()).toContain("reply");
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "PRIVATE_REPLY_SENTINEL" })}` });
  t.advance(400); expect(activity()).toMatchObject({ action: "typing", targetId: t.ids.phone });
  expect(getCommittedEvents(t.sim.world).events.at(-1)).toMatchObject({ operation: "typing", status: "pending" });
  for (const secret of ["PRIVATE_READ_SENTINEL", "PRIVATE_REPLY_SENTINEL", "replyTo"])
    expect(JSON.stringify({ scenes: t.scenes(), public: getCommittedEvents(t.sim.world).events })).not.toContain(secret);
  t.advance(1200); expect(objectActions()).toContain("reply"); expect(activity()).toBeUndefined();
  expect(getCommittedEvents(t.sim.world).events.at(-1)).toMatchObject({ operation: "typing", status: "succeeded" });
  const event = { executionId: "bad-operation", actorId: t.ids.Elaine, roomId: t.ids.kitchen, action: "interact", kind: "action" as const, status: "pending" as const };
  expect(() => publishCommittedEvent(t.sim.world, { ...event, operation: "reply PRIVATE_ARGUMENT" as any })).toThrow("public physical operation");
});

test("stopping a phone read closes its public interval without reading the message", async () => {
  const t = await create(), id = t.text("UNREAD_STOP_SECRET"); t.advance(200); takePhone(t);
  read(t); t.advance(400);
  const pending = getCommittedEvents(t.sim.world).events.at(-1)!;
  t.stop();
  const events = getCommittedEvents(t.sim.world).events.filter(e => e.executionId === pending.executionId);
  expect(events.map(e => e.status)).toEqual(["pending", "failed"]);
  expect(events.at(-1)?.completedAtSimMs).toBe(t.elapsedMs);
  expect(t.message.status[id]).not.toBe("read");
  expect(JSON.stringify(events)).not.toContain("UNREAD_STOP_SECRET");
  t.stop(); expect(getCommittedEvents(t.sim.world).events.filter(e => e.executionId === pending.executionId)).toHaveLength(2);
});
test.each(["phone_moved", "actor_replaced", "room_replaced", "message_replaced"] as const)("reading cannot survive %s during its interval", async change => {
  const t = await create(), id = t.text("UNREAD_UNTIL_COMMIT"); t.advance(200); takePhone(t); read(t); t.advance(400);
  if (change === "phone_moved") setLocatedIn(t.sim.world, t.ids.phone, t.ids.counter);
  if (change === "actor_replaced") WorkingMemoryIdentity.id[t.ids.Elaine] = "replacement-actor";
  if (change === "room_replaced") WorkingMemoryIdentity.id[t.ids.kitchen] = "replacement-room";
  if (change === "message_replaced") WorkingMemoryIdentity.id[id] = "replacement-message";
  t.advance(800); expect(t.message.status[id]).toBe("delivered");
  expect(t.snapshot().events.filter(e => e.kind === "phone_read")).toHaveLength(0);
});
test("typing needs a prior personal read and continued possession; saying a reply is not sending it", async () => {
  const t = await create(), id = t.text("SECRET"); t.advance(200); takePhone(t);
  const action = { type: "interact" as const, target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "No thanks" })}` };
  t.dispatch("Elaine", action); t.advance(1600); expect(t.snapshot().phone).toHaveLength(1);
  read(t); t.advance(1200); t.dispatch("Elaine", action); t.advance(300);
  setLocatedIn(t.sim.world, t.ids.phone, t.ids.counter); t.advance(2000); expect(t.snapshot().phone).toHaveLength(1);
  t.dispatch("Elaine", { type: "speak", content: "I sent a reply." }); t.advance(3000); expect(t.snapshot().phone).toHaveLength(1);
});
test("a past phone read is a personal snapshot, not live access to remotely edited message bodies", async () => {
  const t = await create(), id = t.text("ORIGINALLY_READ_BODY"); t.advance(200); takePhone(t); read(t); t.advance(1200);
  setLocatedIn(t.sim.world, t.ids.phone, t.ids.counter);
  t.dispatch("Elaine", { type: "move", target: "Living Room" }); t.advance(3000);
  t.message.body[id] = "NEVER_SEEN_REPLACEMENT_BODY";
  expect(t.context("Elaine")).toContain("ORIGINALLY_READ_BODY"); expect(t.context("Elaine")).not.toContain("NEVER_SEEN_REPLACEMENT_BODY");
});
test("typing revalidates the exact selected message direction even if another read message enables reply", async () => {
  const t = await create(), first = t.text("First"), second = t.text("Second"); t.advance(200); takePhone(t);
  read(t); t.advance(1200); read(t); t.advance(1200);
  expect(t.message.status[second]).toBe("read");
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: first, text: "No thanks" })}` });
  t.advance(300); t.message.direction[first] = "out"; t.advance(1500);
  expect(t.snapshot().phone).toHaveLength(2); expect(LastAction.success[t.ids.Elaine]).toBe(false);
});
test("eating is real finite consumption and cannot eat a cookie transferred during chewing", async () => {
  const t = await create(); kitchen(t); t.dispatch("Elaine", { type: "interact", target: "Orange tin", content: "open" }); t.advance(800);
  t.dispatch("Elaine", { type: "pickup", target: "Last black-and-white cookie" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Last black-and-white cookie", content: "eat" }); t.advance(1000);
  setLocatedIn(t.sim.world, t.ids.cookie, t.ids.counter); t.advance(2000); expect(t.food.consumed[t.ids.cookie]).toBe(false);
});
test("latest authored thought excludes injections/background and replay safely treats text as data", async () => {
  const t = await create(), text = '</script><img src=x onerror="alert(1)">';
  addThought(t.sim.world, t.ids.Elaine, { type: "reasoning", content: text });
  t.advance(500); t.plantThought("Elaine", "DO_THIS_NOW");
  addThought(t.sim.world, t.ids.Elaine, { type: "reflection", content: "BACKGROUND" });
  const frame = sitcomFrame(t), own = frame.actors.find(a => a.name === "Elaine")!;
  expect(own.latestThought).toMatchObject({ text, atSimMs: 0 });
  const html = renderSitcomReplay([frame], [], t.snapshot().events);
  expect(() => new Script(html.split("</script><script>")[1].split("</script>")[0])).not.toThrow();
  expect(html).not.toContain('<img src=x'); expect(html).toContain("\\u003c/script>");
  expect(html).not.toContain("DO_THIS_NOW");
});
test("stop prevents a pending read or queued message from completing", async () => {
  const t = await create(), id = t.text("STOPPED_BODY"); t.advance(200); takePhone(t); read(t); t.advance(300); t.stop();
  expect(t.message.status[id]).toBe("delivered"); expect(() => t.advance(2000)).toThrow();
  expect(t.snapshot().events.some(e => e.kind === "phone_read")).toBe(false);
});
test("contact edits are ECS state for future messages, never a retroactive change to queued messages, personal reads or replies", async () => {
  const t = await create(), w = t.sim.world;
  const source = { ...boyfriend }; t.setPhoneContact(source); source.name = "Aliased mutation";
  expect(t.contactCard.name[t.ids.phone]).toBe("David"); expect(t.snapshot().contact).toEqual(boyfriend);
  const first = t.text("DINNER_MESSAGE");
  t.setPhoneContact(police); const second = t.text("POLICE_MESSAGE");
  expect(t.snapshot().phone).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: first, contact: boyfriend, contactRevision: 1 }),
    expect.objectContaining({ id: second, contact: police, contactRevision: 2 }),
  ]));
  t.advance(200);
  for (const name of t.characters) {
    expect(t.context(name)).not.toContain("David"); expect(t.context(name)).not.toContain("Officer Davis");
    expect(t.context(name)).not.toContain("DINNER_MESSAGE");
  }
  expect(JSON.stringify(t.scenes())).not.toContain("Officer Davis");
  takePhone(t); read(t); t.advance(1200);
  expect(t.context("Elaine")).toContain('"contact":{"name":"David","relationship":"boyfriend"');
  expect(t.context("Elaine")).not.toContain("Officer Davis");
  expect(t.context("Jerry")).not.toContain("David");
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: first, text: "See you soon." })}` });
  t.setPhoneContact({ name: "Peterman", relationship: "boss", context: "We work together." });
  t.advance(1800);
  expect(t.snapshot().phone.find(m => m.direction === "out")).toMatchObject({ replyTo: first, contact: boyfriend, contactRevision: 1, status: "delivered" });
  setLocatedIn(w, t.ids.phone, t.ids.counter);
  expect(t.context("Elaine")).toContain("David"); expect(t.context("Elaine")).not.toContain("Peterman");
  const snapshot = t.snapshot(); snapshot.phone[0].contact.name = "Snapshot mutation"; snapshot.contact.name = "Snapshot current mutation";
  expect(t.snapshot().phone[0].contact).toEqual(boyfriend); expect(t.snapshot().contact.name).toBe("Peterman");
  t.stop(); expect(() => t.setPhoneContact(boyfriend)).toThrow();
});
test.each(["read", "reply"] as const)("%s revalidates exact message contact identity throughout its duration", async operation => {
  const t = await create(); t.setPhoneContact(boyfriend); const id = t.text("UNCHANGED_BODY"); t.advance(200); takePhone(t);
  if (operation === "read") read(t);
  else {
    read(t); t.advance(1200);
    t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: id, text: "All good" })}` });
  }
  t.advance(300); t.message.contactName[id] = "Replaced sender"; t.advance(1600);
  expect(LastAction.success[t.ids.Elaine]).toBe(false); expect(t.snapshot().phone).toHaveLength(1);
  if (operation === "read") expect(t.snapshot().events.some(e => e.kind === "phone_read")).toBe(false);
  else { expect(t.context("Elaine")).toContain("David"); expect(t.context("Elaine")).not.toContain("Replaced sender"); }
});
test("phone attention competes with the social objective only when its notification is actually perceived", async () => {
  const t = await create(), w = t.sim.world, eid = t.ids.Elaine;
  const goals = getActiveGoals(w, eid), contactGoal = goals.find(g => g.description.includes("Stay in touch through my phone"))!;
  expect(contactGoal.priority).toBe(6); expect(goals.some(g => g.description.includes("cookie") && g.priority === 7)).toBe(true);
  expect(JSON.stringify(t.sim.getAgentMemories("Elaine"))).toContain("being reachable");
  t.phone.silent[t.ids.phone] = true; t.setPhoneContact(police); const id = t.text("POLICE_CLAIM"); t.advance(200);
  expect(Goal.priority[contactGoal.eid]).toBe(6); expect(t.message.status[id]).toBe("delivered");
  t.phone.silent[t.ids.phone] = false; t.advance(6000);
  expect(Goal.priority[contactGoal.eid]).toBe(8);
  t.advance(6000); expect(Goal.priority[contactGoal.eid]).toBe(8); // No repeated escalation.
  expect(t.message.status[id]).toBe("delivered"); expect(getDirectContainer(w, t.ids.phone)).toBe(t.ids.counter); // A desire performs no action.
  takePhone(t); read(t); t.advance(1200);
  expect(Goal.priority[contactGoal.eid]).toBe(6); expect(t.snapshot().phone).toHaveLength(1); // Reading does not require a reply.
  Goal.status[contactGoal.eid] = "retired";
  t.text("ANOTHER_NOTIFICATION"); t.advance(200);
  expect(Goal.status[contactGoal.eid]).toBe("retired"); expect(Goal.priority[contactGoal.eid]).toBe(6);
});
test("a different phone reader learns the contact's relationship to Elaine, never assumes it is their own", async () => {
  const t = await create(); t.setPhoneContact(police); const id = t.text("MEANT_FOR_ELAINE"); t.advance(200);
  t.dispatch("Kramer", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Kramer", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Kramer", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
  expect(t.message.status[id]).toBe("read");
  expect(t.context("Kramer")).toContain('"relationshipTo":"Elaine"');
  expect(t.context("Kramer")).toContain("Officer Davis"); expect(t.context("Elaine")).not.toContain("Officer Davis");
});
test.each(["offline", "inaudible"] as const)("an %s notification cannot secretly increase a private motivation", async condition => {
  const t = await create(), w = t.sim.world, eid = t.ids.Elaine;
  const goal = getActiveGoals(w, eid).find(g => g.description.includes("Stay in touch through my phone"))!.eid;
  if (condition === "offline") t.phone.online[t.ids.phone] = false;
  else { addComponent(w, eid, Traits); Traits.active[eid] = JSON.stringify(["deaf"]); }
  t.text("NOT_PERCEIVED"); t.advance(6200);
  expect(Goal.priority[goal]).toBe(6); expect(t.context("Elaine")).not.toContain("NOT_PERCEIVED");
  expect(t.snapshot().events.some(e => e.actor === "Elaine" && e.kind === "perception" && e.text.includes("familiar"))).toBe(false);
});
test("reusable motivation validates priorities and cannot mutate an inactive actor, detached goal or new goal lifetime", async () => {
  const t = await create(), w = t.sim.world, eid = t.ids.Jerry;
  const options = { description: "Keep in touch without abandoning my evening.", memory: "I value keeping in touch." };
  const count = getActiveGoals(w, eid).length;
  for (const priority of [NaN, Infinity, -Infinity]) expect(() => createCommunicationMotivation(w, eid, { ...options, priority })).toThrow();
  expect(getActiveGoals(w, eid)).toHaveLength(count);
  const motivation = createCommunicationMotivation(w, eid, options), goal = motivation.goal;
  Agent.active[eid] = false; motivation.noticeNotification(); expect(Goal.priority[goal]).toBe(6);
  Agent.active[eid] = true; motivation.noticeNotification(); expect(Goal.priority[goal]).toBe(8);
  removeComponent(w, eid, HasGoal(goal)); motivation.readCommunication(); expect(Goal.priority[goal]).toBe(8);
  addComponent(w, eid, HasGoal(goal)); WorkingMemoryIdentity.id[goal] = "recycled-goal";
  motivation.readCommunication(); expect(Goal.priority[goal]).toBe(8);
});
test("the rendering projection never receives a private contact card, even when its owner reads the message", async () => {
  const t = await create(), director = new SitcomDirector(t, { windowMs: 1000, wholeUtterances: false });
  try {
    const contact = { name: "PRIVATE_CONTACT_NAME", relationship: "PRIVATE_RELATIONSHIP", context: "PRIVATE_CONTACT_CONTEXT" };
    t.setPhoneContact(contact); t.text("PRIVATE_CONTACT_BODY"); t.advance(1000);
    takePhone(t); read(t); t.advance(1200);
    expect(t.context("Elaine")).toContain(contact.name);
    let version: number | undefined;
    for (;;) {
      const next = director.next(version); if (!("segment" in next)) break;
      version = next.segment.version;
      for (const privateText of [...Object.values(contact), "PRIVATE_CONTACT_BODY"]) expect(next.segment.prompt).not.toContain(privateText);
    }
    expect(version).toBeGreaterThan(0);
  } finally { director.stop(); }
});
