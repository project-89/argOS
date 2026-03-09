/**
 * Live Demo: Spirit System with GodAI
 *
 * This test demonstrates:
 * 1. GodAI building a small simulation
 * 2. Spirit hierarchy observing the world
 * 3. Spirits running cognition and reporting
 * 4. GodAI receiving and responding to spirit reports
 *
 * Run with: npx tsx src/spirits/__tests__/test-spirit-live-demo.ts
 *
 * Note: Requires GOOGLE_GENERATIVE_AI_API_KEY environment variable
 */

import "dotenv/config";
import { addEntity, addComponent } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { Name, Description, Agent, Mind, Room, GodAgent } from "../../ecs/components";
import { LocatedIn } from "../../ecs/relations";
import { createEntityRegistry, registerEntity, type EntityRegistry } from "../../ecs/tools";
import { clearDynamicComponents } from "../../ecs/dynamic-components";

// Spirit imports
import {
  initializeSpiritSystem,
  startSpiritSystem,
  stopSpiritSystem,
  getSpiritSystemState,
  createNewSpirit,
  getAllSpirits,
  getRegistrySummary,
  recordActionEvent,
  getSpiritSystemDebugInfo,
  tickSpiritSystem,
  setGodAgentCallback,
} from "../spirit-system";
import {
  getSpiritByName,
  getMessagesForGodAI,
  sendDirective,
  printHierarchy,
} from "../spirit-registry";
import { runSpiritCognition, collectEcsSnapshot } from "../spirit-cognition";
import type { DivineMessage, ActionSnapshot } from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const RUN_LLM_TESTS = !!API_KEY;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function log(message: string) {
  console.log(`[Demo] ${message}`);
}

