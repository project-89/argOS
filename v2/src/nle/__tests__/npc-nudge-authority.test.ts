import { jest } from "@jest/globals";
import { query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Goal, Memory, Perception, Thought, WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { buildAgentContext, getAgentPerceptions } from "../../cognition/agent-mind";
import { chronicle } from "../../cognition/simulation-chronicle";
import { createDaemonRegistry, createDaemonForAgent } from "../../spirits/agent-daemon";
import { nudgeNpc, nudgeRoom, setNudgeDaemonRegistry } from "../npc-nudge";

function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose your own actions.", roomId: room });
  return { world, room, actor };
}
const proposal = { type: "change_goal" as const, action: "Consider a walk", reason: "An optional possibility" };
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test.each(["arrive", "interact", "resolve", "escalate", "reflect", "change_goal"] as const)("daemon-less %s stays advisory, never becomes an action, goal or lived memory", type => {
  const f = fixture(), before = [Goal, Memory, Thought].map(c => [...query(f.world, [c])]);
  expect(nudgeNpc(f.world, "Ada", { ...proposal, type })).toBe(true);
  const p = getAgentPerceptions(f.world, f.actor);
  expect(p).toHaveLength(1); expect(Perception.type[p[0]]).toBe("intent");
  expect(Perception.content[p[0]]).toContain("not proof or an obligation");
  expect([Goal, Memory, Thought].map(c => [...query(f.world, [c])])).toEqual(before);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
});

test("direct delivery reaches only the recipient's private context and records metadata rather than claiming a response", () => {
  const f = fixture(), other = fixture();
  const peer = createAgentEntity(f.world, { name: "Bo", role: "resident", systemPrompt: "An independent person.", roomId: f.room });
  advanceSimulationTime(f.world, 1, 12_000);
  const sourceId = getCommittedEvents(f.world).sourceId;
  const before = [Goal, Memory, Thought].map(c => [...query(f.world, [c])]);
  expect(nudgeNpc(f.world, "Ada", { ...proposal, action: "PRIVATE_NARRATOR_OPTION", reason: "PRIVATE_NARRATOR_REASON" })).toBe(true);
  expect(buildAgentContext(f.world, f.actor)).toContain("PRIVATE_NARRATOR_OPTION");
  expect(buildAgentContext(f.world, peer)).not.toContain("PRIVATE_NARRATOR_OPTION");
  expect(buildAgentContext(other.world, other.actor)).not.toContain("PRIVATE_NARRATOR_OPTION");
  const diagnostics = chronicle.getByType("narrative_nudge_lifecycle").filter(event => event.data.sourceId === sourceId);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].data).toMatchObject({
    route: "direct", stage: "perception_delivered", sourceId, agent: "Ada",
    actorKey: WorkingMemoryIdentity.id[f.actor], issuedAtSimMs: 12_000, atSimMs: 12_000,
    perceptionEid: getAgentPerceptions(f.world, f.actor)[0],
  });
  expect(diagnostics[0].data.nudgeId).toMatch(/^direct-nudge:/);
  expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_NARRATOR/);
  expect([Goal, Memory, Thought].map(c => [...query(f.world, [c])])).toEqual(before);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
  expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("only exact unambiguous active recipients are eligible", () => {
  const f = fixture();
  for (const name of ["", "A", "Ad", "Ada extra"]) expect(nudgeNpc(f.world, name, proposal)).toBe(false);
  Agent.active[f.actor] = false; expect(nudgeNpc(f.world, "Ada", proposal)).toBe(false);
  Agent.active[f.actor] = true;
  createAgentEntity(f.world, { name: "ADA", role: "another person", systemPrompt: "Independent", roomId: f.room });
  expect(nudgeNpc(f.world, "Ada", proposal)).toBe(false);
  expect(getAgentPerceptions(f.world, f.actor)).toEqual([]);
});

test("registration is world-local even with identical actor names", () => {
  const a = fixture(), b = fixture(), ar = createDaemonRegistry(), br = createDaemonRegistry();
  const ad = createDaemonForAgent(ar, a.world, a.actor)!, bd = createDaemonForAgent(br, b.world, b.actor)!;
  setNudgeDaemonRegistry(a.world, ar); setNudgeDaemonRegistry(b.world, br);
  expect(nudgeNpc(a.world, "Ada", proposal)).toBe(true);
  expect(ad.pendingNudges).toHaveLength(1); expect(bd.pendingNudges).toEqual([]);
  expect(getAgentPerceptions(b.world, b.actor)).toEqual([]);
});

test("a room suggestion is an exact-local optional intention, not fabricated shared physical evidence", () => {
  const f = fixture();
  nudgeRoom(f.world, "Lou", "A possible change of focus"); expect(getAgentPerceptions(f.world, f.actor)).toEqual([]);
  nudgeRoom(f.world, "Lounge", "A possible change of focus");
  const p = getAgentPerceptions(f.world, f.actor); expect(p).toHaveLength(1);
  expect(Perception.type[p[0]]).toBe("intent"); expect(Perception.source[p[0]]).not.toBe("world");
});

test("an expired or throwing runtime evidence lease cannot fall back to an unfenced suggestion", () => {
  const f = fixture();
  expect(nudgeNpc(f.world, "Ada", proposal, () => false)).toBe(false);
  expect(nudgeNpc(f.world, "Ada", proposal, () => { throw new Error("Evidence unavailable"); })).toBe(false);
  let checks = 0;
  expect(nudgeNpc(f.world, "Ada", proposal, () => ++checks === 1)).toBe(false);
  expect(getAgentPerceptions(f.world, f.actor)).toEqual([]);
});

test("stopped or canceled work cannot inject suggestions or queue daemon work", async () => {
  const f = fixture(); stopCommittedEvents(f.world);
  expect(nudgeNpc(f.world, "Ada", proposal)).toBe(false);
  nudgeRoom(f.world, "Lounge", proposal.action); expect(getAgentPerceptions(f.world, f.actor)).toEqual([]);
  const other = fixture(), controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort(); expect(() => nudgeNpc(other.world, "Ada", proposal)).toThrow();
  });
  expect(getAgentPerceptions(other.world, other.actor)).toEqual([]);
});
