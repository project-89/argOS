/**
 * Research Agent System
 *
 * Enables agents to conduct sustained research using:
 * - Extended reasoning for complex analysis
 * - Tool-object integration for real-world data access
 * - Working memory for accumulating findings
 * - Knowledge graph for storing discoveries
 *
 * This bridges the gap between ArgOS simulation agents and
 * raw tool-calling research agents.
 */

import { google } from "@ai-sdk/google";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import type { World } from "../ecs/world";
import type { AgentMemoryStore } from "./enhanced-memory";
import {
  createMemoryStore,
  addToWorkingMemory,
  addSemanticMemory,
  addEpisodicMemory,
  clearWorkingMemory,
  formatWorkingMemoryForPrompt,
  querySemanticMemory,
  getMemoryStoreSummary,
} from "./enhanced-memory";
import {
  executeExtendedReasoning,
  createReasoningTask,
  getReasoningResultSummary,
  type ReasoningResult,
} from "./extended-reasoning";
import {
  getToolBinding,
  getAgentAvailableTools,
  formatToolsForPrompt,
  canUseTool,
  recordToolUsage,
  type ToolBinding,
} from "../world/affordance-tools";

// =============================================================================
// TYPES
// =============================================================================

export interface ResearchProject {
  id: string;
  agentEid: number;
  title: string;
  objective: string;
  status: "planning" | "researching" | "analyzing" | "concluded" | "abandoned";
  createdAt: number;
  updatedAt: number;
  deadline?: number;

  // Research plan
  questions: ResearchQuestion[];
  currentQuestionIndex: number;

  // Findings
  findings: ResearchFinding[];
  conclusions: string[];
  uncertainties: string[];

  // Resources
  toolsUsed: string[];
  sourcesConsulted: string[];
  tokensUsed: number;
  reasoningCycles: number;

  // Final output
  report?: string;
  confidence: number;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  priority: "critical" | "important" | "nice_to_have";
  status: "pending" | "investigating" | "answered" | "unanswerable";
  answer?: string;
  confidence?: number;
  sources?: string[];
  subQuestions?: string[];
}

export interface ResearchFinding {
  id: string;
  content: string;
  type: "fact" | "insight" | "connection" | "contradiction" | "hypothesis";
  source: string;
  confidence: number;
  timestamp: number;
  relatedQuestions: string[];
}

export interface ResearchConfig {
  maxQuestions: number;
  maxFindingsPerQuestion: number;
  minConfidenceToAnswer: number;
  enableWebSearch: boolean;
  enableToolUse: boolean;
  maxReasoningDepth: number;
  maxTotalTokens: number;
}

const DEFAULT_CONFIG: ResearchConfig = {
  maxQuestions: 10,
  maxFindingsPerQuestion: 20,
  minConfidenceToAnswer: 0.7,
  enableWebSearch: true,
  enableToolUse: true,
  maxReasoningDepth: 10,
  maxTotalTokens: 50000,
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

// Active research projects per agent
const activeProjects = new Map<number, ResearchProject[]>();

// Memory stores per agent (enhanced memory system)
const agentMemoryStores = new Map<number, AgentMemoryStore>();

/**
 * Get or create memory store for agent
 */
export function getAgentMemoryStore(agentEid: number): AgentMemoryStore {
  let store = agentMemoryStores.get(agentEid);
  if (!store) {
    store = createMemoryStore();
    agentMemoryStores.set(agentEid, store);
  }
  return store;
}

/**
 * Get active research projects for agent
 */
export function getActiveProjects(agentEid: number): ResearchProject[] {
  return activeProjects.get(agentEid) || [];
}

// =============================================================================
// PROJECT MANAGEMENT
// =============================================================================

let projectIdCounter = 0;
let questionIdCounter = 0;
let findingIdCounter = 0;

/**
 * Create a new research project
 */
export async function createResearchProject(
  agentEid: number,
  objective: string,
  agentContext: string,
  config: Partial<ResearchConfig> = {}
): Promise<ResearchProject> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const model = google("gemini-2.0-flash");

  // Generate research questions from objective
  const response = await generateObject({
    model,
    schema: z.object({
      title: z.string().describe("Concise title for the research project"),
      questions: z.array(z.object({
        question: z.string(),
        priority: z.enum(["critical", "important", "nice_to_have"]),
        rationale: z.string(),
      })).max(cfg.maxQuestions),
    }),
    prompt: `You are a research assistant helping an agent conduct research.

Agent Context:
${agentContext}

Research Objective:
${objective}

Generate a research plan with:
1. A concise title
2. Key questions to answer (${cfg.maxQuestions} max)
   - Critical: Must answer to achieve objective
   - Important: Should answer for thorough understanding
   - Nice to have: Would be good to know

Prioritize questions that can be answered with available information and tools.`,
  });

  const project: ResearchProject = {
    id: `research_${++projectIdCounter}_${Date.now()}`,
    agentEid,
    title: response.object.title,
    objective,
    status: "planning",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    questions: response.object.questions.map(q => ({
      id: `q_${++questionIdCounter}`,
      question: q.question,
      priority: q.priority,
      status: "pending" as const,
    })),
    currentQuestionIndex: 0,
    findings: [],
    conclusions: [],
    uncertainties: [],
    toolsUsed: [],
    sourcesConsulted: [],
    tokensUsed: 0,
    reasoningCycles: 0,
    confidence: 0,
  };

  // Store project
  const agentProjects = activeProjects.get(agentEid) || [];
  agentProjects.push(project);
  activeProjects.set(agentEid, agentProjects);

  // Initialize working memory
  const memoryStore = getAgentMemoryStore(agentEid);
  addToWorkingMemory(memoryStore, project.id, "note", `Research Project: ${project.title}`);
  addToWorkingMemory(memoryStore, project.id, "note", `Objective: ${objective}`);

  console.log(`[ResearchAgent] Created project: ${project.title} with ${project.questions.length} questions`);

  return project;
}

