import { jest } from "@jest/globals";
import { addComponent, addEntity, removeEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { BehaviorPolicy, Goal, GoalWorkProgress, LastAction, ObjectState, Traits, WikiDoc, WorkDocument } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { setLocatedIn } from "../../ecs/location";
import { captureDocumentWork, commitDocumentWork, getDocumentCommandEffect, initializeWorkDocument, readProductiveGoalTime } from "../../world/productive-work";
import { executeAffordance, canUseAffordance } from "../../world/effect-executor";
import { worldSchema, WorldSchema, BASE_AFFORDANCES } from "../../world/schema";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { getCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createIntentGoal, executeActions } from "../cognition-system";
import { setGoalContract } from "../goal-contract";
import { readGoalAttemptActivity } from "../goal-attempt";
import { buildAvailableActionsContext, formatActionsForPrompt } from "../action-registry";
import { generatePlanForGoal, checkStepPrerequisites, type PlanStep } from "../planning-system";
import { captureLLMDecision, resolveDecision } from "../bt-compiler";
import { setAgentBehaviorPolicy } from "../behavior-policy";
import { getAgentProceduralSkills, upsertProceduralSkillFromInteraction } from "../procedural-skills";
import { evaluateGoalSuccessContract } from "../../systems/goal-evaluation-system";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";

function fixture(withDevice = false) {
  const world = createArgosWorld("Productive actions"); world.meta.aiEnabled = false; world.meta.timedActions = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Studio" }), away = createRoomEntity(world, { name: "Hall" });
  const make = (name: string) => createAgentEntity(world, { name, role: "writer", systemPrompt: "Choose your own actions.", roomId: room });
  const actor = make("Ada"), peer = make("Bo");
  const document = createObjectEntity(world, { name: "Field report", roomId: room, portable: true });
  const device = withDevice ? createObjectEntity(world, { name: "Workstation", roomId: room, portable: false }) : undefined;
  if (device !== undefined) ObjectState.current[device] = "powered_on";
  initializeWorkDocument(world, document, { deviceEid: device });
  const goal = createIntentGoal(world, actor, "Spend four seconds actually working", 5);
  setGoalContract(world, goal, { version: 1, kind: "scheduled_activity", params: { activityType: "work_block" },
    success: { type: "productive_time", roomName: "Studio", atLeastMs: 4000 } });
  const registry = createSystemRegistry();
  const act = (content: string, who = actor) => executeActions(world, [{ eid: who, action: { type: "interact", target: "Field report", content } }], registry);
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const write = (who = actor) => act('write_document {"revision":0,"text":"The bridge needs repair."}', who);
  return { world, room, away, actor, peer, document, device, goal, registry, act, advance, write };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline native work test")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("command semantics share native argument and access validation without doing work", () => {
  const f = fixture(); WikiDoc.body[f.document] = "Existing text.";
  const events = getCommittedEvents(f.world).events.length;
  const effect = (content: string) => getDocumentCommandEffect(f.world, f.actor, f.document, { type: "interact", content });
  expect(effect("read_document")).toBe("observation");
  expect(effect("  READ_DOCUMENT  ")).toBe("observation");
  expect(effect('write_document {"revision":0,"text":"More."}')).toBe("mutation");
  expect(effect('review_document {"revision":0}')).toBe("mutation");
  for (const content of ["read_document {}", "read_document then write", "read the document", "inspect",
    'write_document {"revision":1,"text":"Stale."}', 'finish_document {"revision":0}']) {
    expect(effect(content)).toBeUndefined();
  }
  expect(getDocumentCommandEffect(f.world, f.actor, f.document, { type: "think", content: "read_document" })).toBeUndefined();
  WorkDocument.reviewedRevision[f.document] = 0; WikiDoc.status[f.document] = "reviewed";
  expect(effect('finish_document {"revision":0}')).toBe("mutation");
  setLocatedIn(f.world, f.document, f.away);
  expect(effect("read_document")).toBeUndefined();
  expect(getDocumentCommandEffect(f.world, f.actor, f.room, { type: "interact", content: "read_document" })).toBeUndefined();
  expect(getCommittedEvents(f.world).events).toHaveLength(events);
  expect(WorkDocument.revision[f.document]).toBe(0); expect(WikiDoc.body[f.document]).toBe("Existing text.");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(0);
});

