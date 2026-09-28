import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan, SocialMemory, Traits } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { addConversationTurn, addPerception, addThought, buildAgentContext } from "../agent-mind";
import { createIntentGoal, executeActions } from "../cognition-system";
import { markStandingIntention } from "../goal-lifecycle";
import { drainPendingStimuli } from "../stimulus-queue";
import { formatSocialMemoryContext, getSocialClosures, getSocialDialogue, getSocialExchanges, recordCommittedSpeech, reviewSocialGoal } from "../social-memory";

function fixture() {
  const world = createArgosWorld("Dialogue proof"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const remote = createRoomEntity(world, { name: "Utility Room" });
  const make = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: `${name} private identity`, roomId: room });
  const mara = make("Mara"), ivo = make("Ivo"), sera = make("Sera"), deaf = make("Dara");
  setLocatedIn(world, sera, remote);
  addComponent(world, deaf, Traits); Traits.active[deaf] = JSON.stringify(["deaf"]);
  const registry = createSystemRegistry();
  const speak = (who: number, target: string, content: string) => executeActions(world, [{ eid: who, action: { type: "speak", target, content } }], registry);
  const goal = createIntentGoal(world, mara, "Get to know Ivo", 4); Goal.kind[goal] = "social";
  return { world, room, remote, mara, ivo, sera, deaf, registry, speak, goal };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls in dialogue tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); drainPendingStimuli(); });

test("only committed local audible speech enters recall, never unexecuted JSON or another mind", () => {
  const f = fixture();
  addConversationTurn(f.world, f.mara, "assistant", "UNEXECUTED_QUESTION");
  addThought(f.world, f.ivo, { content: "PRIVATE_INTENTION" });
  expect(getSocialDialogue(f.world, f.mara)).toEqual([]);
  f.speak(f.ivo, "Mara", "I have the brass key.");
  expect(getSocialDialogue(f.world, f.ivo)).toMatchObject([{ own: true, speaker: "Ivo" }]);
  expect(getSocialDialogue(f.world, f.mara)).toMatchObject([{ own: false, speaker: "Ivo", content: "I have the brass key." }]);
  expect(getSocialDialogue(f.world, f.sera)).toEqual([]);
  expect(getSocialDialogue(f.world, f.deaf)).toEqual([]);
  const context = formatSocialMemoryContext(f.world, f.mara);
  expect(context).not.toContain("UNEXECUTED_QUESTION"); expect(context).not.toContain("PRIVATE_INTENTION");
  expect(context).toContain("people can be wrong, or lie");
});

test("an attributed answer survives perception turnover and later bounded dialogue", () => {
  const f = fixture();
  f.speak(f.mara, "Ivo", "Where is the key?"); f.speak(f.ivo, "Mara", "I carry the key.");
  for (let n = 0; n < 55; n++) {
    addPerception(f.world, f.mara, { type: "visual", content: `Room view ${n}`, source: "eyes" });
    recordCommittedSpeech(f.world, f.ivo, `Later statement ${n}`, "Mara");
  }
  expect(getSocialDialogue(f.world, f.mara)).toHaveLength(48);
  expect(getSocialExchanges(f.world, f.mara)).toHaveLength(1);
  expect(formatSocialMemoryContext(f.world, f.mara)).toContain("I carry the key.");
  expect(formatSocialMemoryContext(f.world, f.mara)).toContain("association is not a guarantee");
});
test("an answer followed by a counterquestion is retained, but speech to another person is not paired", () => {
  const f = fixture();
  f.speak(f.mara, "Ivo", "Have you lived here long?");
  f.speak(f.ivo, "Dara", "Check the window.");
  expect(getSocialExchanges(f.world, f.mara)).toEqual([]);
  f.speak(f.ivo, "Mara", "Since spring. What about you?");
  expect(getSocialExchanges(f.world, f.mara)).toMatchObject([{ response: { content: "Since spring. What about you?" } }]);
});
test("deictic speech retains its original place and age after the listener moves", () => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  const f = fixture(); f.speak(f.ivo, "Mara", "It is here, now.");
  setLocatedIn(f.world, f.mara, f.remote); jest.setSystemTime(120_000);
  expect(formatSocialMemoryContext(f.world, f.mara)).toContain("0s ago, Common Room");
  advanceSimulationTime(f.world, 1, 20_000);
  expect(formatSocialMemoryContext(f.world, f.mara)).toContain("20s ago, Common Room");
});

test("recall survives ECS save/restore with remapped actor IDs", () => {
  const f = fixture(); f.speak(f.ivo, "Mara", "The cupboard key is in my pocket.");
  const expected = getSocialDialogue(f.world, f.mara);
  const save = JSON.parse(JSON.stringify(serializeWorld(f.world, f.registry)));
  const restored = createArgosWorld("Restored"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), save);
  expect(oldToNewId.get(f.mara)).not.toBe(f.mara);
  expect(getSocialDialogue(restored, oldToNewId.get(f.mara)!)).toEqual(expected);
  expect(getSocialDialogue(restored, oldToNewId.get(f.sera)!)).toEqual([]);
});