/**
 * Execute one research cycle for a project
 */
export async function executeResearchCycle(
  project: ResearchProject,
  agentContext: string,
  availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }>,
  config: Partial<ResearchConfig> = {}
): Promise<{
  progress: boolean;
  questionsAnswered: number;
  findingsAdded: number;
  tokensUsed: number;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const memoryStore = getAgentMemoryStore(project.agentEid);
  let tokensUsed = 0;
  let questionsAnswered = 0;
  let findingsAdded = 0;

  // Check if project is already concluded
  if (project.status === "concluded" || project.status === "abandoned") {
    return { progress: false, questionsAnswered: 0, findingsAdded: 0, tokensUsed: 0 };
  }

  // Update status
  project.status = "researching";
  project.updatedAt = Date.now();

  // Find next unanswered question
  const currentQuestion = project.questions.find(q => q.status === "pending" || q.status === "investigating");

  if (!currentQuestion) {
    // All questions answered - move to analysis
    project.status = "analyzing";
    return { progress: true, questionsAnswered: 0, findingsAdded: 0, tokensUsed: 0 };
  }

  currentQuestion.status = "investigating";

  // Build context for reasoning
  const workingMemory = formatWorkingMemoryForPrompt(memoryStore, project.id);
  const previousFindings = project.findings
    .filter(f => f.relatedQuestions.includes(currentQuestion.id))
    .map(f => `- ${f.content} (${f.type}, confidence: ${(f.confidence * 100).toFixed(0)}%)`)
    .join("\n");

  const toolsContext = formatToolsForPrompt(availableTools);

  // Create reasoning task
  const reasoningTask = createReasoningTask(
    project.agentEid,
    "research",
    currentQuestion.question,
    `${agentContext}

## Research Context
Project: ${project.title}
Objective: ${project.objective}

## Working Memory
${workingMemory}

## Previous Findings for This Question
${previousFindings || "None yet"}

## Available Tools
${toolsContext}`,
    {
      maxSteps: cfg.maxReasoningDepth,
    }
  );

  // Execute extended reasoning
  const result = await executeExtendedReasoning(
    reasoningTask,
    memoryStore,
    agentContext,
    {
      maxSteps: cfg.maxReasoningDepth,
      enableToolUse: cfg.enableToolUse,
      enableSelfReflection: true,
    }
  );

  tokensUsed += result.tokensUsed;
  project.tokensUsed += result.tokensUsed;
  project.reasoningCycles++;

  // Process findings
  for (const finding of result.findings) {
    const researchFinding: ResearchFinding = {
      id: `f_${++findingIdCounter}`,
      content: finding,
      type: "fact",
      source: "reasoning",
      confidence: result.confidence,
      timestamp: Date.now(),
      relatedQuestions: [currentQuestion.id],
    };

    project.findings.push(researchFinding);
    findingsAdded++;

    // Store in semantic memory
    addSemanticMemory(memoryStore, {
      category: "fact",
      subject: currentQuestion.question.slice(0, 50),
      content: finding,
      confidence: result.confidence,
      sources: [project.id],
    });
  }

  // Process uncertainties
  for (const uncertainty of result.uncertainties) {
    if (!project.uncertainties.includes(uncertainty)) {
      project.uncertainties.push(uncertainty);
    }
  }

  // Update question status
  if (result.success && result.confidence >= cfg.minConfidenceToAnswer) {
    currentQuestion.status = "answered";
    currentQuestion.answer = result.conclusion;
    currentQuestion.confidence = result.confidence;
    questionsAnswered++;

    addToWorkingMemory(memoryStore, project.id, "conclusion",
      `Q: ${currentQuestion.question}\nA: ${result.conclusion}`);
  } else if (result.confidence < 0.3) {
    currentQuestion.status = "unanswerable";
    currentQuestion.answer = `Unable to answer with confidence. ${result.conclusion}`;
  }

  // Add episodic memory of research session
  addEpisodicMemory(memoryStore, {
    timestamp: Date.now(),
    location: "research",
    participants: [],
    event: `Researched: ${currentQuestion.question}`,
    myRole: result.success ? "Found answer" : "Investigated but uncertain",
    emotionalImpact: result.success ? 0.3 : -0.1,
    importance: currentQuestion.priority === "critical" ? 0.9 : 0.6,
  });

  return { progress: true, questionsAnswered, findingsAdded, tokensUsed };
}