test("a blank document exposes its lifecycle without offering premature commands or unread text", async () => {
  const f = fixture();
  const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify({ goalDescription: "Consider work",
    steps: [{ description: "Read the report", actionType: "interact", target: "Field report", content: "read_document" }] }) }));
  expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any })).not.toBeNull();
  const planning = generate.mock.calls[0][0].system;
  const foreground = formatActionsForPrompt(f.world, f.actor);
  for (const context of [planning, foreground]) {
    expect(context).toContain("review_document");
    expect(context).toContain("finish_document");
    expect(context).toContain("Lifecycle rules, not available commands");
  }
  const offered = getAvailableAffordances(f.world, f.actor, f.document).map(a => a.name);
  expect(offered).not.toContain("review_document");
  expect(offered).not.toContain("finish_document");
  expect(captureDocumentWork(f.world, f.actor, f.document, { type: "interact", content: 'finish_document {"revision":0}' })).toBeUndefined();
  expect(WorkDocument.revision[f.document]).toBe(0);
  expect(WikiDoc.status[f.document]).toBe("draft");
});

test("stored document steps revalidate arguments and revision without granting execution credit", () => {
  const f = fixture();
  const step: PlanStep = { description: "Write the findings", actionType: "interact", target: "Field report",
    content: 'write_document {"revision":0,"text":"The bridge needs repair."}' };
  expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(true);
  expect(checkStepPrerequisites(f.world, f.actor, { ...step, content: "write_document some words" })).toBe(false);
  f.write(); f.advance(2000);
  const events = getCommittedEvents(f.world).events.length;
  expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
  expect(checkStepPrerequisites(f.world, f.actor, { ...step, content: 'review_document {"revision":1}' })).toBe(true);
  expect(checkStepPrerequisites(f.world, f.actor, { ...step, content: "read_document" })).toBe(true);
  expect(getCommittedEvents(f.world).events).toHaveLength(events);
  expect(step.resolution).toBeUndefined();
  expect(WikiDoc.body[f.document]).toBe("The bridge needs repair.");
});

test("native writing, review and finalization create real content with distinct work-time and artifact outcomes", () => {
  const f = fixture(); f.write();
  f.advance(1999); expect(WikiDoc.body[f.document]).toBe(""); expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(0);
  f.advance(1); expect(WikiDoc.body[f.document]).toBe("The bridge needs repair."); expect(WikiDoc.status[f.document]).toBe("draft");
  expect(readGoalAttemptActivity(f.world, f.actor, f.goal)).toBe(2000);
  expect(Goal.progress[f.goal]).toBe(0); // Work happened; no invented whole-goal percentage.
  expect(WorkDocument.revision[f.document]).toBe(1); expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(2000);
  expect(evaluateGoalSuccessContract(f.world, f.actor, f.goal).satisfied).toBe(false);
  f.act('review_document {"revision":1}'); f.advance(2000);
  expect(WikiDoc.status[f.document]).toBe("reviewed"); expect(evaluateGoalSuccessContract(f.world, f.actor, f.goal).satisfied).toBe(true);
  expect(WorkDocument.completedAtSimMs[f.document]).toBe(-1);
  f.act('finish_document {"revision":1}'); f.advance(600);
  expect(WikiDoc.status[f.document]).toBe("finished"); expect(WorkDocument.completedAtSimMs[f.document]).toBe(4600);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(4000);
  const events = getCommittedEvents(f.world).events.filter(e => e.kind === "action");
  expect(events.filter(e => e.status === "succeeded")).toHaveLength(3);
  expect(events.filter(e => e.status === "pending").map(e => e.operation)).toEqual(["typing", "reading", "closing"]);
});

test("read feedback reaches only the reader, not nearby observers, and reading alone earns no productive time", () => {
  const f = fixture(); WikiDoc.body[f.document] = "PRIVATE_DOCUMENT_BODY";
  f.act("read_document"); f.advance(1200);
  const stimuli = peekPendingStimuli();
  expect(stimuli.some(s => s.targetEid === f.actor && s.content.includes("PRIVATE_DOCUMENT_BODY"))).toBe(true);
  expect(stimuli.some(s => s.targetEid === f.peer && s.content.includes("PRIVATE_DOCUMENT_BODY"))).toBe(false);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(0);
});

