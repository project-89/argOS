/**
 * Enhanced Agent System
 *
 * Integrates all cognitive upgrades into a unified enhanced agent capability:
 * - Enhanced Memory (working, episodic, semantic, procedural, autobiographical)
 * - Extended Reasoning (multi-step thinking with tools)
 * - Research Agent (sustained investigation)
 * - Task Queue (explicit todo management)
 * - Tool-Object Integration (MCP tools via physical objects)
 *
 * This creates agents capable of:
 * - Long-range problem solving
 * - Deep research
 * - Persistent memory across sessions
 * - Explicit task management
 * - Tool use through physical objects
 */

import type { World } from "../ecs/world";
import { Name, Mind } from "../ecs/components";
import {
  type AgentMemoryStore,
  createMemoryStore,
  generateMemoryContext,
  consolidateMemories,
  getMemoryStoreSummary,
  addEpisodicMemory,
  addSemanticMemory,
  addProceduralMemory,
  addAutobiographicalMemory,
  recallEpisodicMemories,
  querySemanticMemory,
  findRelevantSkill,
} from "./enhanced-memory";
import {
  executeExtendedReasoning,
  executeQuickReasoning,
  createReasoningTask,
  getReasoningResultSummary,
  type ReasoningResult,
  type ReasoningConfig,
} from "./extended-reasoning";
import {
  getAgentMemoryStore,
  runResearchProject,
  quickResearch,
  getActiveProjects,
  getResearchAgentStatus,
  type ResearchProject,
} from "./research-agent";
import {
  getTaskQueue,
  createTask,
  getNextTask,
  startTask,
  completeTask,
  failTask,
  updateTaskProgress,
  generateTasksFromGoal,
  formatTaskQueueForPrompt,
  getTaskQueueSummary,
  checkDeadlines,
  type Task,
} from "./task-queue";
import {
  getAgentAvailableTools,
  formatToolsForPrompt,
  initializeStandardInterfaces,
  type ToolBinding,
} from "../world/affordance-tools";

// =============================================================================
// ENHANCED AGENT STATE
// =============================================================================

export interface EnhancedAgentState {
  eid: number;
  memoryStore: AgentMemoryStore;
  mode: "reactive" | "focused" | "research" | "planning";
  currentFocus?: string;
  activeResearchProject?: string;
  cognitiveLoad: number; // 0-1
  lastConsolidation: number;
}

const enhancedAgents = new Map<number, EnhancedAgentState>();

/**
 * Initialize an agent with enhanced cognitive capabilities
 */
export function initializeEnhancedAgent(eid: number): EnhancedAgentState {
  let state = enhancedAgents.get(eid);
  if (state) return state;

  state = {
    eid,
    memoryStore: getAgentMemoryStore(eid), // Uses research-agent's store
    mode: "reactive",
    cognitiveLoad: 0,
    lastConsolidation: Date.now(),
  };

  enhancedAgents.set(eid, state);
  console.log(`[EnhancedAgent] Initialized agent ${eid} with enhanced cognition`);

  return state;
}

/**
 * Get enhanced agent state
 */
export function getEnhancedAgentState(eid: number): EnhancedAgentState | null {
  return enhancedAgents.get(eid) || null;
}

// =============================================================================
// COGNITIVE MODE MANAGEMENT
// =============================================================================

/**
 * Set agent's cognitive mode
 */
export function setCognitiveMode(
  eid: number,
  mode: EnhancedAgentState["mode"],
  focus?: string
): void {
  const state = enhancedAgents.get(eid);
  if (!state) return;

  state.mode = mode;
  state.currentFocus = focus;

  console.log(`[EnhancedAgent] Agent ${eid} mode: ${mode}${focus ? ` (${focus})` : ""}`);
}

/**
 * Determine appropriate cognitive mode based on context
 */
