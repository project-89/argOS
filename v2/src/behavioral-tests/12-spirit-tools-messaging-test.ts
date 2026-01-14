/**
 * Spirit Tools & Messaging Test
 *
 * Focused tests for:
 * 1. Spirit messaging system (send, receive, request/response)
 * 2. Spirit tools (Artificer, Watcher, Manager)
 * 3. GodAI-to-spirit communication
 * 4. Role separation and delegation
 */

import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import {
  createSystemRegistry,
  type SystemRegistry,
} from "../ecs/dynamic-systems";
import {
  createSpiritRegistry,
  createSpirit,
  type SpiritRegistry,
} from "../spirits/spirit-registry";
import type { SpiritState, SpiritDefinition } from "../spirits/types";
import {
  spiritRouter,
  initializeSpiritMessaging,
  spiritReport,
  spiritDirective,
  spiritRespond,
  spiritAlert,
  spiritSubscribe,
  spiritEmit,
  getMessagesForSpirit,
  getMessagesForGodAI,
  registerSpiritCapability,
  findCapabilityHandlers,
  getBestCapabilityHandler,
  routeToCapability,
  getServicesRegistry,
} from "../spirits/spirit-messaging";
import { createArtificerTools, createWatcherTools, createManagerTools } from "../spirits/spirit-tools";
import { createOrchestratorTools } from "../god/god-tools-orchestrator";
import { createInterventionRegistry } from "../ecs/interventions";
import { Mind, Name, Health, Agent } from "../ecs/components";
import { query } from "bitecs";

// Colors for terminal output
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// Test result tracking
let testsPassed = 0;
let testsFailed = 0;

function logTest(name: string, passed: boolean, details?: string) {
  if (passed) {
    testsPassed++;
    console.log(`${c.green}  ✓ ${name}${c.reset}`);
  } else {
    testsFailed++;
    console.log(`${c.red}  ✗ ${name}${c.reset}`);
    if (details) {
      console.log(`${c.dim}    ${details}${c.reset}`);
    }
  }
}

function section(title: string) {
  console.log(`\n${c.bold}${c.cyan}═══ ${title} ═══${c.reset}\n`);
}

// Create a minimal spirit definition for testing
function createTestSpiritDefinition(name: string, domain: string, role: string): SpiritDefinition {
  return {
    name,
    domain: domain as any,
    rank: "angel",
    description: `Test ${role} spirit`,
    watchConfig: {
      componentQueries: [],
      eventTypes: [],
    },
    canInjectEvents: domain === "guardian" || role === "agent_control",
    canModifyMood: domain === "guardian" || role === "agent_control",
    canCreateEntities: false,
    canBakeSystems: role === "system_maintenance" || domain === "systems", // Artificer can bake
    model: "flash",
    systemPrompt: `You are ${name}, a ${role} spirit.`,
    observationInterval: 10000,
  };
}