test("admission receipts cannot be forged, copied, transferred, committed early, or replayed", () => {
  const f = fixture();
  const action = { type: "interact" as const, target: "Field report", content: 'write_document {"revision":0,"text":"Test"}' };
  const token = captureDocumentWork(f.world, f.actor, f.document, action)!;
  expect(token).toBeDefined();
  expect(commitDocumentWork(f.world, f.actor, f.document, { ...token }).success).toBe(false);
  expect(commitDocumentWork(f.world, f.peer, f.document, token).success).toBe(false);
  expect(commitDocumentWork(f.world, f.actor, f.document, token).success).toBe(false);
  f.advance(2000);
  expect(commitDocumentWork(f.world, f.actor, f.document, token).success).toBe(false);
  expect(WikiDoc.body[f.document]).toBe("");
  const admitted = captureDocumentWork(f.world, f.actor, f.document, action)!;
  f.advance(2000);
  expect(commitDocumentWork(f.world, f.actor, f.document, admitted).success).toBe(true);
  expect(commitDocumentWork(f.world, f.actor, f.document, admitted).success).toBe(false);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(2000);
});

test.each(["send_text", "send_email", "check_email", "browse_web", "search_files"])("unimplemented %s does not emit a fictional result", verb => {
  const f = fixture(); addComponent(f.world, f.document, Traits);
  Traits.active[f.document] = JSON.stringify(["textable", "usable", "typeable", "browsable", "searchable"]);
  expect(getAvailableAffordances(f.world, f.actor, f.document).map(a => a.name)).not.toContain(verb);
  const before = peekPendingStimuli().length;
  const result = executeAffordance(verb, { world: f.world, actorEid: f.actor, targetEid: f.document, worldSchema,
    registry: { byName: new Map(), byId: new Map() } });
  expect(result.success).toBe(false); expect(result.changes).toEqual([]);
  expect(peekPendingStimuli()).toHaveLength(before);
});

test.each(["send_text", "send_email", "check_email", "browse_web", "search_files"])("legacy restored %s placeholders remain unavailable", verb => {
  const f = fixture(); addComponent(f.world, f.document, Traits);
  Traits.active[f.document] = JSON.stringify(["textable", "usable", "typeable", "browsable", "searchable"]);
  const legacy = JSON.parse(JSON.stringify(BASE_AFFORDANCES[verb])); delete legacy.unavailableReason;
  const schema = WorldSchema.fromJSON({ affordances: { [verb]: legacy } });
  const before = peekPendingStimuli().length;
  expect(executeAffordance(verb, { world: f.world, actorEid: f.actor, targetEid: f.document, worldSchema: schema,
    registry: { byName: new Map(), byId: new Map() } }).success).toBe(false);
  expect(peekPendingStimuli()).toHaveLength(before);
  const backed = { ...legacy, effects: [{ type: "run_tool" as const, toolId: "test.delivery", toolInputFrom: "affordanceArgs" as const }] };
  expect(canUseAffordance(f.world, backed, f.actor, f.document).available).toBe(true);
  // Availability is not tool authorization or delivery. Do not execute a host
  // tool in this offline check; the tool executor retains its own gates.
});

test("document action menus retain clear syntax and current revision without revealing the body", () => {
  const f = fixture(); WikiDoc.body[f.document] = "PRIVATE_DOCUMENT_BODY";
  const menu = buildAvailableActionsContext(f.world, f.actor).objectAffordances.filter(a => a.target === "Field report");
  expect(menu.find(a => a.affordanceName === "write_document")?.description).toContain('"revision":0');
  expect(JSON.stringify(menu)).not.toContain("PRIVATE_DOCUMENT_BODY");
});

test("background planning receives the same current command syntax as foreground cognition, not unread content", async () => {
  const f = fixture(); WikiDoc.body[f.document] = "PRIVATE_DRAFT_TEXT";
  const generate = jest.fn(async (_request: any) => ({ text: JSON.stringify({ goalDescription: "Work on the document", steps: [
    { description: "Read before deciding what to write", actionType: "interact", target: "Field report", content: "read_document" },
  ] }) }));
  expect(await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: generate as any })).not.toBeNull();
  const prompt = generate.mock.calls[0][0].system;
  expect(prompt).toContain("write_document"); expect(prompt).toContain('revision\\\":0');
  expect(prompt).toContain("your paragraph"); expect(prompt).not.toContain("PRIVATE_DRAFT_TEXT");
});

test("the final foreground prompt formatter retains document argument syntax, not only menu metadata", () => {
  const f = fixture(); WikiDoc.body[f.document] = "PRIVATE_DRAFT_TEXT";
  const prompt = formatActionsForPrompt(f.world, f.actor);
  expect(prompt).toContain("your paragraph"); expect(prompt).toContain("revision");
  expect(prompt).not.toContain("PRIVATE_DRAFT_TEXT");
});

