import { jest } from "@jest/globals";
import { Goal, LastAction, WorkingMemoryIdentity } from "../../ecs/components";
import { createPersonalIntention } from "../goal-lifecycle";
import { integrateActorContinuation } from "../actor-continuation";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { completeDeferredAction, executeActions } from "../cognition-system";
import { applyCoordinationReviews, captureCoordinationWork, getCoordinationMemory } from "../coordination-memory";
import { getWorkingMemory, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { recordCommittedSpeech } from "../social-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";
import { getAgentMemory, type AgentAction } from "../agent-mind";

const removers: Array<() => void> = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Execution identity tests are offline")); });
afterEach(() => { for (const remove of removers.splice(0)) remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
function fixture() {
  const world = createArgosWorld("Deferred identity"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Mara", role: "tester", systemPrompt: "Act on evidence", roomId: room });
  const target = createObjectEntity(world, { name: "Valve", roomId: room, portable: false });
  const registry = createSystemRegistry(), received: AgentAction[] = [];
  captureWorkingMemoryObservation(world, actor);
  const proof = { targetKey: workingMemoryEntityRef(world, target)!.key };
  let handler: (action: AgentAction) => boolean = () => true;
  removers.push(registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: action => { received.push({ ...action }); return handler(action); } }));
  const execute = (action: AgentAction) => { executeActions(world, [{ eid: actor, action }], registry); return received.at(-1)!; };
  const promise = (task: string) => {
    const source = recordCommittedSpeech(world, actor, `I will ${task}.`)!;
    expect(applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: source.id, task,
      completion: { type: "action", actionType: "interact", target: "Valve", content: "close" } }])).toBe(1);
    return source.id;
  };
  const issue = (id: string) => execute({ type: "interact", target: "Valve", content: "close",
    coordinationWork: captureCoordinationWork(world, actor, id) });
  const complete = (action: AgentAction, success = true) => completeDeferredAction(world, actor, { ...action }, success,
    success ? "The valve has closed." : "The operation was interrupted.", proof);
  const status = (id: string) => getCoordinationMemory(world, actor).items.find(item => item.id === id)!.localStatus;
  const state = () => JSON.stringify({ workingMemory: getWorkingMemory(world, actor), coordination: getCoordinationMemory(world, actor),
    mind: getAgentMemory(world, actor), stimuli: peekPendingStimuli(actor), last: { type: LastAction.type[actor], target: LastAction.target[actor],
      content: LastAction.content[actor], success: LastAction.success[actor], timestamp: LastAction.timestamp[actor] } });
  return { world, actor, target, room, proof, registry, received, promise, issue, execute, complete, status, state,
    setHandler: (next: typeof handler) => { handler = next; } };
}

test("a late result from a failed identical attempt cannot complete its retry", () => {
  const f = fixture(), id = f.promise("close the valve"), first = f.issue(id);
  f.complete(first, false);
  const retry = f.issue(id), before = f.state();
  expect(first.executionId).toBeTruthy(); expect(retry.executionId).not.toBe(first.executionId);
  f.complete(first);
  expect(f.state()).toBe(before); expect(f.status(id)).toBe("blocked");
  f.complete(retry);
  expect(f.status(id)).toBe("verified_done");
});
test("real deferred completion attributes failure to the issued physical purpose, not later speech", () => {
  const f = fixture(), goal = createPersonalIntention(f.world, f.actor, "Prepare the workshop", 7)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Close the valve for maintenance", actionType: "interact", target: "Valve",
    observedAtSimMs: 0, goalId: goal, goalKey: WorkingMemoryIdentity.id[goal] });
  const issued = f.execute({ type: "interact", target: "Valve", content: "close" });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.provenance === "own_action")).toEqual([]);
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a joke", actionType: "speak", observedAtSimMs: 0 });
  f.complete(issued, false);
  recordCommittedSpeech(f.world, f.actor, "It has been quite a day.");
  const outcomes = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.provenance === "own_action");
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0]).toMatchObject({ succeeded: false, executionContext: { purpose: "Close the valve for maintenance",
    intention: { description: "Prepare the workshop" } } });
  f.complete(issued); expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.provenance === "own_action")).toHaveLength(1);
  expect(Goal.progress[goal]).toBe(0);
});

test("an older same-worded callback cannot steal another undertaking's pending operation", () => {
  const f = fixture(), a = f.promise("close the valve before maintenance"), b = f.promise("close the valve for pressure testing");
  const first = f.issue(a); f.complete(first, false);
  const replacement = f.issue(b), before = f.state();
  f.complete(first);
  expect(f.state()).toBe(before); expect(f.status(b)).toBe("not_started");
  f.complete(replacement);
  expect(f.status(a)).toBe("blocked"); expect(f.status(b)).toBe("verified_done");
});

