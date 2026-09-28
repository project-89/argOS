import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { recordCommittedSpeech } from "../../cognition/social-memory";
import { applyCoordinationReviews, getCoordinationMemory } from "../../cognition/coordination-memory";
import { recordWorkingMemoryEvidence } from "../../cognition/working-memory";
import { getAgentSummaries } from "../monitoring-system";
import { collectAgentState } from "../../spirits/agent-daemon";

afterEach(() => jest.restoreAllMocks());

test("God and the assigned daemon can inspect a private blocker without broadcasting it", () => {
  const world = createArgosWorld("Coordination monitoring"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const make = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Work from evidence.", roomId: room });
  const actor = make("Mara"), listener = make("Ivo");
  const spoken = recordCommittedSpeech(world, actor, "I will bring the replacement belt.", "Ivo")!;
  applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: spoken.id, task: "Bring the replacement belt" }]);
  const id = getCoordinationMemory(world, actor).items[0].id;
  recordWorkingMemoryEvidence(world, actor, { id: "action:missing-belt", atMs: Date.now() + 1,
    kind: "action", provenance: "own_action", succeeded: false, summary: "No replacement belt is reachable here.", facts: [] });
  applyCoordinationReviews(world, actor, [{ kind: "blocked", id,
    reason: "No replacement belt is reachable here.", evidenceIds: ["action:missing-belt"] }]);
  const own = getCoordinationMemory(world, actor), heard = getCoordinationMemory(world, listener);
  const summaries = getAgentSummaries(world, {} as any);
  expect(summaries.find(s => s.eid === actor)?.coordination).toContain("No replacement belt is reachable here.");
  expect(collectAgentState(world, actor)?.coordination).toContain("No replacement belt is reachable here.");
  expect(summaries.find(s => s.eid === listener)?.coordination).not.toContain("No replacement belt is reachable here.");
  expect(getCoordinationMemory(world, actor)).toEqual(own);
  expect(getCoordinationMemory(world, listener)).toEqual(heard);
});
