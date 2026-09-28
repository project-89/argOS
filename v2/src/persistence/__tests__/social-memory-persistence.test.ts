import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { recordCommittedSpeech, recordHeardSpeechFragment, getCompletedContributions, getSocialDialogue } from "../../cognition/social-memory";
import { serializeWorld, type SerializedWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Social continuity source"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common room" });
  const make = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Private identity", roomId: room });
  const ada = make("Ada"), bo = make("Bo");
  recordCommittedSpeech(world, ada, "I will finish the letter.", "Bo", 100, undefined, "PRIVATE_ADA_PURPOSE");
  recordCommittedSpeech(world, bo, "I can wait.", "Ada", 200, undefined, "PRIVATE_BO_PURPOSE");
  recordHeardSpeechFragment(world, ada, { executionId: "interrupted-prefix", roomId: room,
    audience: new Set([bo]), content: "Only these words", tokenIndex: 0, totalTokens: 10,
    startedAtSimMs: 300, heardAtSimMs: 400 }, "Bo");
  const expected = [ada, bo].map(eid => ({ dialogue: getSocialDialogue(world, eid), contributions: getCompletedContributions(world, eid) }));
  const saved = JSON.parse(JSON.stringify(serializeWorld(world, createSystemRegistry()))) as SerializedWorld;
  return { saved, expected, ada, bo };
}
function restore(saved: SerializedWorld, poison = false): any[] {
  const output = execFileSync(process.execPath, ["--import", "tsx", resolve("src/persistence/__tests__/fixtures/social-memory-restore.ts")], {
    input: JSON.stringify({ saved, poison }), encoding: "utf8", timeout: 20_000, maxBuffer: 2_000_000,
  });
  const line = output.split("\n").find(line => line.startsWith("RESTORE_RESULT "));
  if (!line) throw new Error(`Restore probe produced no result: ${output.slice(-1000)}`);
  return JSON.parse(line.slice("RESTORE_RESULT ".length));
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model calls")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("fresh-process remapped restore retains completed speech purposes only for their owner", () => {
  const f = fixture(), actors = restore(f.saved);
  for (const [index, actor] of actors.entries()) {
    expect(actor.eid).not.toBe(actor.oldEid);
    expect(actor.dialogue).toEqual(f.expected[index].dialogue);
    expect(actor.contributions).toEqual(f.expected[index].contributions);
    expect(actor.activity).toBeNull();
  }
  expect(JSON.stringify(actors[0].contributions)).not.toContain("PRIVATE_BO_PURPOSE");
  expect(JSON.stringify(actors[1].contributions)).not.toContain("PRIVATE_ADA_PURPOSE");
});

test("restored heard prefixes remain historical, never fresh notifications or completed turns", () => {
  const actors = restore(fixture().saved);
  for (const actor of actors) {
    expect(actor.fragments).toEqual([expect.objectContaining({ content: "Only these words", complete: false, historical: true })]);
    expect(actor.notifications).toEqual([]);
    expect(actor.dialogue).toHaveLength(2);
    expect(actor.dialogue.some((turn: any) => turn.content === "Only these words")).toBe(false);
  }
});

test.each([false, true])("legacy snapshots default missing fields without importing sparse-slot residue (poison=%s)", poison => {
  const f = fixture();
  for (const entity of f.saved.entities) if (entity.components.SocialMemory) {
    delete entity.components.SocialMemory.fragmentsJson;
    delete entity.components.SocialMemory.contributionsJson;
  }
  for (const actor of restore(f.saved, poison)) {
    expect(actor.rawContributions).toBe("[]"); expect(actor.rawFragments).toBe("[]");
    expect(actor.fragments).toEqual([]); expect(actor.contributions).toEqual([]);
    expect(actor.notifications).toEqual([]);
  }
});

test("saved purposes not linked to own completed speech are not restored as contributions", () => {
  const f = fixture(), data = f.saved.entities.find(e => e.id === f.ada)!.components.SocialMemory;
  const peerTurn = f.expected[0].dialogue.find(turn => !turn.own)!;
  data.contributionsJson = JSON.stringify([{ speechId: peerTurn.id, purpose: "STOLEN_PEER_PURPOSE" },
    { speechId: "nonexistent-turn", purpose: "UNEXECUTED_PURPOSE" }]);
  expect(restore(f.saved)[0].contributions).toEqual([]);
});

test.each(["not-json", "{}", "null"])("malformed optional ledgers restore safely: %s", value => {
  const f = fixture();
  for (const entity of f.saved.entities) if (entity.components.SocialMemory) {
    entity.components.SocialMemory.fragmentsJson = value;
    entity.components.SocialMemory.contributionsJson = value;
  }
  for (const actor of restore(f.saved, true)) {
    expect(actor.fragments).toEqual([]); expect(actor.contributions).toEqual([]);
    expect(actor.notifications).toEqual([]);
  }
});