async function main() {
  console.log(`${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║       SPIRIT TOOLS & MESSAGING TEST                           ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}║       Testing communication & tool separation                 ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════════════╝${c.reset}\n`);

  // ============================================
  // SETUP
  // ============================================
  section("SETUP");

  const world = createArgosWorld();
  initializePrefabs(world);
  const systemRegistry = createSystemRegistry();
  const spiritRegistry = createSpiritRegistry(world);
  const interventionRegistry = createInterventionRegistry();

  // Initialize messaging
  initializeSpiritMessaging(spiritRegistry);
  console.log(`${c.dim}Initialized spirit messaging system${c.reset}`);

  // Create test room and agents
  const roomId = createRoomEntity(world, {
    name: "Test Chamber",
    description: "A sterile testing environment",
    capacity: 10,
    ambience: "quiet",
  });

  const agent1Id = createAgentEntity(world, {
    name: "TestAgent-1",
    role: "test subject",
    systemPrompt: "You are a test agent.",
    description: "A test agent",
    roomId,
  });
  Mind.arousal[agent1Id] = 0.5;

  const agent2Id = createAgentEntity(world, {
    name: "TestAgent-2",
    role: "test subject",
    systemPrompt: "You are another test agent.",
    description: "Another test agent",
    roomId,
  });
  Mind.arousal[agent2Id] = 0.6;

  console.log(`${c.dim}Created test room and 2 agents${c.reset}`);

  // Create test spirits
  const artificerDef = createTestSpiritDefinition("Test-Artificer", "ecology", "system_maintenance");
  const artificer = createSpirit(spiritRegistry, artificerDef);
  console.log(`${c.green}✓ Created Test-Artificer (EID: ${artificer.eid})${c.reset}`);

  const watcherDef = createTestSpiritDefinition("Test-Watcher", "ecology", "monitoring");
  const watcher = createSpirit(spiritRegistry, watcherDef, artificer.eid); // Reports to artificer
  console.log(`${c.green}✓ Created Test-Watcher (EID: ${watcher.eid})${c.reset}`);

  const managerDef = createTestSpiritDefinition("Test-Manager", "guardian", "agent_control");
  const manager = createSpirit(spiritRegistry, managerDef);
  console.log(`${c.green}✓ Created Test-Manager (EID: ${manager.eid})${c.reset}`);

  // ============================================
  // TEST 1: BASIC MESSAGING
  // ============================================
  section("TEST 1: BASIC MESSAGING");

  // Test upward reporting
  const report1 = spiritReport(
    artificer,
    "System Status",
    "All systems nominal",
    { healthyCount: 5, totalSystems: 5 },
    "normal"
  );
  logTest(
    "Spirit can send report to GodAI",
    report1.type === "report" && report1.to === "godai"
  );

  // Check GodAI received it
  const godMessages = getMessagesForGodAI();
  logTest(
    "GodAI received the report",
    godMessages.length === 1 && godMessages[0].subject === "System Status"
  );

  // Test downward directive
  const directive1 = spiritDirective(
    "godai",
    artificer,
    "Priority Repair",
    "Please repair the perception system immediately",
    { systemName: "perception", urgency: "high" }
  );
  logTest(
    "GodAI can send directive to spirit",
    directive1.type === "directive" && directive1.to === artificer.eid
  );

  // Check Artificer received it
  const artificerMessages = getMessagesForSpirit(artificer.eid);
  logTest(
    "Artificer received the directive",
    artificerMessages.length === 1 && artificerMessages[0].subject === "Priority Repair"
  );

  // Test hierarchical reporting (Watcher -> Artificer as superior)
  const report2 = spiritReport(
    watcher,
    "Anomaly Detected",
    "Memory usage spike in room system",
    { metric: "memory", value: 95 }
  );
  const artificerMessages2 = getMessagesForSpirit(artificer.eid);
  logTest(
    "Watcher reports to superior (Artificer)",
    report2.to === artificer.eid && artificerMessages2.length === 1
  );

  // ============================================
  // TEST 2: PEER-TO-PEER MESSAGING
  // ============================================
  section("TEST 2: PEER-TO-PEER MESSAGING");

  // Clear queues for clean test
  spiritRouter.reset();

  // Test alert between peers
  const alert1 = spiritAlert(
    watcher,
    "Critical Issue",
    "Agent-1 health at critical levels",
    { agentEid: agent1Id, health: 10 },
    "guardian" // domain
  );
  logTest(
    "Spirit can broadcast alert to domain",
    alert1.type === "alert" && alert1.priority === "urgent"
  );

  // Test query with request/response simulation
  console.log(`\n${c.dim}Testing request/response pattern...${c.reset}`);

  // Send query from Manager to Watcher (very short timeout since we respond immediately)
  const queryPromise = spiritRouter.query(
    manager,
    watcher,
    "What is the current system health?",
    { includeMetrics: true },
    100 // 100ms timeout (we respond synchronously)
  );

  // Simulate Watcher responding (would normally happen in their cognition cycle)
  const watcherInbox = getMessagesForSpirit(watcher.eid);
  if (watcherInbox.length > 0) {
    const queryMsg = watcherInbox.find(m => m.type === "query");
    if (queryMsg) {
      spiritRespond(queryMsg, watcher, "System health is 95%", { health: 95 });
    }
  }

  // Give event loop a chance to process
  await new Promise(resolve => setTimeout(resolve, 10));

  try {
    const response = await queryPromise;
    logTest(
      "Peer-to-peer query/response works",
      response.content === "System health is 95%" && response.data?.health === 95
    );
  } catch (e) {
    // Note: This may timeout in synchronous tests since there's no cognition loop
    logTest("Peer-to-peer query/response works", false, `${(e as Error).message} (expected in sync test)`);
  }

  // ============================================
  // TEST 3: SUBSCRIPTIONS & EVENTS
  // ============================================
  section("TEST 3: SUBSCRIPTIONS & EVENTS");

  spiritRouter.reset();

  // Subscribe spirits to events
  spiritSubscribe(artificer, "system_error");
  spiritSubscribe(manager, "system_error");
  spiritSubscribe(watcher, "agent_critical");

  logTest(
    "Spirits can subscribe to events",
    true // Subscription doesn't error
  );

  // Emit event (from, eventType, data)
  spiritEmit(watcher, "system_error", { system: "perception", error: "timeout" });

  const artificerSubs = getMessagesForSpirit(artificer.eid);
  const managerSubs = getMessagesForSpirit(manager.eid);
  logTest(
    "Event reaches all subscribers",
    artificerSubs.length === 1 && managerSubs.length === 1
  );

  // Non-subscriber shouldn't get it (watcher emitted it, so doesn't receive)
  spiritRouter.reset();
  spiritSubscribe(artificer, "test_event");
  spiritEmit(watcher, "test_event", { test: true });
  const watcherEvents = getMessagesForSpirit(watcher.eid);
  logTest(
    "Event emitter doesn't receive own event",
    watcherEvents.length === 0
  );

  // ============================================
  // TEST 4: CAPABILITY-BASED ROUTING
  // ============================================
  section("TEST 4: CAPABILITY-BASED ROUTING");

  // Register capabilities
  registerSpiritCapability(artificer, "system_maintenance", 10, "Primary system maintainer");
  registerSpiritCapability(watcher, "monitoring", 5, "System health monitor");
  registerSpiritCapability(manager, "agent_control", 5, "Agent mood/behavior control");

  logTest(
    "Spirits can register capabilities",
    true // Registration doesn't error
  );

  // Find handlers
  const maintenanceHandlers = findCapabilityHandlers("system_maintenance");
  logTest(
    "Can find capability handlers",
    maintenanceHandlers.length === 1 && maintenanceHandlers[0].spiritName === "Test-Artificer"
  );

  // Get best handler
  const bestHandler = getBestCapabilityHandler("system_maintenance");
  logTest(
    "Can get best handler for capability",
    bestHandler?.spiritName === "Test-Artificer" && bestHandler?.priority === 10
  );

  // No handler for unregistered capability
  const noHandler = getBestCapabilityHandler("visual"); // Not registered
  logTest(
    "Returns undefined for unregistered capability",
    noHandler === undefined
  );

  // Route message by capability
  spiritRouter.reset();
  const routedMsg = routeToCapability(
    watcher,
    "system_maintenance",
    "System Help Needed",
    "The perception system is failing"
  );
  logTest(
    "Can route message by capability",
    routedMsg !== undefined && routedMsg.to === artificer.eid
  );

  // Check artificer received it
  const artificerCapabilityMessages = getMessagesForSpirit(artificer.eid);
  logTest(
    "Routed message reaches correct handler",
    artificerCapabilityMessages.length === 1 &&
    artificerCapabilityMessages[0].subject.includes("system_maintenance")
  );

  // Print services registry
  console.log(`\n${c.dim}${getServicesRegistry()}${c.reset}\n`);

  logTest(
    "Services registry summary available",
    getServicesRegistry().includes("Spirit Services Registry")
  );

  // ============================================
  // TEST 5: SPIRIT TOOLS - ARTIFICER
  // ============================================
  section("TEST 5: SPIRIT TOOLS - ARTIFICER");

  const artificerTools = createArtificerTools(world, systemRegistry);

  // Test listSystems tool - returns array directly
  const listResult = await artificerTools.listSystems.execute!({}, { abortSignal: new AbortController().signal } as any);
  const systems = Array.isArray(listResult) ? listResult : [];
  logTest(
    "Artificer can list systems",
    Array.isArray(listResult)
  );

  // Test inspectSystem with non-existent system
  const inspectResult = await artificerTools.inspectSystem.execute!({ systemName: "nonexistent" }, { abortSignal: new AbortController().signal } as any);
  const hasError = typeof inspectResult === "object" && inspectResult !== null && "error" in inspectResult;
  logTest(
    "Artificer handles missing system gracefully",
    hasError
  );

  // Test reportToGodAI tool
  spiritRouter.reset(); // Clear previous messages
  const reportResult = await artificerTools.reportToGodAI.execute!({
    systemName: "test_system",
    issue: "This is a test report from tools",
    recommendation: "No action needed",
    severity: "low",
  }, { abortSignal: new AbortController().signal } as any);
  const reportOk = typeof reportResult === "object" && reportResult !== null && "success" in reportResult;
  logTest(
    "Artificer reportToGodAI tool works",
    reportOk
  );

  // ============================================
  // TEST 6: SPIRIT TOOLS - WATCHER
  // ============================================
  section("TEST 6: SPIRIT TOOLS - WATCHER");

  spiritRouter.reset();

  const watcherTools = createWatcherTools(world, systemRegistry);

  // Test queryAgents - returns array of agents
  const agentsResult = await watcherTools.queryAgents.execute!({}, { abortSignal: new AbortController().signal } as any);
  const agents = Array.isArray(agentsResult) ? agentsResult : [];
  logTest(
    "Watcher can query agents",
    agents.length === 2
  );

  // Test getSystemHealth - returns object with total, active, etc
  const healthResult = await watcherTools.getSystemHealth.execute!({}, { abortSignal: new AbortController().signal } as any);
  const hasTotal = typeof healthResult === "object" && healthResult !== null && "total" in healthResult;
  logTest(
    "Watcher can check system health",
    hasTotal
  );

  // Test reportObservation (the actual tool name)
  spiritRouter.reset();
  const obsResult = await watcherTools.reportObservation.execute!({
    observation: "Test observation - system running normally",
    severity: "low",
  }, { abortSignal: new AbortController().signal } as any);
  const obsOk = typeof obsResult === "object" && obsResult !== null && "success" in obsResult;
  logTest(
    "Watcher can report observations",
    obsOk
  );

  // ============================================
  // TEST 7: SPIRIT TOOLS - MANAGER
  // ============================================
  section("TEST 7: SPIRIT TOOLS - MANAGER");

  spiritRouter.reset();

  const managerTools = createManagerTools(world, systemRegistry);

  // Test modifyAgentMood (uses agentName not agentEid)
  const moodBefore = Mind.arousal[agent1Id];
  const moodResult = await managerTools.modifyAgentMood.execute!({
    agentName: "TestAgent-1",
    arousalDelta: 0.2,
    reason: "Test adjustment",
  }, { abortSignal: new AbortController().signal } as any);
  const moodAfter = Mind.arousal[agent1Id];
  const moodChanged = Math.abs(moodAfter - (moodBefore + 0.2)) < 0.01;
  logTest(
    "Manager can modify agent mood",
    moodChanged
  );

  // Test queryAgents on manager
  const managerAgents = await managerTools.queryAgents.execute!({}, { abortSignal: new AbortController().signal } as any);
  const hasAgents = Array.isArray(managerAgents) && managerAgents.length === 2;
  logTest(
    "Manager can query agents",
    hasAgents
  );

  // ============================================
  // TEST 8: GODAI ORCHESTRATOR TOOLS
  // ============================================
  section("TEST 8: GODAI ORCHESTRATOR TOOLS");

  spiritRouter.reset();

  const narrativeState = {
    tension: 0.5,
    goals: ["Create engaging story"],
    currentBeat: "rising_action",
  };

  const godTools = createOrchestratorTools({
    world,
    systemRegistry,
    interventionRegistry,
    spiritRegistry,
    narrativeState,
  });

  // Test getSpiritHierarchy
  const hierarchyResult = await godTools.getSpiritHierarchy.execute!({}, { abortSignal: new AbortController().signal } as any);
  const hierarchyOk = typeof hierarchyResult === "object" && hierarchyResult !== null &&
                      "success" in hierarchyResult && hierarchyResult.success === true &&
                      "spiritCount" in hierarchyResult && hierarchyResult.spiritCount === 3;
  logTest(
    "GodAI can get spirit hierarchy",
    hierarchyOk
  );

  // Test sendDirectiveToSpirit
  const sendResult = await godTools.sendDirectiveToSpirit.execute!({
    spiritName: "Test-Artificer",
    subject: "Maintenance Check",
    instruction: "Please perform routine maintenance check",
    priority: "normal",
  }, { abortSignal: new AbortController().signal } as any);
  const sendOk = typeof sendResult === "object" && sendResult !== null &&
                 "success" in sendResult && sendResult.success === true;
  logTest(
    "GodAI can send directive via tool",
    sendOk
  );

  // Check artificer received it
  const artificerDirectives = getMessagesForSpirit(artificer.eid);
  logTest(
    "Directive reaches target spirit",
    artificerDirectives.length === 1 && artificerDirectives[0].subject === "Maintenance Check"
  );

  // Test getNarrativeTension
  const tensionResult = await godTools.getNarrativeTension.execute!({}, { abortSignal: new AbortController().signal } as any);
  const tensionOk = typeof tensionResult === "object" && tensionResult !== null &&
                    "tension" in tensionResult && tensionResult.tension === 0.5;
  logTest(
    "GodAI can check narrative tension",
    tensionOk
  );

  // Test getWorldSummary
  const summaryResult = await godTools.getWorldSummary.execute!({}, { abortSignal: new AbortController().signal } as any);
  const summaryOk = typeof summaryResult === "object" && summaryResult !== null &&
                    "summary" in summaryResult && (summaryResult.summary as any).agentCount === 2;
  logTest(
    "GodAI can get world summary",
    summaryOk
  );

  // Test requestSystemRepair (delegation)
  spiritRouter.reset();
  const repairRequest = await godTools.requestSystemRepair.execute!({
    systemName: "perception",
    issue: "Frequent timeouts",
    urgency: "high",
  }, { abortSignal: new AbortController().signal } as any);
  const repairDirectives = getMessagesForSpirit(artificer.eid);
  const delegationWorks = repairDirectives.some(m => m.subject.includes("Repair"));
  logTest(
    "GodAI can delegate repair to Artificer",
    delegationWorks
  );

  // ============================================
  // TEST 9: ROLE SEPARATION VERIFICATION
  // ============================================
  section("TEST 9: ROLE SEPARATION VERIFICATION");

  // Verify tool counts are reasonable
  const artificerToolCount = Object.keys(artificerTools).length;
  const watcherToolCount = Object.keys(watcherTools).length;
  const managerToolCount = Object.keys(managerTools).length;
  const godToolCount = Object.keys(godTools).length;

  logTest(
    `Artificer has focused toolset (${artificerToolCount} tools)`,
    artificerToolCount >= 5 && artificerToolCount <= 15
  );

  logTest(
    `Watcher has focused toolset (${watcherToolCount} tools)`,
    watcherToolCount >= 3 && watcherToolCount <= 10
  );

  logTest(
    `Manager has focused toolset (${managerToolCount} tools)`,
    managerToolCount >= 3 && managerToolCount <= 10
  );

  logTest(
    `GodAI has orchestration toolset (${godToolCount} tools)`,
    godToolCount >= 10 && godToolCount <= 35
  );

  // Verify GodAI doesn't have low-level tools (direct system modification)
  const godToolNames = Object.keys(godTools);
  const hasDirectRepair = godToolNames.includes("repairSystem") || godToolNames.includes("modifySystem");
  logTest(
    "GodAI doesn't have direct repair tools (delegates instead)",
    !hasDirectRepair
  );

  // Verify spirits don't have orchestration tools
  const artificerToolNames = Object.keys(artificerTools);
  const hasOrchestrationTools = artificerToolNames.some(name =>
    name === "getSpiritHierarchy" || name === "sendDirectiveToSpirit" || name === "setNarrativeGoals"
  );
  logTest(
    "Spirits don't have orchestration tools",
    !hasOrchestrationTools
  );

  // ============================================
  // TEST 10: MESSAGE ROUTING SUMMARY
  // ============================================
  section("TEST 10: MESSAGE ROUTING SUMMARY");

  // Reset and run a full communication cycle
  spiritRouter.reset();

  // 1. GodAI sends directive
  spiritDirective("godai", artificer, "Check All Systems", "Perform full system check");

  // 2. Artificer reports back
  spiritReport(artificer, "System Check Complete", "All systems operational", { healthy: 5, total: 5 });

  // 3. Watcher sends alert
  spiritAlert(watcher, "Agent Alert", "Agent-1 needs attention", { agentEid: agent1Id });

  // 4. Manager sends simple message
  spiritRouter.send({
    type: "query",
    from: manager.eid,
    fromName: manager.definition.name,
    to: watcher.eid,
    toName: watcher.definition.name,
    subject: "Status Query",
    content: "What is agent-1's current state?",
    priority: "normal",
  });

  const routingSummary = spiritRouter.getSummary();
  console.log(`\n${c.dim}${routingSummary}${c.reset}\n`);

  logTest(
    "Message routing summary available",
    routingSummary.includes("Spirit Messaging Summary")
  );

  // ============================================
  // FINAL RESULTS
  // ============================================
  console.log(`\n${c.bold}═══════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  TEST RESULTS${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════════════${c.reset}\n`);

  const totalTests = testsPassed + testsFailed;
  const passRate = ((testsPassed / totalTests) * 100).toFixed(1);

  console.log(`${c.green}  Passed: ${testsPassed}${c.reset}`);
  console.log(`${c.red}  Failed: ${testsFailed}${c.reset}`);
  console.log(`${c.bold}  Total:  ${totalTests}${c.reset}`);
  console.log(`${c.bold}  Rate:   ${passRate}%${c.reset}\n`);

  if (testsFailed === 0) {
    console.log(`${c.bold}${c.green}✅ ALL TESTS PASSED!${c.reset}\n`);
  } else {
    console.log(`${c.bold}${c.yellow}⚠️  SOME TESTS FAILED (may be expected for integration tests)${c.reset}\n`);
  }
}

main().catch(console.error);