test("same-named speakers at the same instant still produce distinct source IDs", () => {
  const f = fixture();
  const twin = createAgentEntity(f.world, { name: "Ivo", role: "resident", systemPrompt: "twin", roomId: f.remote });
  const one = recordCommittedSpeech(f.world, f.ivo, "One", undefined, 100);
  const two = recordCommittedSpeech(f.world, twin, "Two", undefined, 100);
  expect(one!.id).not.toBe(two!.id);
});

function review(f: ReturnType<typeof fixture>) {
  f.speak(f.mara, "Ivo", "It is nice to have company."); f.speak(f.ivo, "Mara", "I am glad you are here.");
  return { goalId: f.goal, disposition: "satisfied_for_now", reason: "We had a friendly exchange.", evidenceIds: getSocialDialogue(f.world, f.mara).map(t => t.id) };
}
function attachPlan(f: ReturnType<typeof fixture>, owner = f.mara, goal = f.goal) {
  const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, owner, HasPlan(plan));
  Plan.goalEid[plan] = goal; Plan.status[plan] = "awaiting_decision";
  return plan;
}
test("an owned subjective social goal can settle on actual reciprocal dialogue", () => {
  const f = fixture(), r = review(f);
  const own = attachPlan(f), foreign = attachPlan(f, f.ivo);
  expect(reviewSocialGoal(f.world, f.mara, r)).toEqual({ goalId: f.goal, reason: r.reason });
  expect(Plan.status[own]).toBe("retired"); expect(Plan.status[foreign]).toBe("awaiting_decision");
  expect(Goal.status[f.goal]).toBe("completed"); expect(Goal.progress[f.goal]).toBe(100);
  expect(reviewSocialGoal(f.world, f.mara, r)).toBeUndefined();
  expect(getSocialClosures(f.world, f.mara)).toMatchObject([{ description: "Get to know Ivo", reason: r.reason }]);
  expect(getSocialClosures(f.world, f.ivo)).toEqual([]);
});

test("one reciprocal exchange cannot permanently complete an authored standing desire", () => {
  const f = fixture(); markStandingIntention(f.world, f.goal);
  const r = review(f), plan = attachPlan(f);
  expect(reviewSocialGoal(f.world, f.mara, r)).toBeUndefined();
  expect(Plan.status[plan]).toBe("awaiting_decision");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getSocialClosures(f.world, f.mara)).toEqual([]);
});

test("settled desires retain their own evidence after goal cleanup and dialogue turnover", () => {
  const f = fixture(), r = review(f);
  expect(reviewSocialGoal(f.world, f.mara, r)).toBeDefined();
  const before = getSocialClosures(f.world, f.mara);
  removeEntity(f.world, f.goal);
  for (let n = 0; n < 55; n++) recordCommittedSpeech(f.world, f.ivo, `Later topic ${n}`, "Mara");
  expect(getSocialClosures(f.world, f.mara)).toEqual(before);
  expect(formatSocialMemoryContext(f.world, f.mara)).toContain('"Get to know Ivo" — We had a friendly exchange.');
  const returned = getSocialClosures(f.world, f.mara); returned[0].reason = "CORRUPTED_READER";
  expect(getSocialClosures(f.world, f.mara)).toEqual(before);
});

test("closure survives actor remapping, while a legacy checkpoint cannot inherit stale closure storage", () => {
  const f = fixture(), r = review(f); reviewSocialGoal(f.world, f.mara, r);
  const expected = getSocialClosures(f.world, f.mara);
  const save = JSON.parse(JSON.stringify(serializeWorld(f.world, f.registry)));
  const restored = createArgosWorld("Restored closures"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), save);
  expect(getSocialClosures(restored, oldToNewId.get(f.mara)!)).toEqual(expected);
  const legacy = JSON.parse(JSON.stringify(save));
  for (const entity of legacy.entities) if (entity.components?.SocialMemory) delete entity.components.SocialMemory.closuresJson;
  const old = createArgosWorld("Legacy closures"); initializePrefabs(old);
  const result = deserializeWorld(old, createSystemRegistry(), legacy);
  expect(SocialMemory.closuresJson[result.oldToNewId.get(f.mara)!]).toBe("[]");
  expect(getSocialClosures(old, result.oldToNewId.get(f.mara)!)).toEqual([]);
});

