import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));

const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createGodAgent, godCommand } = await import("../../god/god-agent");
const { createStoryScaffoldEntity } = await import("../story-scaffold");
const { getRoomForEntity } = await import("../../ecs/location");
const { resetNarrativeDirector, setDirectorGodAgent, runNarrativeDirectorCycle } = await import("../narrative-director");

function fixture(name = "Narrative regression") {
  const world = createArgosWorld(name);
  initializePrefabs(world);
  const god = createGodAgent(world, { name: "God", worldName: name });
  const landing = god.tools.createRoom({ name: "Landing" }).result.entityId;
  god.tools.createRoom({ name: "Bedroom" });
  const phone = god.tools.createObject({ name: "Mara's phone", roomName: "Landing", traits: ["phone"] }).result.entityId;
  createStoryScaffoldEntity(world, { seed: "Phone scene", currentAct: "setup", adaptations: [], npcRoles: [], tensions: [{
    id: "phone", description: "A notification", status: "active", involvedNpcs: [],
    beats: [{ id: "notification", description: "The phone on the old bedroom desk", act: "setup", status: "pending", triggerCondition: "A phone is heard", npcActions: [] }],
  }] } as any);
  setDirectorGodAgent(god);
  return { world, god, phone, landing };
}

beforeEach(() => { generate.mockReset(); resetNarrativeDirector(); });

describe("narrative preparation wiring", () => {
  it("rejects legacy prepare_world: adaptive direction cannot restore a phone or create same-cycle scenery", async () => {
    const f = fixture();
    generate.mockImplementation(async input => {
      expect(input.tools).toBeUndefined();
      return { text: JSON.stringify({ actions: [{ type: "prepare_world", target: "Bedroom", content: "Restore Mara's phone to the bedroom desk so she can hear it" }] }) };
    });
    expect(await runNarrativeDirectorCycle(f.world)).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(getRoomForEntity(f.world, f.phone)).toBe(f.landing);
    expect(f.god.conversationHistory).toEqual([]);
    expect(f.god.memory.shortTerm.some(memory => memory.content.includes("User request:"))).toBe(false);
  });

  it("does not broaden narrator authority on retries or inherit old operator history", async () => {
    const f = fixture();
    f.god.conversationHistory.push({ role: "user", content: "Old setup: place phone on desk" });
    let attempt = 0;
    generate.mockImplementation(async input => {
      expect(input.tools.createScenery).toBeDefined();
      expect(input.tools.addRelation).toBeUndefined();
      expect(input.tools.bakeNewSystem).toBeUndefined();
      expect(JSON.stringify(input.messages)).not.toContain("Old setup");
      attempt++;
      return attempt === 1
        ? { text: "", steps: [{ finishReason: "error", rawFinishReason: "MALFORMED_FUNCTION_CALL" }] }
        : { text: "No change is needed", steps: [] };
    });
    await godCommand(f.god, "Optional beat", { authority: "narrative-growth" });
    expect(attempt).toBe(2);
    expect(f.god.conversationHistory).toEqual([{ role: "user", content: "Old setup: place phone on desk" }]);
  });

  it("keeps unrestricted operator editing available", async () => {
    const f = fixture();
    generate.mockImplementation(async input => {
      expect(input.tools.addRelation).toBeDefined();
      expect(input.tools.requestSystemBuild).toBeDefined();
      const result = await input.tools.addRelation.execute({ subjectName: "Mara's phone", relationName: "LocatedIn", targetName: "Bedroom" }, {});
      return { text: "Moved by explicit command", steps: [{ toolCalls: [{ toolName: "addRelation", toolCallId: "move", input: {} }], toolResults: [{ toolCallId: "move", output: result }] }] };
    });
    await godCommand(f.god, "Move Mara's phone back to Bedroom");
    expect(getRoomForEntity(f.world, f.phone)).not.toBe(f.landing);
  });

  it("reviews each world's advisory plan independently without calling either God", async () => {
    const first = fixture("First world");
    const second = fixture("Second world");
    let calls = 0;
    generate.mockImplementation(async input => {
      expect(input.tools).toBeUndefined();
      calls++;
      return { text: JSON.stringify({ assessment: "Retain current possibilities", changes: [] }) };
    });
    expect(await runNarrativeDirectorCycle(first.world)).toBe(false);
    expect(await runNarrativeDirectorCycle(second.world)).toBe(false);
    expect(calls).toBe(2);
    expect(getRoomForEntity(first.world, first.phone)).toBe(first.landing);
    expect(getRoomForEntity(second.world, second.phone)).toBe(second.landing);
  });
});
