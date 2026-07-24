/**
 * Swarm Context — Context management for the swarm agent.
 *
 * Handles three key context flows:
 *
 * 1. PLAN CONTEXT: The planning swarm's winning reasoning feeds into
 *    the execution swarm so executors understand WHY the plan was chosen.
 *
 * 2. STEP CONTEXT: Each step's result accumulates into a rolling context
 *    window so later steps can reference earlier results.
 *
 * 3. WORKING MEMORY: Across tasks, the agent maintains a short-term
 *    memory of what it's done, what worked, and what failed.
 *
 * The BT is NOT injected into LLM context (it's too large and not useful
 * for generation). Instead, we inject a SUMMARY of compiled capabilities
 * so the agent knows what it already knows.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface SwarmContext {
  /** The original task */
  task: string;
  /** Rolling context from completed steps */
  stepHistory: StepContextEntry[];
  /** Planning reasoning (from the winning plan cluster) */
  planningReasoning: string;
  /** Working memory from previous tasks */
  workingMemory: WorkingMemoryEntry[];
  /** Summary of compiled BT capabilities */
  compiledCapabilities: string[];
  /** Token budget for context assembly */
  maxTokens: number;
}

export interface StepContextEntry {
  stepNumber: number;
  description: string;
  result: string;
  success: boolean;
  toolsUsed: string[];
}

export interface WorkingMemoryEntry {
  task: string;
  outcome: "success" | "partial" | "failure";
  learnedPattern: string;
  timestamp: number;
}

// =============================================================================
// CONTEXT MANAGEMENT
// =============================================================================

/** Global working memory (persists across tasks within a session) */
const workingMemory: WorkingMemoryEntry[] = [];
const MAX_WORKING_MEMORY = 20;

/**
 * Create a fresh context for a new task.
 */
export function createSwarmContext(task: string): SwarmContext {
  return {
    task,
    stepHistory: [],
    planningReasoning: "",
    workingMemory: [...workingMemory],
    compiledCapabilities: [],
    maxTokens: 3000,
  };
}

/**
 * Add planning reasoning to the context.
 * Called after swarm planning converges.
 */
export function addPlanningContext(ctx: SwarmContext, reasoning: string, approach: string): void {
  ctx.planningReasoning = `Plan approach (${approach}): ${reasoning}`;
}

/**
 * Record a completed step's result into the context.
 */
export function addStepResult(
  ctx: SwarmContext,
  stepNumber: number,
  description: string,
  result: string,
  success: boolean,
  toolsUsed: string[] = [],
): void {
  ctx.stepHistory.push({ stepNumber, description, result: result.slice(0, 500), success, toolsUsed });
}

/**
 * Record a completed task into working memory.
 */
export function recordTaskOutcome(
  task: string,
  outcome: "success" | "partial" | "failure",
  learnedPattern: string,
): void {
  workingMemory.push({
    task: task.slice(0, 200),
    outcome,
    learnedPattern,
    timestamp: Date.now(),
  });
  // Keep only recent entries
  while (workingMemory.length > MAX_WORKING_MEMORY) {
    workingMemory.shift();
  }
}

/**
 * Clear working memory (for testing).
 */
export function clearWorkingMemory(): void {
  workingMemory.length = 0;
}

// =============================================================================
// CONTEXT ASSEMBLY — build the context string for LLM prompts
// =============================================================================

/**
 * Assemble the full context string for a swarm instance prompt.
 *
 * Priority order (within token budget):
 *   1. Task description (always included)
 *   2. Planning reasoning (if available)
 *   3. Step history (most recent steps first)
 *   4. Working memory (relevant entries)
 *   5. Compiled capabilities summary
 */
export function assembleContext(ctx: SwarmContext): string {
  const sections: string[] = [];
  let approxTokens = 0;
  const tokenEstimate = (s: string) => Math.ceil(s.length / 4);

  // 1. Task (always)
  sections.push(`Task: ${ctx.task}`);
  approxTokens += tokenEstimate(ctx.task);

  // 2. Planning reasoning
  if (ctx.planningReasoning && approxTokens < ctx.maxTokens - 200) {
    sections.push(`\nPlan reasoning:\n${ctx.planningReasoning}`);
    approxTokens += tokenEstimate(ctx.planningReasoning);
  }

  // 3. Step history (most recent first for recency bias)
  if (ctx.stepHistory.length > 0 && approxTokens < ctx.maxTokens - 300) {
    const stepLines = ctx.stepHistory.map(s => {
      const status = s.success ? "✓" : "✗";
      const tools = s.toolsUsed.length > 0 ? ` [${s.toolsUsed.join(", ")}]` : "";
      return `  ${status} Step ${s.stepNumber}: ${s.description}${tools}\n    Result: ${s.result.slice(0, 200)}`;
    });
    sections.push(`\nCompleted steps:\n${stepLines.join("\n")}`);
    approxTokens += stepLines.reduce((sum, l) => sum + tokenEstimate(l), 0);
  }

  // 4. Working memory (only relevant entries)
  if (ctx.workingMemory.length > 0 && approxTokens < ctx.maxTokens - 200) {
    const relevant = ctx.workingMemory
      .filter(m => {
        // Simple relevance: check word overlap between task and memory
        const taskWords = new Set(ctx.task.toLowerCase().split(/\s+/));
        const memWords = m.task.toLowerCase().split(/\s+/);
        return memWords.some(w => taskWords.has(w));
      })
      .slice(-5); // Last 5 relevant entries

    if (relevant.length > 0) {
      const memLines = relevant.map(m =>
        `  [${m.outcome}] ${m.task.slice(0, 80)} → learned: ${m.learnedPattern}`
      );
      sections.push(`\nRelevant experience:\n${memLines.join("\n")}`);
      approxTokens += memLines.reduce((sum, l) => sum + tokenEstimate(l), 0);
    }
  }

  // 5. Compiled capabilities
  if (ctx.compiledCapabilities.length > 0 && approxTokens < ctx.maxTokens - 100) {
    sections.push(`\nKnown capabilities: ${ctx.compiledCapabilities.join(", ")}`);
  }

  return sections.join("\n");
}

/**
 * Build a step-specific prompt with full context.
 */
export function buildStepPrompt(
  ctx: SwarmContext,
  stepDescription: string,
  expectedOutput?: string,
): string {
  const context = assembleContext(ctx);
  return `${context}

Current step: ${stepDescription}
${expectedOutput ? `Expected output: ${expectedOutput}` : ""}

Complete this step using the available tools. Give your result directly.`;
}