function logSection(title: string) {
  console.log("\n" + "─".repeat(60));
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// SIMULATION SETUP
// =============================================================================

interface DemoSimulation {
  world: World;
  registry: EntityRegistry;
  godEid: number;
}

function createDemoSimulation(): DemoSimulation {
  clearDynamicComponents();

  log("Creating simulation world...");
  const world = createArgosWorld("Medieval Village Simulation");
  const registry = createEntityRegistry();

  // Create GodAgent entity
  const godEid = addEntity(world);
  Name.value[godEid] = "The Creator";
  addComponent(world, godEid, GodAgent);
  GodAgent.worldName[godEid] = "Willowbrook Village";
  GodAgent.narrative[godEid] = "A small medieval village where strangers bring secrets and change.";
  GodAgent.tick[godEid] = 0;
  registerEntity(registry, "The Creator", godEid);

  // Create locations
  const locations = [
    { name: "The Rusty Tankard", desc: "A weathered tavern where locals gather for ale and gossip", ambience: "warm and noisy" },
    { name: "Village Square", desc: "The heart of the village, with a well and notice board", ambience: "busy during day" },
    { name: "Blacksmith's Forge", desc: "Sparks fly as metal meets hammer", ambience: "hot and rhythmic" },
    { name: "The Old Chapel", desc: "A quiet stone building where villagers seek solace", ambience: "peaceful and reverent" },
  ];

  const roomEids = new Map<string, number>();
  for (const loc of locations) {
    const eid = addEntity(world);
    Name.value[eid] = loc.name;
    Description.value[eid] = loc.desc;
    addComponent(world, eid, Room);
    Room.ambience[eid] = loc.ambience;
    registerEntity(registry, loc.name, eid);
    roomEids.set(loc.name, eid);
  }

  // Create characters
  const characters = [
    { name: "Elena", desc: "The innkeeper's daughter, curious and kind", location: "The Rusty Tankard", arousal: 0.5, focus: "customers" },
    { name: "Marcus", desc: "The village blacksmith, strong and silent", location: "Blacksmith's Forge", arousal: 0.4, focus: "work" },
    { name: "Sister Agnes", desc: "The elderly chapel keeper, wise but worried", location: "The Old Chapel", arousal: 0.3, focus: "prayers" },
    { name: "The Stranger", desc: "A cloaked figure who arrived at dusk, asking questions", location: "The Rusty Tankard", arousal: 0.7, focus: "secrets" },
  ];

  for (const char of characters) {
    const eid = addEntity(world);
    Name.value[eid] = char.name;
    Description.value[eid] = char.desc;
    addComponent(world, eid, Agent);
    addComponent(world, eid, Mind);
    Mind.arousal[eid] = char.arousal;
    Mind.focus[eid] = char.focus;
    Mind.mode[eid] = "deliberative";
    Agent.active[eid] = true;

    const roomEid = roomEids.get(char.location);
    if (roomEid) {
      addComponent(world, eid, LocatedIn(roomEid));
    }

    registerEntity(registry, char.name, eid);
  }

  log(`Created world with ${locations.length} locations and ${characters.length} characters`);
  return { world, registry, godEid };
}

// =============================================================================
// DEMO: SPIRIT HIERARCHY
// =============================================================================

async function demoSpiritHierarchy(sim: DemoSimulation) {
  logSection("DEMO: Spirit Hierarchy Setup");

  // Initialize spirit system
  log("Initializing spirit system...");
  const state = initializeSpiritSystem(sim.world, {
    godAgentEid: sim.godEid,
    autoCreateNarrator: true,
    tickInterval: 5000,
  });

  const narrator = getSpiritByName(state.registry, "The Narrator")!;
  log(`✓ The Narrator created (archangel of narrative)`);

  // Create subordinate spirits
  log("\nCreating spirit hierarchy...");

  const sceneAngel = createNewSpirit({
    name: "Tavern Watcher",
    domain: "locale",
    rank: "angel",
    description: "Watches events in The Rusty Tankard",
    watchConfig: {
      componentQueries: [],
      eventTypes: ["dialogue_spoken", "action_executed"],
      watchRooms: ["The Rusty Tankard"],
    },
    canInjectEvents: true,
    canModifyMood: false,
    canCreateEntities: false,
    canBakeSystems: false,
    model: "flash",
    observationInterval: 15000,
    systemPrompt: "You watch The Rusty Tankard, noting dramatic moments and character interactions.",
  }, narrator.eid);
  log(`✓ Tavern Watcher created (angel under Narrator)`);

  const guardianSpirit = createNewSpirit({
    name: "Stranger's Shadow",
    domain: "guardian",
    rank: "daemon",
    description: "Watches The Stranger specifically",
    watchConfig: {
      componentQueries: [],
      eventTypes: ["action_executed"],
      watchEntities: ["The Stranger"],
    },
    canInjectEvents: false,
    canModifyMood: false,
    canCreateEntities: false,
    canBakeSystems: false,
    model: "flash",
    observationInterval: 10000,
    systemPrompt: "You shadow The Stranger, tracking their movements and interactions.",
  }, sceneAngel!.eid);
  log(`✓ Stranger's Shadow created (daemon under Tavern Watcher)`);

  // Print hierarchy
  console.log("\n" + printHierarchy(state.registry));

  return state;
}

// =============================================================================
// DEMO: SIMULATED ACTIONS
// =============================================================================

async function demoSimulatedActions() {
  logSection("DEMO: Simulating World Events");

  const actions: ActionSnapshot[] = [
    { timestamp: Date.now(), actor: "Elena", type: "action", content: "Elena polishes a glass, watching the stranger from the corner of her eye" },
    { timestamp: Date.now() + 100, actor: "The Stranger", type: "speak", content: "Tell me, does anyone remember the night the old miller disappeared?", target: "Elena" },
    { timestamp: Date.now() + 200, actor: "Elena", type: "speak", content: "That was ten years ago... why do you ask?", target: "The Stranger" },
    { timestamp: Date.now() + 300, actor: "Elena", type: "emotion", content: "Elena feels a chill run down her spine" },
    { timestamp: Date.now() + 400, actor: "Marcus", type: "action", content: "Marcus enters the tavern, covered in soot from the forge" },
    { timestamp: Date.now() + 500, actor: "Marcus", type: "speak", content: "Evening, Elena. The usual.", target: "Elena" },
    { timestamp: Date.now() + 600, actor: "Marcus", type: "action", content: "Marcus notices the stranger and his expression hardens" },
  ];

  log("Recording simulated events...");
  for (const action of actions) {
    recordActionEvent(action.actor, action.type, action.content, action.target);
    console.log(`  → [${action.type}] ${action.actor}: ${action.content.slice(0, 50)}...`);
  }

  log(`\n✓ Recorded ${actions.length} events for spirits to observe`);
}

// =============================================================================
// DEMO: SPIRIT COGNITION (LLM)
// =============================================================================

async function demoSpiritCognition(sim: DemoSimulation) {
  logSection("DEMO: Spirit Cognition (LLM)");

  if (!RUN_LLM_TESTS) {
    log("⚠ Skipping LLM test - no API key configured");
    log("  Set GOOGLE_GENERATIVE_AI_API_KEY to run this demo");
    return;
  }

  const state = getSpiritSystemState()!;
  const narrator = getSpiritByName(state.registry, "The Narrator")!;

  // Set up callback to receive reports
  const receivedReports: DivineMessage[] = [];
  setGodAgentCallback(async (messages) => {
    receivedReports.push(...messages);
    for (const msg of messages) {
      log(`📨 Report from ${Name.value[msg.from] || msg.from}: ${msg.subject}`);
    }
  });

  log("Running Narrator cognition cycle...");
  log("(This will call the LLM to analyze the world state)\n");

  try {
    const output = await runSpiritCognition(
      narrator,
      sim.world,
      sim.registry,
      state.registry,
      state.actionBuffer
    );

    console.log("\n🧠 Narrator's Thoughts:");
    console.log("─".repeat(40));
    console.log(output.thoughts || "(No thoughts recorded)");

    if (output.observations.length > 0) {
      console.log("\n👁 Observations:");
      for (const obs of output.observations) {
        console.log(`  • [${obs.type}] ${obs.content} (significance: ${obs.significance})`);
      }
    }

    if (output.interventions.length > 0) {
      console.log("\n⚡ Planned Interventions:");
      for (const int of output.interventions) {
        console.log(`  • ${int.type} → ${int.target.name}: ${int.content}`);
        console.log(`    Reason: ${int.reason}`);
      }
    }

    if (output.updatedNarrativeState) {
      console.log("\n📖 Narrative State Update:");
      console.log(`  • Tension: ${output.updatedNarrativeState.tension}`);
      console.log(`  • Phase: ${output.updatedNarrativeState.currentPhase}`);
      if (output.updatedNarrativeState.protagonists) {
        console.log(`  • Protagonists: ${output.updatedNarrativeState.protagonists.join(", ")}`);
      }
    }

    log(`\n✓ Cognition cycle complete`);
    log(`  Generated ${output.observations.length} observations`);
    log(`  Planned ${output.interventions.length} interventions`);
    log(`  Sent ${output.reports.length} reports to GodAI`);

  } catch (error) {
    log(`✗ Cognition failed: ${error}`);
  }
}

// =============================================================================
// DEMO: MESSAGE FLOW
// =============================================================================

async function demoMessageFlow(sim: DemoSimulation) {
  logSection("DEMO: Divine Message Flow");

  const state = getSpiritSystemState()!;
  const narrator = getSpiritByName(state.registry, "The Narrator")!;

  // GodAI sends directive to Narrator
  log("GodAI → Narrator: Sending directive...");
  const directive = sendDirective(state.registry, sim.godEid, narrator.eid, {
    type: "intervene",
    description: "Escalate the tension between The Stranger and Marcus. Create a confrontation.",
    action: {
      type: "inject_stimulus",
      target: "The Rusty Tankard",
      parameters: {
        content: "The fire crackles ominously as silence falls over the tavern",
      },
    },
  });

  log(`  Directive ID: ${directive.id}`);
  log(`  Status: ${directive.status}`);
  log(`  Description: ${directive.description}`);

  // Check narrator's pending directives
  console.log("\n📋 Narrator's Pending Directives:");
  for (const dir of narrator.pendingDirectives) {
    console.log(`  • [${dir.status}] ${dir.description}`);
  }

  // Simulate narrative state update
  narrator.narrativeState!.tension = 0.7;
  narrator.narrativeState!.currentPhase = "rising";
  narrator.narrativeState!.protagonists = ["Elena", "Marcus"];
  narrator.narrativeState!.antagonists = ["The Stranger"];
  narrator.narrativeState!.plotThreads.push({
    id: "mystery_miller",
    name: "The Miller's Disappearance",
    description: "The Stranger's questions about the old miller have awakened old fears",
    participants: ["The Stranger", "Elena", "Marcus"],
    status: "active",
    tension: 0.6,
    events: [],
    startedAt: Date.now(),
  });

  console.log("\n📖 Updated Narrative State:");
  console.log(`  • Phase: ${narrator.narrativeState!.currentPhase}`);
  console.log(`  • Tension: ${(narrator.narrativeState!.tension * 100).toFixed(0)}%`);
  console.log(`  • Protagonists: ${narrator.narrativeState!.protagonists.join(", ")}`);
  console.log(`  • Antagonists: ${narrator.narrativeState!.antagonists.join(", ")}`);
  console.log(`  • Active Plot Threads: ${narrator.narrativeState!.plotThreads.length}`);

  log("\n✓ Message flow demonstration complete");
}

// =============================================================================
// DEMO: SYSTEM DEBUG INFO
// =============================================================================

async function demoDebugInfo() {
  logSection("DEMO: System Debug Information");

  const debugInfo = getSpiritSystemDebugInfo() as any;

  console.log("\n📊 Spirit System Status:");
  console.log(`  • Status: ${debugInfo.status}`);
  console.log(`  • Spirit Count: ${debugInfo.spiritCount}`);
  console.log(`  • Action Buffer: ${debugInfo.actionBufferSize} events`);
  console.log(`  • Message Queue: ${debugInfo.messageQueueSize} messages`);

  console.log("\n👼 Registered Spirits:");
  for (const spirit of debugInfo.spirits) {
    console.log(`  • ${spirit.name} [${spirit.domain}/${spirit.rank}]`);
    console.log(`    Observations: ${spirit.observationsCount}, Inbox: ${spirit.inboxSize}`);
  }

  console.log("\n" + getRegistrySummary());
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  🌟 SPIRIT SYSTEM LIVE DEMONSTRATION 🌟");
  console.log("═".repeat(60));

  try {
    // Create simulation
    const sim = createDemoSimulation();

    // Demo: Spirit hierarchy
    await demoSpiritHierarchy(sim);

    // Demo: Simulated actions
    await demoSimulatedActions();

    // Demo: Message flow
    await demoMessageFlow(sim);

    // Demo: Spirit cognition (LLM)
    await demoSpiritCognition(sim);

    // Demo: Debug info
    await demoDebugInfo();

    // Cleanup
    stopSpiritSystem();

    logSection("DEMONSTRATION COMPLETE");
    console.log("\n✅ All demos executed successfully!\n");

  } catch (error) {
    console.error("\n❌ Demo failed:", error);
    process.exit(1);
  }
}

main();
