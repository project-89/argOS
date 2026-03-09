/**
 * Behavioral Test: Persistence of BehaviorPolicy + Procedural Memory
 *
 * Verifies:
 * - BehaviorPolicy component persists through save/load
 * - HasMemory relations and Memory entities (including procedural skills) persist through save/load
 * - After load, agentThink can still start a procedure via policy (no LLM required)
 *
 * Run:
 *   npx tsx src/behavioral-tests/30-persistence-policy-and-skills-test.ts
 */
import "dotenv/config";

import { getRelationTargets, query } from "bitecs";
import * as fs from "fs/promises";
import * as path from "path";

import { createSystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, BehaviorPolicy, Memory, Name } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { proceduralSignature } from "../cognition/procedural-skills";
import { saveWorld, loadWorld } from "../persistence/world-persistence";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function findEntityByName(world: any, wanted: string): number | undefined {
  const w = wanted.trim().toLowerCase();
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    const n = Name.value[eid];
    if (typeof n === "string" && n.trim().toLowerCase() === w) return eid;
  }
  return undefined;
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  PERSISTENCE: POLICY + PROCEDURAL SKILLS TEST");
  console.log("═".repeat(70) + "\n");

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("PersistencePolicyAndSkillsTest") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const office = createRoomEntity(world as any, {
    name: "Office",
    description: "A small office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(office, "Office");

  worldSchema.defineObjectType({
    name: "notepad",
    description: "A small notepad for jotting down notes.",
    traits: ["notepad", "examinable"],
    states: { idle: { description: "A blank notepad lies here.", traits: ["notepad"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "write_note",
    requires: ["notepad"],
    descriptionTemplate: "{actor.name} writes a note.",
    effects: [{ type: "run_tool", toolId: "notes.append" }],
  });
  worldSchema.defineObjectType({
    name: "policy_console",
    description: "A console for configuring behavior policies",
    traits: ["policy_console", "examinable"],
    states: { idle: { description: "A console awaits a policy JSON.", traits: ["policy_console"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "set_policy",
    requires: ["policy_console"],
    descriptionTemplate: "{actor.name} installs a behavior policy.",
    effects: [{ type: "run_tool", toolId: "policy.set", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const agent = createAgentEntity(world as any, {
    name: "Riley",
    role: "Engineer",
    systemPrompt: "You are Riley.",
    roomId: office,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Riley");

  const notepad = objectManager.spawn("notepad", { name: "Notepad", containedIn: office })!;
  const consoleEid = objectManager.spawn("policy_console", { name: "Policy Console", containedIn: office })!;
  registerEntity(notepad, "Notepad");
  registerEntity(consoleEid, "Policy Console");

  // Train the procedural skill.
  for (let i = 0; i < 2; i++) {
    executeActions(
      world as any,
      [{ eid: agent, action: { type: "interact", target: "Notepad", content: "write_note persistent" } as any }],
      registry
    );
    drainPendingStimuli();
  }

  const signature = proceduralSignature({ affordance: "write_note", args: "persistent" });
  const tree = { type: "use_procedure", signature, minSuccesses: 2 };

  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Policy Console", content: `set_policy ${JSON.stringify({ tree })}` } as any }],
    registry
  );
  drainPendingStimuli();

  const savePath = path.join(process.cwd(), "saves", "__tests__", `policy-procedure-${Date.now()}.json`);
  await saveWorld(world as any, registry as any, savePath);

  // Load into a fresh world.
  const world2 = createArgosWorld("PersistencePolicyAndSkillsTestReloaded") as any;
  initializePrefabs(world2);
  const registry2 = createSystemRegistry();
  await loadWorld(world2 as any, registry2 as any, savePath);

  const loadedAgent = findEntityByName(world2 as any, "Riley");
  assert(loadedAgent !== undefined, "expected to find loaded agent by name");
  const agentEid = loadedAgent!;

  assert(Array.from(query(world2 as any, [Agent] as any)).includes(agentEid), "expected loaded agent to have Agent component");
  assert(BehaviorPolicy.enabled[agentEid] === true, "expected BehaviorPolicy.enabled persisted");
  assert(String(BehaviorPolicy.treeJson[agentEid] || "").includes(signature), "expected BehaviorPolicy.treeJson to include signature");

  const memories = getRelationTargets(world2 as any, agentEid, HasMemory as any) as number[];
  assert(memories.length > 0, "expected at least one HasMemory relation after load");
  const procedural = memories.find((mid: number) => String(Memory.type[mid] || "") === "procedural" && String(Memory.content[mid] || "").includes(signature));
  assert(typeof procedural === "number", "expected procedural Memory with signature after load");

  const action = await agentThink(world2 as any, agentEid);
  assert(action.type === "interact", "expected loaded policy to start procedure and yield interact action");

  await fs.rm(savePath, { force: true });

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
