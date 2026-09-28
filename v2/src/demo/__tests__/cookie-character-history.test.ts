import { jest } from "@jest/globals";
import { getRelationTargets, query } from "bitecs";
import { ApartmentSitcom, type SitcomOptions } from "../apartment-sitcom";
import { createElaineDavidPast, ELAINE_DAVID_CONTACT, ELAINE_DAVID_APPOINTMENT } from "../cookie-character-history";
import { Agent, Memory, Name } from "../../ecs/components";
import { HasMemory } from "../../ecs/relations";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { buildAgentContext } from "../../cognition/agent-mind";
import { getActiveGoals } from "../../cognition/cognition-system";
import { getAspirations } from "../../cognition/goal-learning";
import { getIdentityAnchors } from "../../cognition/narrative-memory";
import { getCommittedEvents } from "../../runtime/committed-events";
import { getDirectContainer } from "../../ecs/location";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { authorPhoneAppointmentSchedule } from "../../evals/phone-appointment-fixture";
import { formatScheduleForContext, getCurrentActivity, getSchedule } from "../../cognition/schedule-system";
import { Schedule } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";

const active: ApartmentSitcom[] = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in character-authoring tests")); });
afterEach(() => { active.forEach(t => t.stop()); active.length = 0; expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
async function fixture(options: SitcomOptions = {}) {
  const t = await ApartmentSitcom.create({ narrativeMind: true, ...options, live: false, outsideTextAtMs: null });
  active.push(t); return t;
}
const goals = (t: ApartmentSitcom, name: string) => getActiveGoals(t.sim.world, t.ids[name])
  .map(({ description, priority }) => ({ description, priority }));

test("snack ablation changes only Elaine's opening cookie grievance, not phone motivation or her past", async () => {
  const authored = async (cookieGrievance: "respect" | "snack") => {
    const t = await fixture({ cookieHistory: "david", cookieGrievance });
    const characters = Object.fromEntries(["Elaine", "George", "Jerry", "Kramer"].map(name => {
      const id = t.ids[name];
      return [name, { prompt: Agent.systemPrompt[id], drives: [...getAspirations(t.sim.world, id)], goals: goals(t, name),
        memories: getRelationTargets(t.sim.world, id, HasMemory).map(m => Memory.content[m]),
        anchors: getIdentityAnchors(t.sim.world, id).map(a => a.monologue) }];
    }));
    return { characters, contact: t.snapshot().contact, phone: t.snapshot().phone };
  };
  const control = await authored("respect"), treatment = await authored("snack");
  for (const name of ["George", "Jerry", "Kramer"]) expect(treatment.characters[name]).toEqual(control.characters[name]);
  const before = control.characters.Elaine, after = treatment.characters.Elaine;
  expect(after.prompt).toBe(before.prompt); expect(after.drives).toEqual(before.drives); expect(after.anchors).toEqual(before.anchors);
  expect(after.goals.filter(g => !g.description.includes("cookie"))).toEqual(before.goals.filter(g => !g.description.includes("cookie")));
  expect(after.goals.find(g => g.description.includes("cookie"))?.priority).toBe(7);
  expect(after.memories.filter(m => !m.includes("I asked George"))).toEqual(before.memories.filter(m => !m.includes("I asked George")));
  expect(after.memories.find(m => m.includes("I asked George"))).not.toContain("unreasonable");
  expect(treatment.contact).toEqual(control.contact); expect(treatment.phone).toEqual(control.phone);
  await expect(ApartmentSitcom.create({ cookieGrievance: "invented" as any })).rejects.toThrow("Unknown cookie grievance");
  await expect(ApartmentSitcom.create({ scenario: "duet", cookieGrievance: "snack" })).rejects.toThrow("cookie scenario");
});

test("scheduled appointment ablation supplies a private due intention, not an action or forced phone response", async () => {
  const t = await fixture({ cookieHistory: "david-appointment" }), w = t.sim.world;
  const beforeGoals = goals(t, "Elaine"), beforePhone = t.snapshot().phone;
  const scheduleId = getSchedule(w, t.ids.Elaine);
  const previous = scheduleId === undefined ? [] : JSON.parse(Schedule.activities[scheduleId]);
  authorPhoneAppointmentSchedule(t);
  expect(getCurrentActivity(w, t.ids.Elaine)).toMatchObject({ name: "Coffee with David", priority: 7, interruptible: true });
  expect(JSON.parse(Schedule.activities[getSchedule(w, t.ids.Elaine)!]).slice(1)).toEqual(previous);
  expect(goals(t, "Elaine")).toEqual(beforeGoals);
  expect(t.snapshot().phone).toEqual(beforePhone);
  expect(getCommittedEvents(w).events).toEqual([]);
  expect(() => authorPhoneAppointmentSchedule(t)).toThrow("already authored");
  advanceSimulationTime(w, 1, 138_000);
  const context = buildAgentContext(w, t.ids.Elaine);
  expect(context).toContain("CURRENT WORLD TIME: 16:02 (Day 1)");
  expect(context).toContain("Scheduled activity: Coffee with David");
  expect(context).toContain("Scheduled start: 16:00; 2 minutes since start");
  expect(context).toContain("not proof of attendance or execution");
  for (const friend of ["Jerry", "George", "Kramer"]) expect(buildAgentContext(w, t.ids[friend])).not.toContain("Coffee with David");
  expect(JSON.stringify(t.scenes())).not.toContain("Coffee with David");
  expect(() => authorPhoneAppointmentSchedule(t)).toThrow("initial known-appointment");
  const data = JSON.parse(JSON.stringify(serializeWorld(w, t.sim.god.systemRegistry)));
  const loaded = createArgosWorld("appointment restore"); initializePrefabs(loaded);
  const { oldToNewId } = deserializeWorld(loaded, createSystemRegistry(), data);
  const elaine = oldToNewId.get(t.ids.Elaine)!;
  expect(formatScheduleForContext(loaded, elaine)).toContain("Scheduled activity: Coffee with David");
});

test("David history seeds private narrative anchors and drives without changing cookie goals or the physical puzzle", async () => {
  const episodic = (bed: ApartmentSitcom) => getRelationTargets(bed.sim.world, bed.ids.Elaine, HasMemory)
    .map(id => ({ content: Memory.content[id], importance: Memory.importance[id] }));
  const limits = { openNeighborhood: true, growthLimits: { maxWorldEntities: 24, maxBuildJobs: 0 } };
  const baseline = await fixture(limits);
  // These fixtures use process-global component arrays. Compare frozen values,
  // not an old world's cells after another world has reused the same IDs.
  const initialGoals = Object.fromEntries(baseline.characters.map(name => [name, goals(baseline, name)]));
  const initialMemories = episodic(baseline); baseline.stop();
  const t = await fixture({ ...limits, cookieHistory: "david" }), w = t.sim.world;
  const past = createElaineDavidPast(), anchors = getIdentityAnchors(w, t.ids.Elaine);
  expect(t.options.cookieHistory).toBe("david");
  expect(t.snapshot().contact).toEqual(ELAINE_DAVID_CONTACT);
  expect(anchors.map(a => a.monologue)).toEqual(past.memories.map(m => m.recollection));
  expect(anchors.every(a => a.kind === "recollection" && a.identity?.origin?.provenance === "authored-history")).toBe(true);
  expect(getAspirations(t.sim.world, t.ids.Elaine)).toEqual(past.drives);
  expect(Agent.systemPrompt[t.ids.Elaine]).toContain(past.background);
  for (const name of t.characters) expect(goals(t, name)).toEqual(initialGoals[name]);
  expect(episodic(t)).toEqual(initialMemories);
  expect(getDirectContainer(w, t.ids.cookie)).toBe(t.ids.tin);
  expect(getDirectContainer(w, t.ids.phone)).toBe(t.ids.counter);
  expect([...query(w, [Agent, Name])].some(id => Name.value[id] === "David")).toBe(false);
  expect(getCommittedEvents(w).events).toEqual([]);
  expect(t.snapshot().phone).toEqual([]);
});

test("appointment variant authors mutual date knowledge privately without simulating a read or forcing departure", async () => {
  const t = await fixture({ cookieHistory: "david-appointment" }), w = t.sim.world;
  expect(w.time.simulationHour).toBe(ELAINE_DAVID_APPOINTMENT.hour);
  expect(w.time.simulationDay).toBe(ELAINE_DAVID_APPOINTMENT.day);
  const anchors = getIdentityAnchors(w, t.ids.Elaine);
  expect(anchors.map(a => a.monologue)).toContain(ELAINE_DAVID_APPOINTMENT.recollection);
  expect(buildAgentContext(w, t.ids.Elaine)).toContain(ELAINE_DAVID_APPOINTMENT.recollection);
  for (const friend of ["Jerry", "George", "Kramer"]) expect(buildAgentContext(w, t.ids[friend])).not.toContain(ELAINE_DAVID_APPOINTMENT.recollection);
  expect(JSON.stringify(t.scenes())).not.toContain(ELAINE_DAVID_APPOINTMENT.recollection);
  expect(t.snapshot().phone).toEqual([]); expect(getCommittedEvents(w).events).toEqual([]);
  expect(goals(t, "Elaine").some(g => /Monk|breakfast.*David/i.test(g.description))).toBe(false);
  expect(createElaineDavidPast().memories.map(m => m.recollection)).not.toContain(ELAINE_DAVID_APPOINTMENT.recollection);
  const before = anchors; t.setPhoneContact({ name: "Someone else", relationship: "boss", context: "An unrelated contact" });
  expect(getIdentityAnchors(w, t.ids.Elaine)).toEqual(before);
  await expect(ApartmentSitcom.create({ scenario: "duet", cookieHistory: "david-appointment" })).rejects.toThrow("Alex duet");
});

test("authored recollections reach Elaine, not her friends, public appearance, or scene snapshots", async () => {
  const t = await fixture({ cookieHistory: "david" }), w = t.sim.world, past = createElaineDavidPast();
  expect(buildAgentContext(w, t.ids.Elaine)).toContain("MEMORIES THAT MADE YOU");
  expect(buildAgentContext(w, t.ids.Elaine)).toContain("David");
  for (const friend of ["Jerry", "George", "Kramer"]) {
    expect(getIdentityAnchors(w, t.ids[friend])).toEqual([]);
    const context = buildAgentContext(w, t.ids[friend]);
    expect(context).not.toContain(past.background);
    for (const m of past.memories) expect(context).not.toContain(m.recollection);
  }
  const publicScene = JSON.stringify(t.scenes());
  expect(publicScene).not.toContain(past.background);
  for (const m of past.memories) expect(publicScene).not.toContain(m.recollection);
});

test("legacy cookie and Alex duet remain available without silently adding David's past", async () => {
  for (const options of [{}, { cookieHistory: "legacy" }, { scenario: "duet" }] as SitcomOptions[]) {
    const t = await fixture(options);
    expect(getIdentityAnchors(t.sim.world, t.ids.Elaine)).toEqual([]);
    expect(Agent.systemPrompt[t.ids.Elaine]).not.toContain("David");
    expect(t.options.cookieHistory).toBe("legacy");
    expect(t.snapshot().contact.name).toBe(options.scenario === "duet" ? "Alex" : "Unknown sender");
    t.stop();
  }
});

test("changing an operator contact never rewrites Elaine's pre-existing relationship history", async () => {
  const t = await fixture({ cookieHistory: "david" }), before = getIdentityAnchors(t.sim.world, t.ids.Elaine);
  t.setPhoneContact({ name: "Officer Jones", relationship: "police", context: "An officer making an inquiry." });
  expect(t.snapshot().contact.name).toBe("Officer Jones");
  expect(getIdentityAnchors(t.sim.world, t.ids.Elaine)).toEqual(before);
  expect(Agent.systemPrompt[t.ids.Elaine]).toContain("David has been my boyfriend for two years");
});

test("native save and restore preserve Elaine's private past and authored drives", async () => {
  const t = await fixture({ cookieHistory: "david" }), before = getIdentityAnchors(t.sim.world, t.ids.Elaine);
  const data = JSON.parse(JSON.stringify(serializeWorld(t.sim.world, t.sim.god.systemRegistry)));
  const restored = createArgosWorld("Restored David history"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), data);
  const eid = oldToNewId.get(t.ids.Elaine)!;
  expect(getIdentityAnchors(restored, eid)).toEqual(before);
  expect(getAspirations(restored, eid)).toEqual(createElaineDavidPast().drives);
  expect(Agent.systemPrompt[eid]).toContain(createElaineDavidPast().background);
  expect(buildAgentContext(restored, oldToNewId.get(t.ids.Jerry)!)).not.toContain(createElaineDavidPast().background);
  expect(getCommittedEvents(restored).events).toEqual([]);
});

test("history creation is copy-isolated and incompatible/unknown variants reject", async () => {
  const a = createElaineDavidPast(); a.memories[0].recollection = "changed"; a.drives[0] = "changed";
  expect(createElaineDavidPast().memories[0].recollection).not.toBe("changed");
  expect(createElaineDavidPast().drives[0]).not.toBe("changed");
  await expect(ApartmentSitcom.create({ scenario: "duet", cookieHistory: "david" })).rejects.toThrow("Alex duet");
  await expect(ApartmentSitcom.create({ cookieHistory: "invented" as any })).rejects.toThrow("Unknown cookie character history");
});