export function determineCognitiveMode(
  eid: number,
  stimulus: { type: string; complexity: number; urgency: number }
): EnhancedAgentState["mode"] {
  const state = enhancedAgents.get(eid);
  if (!state) return "reactive";

  // Check if already in a focused mode
  if (state.mode === "research" && state.activeResearchProject) {
    return "research"; // Continue research
  }

  // High complexity → extended reasoning
  if (stimulus.complexity > 0.7) {
    return "focused";
  }

  // Active tasks → planning mode
  const queue = getTaskQueue(eid);
  if (queue.tasks.filter(t => t.status === "in_progress").length > 0) {
    return "planning";
  }

  // Default
  return "reactive";
}

// =============================================================================
// UNIFIED COGNITION CYCLE
// =============================================================================

export interface CognitiveInput {
  perceptions: string[];
  currentLocation: string;
  peoplePresent: string[];
  availableObjects: Array<{ type: string; state?: string[]; entityId: number }>;
  worldContext: string;
  agentPersonality: string;
}

export interface CognitiveOutput {
  action: {
    type: string;
    target?: string;
    content?: string;
  } | null;
  thoughts: string[];
  memoryUpdates: number;
  modeSwitch?: EnhancedAgentState["mode"];
}

/**
 * Run enhanced cognition cycle
 * This replaces or augments the standard cognition cycle with deeper capabilities
 */
