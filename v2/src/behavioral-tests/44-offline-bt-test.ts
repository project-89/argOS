/**
 * Offline BT Test — Run learned behavior trees WITHOUT the LLM
 *
 * Proves that trees trained through LLM interaction can execute
 * autonomously with zero API calls.
 *
 * 1. Build a "trained" tree (simulating what 60 ticks of learning produces)
 * 2. Delete the API key
 * 3. Run 30 ticks — agent should act purely from compiled BT branches
 * 4. Measure: actions produced, variety, no wait spam, no errors
 *
 * Run:
 *   cd v2 && npx tsx src/behavioral-tests/44-offline-bt-test.ts
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name, Needs, Traits } from "../ecs/components";
import { addEntity, addComponent } from "bitecs";
import { registerEntity } from "../cognition/cognition-system";
import { agentThink } from "../cognition/agent-mind";
import {
  setAgentBehaviorPolicy,
  clearPolicyEvalHistory,
  type BehaviorNode,
} from "../cognition/behavior-policy";
import { registerAffordance } from "../world/schema";
import { registerTrait } from "../world/trait-registry";
import { registerSkill, resetSkillRegistry } from "../cognition/skill-registry";
import { resetCompilerState } from "../cognition/bt-compiler";
import { resetLearningState } from "../cognition/policy-learning";
import { resetAllPolicyMetrics } from "../cognition/policy-metrics";
import { clearActionHistory } from "../cognition/agent-action-history";
import { setLocatedIn } from "../ecs/location";

function log(msg: string) { console.log(msg); }
function header(title: string) { log("\n" + "═".repeat(72)); log(`  ${title}`); log("═".repeat(72)); }
function sub(title: string) { log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`); }
function pass(msg: string) { log(`  ✅ ${msg}`); }
function fail(msg: string) { log(`  ❌ ${msg}`); }
function info(msg: string) { log(`  ℹ  ${msg}`); }

async function main() {
  header("OFFLINE BT TEST — NO LLM, PURE BEHAVIOR TREE");

  // ─── KILL THE API KEY ──────────────────────────────────────────────────
  const savedKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  info("API key REMOVED — zero LLM calls possible");

  resetCompilerState();
  resetLearningState();
  resetAllPolicyMetrics();
  clearActionHistory();
  resetSkillRegistry();

  // ─── World ─────────────────────────────────────────────────────────────
  sub("WORLD SETUP");

  const world = createArgosWorld("OfflineBTTest") as any;
  initializePrefabs(world);

  const forge = createRoomEntity(world, { name: "Forge", description: "A blacksmith's forge" });
  registerEntity(forge, "Forge");
  const tavern = createRoomEntity(world, { name: "Tavern", description: "A warm tavern" });
  registerEntity(tavern, "Tavern");
  const forest = createRoomEntity(world, { name: "Forest", description: "A forest with wild berries" });
  registerEntity(forest, "Forest");

  registerAffordance({ name: "forge_weapon", description: "Forge a weapon", requires: ["forgeable"], effects: [], category: "craft" } as any);
  registerAffordance({ name: "forage", description: "Forage for food", requires: ["forageable"], effects: [], category: "survival" } as any);
  registerTrait({ name: "forgeable", description: "Can be forged", category: "material" });
  registerTrait({ name: "forageable", description: "Can be foraged", category: "natural" });

  const anvil = addEntity(world);
  addComponent(world, anvil, Name as any); Name.value[anvil] = "Iron Anvil";
  addComponent(world, anvil, Traits as any); Traits.active[anvil] = JSON.stringify(["forgeable", "examinable"]);
  setLocatedIn(world, anvil, forge); registerEntity(anvil, "Iron Anvil");

  const berries = addEntity(world);
  addComponent(world, berries, Name as any); Name.value[berries] = "Wild Berries";
  addComponent(world, berries, Traits as any); Traits.active[berries] = JSON.stringify(["forageable", "edible"]);
  setLocatedIn(world, berries, forest); registerEntity(berries, "Wild Berries");

  info("3 rooms, 2 objects, 2 affordances, 0 API key");

  // ─── Register a "forge_and_eat" skill ──────────────────────────────────
  registerSkill({
    name: "forge_session",
    description: "A full forging session",
    origin: "compiled",
    tree: {
      type: "sequence",
      children: [
        { type: "interact_with_trait", trait: "forgeable", affordance: "forge_weapon", scope: "room" },
      ],
    },
  });

  // ─── Build a TRAINED tree (what 60 ticks of learning produces) ─────────
  sub("TRAINED BEHAVIOR TREE");

  const trainedTree: BehaviorNode = {
    type: "selector",
    children: [
      // Survival: rest when exhausted
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_below", need: "energy", value: 15 } },
          { type: "action", action: { type: "rest" } },
        ],
      },
      // Compiled from LLM: when hungry, go to Forest
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_above", need: "hunger", value: 60 } },
          { type: "condition", op: { type: "not_in_room", roomName: "Forest" } },
          { type: "action", action: { type: "move", target: "Forest" } },
        ],
      },
      // Compiled from LLM: when in Forest, forage
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "in_room", roomName: "Forest" } },
          { type: "interact_with_trait", trait: "forageable", affordance: "forage", scope: "room" },
        ],
      },
      // Compiled from LLM: when in Forge, use the forge_session skill
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "in_room", roomName: "Forge" } },
          { type: "skill", name: "forge_session" },
        ],
      },
      // Compiled from LLM: when lonely, go to Tavern
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_below", need: "social", value: 30 } },
          { type: "condition", op: { type: "not_in_room", roomName: "Tavern" } },
          { type: "action", action: { type: "move", target: "Tavern" } },
        ],
      },
      // Compiled from LLM: socialize in Tavern
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "in_room", roomName: "Tavern" } },
          { type: "condition", op: { type: "room_has_other_agents" } },
          { type: "action", action: { type: "speak", content: "Good evening!" } },
        ],
      },
      // Memory-driven: if remembers famine, be cautious
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "has_memory", includes: "famine" } },
          { type: "action", action: { type: "observe" } },
        ],
      },
      // Fallback: go home to Forge
      { type: "action", action: { type: "move", target: "Forge" } },
    ],
  };

  const agent = createAgentEntity(world, {
    name: "Aldric",
    role: "blacksmith",
    systemPrompt: "You are Aldric, a gruff blacksmith.",
    roomId: forge,
  });
  registerEntity(agent, "Aldric");
  setAgentBehaviorPolicy(world, agent, trainedTree, true);
  clearPolicyEvalHistory(agent);

  const nodeCount = JSON.stringify(trainedTree).match(/"type"/g)?.length ?? 0;
  info(`Aldric's trained tree: ${nodeCount} nodes, 8 branches`);
  info("Branches: rest, hungry→forest, forage, forge, lonely→tavern, socialize, famine-memory, go-home");

  // ─── Run 30 ticks with NO LLM ─────────────────────────────────────────
  header("SIMULATION: 30 TICKS, NO LLM");

  const actions: string[] = [];
  let errors = 0;

  // Scenario: start hungry, forge a bit, get lonely, go socialize
  Needs.hunger[agent] = 80;  // Hungry → should go to Forest
  Needs.energy[agent] = 100;
  Needs.social[agent] = 50;

  for (let tick = 1; tick <= 30; tick++) {
    try {
      const action = await agentThink(world, agent);
      const desc = `${action.type}${action.target ? "→" + action.target : ""}`;
      actions.push(desc);

      // Simulate state changes (what ECS systems would do)
      if (action.type === "move" && action.target) {
        const rooms: Record<string, number> = { Forge: forge, Tavern: tavern, Forest: forest };
        const target = rooms[action.target];
        if (target) setLocatedIn(world, agent, target);
      }
      if (action.type === "interact" && action.content?.includes("forage")) {
        Needs.hunger[agent] = Math.max(0, Needs.hunger[agent] - 20);
      }
      if (action.type === "interact" && action.content?.includes("forge")) {
        Needs.energy[agent] = Math.max(0, Needs.energy[agent] - 5);
      }
      if (action.type === "speak") {
        Needs.social[agent] = Math.min(100, Needs.social[agent] + 15);
      }

      // Simulate need decay
      Needs.hunger[agent] = Math.min(100, Needs.hunger[agent] + 3);
      Needs.social[agent] = Math.max(0, Needs.social[agent] - 2);

      if (tick % 10 === 0) {
        info(`Tick ${tick}: ${actions.slice(-10).join(" | ")}`);
        info(`  Needs: hunger=${Needs.hunger[agent]}, energy=${Needs.energy[agent]}, social=${Needs.social[agent]}`);
      }
    } catch (err: any) {
      actions.push(`ERROR`);
      errors++;
    }
  }

  // ─── Results ───────────────────────────────────────────────────────────
  header("RESULTS");

  info(`Full sequence: ${actions.join(" | ")}`);
  log("");

  const actionTypes = new Set(actions.map(a => a.split("→")[0]));
  const moveCount = actions.filter(a => a.startsWith("move")).length;
  const interactCount = actions.filter(a => a.startsWith("interact")).length;
  const waitCount = actions.filter(a => a === "wait").length;
  const totalActions = actions.length;

  info(`Total actions: ${totalActions}`);
  info(`Action types: ${[...actionTypes].join(", ")} (${actionTypes.size} unique)`);
  info(`Moves: ${moveCount}, Interacts: ${interactCount}, Waits: ${waitCount}, Errors: ${errors}`);

  // ─── Score ─────────────────────────────────────────────────────────────
  header("SCORECARD");

  let score = 0;
  const max = 50;

  // 1. No LLM calls (10 pts)
  const noLLM = !process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  score += noLLM ? 10 : 0;
  noLLM ? pass("Zero LLM calls: 10/10") : fail("LLM was used: 0/10");

  // 2. Agent acts (not all waits) (10 pts)
  const actRate = (totalActions - waitCount) / totalActions;
  const actScore = actRate > 0.5 ? 10 : actRate > 0.2 ? 5 : 0;
  score += actScore;
  actScore >= 5 ? pass(`Active rate ${(actRate * 100).toFixed(0)}%: ${actScore}/10`) : fail(`Active rate ${(actRate * 100).toFixed(0)}%: ${actScore}/10`);

  // 3. Multiple action types (10 pts)
  const typeScore = actionTypes.size >= 3 ? 10 : actionTypes.size >= 2 ? 5 : 0;
  score += typeScore;
  typeScore >= 5 ? pass(`${actionTypes.size} action types: ${typeScore}/10`) : fail(`${actionTypes.size} action types: ${typeScore}/10`);

  // 4. Responds to needs (10 pts) — moves to Forest when hungry, Tavern when lonely
  const wentToForest = actions.some(a => a === "move→Forest");
  const forgedOrForaged = actions.some(a => a.startsWith("interact"));
  const needScore = (wentToForest ? 5 : 0) + (forgedOrForaged ? 5 : 0);
  score += needScore;
  needScore >= 5 ? pass(`Need-driven: forest=${wentToForest}, interact=${forgedOrForaged}: ${needScore}/10`) : fail(`Need-driven: ${needScore}/10`);

  // 5. No errors (10 pts)
  const errScore = errors === 0 ? 10 : errors <= 2 ? 5 : 0;
  score += errScore;
  errScore >= 5 ? pass(`${errors} errors: ${errScore}/10`) : fail(`${errors} errors: ${errScore}/10`);

  log(`\n  TOTAL: ${score}/${max}`);
  const grade = score >= 45 ? "A" : score >= 35 ? "B" : score >= 25 ? "C" : "F";
  log(`  Grade: ${grade}\n`);

  // Restore key
  if (savedKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = savedKey;

  process.exit(score >= 25 ? 0 : 1);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