test("unissued and tampered callback data have no effects and cannot consume the valid operation", () => {
  const f = fixture(), id = f.promise("close the valve"), issued = f.issue(id), before = f.state();
  const impostors: AgentAction[] = [
    { ...issued, executionId: undefined }, { ...issued, executionId: "invented" },
    { ...issued, type: "use" }, { ...issued, target: "Other valve" },
    { ...issued, content: "close extra argument" }, { ...issued, content: "CLOSE" },
  ];
  for (const callback of impostors) { f.complete(callback); expect(f.state()).toBe(before); }
  f.complete(issued); expect(f.status(id)).toBe("verified_done");
  const committed = f.state(); f.complete(issued, false); expect(f.state()).toBe(committed);
});

test("caller-supplied operation IDs cannot replace engine-issued identity, and package copies retain it", () => {
  const f = fixture(), id = f.promise("close the valve");
  const requested: AgentAction = { type: "interact", target: "Valve", content: "close", executionId: "caller-forged",
    coordinationWork: captureCoordinationWork(f.world, f.actor, id) };
  const issued = f.execute(requested);
  expect(issued.executionId).not.toBe("caller-forged"); expect(requested.executionId).toBe("caller-forged");
  f.complete(requested); expect(f.status(id)).toBe("not_started");
  f.complete(structuredClone(issued)); expect(f.status(id)).toBe("verified_done");
});

test("changing actor identity makes a retained callback inert", () => {
  const f = fixture(), id = f.promise("close the valve"), issued = f.issue(id);
  WorkingMemoryIdentity.id[f.actor] = "entity:replacement-actor";
  const before = f.state(); f.complete(issued); expect(f.state()).toBe(before);
});

test("a rejected busy command cannot overwrite accepted work or leave a second completable operation", () => {
  const f = fixture(), id = f.promise("close the valve"), original = f.issue(id);
  const swallowed = f.execute({ type: "interact", target: "Valve", content: "open" });
  const before = f.state(); f.complete(swallowed); expect(f.state()).toBe(before);
  f.complete(original); expect(f.status(id)).toBe("verified_done");
  const after = f.state(); f.complete(swallowed); expect(f.state()).toBe(after);
});

test("dispatch throwing discards its orphan identity and does not swallow the next timed attempt", () => {
  const f = fixture(), id = f.promise("close the valve");
  f.setHandler(() => { throw new Error("Package dispatch failed"); });
  expect(() => f.issue(id)).toThrow("Package dispatch failed");
  const orphan = f.received.at(-1)!, before = f.state();
  f.complete(orphan); expect(f.state()).toBe(before);
  f.setHandler(() => true);
  const retry = f.issue(id); f.complete(retry);
  expect(f.status(id)).toBe("verified_done");
});

test("a second dispatch throwing removes only itself, preserving the original accepted operation", () => {
  const f = fixture(), id = f.promise("close the valve"), original = f.issue(id);
  f.setHandler(() => { throw new Error("Interrupt dispatch failed"); });
  expect(() => f.execute({ type: "interact", target: "Valve", content: "open" })).toThrow("Interrupt dispatch failed");
  const orphan = f.received.at(-1)!, before = f.state();
  f.complete(orphan); expect(f.state()).toBe(before);
  f.complete(original); expect(f.status(id)).toBe("verified_done");
});

test("explicit release settles the held operation and the separately issued release exactly once each", () => {
  const f = fixture(); let hold: AgentAction | undefined;
  f.setHandler(action => {
    if (action.content === "hold") { hold = { ...action }; return true; }
    if (action.content === "release") {
      completeDeferredAction(f.world, f.actor, hold!, false, "You stopped holding the valve.", f.proof);
      completeDeferredAction(f.world, f.actor, action, true, "You released the valve.", f.proof);
      return true;
    }
    return true;
  });
  f.execute({ type: "interact", target: "Valve", content: "hold" });
  const release = f.execute({ type: "interact", target: "Valve", content: "release" });
  expect(release.executionId).not.toBe(hold!.executionId);
  expect(LastAction.content[f.actor]).toBe("release"); expect(LastAction.success[f.actor]).toBe(true);
  const receipts = getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.provenance === "own_action");
  expect(receipts.filter(receipt => receipt.summary === "You stopped holding the valve." && !receipt.succeeded)).toHaveLength(1);
  expect(receipts.filter(receipt => receipt.summary === "You released the valve." && receipt.succeeded)).toHaveLength(1);
  const before = f.state(); f.complete(hold!); f.complete(release); expect(f.state()).toBe(before);
});