export async function runEnhancedCognition(
  eid: number,
  input: CognitiveInput
): Promise<CognitiveOutput> {
  const state = initializeEnhancedAgent(eid);
  const thoughts: string[] = [];
  let memoryUpdates = 0;

  // 1. Periodic memory consolidation
  const timeSinceConsolidation = Date.now() - state.lastConsolidation;
  if (timeSinceConsolidation > 60000) { // Every minute
    const result = consolidateMemories(state.memoryStore);
    state.lastConsolidation = Date.now();
    memoryUpdates += result.patternsFound;
  }

  // 2. Check deadlines and escalate if needed
  const overdue = checkDeadlines(eid);
  if (overdue.length > 0) {
    thoughts.push(`Warning: ${overdue.length} overdue task(s)!`);
    setCognitiveMode(eid, "planning", "deadline management");
  }

  // 3. Get available tools from objects
  const availableTools = getAgentAvailableTools(input.availableObjects);

  // 4. Generate memory context
  const memoryContext = generateMemoryContext(state.memoryStore, {
    currentLocation: input.currentLocation,
    currentTask: getNextTask(eid)?.id,
    peoplePresent: input.peoplePresent,
    topic: state.currentFocus,
  });

  // 5. Mode-specific processing
  let action: CognitiveOutput["action"] = null;

  switch (state.mode) {
    case "research": {
      // Continue research project
      const projects = getActiveProjects(eid);
      const activeProject = projects.find(p => p.id === state.activeResearchProject);

      if (activeProject && activeProject.status !== "concluded") {
        thoughts.push(`Continuing research: ${activeProject.title}`);
        // Research processing would happen here
        // For now, just note we're researching
        action = {
          type: "think",
          content: `Researching: ${activeProject.objective}`,
        };
      } else {
        // Research done, return to reactive
        setCognitiveMode(eid, "reactive");
      }
      break;
    }

    case "focused": {
      // Extended reasoning mode
      if (state.currentFocus) {
        const task = createReasoningTask(
          eid,
          "problem_solving",
          state.currentFocus,
          `${input.worldContext}\n\n${memoryContext}`
        );

        const result = await executeExtendedReasoning(
          task,
          state.memoryStore,
          input.agentPersonality,
          { maxSteps: 5, enableToolUse: availableTools.length > 0 }
        );

        thoughts.push(`Reasoning complete: ${result.conclusion}`);
        memoryUpdates += result.findings.length;

        // Convert conclusion to action
        if (result.suggestedActions.length > 0) {
          action = parseActionFromSuggestion(result.suggestedActions[0]);
        }

        // Return to reactive after focused thinking
        setCognitiveMode(eid, "reactive");
      }
      break;
    }

    case "planning": {
      // Task-oriented mode
      const currentTask = getNextTask(eid);

      if (currentTask) {
        if (currentTask.status === "pending") {
          startTask(eid, currentTask.id);
          thoughts.push(`Starting task: ${currentTask.title}`);
        }

        // Generate action for current task
        action = await generateActionForTask(
          eid,
          currentTask,
          input,
          state.memoryStore,
          availableTools
        );

        // Check if task is complete
        if (currentTask.progress >= 100) {
          completeTask(eid, currentTask.id, "Completed via cognition cycle");
          thoughts.push(`Completed: ${currentTask.title}`);
        }
      } else {
        // No tasks, return to reactive
        setCognitiveMode(eid, "reactive");
      }
      break;
    }

    case "reactive":
    default: {
      // Standard reactive processing with memory enhancement
      action = await generateReactiveAction(
        eid,
        input,
        state.memoryStore,
        memoryContext,
        availableTools
      );

      // Check if input suggests mode switch
      const shouldFocus = await evaluateFocusNeed(input, state.memoryStore);
      if (shouldFocus.needed) {
        setCognitiveMode(eid, shouldFocus.mode, shouldFocus.focus);
        thoughts.push(`Switching to ${shouldFocus.mode} mode: ${shouldFocus.focus}`);
      }
      break;
    }
  }

  // 6. Record this cycle as episodic memory
  addEpisodicMemory(state.memoryStore, {
    timestamp: Date.now(),
    location: input.currentLocation,
    participants: input.peoplePresent,
    event: input.perceptions.slice(0, 3).join("; "),
    myRole: action ? `${action.type}: ${action.content || action.target || ""}` : "observed",
    emotionalImpact: 0,
    importance: state.mode === "reactive" ? 0.3 : 0.6,
  });
  memoryUpdates++;

  return {
    action,
    thoughts,
    memoryUpdates,
    modeSwitch: state.mode !== "reactive" ? state.mode : undefined,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function parseActionFromSuggestion(suggestion: string): CognitiveOutput["action"] {
  // Simple parsing - could be enhanced with LLM
  const lower = suggestion.toLowerCase();

  if (lower.includes("speak") || lower.includes("say") || lower.includes("tell")) {
    return { type: "speak", content: suggestion };
  }
  if (lower.includes("move") || lower.includes("go to")) {
    const match = lower.match(/(?:move|go) to (\w+)/);
    return { type: "move", target: match?.[1] || suggestion };
  }
  if (lower.includes("examine") || lower.includes("look at")) {
    const match = lower.match(/(?:examine|look at) (\w+)/);
    return { type: "observe", target: match?.[1] || suggestion };
  }

  return { type: "think", content: suggestion };
}

async function generateActionForTask(
  eid: number,
  task: Task,
  input: CognitiveInput,
  memoryStore: AgentMemoryStore,
  availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }>
): Promise<CognitiveOutput["action"]> {
  // Check if task requires a tool
  if (task.toolsRequired && task.toolsRequired.length > 0) {
    const neededTool = task.toolsRequired[0];
    const hasTool = availableTools.find(t => t.tool.affordance === neededTool);

    if (!hasTool) {
      return {
        type: "think",
        content: `Need ${neededTool} to complete "${task.title}" but don't have access`,
      };
    }

    return {
      type: "interact",
      target: hasTool.objectType,
      content: neededTool,
    };
  }

  // Generate action based on task type
  switch (task.type) {
    case "communication":
      if (task.relatedEntities && task.relatedEntities[0]) {
        return {
          type: "speak",
          target: task.relatedEntities[0],
          content: task.description,
        };
      }
      break;

    case "action":
      return {
        type: "interact",
        target: task.relatedEntities?.[0],
        content: task.title,
      };

    case "research":
      // Trigger research mode
      setCognitiveMode(eid, "research", task.title);
      return {
        type: "think",
        content: `Beginning research: ${task.title}`,
      };

    default:
      return {
        type: "think",
        content: `Working on: ${task.title}`,
      };
  }

  return null;
}

async function generateReactiveAction(
  eid: number,
  input: CognitiveInput,
  memoryStore: AgentMemoryStore,
  memoryContext: string,
  availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }>
): Promise<CognitiveOutput["action"]> {
  // Check for relevant skills
  const perceptionText = input.perceptions.join(" ");
  const relevantSkill = findRelevantSkill(memoryStore, perceptionText);

  if (relevantSkill && relevantSkill.successRate > 0.7) {
    // Use learned skill
    const firstStep = relevantSkill.steps[0];
    return parseActionFromSuggestion(firstStep);
  }

  // Default reactive behavior would be handled by standard cognition
  return null;
}

