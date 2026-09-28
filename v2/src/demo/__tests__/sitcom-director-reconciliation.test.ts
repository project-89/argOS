import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { query } = await import("bitecs");
const { ApartmentSitcom } = await import("../apartment-sitcom");
const { Goal, Memory, Thought, Perception } = await import("../../ecs/components");
const { getAgentPerceptions } = await import("../../cognition/agent-mind");
const { getSocialDialogue } = await import("../../cognition/social-memory");
const { createStoryScaffoldEntity, getStoryScaffold } = await import("../../nle/story-scaffold");
const { runNarrativeDirectorCycle, resetNarrativeDirector } = await import("../../nle/narrative-director");
const { captureNarrativeEvidence } = await import("../../nle/narrative-evidence");
const { estimateSpeechDurationMs } = await import("../../cognition/timed-speech");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");

let t: Awaited<ReturnType<typeof ApartmentSitcom.create>>;
beforeEach(async () => {
  generate.mockReset(); drainPendingStimuli(); resetNarrativeDirector();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls in director integration"));
  t = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null }); await t.start();
});

test("the follow-through request sees only its recipient's experience, not another observer's speech or the global rewritten plot", async () => {
  const w = t.sim.world;
  t.dispatch("Jerry", { type: "move", target: "Kitchen" }); t.advance(3000);
  const words = "ONLY_ELAINE_HEARD_THIS: I might spend the evening alone.";
  t.dispatch("Elaine", { type: "speak", content: words }); t.advance(estimateSpeechDurationMs(words) + 1);
  expect(getSocialDialogue(w, t.ids.Jerry).some(turn => turn.content.includes("ONLY_ELAINE_HEARD_THIS"))).toBe(false);
  createStoryScaffoldEntity(w, { seed: "Evening", currentAct: "setup", adaptations: [], npcRoles: [],
    tensions: [{ id: "place", description: "SCAFFOLD_ONLY_SENTINEL", status: "active", involvedNpcs: ["Jerry"],
      beats: [{ id: "old-room", description: "Jerry remains in the living room", triggerCondition: "Jerry is in the living room", act: "setup", status: "pending" }] }] });
  let calls = 0;
  generate.mockImplementation(async input => {
    calls++; const prompt = JSON.stringify([input.system, input.prompt, input.messages]);
    const record = captureNarrativeEvidence(w)!.snapshot.records.find(row => row.kind === "actor_presence" && row.observer?.id === t.ids.Jerry)!;
    if (calls === 1) {
      expect(prompt).toContain("ONLY_ELAINE_HEARD_THIS");
      return { text: JSON.stringify({ assessment: "Jerry actually moved", changes: [{ tensionId: "place", beatId: "old-room", disposition: "retire",
        reason: "Jerry is now in the kitchen", evidenceIds: [record.id] }] }) };
    }
    expect(prompt).toContain("RECIPIENT_LOCAL_EVIDENCE");
    expect(prompt).not.toMatch(/ONLY_ELAINE_HEARD_THIS|SCAFFOLD_ONLY_SENTINEL|Jerry actually moved/);
    return { text: JSON.stringify({ disposition: "suggest", evidenceIds: [record.id], suggestion: "You could take a quiet moment here if you want." }) };
  });
  const before = ownedState(); expect(await runNarrativeDirectorCycle(w)).toBe(true); expect(calls).toBe(2);
  expect(getAgentPerceptions(w, t.ids.Jerry).some(id => Perception.content[id].includes("You could take a quiet moment here if you want."))).toBe(true);
  expect(getAgentPerceptions(w, t.ids.Elaine).some(id => Perception.content[id].includes("You could take a quiet moment here if you want."))).toBe(false);
  expect(ownedState()).toEqual(before);
});
afterEach(() => { t?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
function ownedState() {
  const w = t.sim.world;
  return { goals: [...query(w, [Goal])].map(id => [id, Goal.description[id], Goal.status[id], Goal.priority[id], Goal.progress[id]]),
    memories: [...query(w, [Memory])].map(id => [id, Memory.content[id], Memory.timestamp[id]]),
    thoughts: [...query(w, [Thought])].map(id => [id, Thought.content[id], Thought.timestamp[id]]) };
}

test("native private phone state is absent; actual public disclosure can retire a stale date plan without rewriting either NPC", async () => {
  const w = t.sim.world;
  createStoryScaffoldEntity(w, { seed: "Evening", currentAct: "setup", adaptations: [],
    npcRoles: [{ name: "Elaine", eid: t.ids.Elaine, role: "protagonist", secrets: ["SECRET_ROLE_LEAD"], hiddenMotivation: "SECRET_ROLE_MOTIVE" }],
    tensions: [{ id: "evening", description: "Plans for tonight", status: "active", involvedNpcs: ["Elaine", "Jerry"],
      beats: [{ id: "old-date", description: "Get ready for the dinner date", triggerCondition: "They choose to prepare for dinner", act: "setup", status: "pending" }] }] });
  t.setPhoneContact({ name: "SECRET_CONTACT", relationship: "SECRET_RELATIONSHIP", context: "SECRET_HISTORY" });
  t.text("SECRET_UNREAD_BODY"); t.advance(200); t.plantThought("Elaine", "SECRET_INNER_THOUGHT");
  generate.mockImplementation(async input => {
    expect(JSON.stringify([input.system, input.prompt, input.messages])).not.toMatch(/SECRET_/);
    return { text: JSON.stringify({ assessment: "No changed public circumstance", changes: [] }) };
  });
  const initial = ownedState(); await runNarrativeDirectorCycle(w);
  expect(ownedState()).toEqual(initial); expect(getStoryScaffold(w)?.tensions[0].beats[0].status).toBe("pending");

  const words = "Our dinner is cancelled. Alex ended our relationship today.";
  t.dispatch("Elaine", { type: "speak", target: "Jerry", content: words });
  t.advance(estimateSpeechDurationMs(words) + 1);
  t.advance(45_000);
  const before = ownedState(); let reconciled = false;
  generate.mockImplementation(async input => {
    const prompt = JSON.stringify([input.system, input.prompt, input.messages]); expect(prompt).not.toMatch(/SECRET_/);
    if (reconciled) return { text: JSON.stringify({ disposition: "skip", evidenceIds: [] }) };
    expect(prompt).toContain(words);
    const snapshot = captureNarrativeEvidence(w)!.snapshot;
    const receipt = snapshot.records.find(row => row.kind === "completed_dialogue" && row.dialogue?.words === words)!;
    expect(receipt).toBeDefined(); reconciled = true;
    return { text: JSON.stringify({ assessment: "The stated plans no longer fit the publicly disclosed change", changes: [{
      tensionId: "evening", beatId: "old-date", disposition: "replace", reason: "Elaine publicly said the date was cancelled", evidenceIds: [receipt.id],
      replacement: { description: "An evening whose plans can be reconsidered", triggerCondition: "The characters choose what to do after the disclosure", act: "escalation", actorKeys: [receipt.observer!.key] },
    }] }) };
  });
  expect(await runNarrativeDirectorCycle(w)).toBe(true); expect(reconciled).toBe(true);
  const scaffold = getStoryScaffold(w)!;
  expect(scaffold.tensions[0].beats.find(b => b.id === "old-date")?.status).toBe("retired");
  expect(scaffold.tensions[0].beats.some(b => b.id !== "old-date" && b.status === "pending")).toBe(true);
  expect(scaffold.currentAct).toBe("setup"); expect(scaffold.tensions[0].status).toBe("active");
  expect(ownedState()).toEqual(before);
});
