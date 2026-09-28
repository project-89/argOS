import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, removeEntity, query } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Agent, Name, ObjectState, SocialMemory, WorkingMemoryIdentity, Goal, Memory, Perception } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { getCommittedEvents, startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { recordCommittedSpeech } = await import("../../cognition/social-memory");
const { registerAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { createStoryScaffoldEntity, getStoryScaffold, updateStoryScaffold, formatScaffoldForContext } = await import("../story-scaffold");
const { captureNarrativeEvidence, captureRecipientNarrativeEvidence } = await import("../narrative-evidence");
const { runNarrativeDirectorCycle, resetNarrativeDirector } = await import("../narrative-director");

function fixture(source = true) {
  const world = createArgosWorld(); initializePrefabs(world); if (source) startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" }), elsewhere = createRoomEntity(world, { name: "Elsewhere" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "PRIVATE_PERSONA", roomId: room });
  const peer = createAgentEntity(world, { name: "Ben", role: "resident", systemPrompt: "PRIVATE_PEER", roomId: elsewhere });
  const object = createObjectEntity(world, { name: "Lamp", roomId: room });
  addComponent(world, object, ObjectState); ObjectState.current[object] = "off";
  createStoryScaffoldEntity(world, { seed: "An evening", currentAct: "setup", adaptations: [],
    npcRoles: [{ name: "Ada", eid: actor, role: "protagonist", secrets: ["PRIVATE_SECRET"], hiddenMotivation: "PRIVATE_MOTIVE" }],
    tensions: [{ id: "evening", description: "An evening's possibilities", status: "active", involvedNpcs: ["Ada"], beats: [
      { id: "past", description: "Existing history", act: "setup", status: "completed", triggerCondition: "Already observed" },
      { id: "date", description: "Prepare for tonight's date", act: "escalation", status: "pending", triggerCondition: "A date is still planned" },
    ] }] });
  recordCommittedSpeech(world, actor, "The date is cancelled. We broke up.");
  return { world, room, elsewhere, actor, peer, object };
}
type Fixture = ReturnType<typeof fixture>;
function proposal(f: Fixture, replace = false) {
  const snapshot = captureNarrativeEvidence(f.world)!.snapshot;
  const receipt = snapshot.records.find(row => row.kind === "completed_dialogue" && row.observer?.id === f.actor)!;
  return { assessment: "The disclosed change makes the old possibility stale", changes: [{ tensionId: "evening", beatId: "date",
    disposition: replace ? "replace" : "retire", reason: "Ada said the date is cancelled", evidenceIds: [receipt.id],
    ...(replace ? { replacement: { description: "Possibly reconsider the evening", triggerCondition: "Ada chooses what she wants next", act: "escalation", actorKeys: [receipt.observer!.key] } } : {}) }] };
}
const reply = (value: unknown) => ({ text: JSON.stringify(value) });
function defer() { let resolve!: (value: { text: string }) => void; const promise = new Promise<{ text: string }>(r => { resolve = r; }); return { promise, resolve }; }
function tick(f: Fixture, ms: number) { advanceSimulationTime(f.world, f.world.time.tick + 1, ms); }
beforeEach(() => { generate.mockReset(); resetNarrativeDirector(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("retirement preserves existing history; exhausted plans go dormant, never resolved", async () => {
  const f = fixture(), before = [Goal, Memory].map(c => [...query(f.world, [c])]);
  generate.mockResolvedValueOnce(reply(proposal(f))).mockResolvedValueOnce(reply({ disposition: "skip" }));
  expect(await runNarrativeDirectorCycle(f.world)).toBe(true);
  const scaffold = getStoryScaffold(f.world)!;
  expect(scaffold.currentAct).toBe("setup"); expect(scaffold.tensions[0].status).toBe("dormant");
  expect(scaffold.tensions[0].beats.map(b => b.status)).toEqual(["completed", "retired"]);
  expect([Goal, Memory].map(c => [...query(f.world, [c])])).toEqual(before);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1600,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } });
  expect(generate.mock.calls[1][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 500,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } });
  expect(generate.mock.calls[0][0].prompt).toContain("At most six changes and one replacement");
});
test("replacement gets a host ID and exact actor identities and remains an advisory pending possibility", async () => {
  const f = fixture(); generate.mockResolvedValueOnce(reply(proposal(f, true))).mockResolvedValueOnce(reply({ disposition: "skip" }));
  expect(await runNarrativeDirectorCycle(f.world)).toBe(true);
  const scaffold = getStoryScaffold(f.world)!, beats = scaffold.tensions[0].beats;
  expect(beats[1].status).toBe("retired"); expect(beats[2].id).toMatch(/^beat:/); expect(beats[2].status).toBe("pending");
  expect(beats[2].reconciliation?.actorKeys).toEqual([WorkingMemoryIdentity.id[f.actor]]);
  expect(beats[2].npcActions).toEqual([]); expect(scaffold.tensions[0].status).toBe("active");
  expect(formatScaffoldForContext(f.world)).toContain("Possibly reconsider");
  expect(scaffold.tensions[0].description).toBe("An evening's possibilities");
  tick(f, 45_000);
  generate.mockImplementationOnce(async input => {
    expect(input.prompt).toContain("Possibly reconsider the evening");
    expect(input.prompt).not.toContain("An evening's possibilities");
    expect(input.prompt).not.toContain("Prepare for tonight's date");
    return reply({ assessment: "Retain revised possibility", changes: [] });
  });
  await runNarrativeDirectorCycle(f.world);
});
test.each(["unknown evidence", "unknown beat", "unknown actor", "duplicate", "promotion", "legacy broadcast"])("invalid %s is rejected atomically", async fault => {
  const f = fixture(), before = getStoryScaffold(f.world), value: any = proposal(f, true);
  if (fault === "unknown evidence") value.changes[0].evidenceIds = ["made-up"];
  if (fault === "unknown beat") value.changes[0].beatId = "dat";
  if (fault === "unknown actor") value.changes[0].replacement.actorKeys = ["Ada"];
  if (fault === "duplicate") value.changes.push(value.changes[0]);
  if (fault === "promotion") value.changes[0].status = "completed";
  if (fault === "legacy broadcast") value.actions = [{ type: "broadcast_event", content: "Alex arrived" }];
  generate.mockResolvedValue(reply(value)); expect(await runNarrativeDirectorCycle(f.world)).toBe(false);
  expect(getStoryScaffold(f.world)).toEqual(before); expect(generate).toHaveBeenCalledTimes(1);
});
test.each(["stop", "restart", "scaffold ABA", "raw scaffold", "identity", "persona", "package", "room", "object", "completed words", "reset"])("in-flight %s changes revoke the result", async fault => {
  const f = fixture(), deferred = defer(), value = proposal(f); generate.mockReturnValue(deferred.promise);
  const task = runNarrativeDirectorCycle(f.world);
  if (fault === "stop") stopCommittedEvents(f.world);
  if (fault === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (fault === "scaffold ABA") { updateStoryScaffold(f.world, { currentAct: "crisis" }); updateStoryScaffold(f.world, { currentAct: "setup" }); }
  if (fault === "raw scaffold") { const s = getStoryScaffold(f.world)!; s.tensions[0].beats[1].description = "Another plan"; updateStoryScaffold(f.world, { tensions: s.tensions }); }
  if (fault === "identity") { removeEntity(f.world, f.actor); createAgentEntity(f.world, { name: "Ada", role: "resident", systemPrompt: "PRIVATE_PERSONA", roomId: f.room }); }
  if (fault === "persona") Agent.systemPrompt[f.actor] = "Changed identity";
  if (fault === "package") registerAgentWorldCapabilities(f.world, f.actor, {} as any);
  if (fault === "room") setLocatedIn(f.world, f.actor, f.elsewhere);
  if (fault === "object") ObjectState.current[f.object] = "on";
  if (fault === "completed words") recordCommittedSpeech(f.world, f.actor, "Actually, our plans changed again.");
  if (fault === "reset") resetNarrativeDirector(f.world);
  deferred.resolve(reply(value)); expect(await task).toBe(false);
  expect(getStoryScaffold(f.world)!.tensions[0].beats[1].status).toBe("pending");
});
test("mere simulated time and unfinished prefix progress do not stale a completed-evidence proposal", async () => {
  const f = fixture(), deferred = defer(), value = proposal(f);
  generate.mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(reply({ disposition: "skip" }));
  const task = runNarrativeDirectorCycle(f.world); tick(f, 1200);
  SocialMemory.fragmentsJson[f.actor] = JSON.stringify([{ content: "An unfinished PRIVATE_PREFIX", complete: false }]);
  deferred.resolve(reply(value)); expect(await task).toBe(true);
});
test("cadence and in-flight coalescing are simulation-time based, with independent world scheduling", async () => {
  const f = fixture(), deferred = defer(); generate.mockReturnValueOnce(deferred.promise).mockResolvedValue(reply({ assessment: "Retain", changes: [] }));
  const task = runNarrativeDirectorCycle(f.world); expect(await runNarrativeDirectorCycle(f.world)).toBe(false);
  expect(generate).toHaveBeenCalledTimes(1);
  deferred.resolve(reply({ assessment: "Retain", changes: [] })); await task;
  jest.spyOn(Date, "now").mockReturnValue(9e12); expect(await runNarrativeDirectorCycle(f.world)).toBe(false);
  tick(f, 44_999); await runNarrativeDirectorCycle(f.world); expect(generate).toHaveBeenCalledTimes(1);
  tick(f, 1); await runNarrativeDirectorCycle(f.world); expect(generate).toHaveBeenCalledTimes(2);
  const other = fixture(); await runNarrativeDirectorCycle(other.world); expect(generate).toHaveBeenCalledTimes(3);
});
test("shared component-array identity overwrite from a colliding legacy world revokes an in-flight request", async () => {
  const f = fixture(), other = fixture(), deferred = defer(), value = proposal(f);
  generate.mockReturnValueOnce(deferred.promise);
  const task = runNarrativeDirectorCycle(f.world); captureNarrativeEvidence(other.world);
  deferred.resolve(reply(value)); expect(await task).toBe(false);
  expect(getStoryScaffold(f.world)!.tensions[0].beats[1].status).toBe("pending");
});
test("legacy source-less worlds can reconcile without silently starting a tape; source creation revokes old issuance", async () => {
  const f = fixture(false), capture = captureNarrativeEvidence(f.world)!;
  expect(capture.snapshot.sourceId).toBeNull(); expect(getCommittedEvents(f.world).sourceId).toBeNull();
  startCommittedEvents(f.world); expect(capture.current()).toBe(false);
  const other = fixture(false); generate.mockResolvedValueOnce(reply(proposal(other))).mockResolvedValueOnce(reply({ disposition: "skip" }));
  expect(await runNarrativeDirectorCycle(other.world)).toBe(true); expect(getCommittedEvents(other.world).sourceId).toBeNull();
});
test("evidence is immutable and private data, unfinished prefixes and future legacy turns are excluded", () => {
  const f = fixture();
  const turns = JSON.parse(SocialMemory.turnsJson[f.actor]); turns.push({ ...turns[0], id: "future", content: "PRIVATE_FUTURE", atSimMs: 500 });
  SocialMemory.turnsJson[f.actor] = JSON.stringify(turns);
  SocialMemory.fragmentsJson[f.actor] = JSON.stringify([{ content: "PRIVATE_PREFIX", complete: false }]);
  const capture = captureNarrativeEvidence(f.world)!;
  expect(JSON.stringify(capture.snapshot)).not.toContain("PRIVATE_");
  expect(() => { capture.snapshot.records[0].id = "tampered"; }).toThrow();
  expect(capture.current()).toBe(true);
});
test("canceled captures cannot issue identities", async () => {
  const f = fixture(), controller = new AbortController();
  const before = [...query(f.world, [WorkingMemoryIdentity])];
  await withSimulationTask(controller.signal, async () => { controller.abort(); expect(() => captureNarrativeEvidence(f.world)).toThrow(); });
  expect([...query(f.world, [WorkingMemoryIdentity])]).toEqual(before);
});
test("recipient context is local and survives unrelated remote activity, but not recipient changes", () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.peer, "REMOTE_PRIVATE_WORDS");
  const global = captureNarrativeEvidence(f.world)!, local = captureRecipientNarrativeEvidence(f.world, WorkingMemoryIdentity.id[f.actor])!;
  expect(JSON.stringify(global.snapshot)).toContain("REMOTE_PRIVATE_WORDS");
  expect(JSON.stringify(local.snapshot)).not.toContain("REMOTE_PRIVATE_WORDS");
  expect(local.snapshot.actors).toHaveLength(1); expect(local.snapshot.records.every(row => row.observer?.id === f.actor)).toBe(true);
  recordCommittedSpeech(f.world, f.peer, "Another remote remark"); expect(local.current()).toBe(true); expect(global.current()).toBe(false);
  setLocatedIn(f.world, f.actor, f.elsewhere); expect(local.current()).toBe(false);
});
test("recipient-only capture never broadens an empty, unknown or ambiguous identity to the global evidence pool", () => {
  const f = fixture(); captureNarrativeEvidence(f.world);
  for (const key of ["", " ", "unknown"]) expect(captureRecipientNarrativeEvidence(f.world, key)).toBeUndefined();
  WorkingMemoryIdentity.id[f.peer] = WorkingMemoryIdentity.id[f.actor];
  expect(captureRecipientNarrativeEvidence(f.world, WorkingMemoryIdentity.id[f.actor])).toBeUndefined();
});
test("a successful global reconciliation cannot leak another observer's words into an optional actor suggestion", async () => {
  const f = fixture(); recordCommittedSpeech(f.world, f.peer, "REMOTE_PRIVATE_WORDS");
  generate.mockImplementationOnce(async input => { expect(input.prompt).toContain("REMOTE_PRIVATE_WORDS"); expect(input.prompt).not.toContain("PRIVATE_PERSONA"); return reply(proposal(f, true)); });
  generate.mockImplementationOnce(async input => {
    expect(input.prompt).toContain("The date is cancelled"); expect(input.prompt).not.toContain("REMOTE_PRIVATE_WORDS");
    expect(input.prompt).not.toContain("Possibly reconsider the evening"); expect(input.prompt).not.toContain("Elsewhere");
    const local = captureRecipientNarrativeEvidence(f.world, WorkingMemoryIdentity.id[f.actor])!;
    return reply({ disposition: "suggest", evidenceIds: [local.snapshot.records[0].id], suggestion: "Perhaps take a moment to consider what you want." });
  });
  expect(await runNarrativeDirectorCycle(f.world)).toBe(true);
  expect([...query(f.world, [Perception])].some(id => Perception.type[id] === "intent")).toBe(true);
  expect([...query(f.world, [Goal, Memory])]).toEqual([]);
});
test("actor movement while its local suggestion is in flight prevents delivery without undoing legitimate reconciliation", async () => {
  const f = fixture(), deferred = defer(); generate.mockResolvedValueOnce(reply(proposal(f))).mockReturnValueOnce(deferred.promise);
  const task = runNarrativeDirectorCycle(f.world); while (generate.mock.calls.length < 2) await Promise.resolve();
  const local = captureRecipientNarrativeEvidence(f.world, WorkingMemoryIdentity.id[f.actor])!;
  setLocatedIn(f.world, f.actor, f.elsewhere);
  deferred.resolve(reply({ disposition: "suggest", evidenceIds: [local.snapshot.records[0].id], suggestion: "Perhaps pause." }));
  expect(await task).toBe(true); expect([...query(f.world, [Perception])]).toEqual([]);
});
test("one response cannot change two issued tensions even with individually valid evidence", async () => {
  const f = fixture(), scaffold = getStoryScaffold(f.world)!;
  scaffold.tensions.push({ ...structuredClone(scaffold.tensions[0]), id: "other", beats: [{ ...scaffold.tensions[0].beats[1], id: "other-beat" }] });
  updateStoryScaffold(f.world, { tensions: scaffold.tensions });
  const value: any = proposal(f); value.changes.push({ ...value.changes[0], tensionId: "other", beatId: "other-beat" });
  generate.mockResolvedValue(reply(value));
  expect(await runNarrativeDirectorCycle(f.world)).toBe(false); expect(getStoryScaffold(f.world)).toEqual(scaffold);
});
test.each(["abstention", "invalid", "stale", "provider error"])("bounded input windows rotate after %s instead of starving later pending beats", async outcome => {
  const f = fixture(), scaffold = getStoryScaffold(f.world)!;
  scaffold.tensions[0].beats = Array.from({ length: 35 }, (_, i) => ({ ...scaffold.tensions[0].beats[1], id: `pending-${i}` }));
  updateStoryScaffold(f.world, { tensions: scaffold.tensions });
  generate.mockImplementationOnce(async input => {
    const issued = JSON.parse(input.prompt.split("ISSUED_PENDING_BEATS:\n")[1].split("\nISSUED_EVIDENCE:")[0]);
    expect(issued).toHaveLength(32); expect(issued[0].beatId).toBe("pending-0");
    if (outcome === "provider error") throw new Error("controlled failure");
    if (outcome === "stale") ObjectState.current[f.object] = "on";
    return reply(outcome === "invalid" ? { actions: [] } : { assessment: "Retain", changes: [] });
  });
  await runNarrativeDirectorCycle(f.world); tick(f, outcome === "stale" ? 5_000 : 45_000);
  generate.mockImplementationOnce(async input => {
    const issued = JSON.parse(input.prompt.split("ISSUED_PENDING_BEATS:\n")[1].split("\nISSUED_EVIDENCE:")[0]);
    expect(issued.map((b: any) => b.beatId)).toEqual(["pending-32", "pending-33", "pending-34"]);
    return reply({ assessment: "Retain", changes: [] });
  });
  await runNarrativeDirectorCycle(f.world); expect(generate).toHaveBeenCalledTimes(2);
});
test("outcome telemetry separates stale proposals from abstention without logging dialogue or prompts", async () => {
  const f = fixture(), value = proposal(f), logs = jest.spyOn(console, "log").mockImplementation(() => {});
  generate.mockImplementationOnce(async () => { ObjectState.current[f.object] = "on"; return reply(value); });
  await runNarrativeDirectorCycle(f.world);
  const line = logs.mock.calls.flat().find(row => typeof row === "string" && row.startsWith("[NLE] Director outcome ")) as string;
  expect(line).not.toContain("The date is cancelled"); expect(line).not.toContain("Ada said");
  expect(JSON.parse(line.slice("[NLE] Director outcome ".length))).toMatchObject({ kind: "reconciliation", outcome: "stale",
    evidenceCurrent: false, scaffoldCurrent: true, cycleCurrent: true, validatedChanges: 1, issuedBeatIds: ["date"] });
});
test("token-limited output is not a whole proposal even if JSON extraction finds a valid fragment", async () => {
  const f = fixture(), logs = jest.spyOn(console, "log").mockImplementation(() => {});
  generate.mockResolvedValueOnce({ ...reply(proposal(f)), finishReason: "length" } as any);
  expect(await runNarrativeDirectorCycle(f.world)).toBe(false);
  expect(getStoryScaffold(f.world)!.tensions[0].beats[1].status).toBe("pending");
  expect(logs.mock.calls.flat().some(row => String(row).includes('"outcome":"output_limit"'))).toBe(true);
});
test("token-limited local suggestion cannot become an intent", async () => {
  const f = fixture(); generate.mockResolvedValueOnce(reply(proposal(f))).mockImplementationOnce(async () => {
    const local = captureRecipientNarrativeEvidence(f.world, WorkingMemoryIdentity.id[f.actor])!;
    return { ...reply({ disposition: "suggest", evidenceIds: [local.snapshot.records[0].id], suggestion: "Perhaps pause." }), finishReason: "length" };
  });
  expect(await runNarrativeDirectorCycle(f.world)).toBe(true); expect([...query(f.world, [Perception])]).toEqual([]);
});