test("a new actor does not inherit closure data left in a reused component array slot", () => {
  const f = fixture(), r = review(f); reviewSocialGoal(f.world, f.mara, r);
  const stale = SocialMemory.closuresJson[f.mara];
  const newActor = createAgentEntity(f.world, { name: "Newcomer", role: "resident", systemPrompt: "New arrival", roomId: f.room });
  // Model the stale SoA slot that can survive entity deletion. Ownership still
  // requires the component to be attached, and first admission initializes it.
  SocialMemory.closuresJson[newActor] = stale;
  expect(getSocialClosures(f.world, newActor)).toEqual([]);
  recordCommittedSpeech(f.world, f.ivo, "Welcome, newcomer.", "Newcomer");
  expect(getSocialClosures(f.world, newActor)).toEqual([]);
});

test("closure storage and context stay bounded without completing unrelated goals", () => {
  const f = fixture();
  for (let n = 0; n < 20; n++) {
    const goalId = createIntentGoal(f.world, f.mara, `Talk about topic ${n}`, 4); Goal.kind[goalId] = "social";
    f.speak(f.mara, "Ivo", `My topic ${n}.`); f.speak(f.ivo, "Mara", `My reply ${n}.`);
    const evidenceIds = getSocialDialogue(f.world, f.mara).slice(-2).map(t => t.id);
    expect(reviewSocialGoal(f.world, f.mara, { goalId, disposition: "satisfied_for_now", reason: `Settled topic ${n}.`, evidenceIds })).toBeDefined();
  }
  expect(getSocialClosures(f.world, f.mara)).toHaveLength(16);
  expect(Goal.status[f.goal]).toBe("active");
  const context = formatSocialMemoryContext(f.world, f.mara);
  expect(context).toContain("Settled topic 19."); expect(context).not.toContain("Settled topic 14.");
});

test("foreground context gives committed words once before historical thought, without erasing delivery attention", () => {
  const f = fixture(); f.speak(f.ivo, "Mara", "I look after the pipes.");
  addPerception(f.world, f.mara, { type: "speech", source: "Ivo", content: 'Ivo says to you: "I look after the pipes."' });
  addPerception(f.world, f.mara, { type: "auditory", source: "Ivo", content: 'Ivo says: "I look after the pipes."' });
  addThought(f.world, f.mara, { content: "OLDER: I should wait for Ivo's answer." });
  const context = buildAgentContext(f.world, f.mara);
  expect(context.split("I look after the pipes.")).toHaveLength(2);
  expect(context).toContain("speech delivered:");
  expect(context.indexOf("I look after the pipes.")).toBeLessThan(context.indexOf("OLDER:"));
});
test("copying the exact UUID without its display namespace still cites the same owned event", () => {
  const f = fixture(), r = review(f);
  r.evidenceIds = r.evidenceIds.map(id => id.replace(/^speech:/, ""));
  expect(reviewSocialGoal(f.world, f.mara, r)).toBeDefined();
  expect(Goal.status[f.goal]).toBe("completed");
});
test("UUID normalization never admits truncated or another listener's private evidence", () => {
  const f = fixture(), r = review(f);
  const remote = recordCommittedSpeech(f.world, f.sera, "Private remote statement")!;
  for (const id of [remote.id.replace(/^speech:/, ""), r.evidenceIds[1].slice(7, -1)]) {
    expect(reviewSocialGoal(f.world, f.mara, { ...r, evidenceIds: [r.evidenceIds[0], id] })).toBeUndefined();
    expect(Goal.status[f.goal]).toBe("active");
  }
});
test.each(["physical", "foreign", "fake", "old", "one_sided"])("social review rejects %s evidence/authority", kind => {
  const f = fixture(), r = review(f), plan = attachPlan(f);
  if (kind === "physical") Goal.successJson[f.goal] = JSON.stringify({ type: "entity_component_equals", entityName: "Relay", component: "Circuit", field: "lit", equals: true });
  if (kind === "foreign") r.goalId = createIntentGoal(f.world, f.ivo, "An Ivo-only desire", 3);
  if (kind === "fake") r.evidenceIds[0] = "invented";
  if (kind === "old") Goal.createdAt[f.goal] = Date.now() + 1000;
  if (kind === "one_sided") r.evidenceIds = [r.evidenceIds[0], r.evidenceIds[0]];
  expect(reviewSocialGoal(f.world, f.mara, r)).toBeUndefined();
  expect(Plan.status[plan]).toBe("awaiting_decision");
  expect(Goal.status[f.goal]).toBe("active");
});

test("social context supplies evidence without mandatory responses, invented familiarity or scenario scripts", () => {
  const f = fixture(); addConversationTurn(f.world, f.mara, "user", "Ivo Ivo Ivo");
  const context = buildAgentContext(f.world, f.mara);
  expect(context).toContain("No spoken exchange recorded here yet");
  expect(context).not.toContain("ALWAYS"); expect(context).not.toContain("make them feel welcome");
  expect(context).not.toContain("ask to borrow it"); expect(context).not.toContain("Ivo private identity");
});