/**
 * Execute tool from tool-object system during research
 */
export async function executeResearchTool(
  project: ResearchProject,
  toolBinding: ToolBinding,
  objectEid: number,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: string }> {
  // Check if tool can be used
  const canUse = canUseTool(objectEid, toolBinding.affordance);
  if (!canUse.allowed) {
    return { success: false, result: `Cannot use tool: ${canUse.reason}` };
  }

  // Record tool usage
  recordToolUsage(objectEid, toolBinding.affordance);

  if (!project.toolsUsed.includes(toolBinding.toolId)) {
    project.toolsUsed.push(toolBinding.toolId);
  }

  // Execute based on tool type
  if (toolBinding.type === "mcp") {
    // MCP tool execution would go here
    // For now, return placeholder
    return {
      success: true,
      result: `[MCP Tool ${toolBinding.toolId}] Would execute with input: ${JSON.stringify(input)}`,
    };
  } else {
    // Internal tool execution
    return {
      success: true,
      result: `[Internal Tool ${toolBinding.toolId}] Executed with input: ${JSON.stringify(input)}`,
    };
  }
}

/**
 * Analyze findings and generate conclusions
 */
export async function analyzeAndConclude(
  project: ResearchProject,
  agentContext: string
): Promise<{ report: string; confidence: number }> {
  const model = google("gemini-2.0-flash");
  const memoryStore = getAgentMemoryStore(project.agentEid);

  // Gather all answered questions
  const answeredQuestions = project.questions
    .filter(q => q.status === "answered")
    .map(q => `Q: ${q.question}\nA: ${q.answer} (confidence: ${((q.confidence || 0) * 100).toFixed(0)}%)`)
    .join("\n\n");

  // Gather key findings
  const keyFindings = project.findings
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)
    .map(f => `- ${f.content} (${f.type})`)
    .join("\n");

  // Generate final report
  const response = await generateObject({
    model,
    schema: z.object({
      executiveSummary: z.string(),
      keyFindings: z.array(z.string()),
      conclusions: z.array(z.string()),
      recommendations: z.array(z.string()),
      limitations: z.array(z.string()),
      overallConfidence: z.number(),
    }),
    prompt: `Generate a research report based on the following:

## Research Objective
${project.objective}

## Questions Investigated
${answeredQuestions}

## Key Findings
${keyFindings}

## Uncertainties
${project.uncertainties.join("\n") || "None noted"}

Create a comprehensive report with:
1. Executive summary (2-3 sentences)
2. Key findings (bullet points)
3. Conclusions (what we now know)
4. Recommendations (what to do with this knowledge)
5. Limitations (what we couldn't determine)
6. Overall confidence score (0-1)`,
  });

  // Build report
  const report = `# Research Report: ${project.title}

## Executive Summary
${response.object.executiveSummary}

## Key Findings
${response.object.keyFindings.map(f => `- ${f}`).join("\n")}

## Conclusions
${response.object.conclusions.map(c => `- ${c}`).join("\n")}

## Recommendations
${response.object.recommendations.map(r => `- ${r}`).join("\n")}

## Limitations
${response.object.limitations.map(l => `- ${l}`).join("\n")}

---
*Confidence: ${(response.object.overallConfidence * 100).toFixed(0)}%*
*Questions Answered: ${project.questions.filter(q => q.status === "answered").length}/${project.questions.length}*
*Findings: ${project.findings.length}*
*Reasoning Cycles: ${project.reasoningCycles}*
*Tokens Used: ~${project.tokensUsed}*`;

  // Update project
  project.status = "concluded";
  project.report = report;
  project.conclusions = response.object.conclusions;
  project.confidence = response.object.overallConfidence;
  project.updatedAt = Date.now();

  // Store conclusions in semantic memory
  for (const conclusion of response.object.conclusions) {
    addSemanticMemory(memoryStore, {
      category: "fact",
      subject: project.title,
      content: conclusion,
      confidence: response.object.overallConfidence,
      sources: [project.id],
    });
  }

  // Clear working memory for this project (consolidating important items)
  clearWorkingMemory(memoryStore, project.id, true);

  // Add episodic memory of completing research
  addEpisodicMemory(memoryStore, {
    timestamp: Date.now(),
    location: "research",
    participants: [],
    event: `Completed research project: ${project.title}`,
    myRole: "Researcher",
    emotionalImpact: response.object.overallConfidence > 0.7 ? 0.5 : 0.1,
    importance: 0.8,
    outcome: response.object.executiveSummary,
  });

  console.log(`[ResearchAgent] Completed project: ${project.title} with ${(response.object.overallConfidence * 100).toFixed(0)}% confidence`);

  return { report, confidence: response.object.overallConfidence };
}