test.each(["read_document", "write_document", "review_document", "finish_document"])("a successful %s is evidence, not a reusable literal document command", verb => {
  const f = fixture();
  setAgentBehaviorPolicy(f.world, f.actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
  const before = BehaviorPolicy.treeJson[f.actor], content = `${verb} {"revision":0,"text":"case-specific text"}`;
  captureLLMDecision(f.world, f.actor, "Work on this particular revision", { type: "interact", target: "Field report", content });
  resolveDecision(f.world, f.actor, true);
  upsertProceduralSkillFromInteraction(f.world, f.actor, { affordance: verb, args: content.slice(verb.length).trim(), targetName: "Field report", success: true });
  expect(BehaviorPolicy.treeJson[f.actor]).toBe(before);
  expect(getAgentProceduralSkills(f.world, f.actor).some(s => s.skill.signature.includes(verb))).toBe(false);
});

test.each(["moved_actor", "moved_document", "removed_document", "edited_body", "edited_revision", "stopped_source", "cleared_timeline"])("%s prevents pending writing from manufacturing content/time", reason => {
  const f = fixture(); f.write();
  if (reason === "moved_actor") setLocatedIn(f.world, f.actor, f.away);
  if (reason === "moved_document") setLocatedIn(f.world, f.document, f.away);
  if (reason === "removed_document") removeEntity(f.world, f.document);
  if (reason === "edited_body") WikiDoc.body[f.document] = "New external draft";
  if (reason === "edited_revision") WorkDocument.revision[f.document]++;
  if (reason === "stopped_source") stopCommittedEvents(f.world);
  if (reason === "cleared_timeline") clearSimulationTimeline(f.world);
  f.advance(2000);
  expect(WikiDoc.body[f.document]).not.toContain("The bridge needs repair.");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(0);
});

test("an observed power interruption invalidates work even if power returns before completion", () => {
  const f = fixture(true); f.write(); ObjectState.current[f.device!] = "powered_off";
  f.advance(500); ObjectState.current[f.device!] = "powered_on"; f.advance(1500);
  expect(WikiDoc.body[f.document]).toBe(""); expect(LastAction.success[f.actor]).toBe(false);
});

test("two writers cannot commit against the same document revision", () => {
  const f = fixture(); f.write(); f.write(f.peer); f.advance(2000);
  expect(WorkDocument.revision[f.document]).toBe(1);
  expect(WikiDoc.body[f.document]).toBe("The bridge needs repair.");
  expect(LastAction.success[f.actor]).toBe(true); expect(LastAction.success[f.peer]).toBe(false);
});

test("a goal edited during work cannot inherit the old work-time receipt", () => {
  const f = fixture(); f.write(); Goal.successJson[f.goal] = JSON.stringify({ type: "productive_time", roomName: "Studio", atLeastMs: 1000 });
  f.advance(2000); expect(WikiDoc.body[f.document]).not.toBe("");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Studio")).toBe(0);
});

test("stale revision and premature finalization do not mutate the artifact", () => {
  const f = fixture(); f.act('finish_document {"revision":0}'); f.advance(1000);
  expect(WikiDoc.status[f.document]).toBe("draft"); expect(LastAction.success[f.actor]).toBe(false);
  f.act('write_document {"revision":99,"text":"wrong revision"}'); f.advance(2000);
  expect(WikiDoc.body[f.document]).toBe(""); expect(WorkDocument.revision[f.document]).toBe(0);
});

test("restoring completed progress retains content/time but does not replay pending writing", () => {
  const f = fixture(); f.write(); f.advance(2000);
  f.act('write_document {"revision":1,"text":"UNFINISHED_WORDS"}');
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, f.registry)));
  const restored = createArgosWorld("Restored documents"); initializePrefabs(restored);
  for (let n = 0; n < 75; n++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!, document = oldToNewId.get(f.document)!, goal = oldToNewId.get(f.goal)!;
  expect(document).not.toBe(f.document); expect(hasComponent(restored, document, WorkDocument)).toBe(true);
  expect(hasComponent(restored, goal, GoalWorkProgress)).toBe(true);
  expect(WikiDoc.body[document]).toBe("The bridge needs repair.");
  expect(readProductiveGoalTime(restored, actor, goal, "Studio")).toBe(2000);
  advanceSimulationTimeline(restored, 10_000, { integrate: () => {} });
  expect(WikiDoc.body[document]).not.toContain("UNFINISHED_WORDS");
  expect(getAvailableAffordances(restored, actor, document).some(a => a.name === "review_document")).toBe(true);
  clearSimulationTimeline(f.world);
});