async function evaluateFocusNeed(
  input: CognitiveInput,
  memoryStore: AgentMemoryStore
): Promise<{ needed: boolean; mode: EnhancedAgentState["mode"]; focus?: string }> {
  // Check perceptions for complexity indicators
  const perceptionText = input.perceptions.join(" ");

  // Research triggers
  const researchKeywords = ["find out", "research", "investigate", "understand", "learn about"];
  for (const keyword of researchKeywords) {
    if (perceptionText.toLowerCase().includes(keyword)) {
      const focusMatch = perceptionText.match(new RegExp(`${keyword}\\s+(.+?)(?:\\.|$)`, "i"));
      return {
        needed: true,
        mode: "research",
        focus: focusMatch?.[1] || perceptionText,
      };
    }
  }

  // Complex problem triggers
  const complexityKeywords = ["how to", "figure out", "solve", "plan"];
  for (const keyword of complexityKeywords) {
    if (perceptionText.toLowerCase().includes(keyword)) {
      return {
        needed: true,
        mode: "focused",
        focus: perceptionText,
      };
    }
  }

  return { needed: false, mode: "reactive" };
}

// =============================================================================
// HIGH-LEVEL API
// =============================================================================

/**
 * Give agent a goal and let them figure out how to achieve it
 */
export async function assignGoal(
  eid: number,
  goal: string,
  agentContext: string
): Promise<Task[]> {
  initializeEnhancedAgent(eid);

  // Generate tasks from goal
  const tasks = await generateTasksFromGoal(eid, goal, agentContext);

  // Add autobiographical memory of receiving this goal
  const state = getEnhancedAgentState(eid);
  if (state) {
    addAutobiographicalMemory(state.memoryStore, {
      theme: "turning_point",
      narrative: `I was given an important goal: ${goal}`,
      significance: "This goal shapes my current purpose",
      emotionalCore: "determination",
      linkedMemories: [],
    });
  }

  setCognitiveMode(eid, "planning", goal);

  return tasks;
}

/**
 * Ask agent to research something
 */
export async function askToResearch(
  eid: number,
  question: string,
  agentContext: string
): Promise<ResearchProject> {
  const state = initializeEnhancedAgent(eid);

  const project = await runResearchProject(eid, question, agentContext);

  state.activeResearchProject = project.id;
  setCognitiveMode(eid, "research", question);

  return project;
}

/**
 * Quick question answering using memory and reasoning
 */
export async function askQuestion(
  eid: number,
  question: string,
  agentContext: string
): Promise<{ answer: string; confidence: number }> {
  initializeEnhancedAgent(eid);

  return quickResearch(eid, question, agentContext);
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the enhanced agent system
 */
export function initializeEnhancedAgentSystem(): void {
  // Initialize tool-object interfaces
  initializeStandardInterfaces();

  console.log("[EnhancedAgent] System initialized");
}

// =============================================================================
// STATUS & DEBUGGING
// =============================================================================

export function getEnhancedAgentStatus(eid: number): string {
  const state = enhancedAgents.get(eid);
  if (!state) return `Agent ${eid} not initialized with enhanced cognition`;

  return `Enhanced Agent ${eid}:
Mode: ${state.mode}${state.currentFocus ? ` (${state.currentFocus})` : ""}
Cognitive Load: ${(state.cognitiveLoad * 100).toFixed(0)}%

${getMemoryStoreSummary(state.memoryStore)}

${getTaskQueueSummary(eid)}

${getResearchAgentStatus(eid)}`;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  // Memory
  addEpisodicMemory,
  addSemanticMemory,
  addProceduralMemory,
  recallEpisodicMemories,
  querySemanticMemory,

  // Tasks
  createTask,
  getNextTask,
  completeTask,
  formatTaskQueueForPrompt,

  // Research
  quickResearch,
  runResearchProject,

  // Reasoning
  executeExtendedReasoning,
  executeQuickReasoning,
};