// =============================================================================
// HIGH-LEVEL API
// =============================================================================

/**
 * Run a complete research project from start to finish
 */
export async function runResearchProject(
  agentEid: number,
  objective: string,
  agentContext: string,
  availableTools: Array<{ tool: ToolBinding; objectType: string; objectEid: number }> = [],
  config: Partial<ResearchConfig> = {}
): Promise<ResearchProject> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Create project
  const project = await createResearchProject(agentEid, objective, agentContext, cfg);

  // Run research cycles until complete or token limit
  while (
    project.status !== "concluded" &&
    project.status !== "abandoned" &&
    project.tokensUsed < cfg.maxTotalTokens
  ) {
    const cycleResult = await executeResearchCycle(project, agentContext, availableTools, cfg);

    if (!cycleResult.progress) {
      break;
    }

    // Check if ready for analysis
    const pendingQuestions = project.questions.filter(q => q.status === "pending" || q.status === "investigating");
    if (pendingQuestions.length === 0 && project.status === "analyzing") {
      await analyzeAndConclude(project, agentContext);
    }
  }

  // If we hit token limit before concluding
  if (project.status !== "concluded") {
    console.log(`[ResearchAgent] Project ${project.id} ended early (token limit or no progress)`);
    await analyzeAndConclude(project, agentContext);
  }

  return project;
}

/**
 * Quick research query (single question, no project overhead)
 */
export async function quickResearch(
  agentEid: number,
  question: string,
  agentContext: string
): Promise<{ answer: string; confidence: number; sources: string[] }> {
  const memoryStore = getAgentMemoryStore(agentEid);
  const model = google("gemini-2.0-flash");

  // First check existing knowledge
  const existingKnowledge = querySemanticMemory(memoryStore, {
    keywords: question.split(" ").slice(0, 5),
    minConfidence: 0.6,
  }, 5);

  if (existingKnowledge.length > 0) {
    // We might already know this
    const bestMatch = existingKnowledge[0];
    if (bestMatch.confidence >= 0.8) {
      return {
        answer: bestMatch.content,
        confidence: bestMatch.confidence,
        sources: bestMatch.sources,
      };
    }
  }

  // Quick reasoning
  const response = await generateObject({
    model,
    schema: z.object({
      answer: z.string(),
      confidence: z.number(),
      reasoning: z.string(),
    }),
    prompt: `Answer this question based on your knowledge and the context provided:

Context:
${agentContext}

${existingKnowledge.length > 0 ? `Relevant prior knowledge:\n${existingKnowledge.map(k => `- ${k.content}`).join("\n")}` : ""}

Question: ${question}

Provide a clear answer with your confidence level (0-1).`,
  });

  // Store the answer
  addSemanticMemory(memoryStore, {
    category: "fact",
    subject: question.slice(0, 50),
    content: response.object.answer,
    confidence: response.object.confidence,
    sources: ["quick_research"],
  });

  return {
    answer: response.object.answer,
    confidence: response.object.confidence,
    sources: existingKnowledge.map(k => k.id),
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

export function getProjectSummary(project: ResearchProject): string {
  const answered = project.questions.filter(q => q.status === "answered").length;
  const total = project.questions.length;

  return `Research Project: ${project.title}
Status: ${project.status}
Progress: ${answered}/${total} questions answered
Findings: ${project.findings.length}
Confidence: ${(project.confidence * 100).toFixed(0)}%
Tokens Used: ~${project.tokensUsed}
${project.report ? "\n[Report Generated]" : ""}`;
}

export function getResearchAgentStatus(agentEid: number): string {
  const projects = getActiveProjects(agentEid);
  const memoryStore = getAgentMemoryStore(agentEid);

  return `Research Agent Status (Agent ${agentEid}):
Active Projects: ${projects.filter(p => p.status !== "concluded" && p.status !== "abandoned").length}
Completed Projects: ${projects.filter(p => p.status === "concluded").length}

${getMemoryStoreSummary(memoryStore)}

Projects:
${projects.map(p => `- ${p.title} [${p.status}]`).join("\n") || "(none)"}`;
}
