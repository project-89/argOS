/**
 * Behavioral Test: Enhanced Cognition System
 *
 * Tests the new cognitive architecture:
 * - Enhanced Memory (working, episodic, semantic, procedural, autobiographical)
 * - Extended Reasoning (multi-step thinking with tools)
 * - Research Agent (sustained investigation)
 * - Task Queue (explicit task management)
 * - Cognitive Mode Switching
 *
 * Run with: npx tsx src/behavioral-tests/05-enhanced-cognition.ts
 */

import "dotenv/config";
import {
  createMemoryStore,
  addToWorkingMemory,
  addEpisodicMemory,
  addSemanticMemory,
  addProceduralMemory,
  addAutobiographicalMemory,
  recallEpisodicMemories,
  querySemanticMemory,
  findRelevantSkill,
  consolidateMemories,
  generateMemoryContext,
  getMemoryStoreSummary,
  formatWorkingMemoryForPrompt,
  clearWorkingMemory,
  type AgentMemoryStore,
} from "../cognition/enhanced-memory";
import {
  executeExtendedReasoning,
  executeQuickReasoning,
  createReasoningTask,
  getReasoningResultSummary,
} from "../cognition/extended-reasoning";
import {
  createResearchProject,
  executeResearchCycle,
  analyzeAndConclude,
  quickResearch,
  getAgentMemoryStore,
  getProjectSummary,
} from "../cognition/research-agent";
import {
  getTaskQueue,
  createTask,
  getNextTask,
  startTask,
  completeTask,
  failTask,
  updateTaskProgress,
  completeSubtask,
  generateTasksFromGoal,
  formatTaskQueueForPrompt,
  getTaskQueueSummary,
  checkDeadlines,
  delegateTask,
} from "../cognition/task-queue";
import {
  initializeEnhancedAgent,
  getEnhancedAgentState,
  setCognitiveMode,
  runEnhancedCognition,
  assignGoal,
  getEnhancedAgentStatus,
  initializeEnhancedAgentSystem,
} from "../cognition/enhanced-agent";

// =============================================================================
// TEST UTILITIES
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<{ passed: boolean; details: string }>
): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log("=".repeat(60));

  const start = Date.now();
  try {
    const result = await testFn();
    const duration = Date.now() - start;

    results.push({
      name,
      passed: result.passed,
      duration,
      details: result.details,
    });

    console.log(`\n${result.passed ? "✅ PASSED" : "❌ FAILED"} (${duration}ms)`);
    console.log(result.details);
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);

    results.push({
      name,
      passed: false,
      duration,
      details: "Test threw an exception",
      error: errorMsg,
    });

    console.log(`\n❌ ERROR (${duration}ms)`);
    console.log(`Error: ${errorMsg}`);
  }
}

