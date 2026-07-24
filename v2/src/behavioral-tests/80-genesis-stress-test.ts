/**
 * Genesis Mode Stress Test
 *
 * Tests the full spontaneous genesis pipeline:
 *   seed description → God creates rooms/agents/objects/components → simulation runs
 *
 * Also validates the unified component registry:
 *   dynamic components are BitECS-queryable, system destructure picks them up
 */

import "dotenv/config";
import { createSimulation, query, hasComponent, getRelationTargets } from "../index";
import {
  initializeRegistry,
  getComponent,
  registryHasComponent,
  attachToEntity,
  getMergedComponents,
  listNames as listComponentNames,
  listDynamic as listDynamicComponentDefs,
} from "../ecs/component-registry";
import { createDynamicComponent, getDynamicComponent } from "../ecs/dynamic-components";
import { compileSystemCode } from "../god/system-baker";
import { Agent, Name, Room, LastAction } from "../ecs/components";
import { createArgosWorld } from "../ecs/world";
import { addEntity, addComponent, removeEntity } from "bitecs";

// ============================================================================
// Test harness
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(async () => {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, passed: true, detail: "OK", durationMs: Date.now() - start });
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      results.push({ name, passed: false, detail: e.message, durationMs: Date.now() - start });
      console.log(`  ❌ ${name}: ${e.message}`);
    }
  });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ============================================================================
// Phase 1: Unified Component Registry (no LLM needed)
// ============================================================================

async function runRegistryTests() {
  console.log("\n═══ Phase 1: Unified Component Registry ═══\n");

  const world = createArgosWorld("Registry Test");
  initializeRegistry(world);

  await test("Static components registered", () => {
    assert(registryHasComponent("Name"), "Name not in registry");
    assert(registryHasComponent("Agent"), "Agent not in registry");
    assert(registryHasComponent("Room"), "Room not in registry");
    assert(registryHasComponent("Mind"), "Mind not in registry");
    assert(registryHasComponent("Needs"), "Needs not in registry");
    const names = listComponentNames();
    assert(names.length >= 50, `Only ${names.length} components registered, expected 50+`);
  });

  await test("Static component SoA matches original", () => {
    const nameSoa = getComponent("Name");
    assert(nameSoa === Name, "Registry Name SoA is not the same object as imported Name");
    const agentSoa = getComponent("Agent");
    assert(agentSoa === Agent, "Registry Agent SoA is not the same object as imported Agent");
  });

  await test("Dynamic component creation via registry", () => {
    const def = {
      name: "Temperature",
      description: "Thermal state of an entity",
      properties: { current: "number" as const, target: "number" as const, rate: "number" as const },
    };
    createDynamicComponent(def);

    assert(registryHasComponent("Temperature"), "Temperature not in registry after creation");
    const soa = getComponent("Temperature");
    assert(soa !== undefined, "getComponent('Temperature') returned undefined");
    assert(Array.isArray(soa.current), "Temperature.current is not an array");
    assert(Array.isArray(soa.target), "Temperature.target is not an array");
  });

  await test("Merged components include both static and dynamic", () => {
    const merged = getMergedComponents();
    assert(merged.Name === Name, "Merged Name mismatch");
    assert(merged.Temperature !== undefined, "Merged missing Temperature");
    assert(merged.Agent === Agent, "Merged Agent mismatch");
  });

  await test("attachToEntity bridges dynamic component to BitECS", () => {
    const eid = addEntity(world);
    addComponent(world, eid, Name);
    Name.value[eid] = "TestEntity";

    // Attach dynamic component via registry
    const ok = attachToEntity(world, eid, "Temperature", { current: 20, target: 25, rate: 0.5 });
    assert(ok, "attachToEntity returned false");

    // Verify values were written
    const soa = getComponent("Temperature");
    assert(soa.current[eid] === 20, `current=${soa.current[eid]}, expected 20`);
    assert(soa.target[eid] === 25, `target=${soa.target[eid]}, expected 25`);

    // THE CRITICAL TEST: query by dynamic component
    const found = Array.from(query(world, [soa]));
    assert(found.includes(eid), `query(world, [Temperature]) did not find entity ${eid}. Found: ${found}`);
  });

  await test("Dynamic component names in listComponentNames", () => {
    const names = listComponentNames();
    assert(names.includes("Temperature"), "Temperature not in listComponentNames");
    assert(names.includes("Name"), "Name not in listComponentNames");
  });

  await test("listDynamicComponentDefs returns only dynamic", () => {
    const defs = listDynamicComponentDefs();
    assert(defs.length >= 1, "No dynamic defs found");
    assert(defs.some(d => d.name === "Temperature"), "Temperature not in dynamic defs");
    assert(!defs.some(d => d.name === "Name"), "Name should not be in dynamic defs");
  });

  await test("Compiled system can destructure dynamic components", () => {
    const code = `
      const entities = Array.from(ctx.query(world, [Temperature]));
      for (const eid of entities) {
        Temperature.current[eid] += Temperature.rate[eid];
        ctx.log("temp: " + Temperature.current[eid]);
      }
    `;
    const result = compileSystemCode(code, false);
    assert(result.success, `Compile failed: ${result.error}`);
    assert(typeof result.fn === "function", "Compiled fn is not a function");
  });
}