function printSummary(): void {
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  for (const result of results) {
    const status = result.passed ? "✅" : "❌";
    console.log(`${status} ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  console.log("\n" + "-".repeat(60));
  console.log(`Total: ${passed} passed, ${failed} failed`);
  console.log(`Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log("=".repeat(60));
}

// =============================================================================
// TEST 1: ENHANCED MEMORY SYSTEM
// =============================================================================

async function testEnhancedMemory(): Promise<{ passed: boolean; details: string }> {
  const store = createMemoryStore();
  const details: string[] = [];
  let allPassed = true;

  // Test 1.1: Working Memory
  details.push("\n--- Working Memory ---");
  const taskId = "task_test_1";

  addToWorkingMemory(store, taskId, "note", "Starting investigation into market trends");
  addToWorkingMemory(store, taskId, "finding", "Q3 growth was 15% higher than expected");
  addToWorkingMemory(store, taskId, "hypothesis", "Growth driven by new product launch");
  addToWorkingMemory(store, taskId, "question", "What was the marketing spend in Q3?");
  addToWorkingMemory(store, taskId, "conclusion", "Product launch was primary growth driver");

  const workingMem = formatWorkingMemoryForPrompt(store, taskId);
  details.push(`Working memory items: ${store.workingMemory.length}`);
  details.push(`Formatted output has sections: ${workingMem.includes("Conclusions") && workingMem.includes("Findings")}`);

  if (store.workingMemory.length !== 5) {
    allPassed = false;
    details.push("❌ Working memory count mismatch");
  }

  // Test 1.2: Episodic Memory
  details.push("\n--- Episodic Memory ---");

  addEpisodicMemory(store, {
    timestamp: Date.now() - 86400000, // Yesterday
    location: "office",
    participants: ["Alice", "Bob"],
    event: "Had a productive meeting about the project",
    myRole: "Presented the quarterly results",
    emotionalImpact: 0.6,
    importance: 0.8,
  });

  addEpisodicMemory(store, {
    timestamp: Date.now() - 172800000, // 2 days ago
    location: "cafe",
    participants: ["Alice"],
    event: "Casual coffee chat about career goals",
    myRole: "Shared my aspirations for promotion",
    emotionalImpact: 0.4,
    importance: 0.5,
  });

  addEpisodicMemory(store, {
    timestamp: Date.now(),
    location: "office",
    participants: ["Charlie"],
    event: "Received critical feedback on my work",
    myRole: "Listened and took notes",
    emotionalImpact: -0.3,
    importance: 0.7,
  });

  // Recall by person
  const aliceMemories = recallEpisodicMemories(store, { person: "Alice" }, 5);
  details.push(`Memories involving Alice: ${aliceMemories.length}`);
  if (aliceMemories.length !== 2) {
    allPassed = false;
    details.push("❌ Episodic recall by person failed");
  }

  // Recall by location
  const officeMemories = recallEpisodicMemories(store, { location: "office" }, 5);
  details.push(`Memories at office: ${officeMemories.length}`);

  // Test 1.3: Semantic Memory
  details.push("\n--- Semantic Memory ---");

  addSemanticMemory(store, {
    category: "fact",
    subject: "Alice",
    content: "Alice is the project manager",
    confidence: 0.9,
    sources: ["direct_observation"],
  });

  addSemanticMemory(store, {
    category: "relationship",
    subject: "Alice",
    predicate: "reports_to",
    object: "CEO",
    content: "Alice reports directly to the CEO",
    confidence: 0.8,
    sources: ["org_chart"],
  });

  addSemanticMemory(store, {
    category: "fact",
    subject: "quarterly_results",
    content: "Q3 revenue was $2.5M",
    confidence: 0.95,
    sources: ["financial_report"],
  });

  // Query semantic memory
  const aliceFacts = querySemanticMemory(store, { subject: "Alice" }, 5);
  details.push(`Facts about Alice: ${aliceFacts.length}`);
  if (aliceFacts.length !== 2) {
    allPassed = false;
    details.push("❌ Semantic query failed");
  }

  // Test 1.4: Procedural Memory
  details.push("\n--- Procedural Memory ---");

  addProceduralMemory(store, {
    skill: "presenting_quarterly_results",
    context: "When asked to present financial results",
    steps: ["Gather data from reports", "Create slides", "Practice delivery", "Present to stakeholders"],
    conditions: ["have_financial_data", "meeting_scheduled"],
    successRate: 0.85,
  });

  const relevantSkill = findRelevantSkill(store, "I need to present the quarterly results");
  details.push(`Found relevant skill: ${relevantSkill?.skill || "none"}`);
  if (!relevantSkill || relevantSkill.skill !== "presenting_quarterly_results") {
    allPassed = false;
    details.push("❌ Procedural memory recall failed");
  }

  // Test 1.5: Autobiographical Memory
  details.push("\n--- Autobiographical Memory ---");

  addAutobiographicalMemory(store, {
    theme: "achievement",
    narrative: "I successfully led my first major project to completion, earning recognition from leadership",
    significance: "Proved my capability as a leader",
    emotionalCore: "pride",
    linkedMemories: [],
  });

  details.push(`Autobiographical memories: ${store.autobiographicalMemories.length}`);

  // Test 1.6: Memory Consolidation
  details.push("\n--- Memory Consolidation ---");

  const consolidationResult = consolidateMemories(store);
  details.push(`Consolidation: ${consolidationResult.decayed} decayed, ${consolidationResult.strengthened} strengthened, ${consolidationResult.patternsFound} patterns`);

  // Test 1.7: Context Generation
  details.push("\n--- Context Generation ---");

  const context = generateMemoryContext(store, {
    currentLocation: "office",
    peoplePresent: ["Alice"],
    topic: "quarterly_results",
  });
  details.push(`Context generated: ${context.length} chars`);
  details.push(`Contains relevant memories: ${context.includes("Alice") && context.includes("quarterly")}`);

  // Summary
  details.push("\n--- Summary ---");
  details.push(getMemoryStoreSummary(store));

  // Clear working memory
  const cleared = clearWorkingMemory(store, taskId, true);
  details.push(`Cleared ${cleared.cleared} items, consolidated ${cleared.consolidated}`);

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// TEST 2: EXTENDED REASONING
// =============================================================================

async function testExtendedReasoning(): Promise<{ passed: boolean; details: string }> {
  const details: string[] = [];
  let allPassed = true;

  const memoryStore = createMemoryStore();
  const agentContext = `You are a business analyst named Alex.
You work at a tech startup and are known for thorough analysis.
You have access to company data and market research.`;

  // Test 2.1: Quick Reasoning
  details.push("\n--- Quick Reasoning ---");

  const quickResult = await executeQuickReasoning(
    "What factors should I consider when evaluating a new market opportunity?",
    agentContext,
    memoryStore
  );

  details.push(`Quick reasoning answer length: ${quickResult.answer.length} chars`);
  details.push(`Confidence: ${(quickResult.confidence * 100).toFixed(0)}%`);

  if (quickResult.confidence < 0.5) {
    allPassed = false;
    details.push("❌ Quick reasoning confidence too low");
  }

  // Test 2.2: Extended Reasoning (Problem Solving)
  details.push("\n--- Extended Reasoning: Problem Solving ---");

  const problemTask = createReasoningTask(
    1, // agentEid
    "problem_solving",
    "Our customer churn rate increased by 20% last quarter. What could be causing this and how should we investigate?",
    agentContext,
    { maxSteps: 5 }
  );

  const problemResult = await executeExtendedReasoning(
    problemTask,
    memoryStore,
    agentContext,
    { maxSteps: 5, enableToolUse: true, enableSelfReflection: true }
  );

  details.push(`Steps taken: ${problemResult.steps.length}`);
  details.push(`Findings: ${problemResult.findings.length}`);
  details.push(`Confidence: ${(problemResult.confidence * 100).toFixed(0)}%`);
  details.push(`Time: ${(problemResult.timeElapsed / 1000).toFixed(1)}s`);

  if (problemResult.steps.length === 0) {
    allPassed = false;
    details.push("❌ No reasoning steps generated");
  }

  // Show reasoning chain
  details.push("\nReasoning Chain:");
  for (const step of problemResult.steps.slice(0, 5)) {
    details.push(`  ${step.stepNumber}. [${step.type}] ${step.content.slice(0, 100)}...`);
  }

  if (problemResult.conclusion) {
    details.push(`\nConclusion: ${problemResult.conclusion.slice(0, 200)}...`);
  }

  // Test 2.3: Extended Reasoning (Analysis)
  details.push("\n--- Extended Reasoning: Analysis ---");

  const analysisTask = createReasoningTask(
    1,
    "analysis",
    "Compare the pros and cons of expanding into the European market vs the Asian market",
    agentContext,
    { maxSteps: 6 }
  );

  const analysisResult = await executeExtendedReasoning(
    analysisTask,
    memoryStore,
    agentContext,
    { maxSteps: 6, enableToolUse: false, enableSelfReflection: true }
  );

  details.push(`Analysis steps: ${analysisResult.steps.length}`);
  details.push(`Suggested actions: ${analysisResult.suggestedActions.length}`);

  if (analysisResult.suggestedActions.length > 0) {
    details.push("\nSuggested Actions:");
    for (const action of analysisResult.suggestedActions) {
      details.push(`  - ${action}`);
    }
  }

  // Check memory was updated
  const storedFacts = querySemanticMemory(memoryStore, { category: "fact" }, 10);
  details.push(`\nFacts stored in memory: ${storedFacts.length}`);

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// TEST 3: RESEARCH AGENT
// =============================================================================

async function testResearchAgent(): Promise<{ passed: boolean; details: string }> {
  const details: string[] = [];
  let allPassed = true;

  const agentEid = 100;
  const agentContext = `You are a market research analyst.
You specialize in technology sector analysis.
You have access to public market data and industry reports.`;

  // Test 3.1: Create Research Project
  details.push("\n--- Create Research Project ---");

  const project = await createResearchProject(
    agentEid,
    "Analyze the competitive landscape for AI-powered productivity tools",
    agentContext,
    { maxQuestions: 5, maxTotalTokens: 20000 }
  );

  details.push(`Project: ${project.title}`);
  details.push(`Questions generated: ${project.questions.length}`);

  if (project.questions.length === 0) {
    allPassed = false;
    details.push("❌ No research questions generated");
  } else {
    details.push("\nResearch Questions:");
    for (const q of project.questions) {
      details.push(`  [${q.priority}] ${q.question}`);
    }
  }

  // Test 3.2: Execute Research Cycles
  details.push("\n--- Execute Research Cycles ---");

  let cycles = 0;
  const maxCycles = 3;

  while (cycles < maxCycles && project.status !== "analyzing" && project.status !== "concluded") {
    const cycleResult = await executeResearchCycle(
      project,
      agentContext,
      [], // No tools for this test
      { maxReasoningDepth: 3 }
    );

    cycles++;
    details.push(`Cycle ${cycles}: ${cycleResult.questionsAnswered} answered, ${cycleResult.findingsAdded} findings`);

    if (!cycleResult.progress) break;
  }

  details.push(`\nTotal cycles: ${cycles}`);
  details.push(`Questions answered: ${project.questions.filter(q => q.status === "answered").length}/${project.questions.length}`);
  details.push(`Total findings: ${project.findings.length}`);

  // Test 3.3: Analyze and Conclude
  details.push("\n--- Analyze and Conclude ---");

  const { report, confidence } = await analyzeAndConclude(project, agentContext);

  details.push(`Report generated: ${report.length} chars`);
  details.push(`Final confidence: ${(confidence * 100).toFixed(0)}%`);

  if (report.length < 100) {
    allPassed = false;
    details.push("❌ Report too short");
  }

  // Show report excerpt
  details.push("\nReport Excerpt:");
  const lines = report.split("\n").slice(0, 15);
  for (const line of lines) {
    details.push(`  ${line}`);
  }

  // Test 3.4: Quick Research
  details.push("\n--- Quick Research ---");

  const quickResult = await quickResearch(
    agentEid,
    "What are the main competitors in the AI productivity space?",
    agentContext
  );

  details.push(`Quick answer: ${quickResult.answer.slice(0, 150)}...`);
  details.push(`Confidence: ${(quickResult.confidence * 100).toFixed(0)}%`);

  // Check memory store
  const memoryStore = getAgentMemoryStore(agentEid);
  details.push(`\nMemory after research: ${memoryStore.semanticMemories.length} facts stored`);

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// TEST 4: TASK QUEUE
// =============================================================================

async function testTaskQueue(): Promise<{ passed: boolean; details: string }> {
  const details: string[] = [];
  let allPassed = true;

  const agentEid = 200;

  // Test 4.1: Create Tasks
  details.push("\n--- Create Tasks ---");

  const task1 = createTask(agentEid, {
    title: "Review quarterly report",
    description: "Review and approve the Q3 financial report",
    type: "action",
    priority: "high",
    importance: 0.8,
    urgency: 0.7,
    deadline: Date.now() + 86400000, // Tomorrow
    subtasks: [
      { id: "st1", title: "Read executive summary", completed: false },
      { id: "st2", title: "Check financial figures", completed: false },
      { id: "st3", title: "Write approval memo", completed: false },
    ],
  });

  const task2 = createTask(agentEid, {
    title: "Prepare presentation",
    description: "Create slides for the board meeting",
    type: "creation",
    priority: "medium",
    importance: 0.6,
    urgency: 0.5,
    blockedBy: [task1.id], // Depends on task1
  });

  const task3 = createTask(agentEid, {
    title: "Research competitor pricing",
    description: "Investigate competitor pricing strategies",
    type: "research",
    priority: "low",
    importance: 0.5,
    urgency: 0.3,
  });

  details.push(`Created 3 tasks`);
  details.push(`Task 2 blocked by: ${task2.blockedBy?.join(", ")}`);

  // Test 4.2: Task Prioritization
  details.push("\n--- Task Prioritization ---");

  const nextTask = getNextTask(agentEid);
  details.push(`Next task: ${nextTask?.title || "none"}`);

  if (nextTask?.id !== task1.id) {
    allPassed = false;
    details.push("❌ Wrong task prioritized");
  }

  // Test 4.3: Task Execution Flow
  details.push("\n--- Task Execution Flow ---");

  // Start the task
  startTask(agentEid, task1.id);
  details.push(`Started: ${task1.title}`);

  // Complete subtasks
  completeSubtask(agentEid, task1.id, "st1", "Summary reviewed");
  completeSubtask(agentEid, task1.id, "st2", "Figures verified");

  const updated = updateTaskProgress(agentEid, task1.id, 66, "Two subtasks done");
  details.push(`Progress: ${updated?.progress}%`);

  completeSubtask(agentEid, task1.id, "st3", "Memo written");

  // Complete the task
  const completed = completeTask(agentEid, task1.id, "Report approved with minor corrections", "Always check footnotes");
  details.push(`Completed: ${completed?.title}`);
  details.push(`Lessons learned: ${completed?.lessonsLearned}`);

  // Test 4.4: Dependency Resolution
  details.push("\n--- Dependency Resolution ---");

  const nextAfterComplete = getNextTask(agentEid);
  details.push(`Next task after completing blocker: ${nextAfterComplete?.title || "none"}`);

  if (nextAfterComplete?.id !== task2.id) {
    allPassed = false;
    details.push("❌ Blocked task not unblocked");
  }

  // Test 4.5: Generate Tasks from Goal
  details.push("\n--- Generate Tasks from Goal ---");

  const generatedTasks = await generateTasksFromGoal(
    agentEid,
    "Launch a new product feature by end of month",
    "I am a product manager at a software company",
    5
  );

  details.push(`Generated ${generatedTasks.length} tasks from goal`);
  for (const task of generatedTasks) {
    details.push(`  [${task.priority}] ${task.title}`);
  }

  // Test 4.6: Deadline Checking
  details.push("\n--- Deadline Checking ---");

  // Create an overdue task
  createTask(agentEid, {
    title: "Overdue task",
    description: "This task is overdue",
    type: "action",
    priority: "low",
    importance: 0.5,
    urgency: 0.5,
    deadline: Date.now() - 3600000, // 1 hour ago
  });

  const overdue = checkDeadlines(agentEid);
  details.push(`Overdue tasks: ${overdue.length}`);
  if (overdue.length > 0) {
    details.push(`Escalated to: ${overdue[0].priority}`);
  }

  // Test 4.7: Task Delegation
  details.push("\n--- Task Delegation ---");

  const agentEid2 = 201;
  const delegated = delegateTask(agentEid, task3.id, agentEid2);
  details.push(`Delegated "${task3.title}" to agent ${agentEid2}`);

  const queue2 = getTaskQueue(agentEid2);
  details.push(`Agent ${agentEid2} now has ${queue2.tasks.length} task(s)`);

  // Summary
  details.push("\n--- Summary ---");
  details.push(getTaskQueueSummary(agentEid));
  details.push("\nFormatted for prompt:");
  details.push(formatTaskQueueForPrompt(agentEid));

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// TEST 5: INTEGRATED ENHANCED AGENT
// =============================================================================

async function testEnhancedAgentIntegration(): Promise<{ passed: boolean; details: string }> {
  const details: string[] = [];
  let allPassed = true;

  // Initialize system
  initializeEnhancedAgentSystem();
  details.push("Enhanced agent system initialized");

  const agentEid = 300;

  // Test 5.1: Initialize Agent
  details.push("\n--- Initialize Agent ---");

  const state = initializeEnhancedAgent(agentEid);
  details.push(`Agent ${agentEid} initialized`);
  details.push(`Initial mode: ${state.mode}`);

  // Test 5.2: Assign Goal
  details.push("\n--- Assign Goal ---");

  const tasks = await assignGoal(
    agentEid,
    "Prepare and deliver a compelling presentation on Q3 results to the board",
    "I am the CFO of a mid-size technology company. I am analytical, detail-oriented, and value clear communication."
  );

  details.push(`Goal decomposed into ${tasks.length} tasks`);
  for (const task of tasks.slice(0, 5)) {
    details.push(`  - ${task.title} [${task.priority}]`);
  }

  const updatedState = getEnhancedAgentState(agentEid);
  details.push(`Mode after goal assignment: ${updatedState?.mode}`);

  // Test 5.3: Run Cognition Cycle
  details.push("\n--- Run Cognition Cycle ---");

  const cognitiveInput = {
    perceptions: [
      "Alice enters the office and greets you",
      "Your calendar shows a board meeting in 2 hours",
      "A notification pops up on your computer about updated financial data",
    ],
    currentLocation: "executive_office",
    peoplePresent: ["Alice"],
    availableObjects: [
      { type: "computer", state: ["powered_on"], entityId: 10 },
      { type: "smartphone", state: ["powered_on"], entityId: 11 },
    ],
    worldContext: "It is Monday morning. The quarterly board meeting is scheduled for this afternoon.",
    agentPersonality: "Analytical, detail-oriented CFO who values preparation and clear communication.",
  };

  const output = await runEnhancedCognition(agentEid, cognitiveInput);

  details.push(`Action decided: ${output.action?.type || "none"}`);
  if (output.action?.content) {
    details.push(`  Content: ${output.action.content.slice(0, 100)}...`);
  }
  if (output.action?.target) {
    details.push(`  Target: ${output.action.target}`);
  }
  details.push(`Thoughts: ${output.thoughts.length}`);
  for (const thought of output.thoughts) {
    details.push(`  - ${thought}`);
  }
  details.push(`Memory updates: ${output.memoryUpdates}`);
  if (output.modeSwitch) {
    details.push(`Mode switched to: ${output.modeSwitch}`);
  }

  // Test 5.4: Mode Switching
  details.push("\n--- Mode Switching ---");

  setCognitiveMode(agentEid, "focused", "Analyzing financial discrepancy");
  const focusedState = getEnhancedAgentState(agentEid);
  details.push(`Mode set to: ${focusedState?.mode} (${focusedState?.currentFocus})`);

  // Run another cycle in focused mode
  const focusedOutput = await runEnhancedCognition(agentEid, {
    ...cognitiveInput,
    perceptions: ["You notice a discrepancy in the Q3 revenue figures"],
  });

  details.push(`Focused mode action: ${focusedOutput.action?.type || "none"}`);

  // Test 5.5: Memory Persistence
  details.push("\n--- Memory Persistence ---");

  const memoryStore = state.memoryStore;
  details.push(`Episodic memories: ${memoryStore.episodicMemories.length}`);
  details.push(`Semantic memories: ${memoryStore.semanticMemories.length}`);

  // Recall recent memories
  const recentMemories = recallEpisodicMemories(memoryStore, { location: "executive_office" }, 3);
  details.push(`Recent office memories: ${recentMemories.length}`);

  // Test 5.6: Full Status
  details.push("\n--- Full Agent Status ---");
  details.push(getEnhancedAgentStatus(agentEid));

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// TEST 6: STRESS TEST - SUSTAINED OPERATION
// =============================================================================

async function testSustainedOperation(): Promise<{ passed: boolean; details: string }> {
  const details: string[] = [];
  let allPassed = true;

  const agentEid = 400;
  initializeEnhancedAgent(agentEid);

  details.push("Running sustained operation test (10 cycles)...");

  const locations = ["office", "meeting_room", "cafeteria", "lobby"];
  const people = ["Alice", "Bob", "Charlie", "Diana", "Eve"];

  for (let cycle = 1; cycle <= 10; cycle++) {
    const location = locations[cycle % locations.length];
    const presentPeople = people.slice(0, (cycle % 3) + 1);

    const output = await runEnhancedCognition(agentEid, {
      perceptions: [
        `Cycle ${cycle}: You are in the ${location}`,
        `${presentPeople.join(" and ")} ${presentPeople.length > 1 ? "are" : "is"} nearby`,
      ],
      currentLocation: location,
      peoplePresent: presentPeople,
      availableObjects: [],
      worldContext: `Simulation cycle ${cycle}`,
      agentPersonality: "A curious and observant office worker",
    });

    details.push(`Cycle ${cycle}: ${output.action?.type || "no action"}, ${output.memoryUpdates} memory updates`);
  }

  // Check memory accumulation
  const state = getEnhancedAgentState(agentEid);
  if (state) {
    details.push(`\nAfter 10 cycles:`);
    details.push(`- Episodic memories: ${state.memoryStore.episodicMemories.length}`);
    details.push(`- Semantic memories: ${state.memoryStore.semanticMemories.length}`);

    // Run consolidation
    const consolidation = consolidateMemories(state.memoryStore);
    details.push(`\nConsolidation: ${consolidation.patternsFound} patterns found`);

    if (state.memoryStore.episodicMemories.length < 5) {
      allPassed = false;
      details.push("❌ Too few episodic memories accumulated");
    }
  }

  return {
    passed: allPassed,
    details: details.join("\n"),
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("\n" + "╔" + "═".repeat(58) + "╗");
  console.log("║" + " Enhanced Cognition Behavioral Tests ".padStart(40).padEnd(58) + "║");
  console.log("╚" + "═".repeat(58) + "╝");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Run tests
  await runTest("1. Enhanced Memory System", testEnhancedMemory);
  await runTest("2. Extended Reasoning", testExtendedReasoning);
  await runTest("3. Research Agent", testResearchAgent);
  await runTest("4. Task Queue", testTaskQueue);
  await runTest("5. Integrated Enhanced Agent", testEnhancedAgentIntegration);
  await runTest("6. Sustained Operation (10 cycles)", testSustainedOperation);

  // Print summary
  printSummary();

  // Exit with appropriate code
  const failed = results.filter(r => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