// ============================================================================
// Phase 2: Genesis Mode (requires LLM / API key)
// ============================================================================

async function runGenesisTest() {
  console.log("\n═══ Phase 2: Genesis Mode (Full Pipeline) ═══\n");

  const hasKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
  if (!hasKey) {
    console.log("  ⚠️  Skipping genesis test — no GOOGLE_GENERATIVE_AI_API_KEY set");
    results.push({ name: "Genesis (skipped)", passed: true, detail: "No API key", durationMs: 0 });
    return;
  }

  let sim: Awaited<ReturnType<typeof createSimulation>> | null = null;

  await test("createSimulation with genesis: true", async () => {
    sim = await createSimulation({
      name: "Genesis Tavern",
      narrative: "A cozy medieval tavern called The Rusty Tankard with a barkeeper, a bard, and a mysterious hooded stranger. There's a roaring fireplace, ale barrels, and a creaky staircase leading upstairs.",
      genesis: true,
      enableAI: true,
      enableSpirits: false,   // Disable spirits for faster test
      dualLoop: true,
    });
    assert(sim !== null, "createSimulation returned null");
    assert(sim.world !== null, "sim.world is null");
    assert(sim.god !== null, "sim.god is null");
  });

  if (!sim) return;

  await test("Genesis created rooms", () => {
    const rooms = Array.from(query(sim!.world, [Room]));
    console.log(`    Rooms: ${rooms.map(eid => Name.value[eid]).join(", ")}`);
    assert(rooms.length >= 1, `Expected at least 1 room, got ${rooms.length}`);
  });

  await test("Genesis created agents", () => {
    const agents = Array.from(query(sim!.world, [Agent]));
    console.log(`    Agents: ${agents.map(eid => Name.value[eid]).join(", ")}`);
    assert(agents.length >= 2, `Expected at least 2 agents, got ${agents.length}`);
  });

  await test("Genesis world has entities with Name", () => {
    const named = Array.from(query(sim!.world, [Name]));
    console.log(`    Total named entities: ${named.length}`);
    assert(named.length >= 5, `Expected at least 5 named entities, got ${named.length}`);
  });

  await test("Simulation can start and tick", async () => {
    await sim!.start();
    assert(sim!.running, "sim.running should be true after start");

    // Let it tick a few times
    await new Promise(resolve => setTimeout(resolve, 3000));

    const stats = sim!.getStats();
    console.log(`    After 3s: tick=${stats.tick}, agents=${stats.agentCount}, rooms=${stats.roomCount}, systems=${stats.systemCount}`);
    assert(stats.tick > 0, `Expected tick > 0, got ${stats.tick}`);
  });

  await test("Agents have actions after running", async () => {
    // Wait a bit more for cognition
    await new Promise(resolve => setTimeout(resolve, 5000));

    const stats = sim!.getStats();
    console.log(`    After 8s total: tick=${stats.tick}`);

    // Check agents have done something via LastAction component
    const agents = Array.from(query(sim!.world, [Agent]));
    let agentsWithActions = 0;
    for (const eid of agents) {
      const actionType = LastAction.type[eid];
      if (actionType) {
        agentsWithActions++;
        console.log(`    ${Name.value[eid]}: ${actionType} → ${LastAction.target[eid] || "?"}`);
      }
    }
    // At least one agent should have acted (behavior policies)
    assert(agentsWithActions >= 1, `Expected at least 1 agent with actions, got ${agentsWithActions}`);
  });

  // Cleanup
  sim.stop();
  console.log("    Simulation stopped.");
}

// ============================================================================
// Phase 3: Component Registry + Generated System Integration
// ============================================================================

async function runIntegrationTests() {
  console.log("\n═══ Phase 3: Registry + System Integration ═══\n");

  const world = createArgosWorld("Integration Test");
  initializeRegistry(world);

  // Create a dynamic component
  createDynamicComponent({
    name: "Hunger",
    description: "How hungry an entity is",
    properties: { level: "number" as const, decayRate: "number" as const },
  });

  // Create some entities
  const e1 = addEntity(world);
  addComponent(world, e1, Name);
  Name.value[e1] = "Alice";
  attachToEntity(world, e1, "Hunger", { level: 80, decayRate: 0.1 });

  const e2 = addEntity(world);
  addComponent(world, e2, Name);
  Name.value[e2] = "Bob";
  attachToEntity(world, e2, "Hunger", { level: 30, decayRate: 0.2 });

  await test("Generated system reads/writes dynamic component", () => {
    const code = `
      const hungryEntities = Array.from(ctx.query(world, [Hunger]));
      for (const eid of hungryEntities) {
        Hunger.level[eid] = Math.max(0, Hunger.level[eid] - Hunger.decayRate[eid]);
        if (Hunger.level[eid] < 50) {
          ctx.emit("hunger_warning", { entity: Name.value[eid], level: Hunger.level[eid] });
        }
      }
    `;
    const result = compileSystemCode(code, false);
    assert(result.success, `Compile failed: ${result.error}`);

    // Execute the system
    const events: any[] = [];
    const logs: string[] = [];
    const ctx = {
      tick: 1, delta: 1000, elapsed: 1000,
      emit: (type: string, data: any) => events.push({ type, data }),
      log: (msg: string) => logs.push(msg),
      query,
      hasComponent,
      getRelationTargets,
      addEntity,
      addComponent,
      removeEntity,
      components: getMergedComponents(),
      relations: {},
      ai: {} as any,
      grid: {} as any,
      location: {} as any,
      cognitive: {} as any,
      getComponent,
      createComponent: createDynamicComponent,
      attachComponent: (eid: number, name: string, values?: any) => attachToEntity(world, eid, name, values),
    };

    result.fn!(world, ctx as any);

    // Verify mutations
    const hungerSoa = getComponent("Hunger");
    assert(hungerSoa.level[e1] < 80, `Alice's hunger should have decreased from 80, got ${hungerSoa.level[e1]}`);
    assert(hungerSoa.level[e2] < 30, `Bob's hunger should have decreased from 30, got ${hungerSoa.level[e2]}`);

    // Verify events (Bob's level was 30 - 0.2 = 29.8, which is < 50)
    assert(events.length >= 1, `Expected at least 1 hunger_warning event, got ${events.length}`);
    assert(events.some(e => e.data.entity === "Bob"), "Expected hunger_warning for Bob");
  });

  await test("Multiple dynamic components on same entity", () => {
    createDynamicComponent({
      name: "Mood",
      description: "Emotional state",
      properties: { happiness: "number" as const, anxiety: "number" as const },
    });

    const e3 = addEntity(world);
    addComponent(world, e3, Name);
    Name.value[e3] = "Charlie";
    attachToEntity(world, e3, "Hunger", { level: 60, decayRate: 0.15 });
    attachToEntity(world, e3, "Mood", { happiness: 70, anxiety: 20 });

    // Query by both
    const hungerSoa = getComponent("Hunger");
    const moodSoa = getComponent("Mood");
    const withBoth = Array.from(query(world, [hungerSoa, moodSoa]));
    assert(withBoth.includes(e3), `Entity with both Hunger+Mood not found in query`);
    assert(!withBoth.includes(e1), `Alice shouldn't have Mood component`);
  });
}

// ============================================================================
// Run all tests
// ============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ArgOS v2 — Genesis & Component Registry Stress Test       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  try {
    await runRegistryTests();
    await runIntegrationTests();
    await runGenesisTest();
  } catch (e: any) {
    console.error("\n💥 Unexpected error:", e);
  }

  // Summary
  console.log("\n════════════════════════════════════════════════════════");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.detail}`);
    }
  }

  console.log(`\nTotal duration: ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);
  console.log("════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
