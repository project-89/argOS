/**
 * Nightly Trainer — Overnight batch improvement for a person's assistant.
 *
 * The key insight: instead of random conversation templates, the swarm explores
 * variations of the person's ACTUAL conversations. Their real topics, real
 * emotional patterns, real escalation points. This is personalized exploration.
 *
 * Pipeline:
 *   1. LOAD    — Load the person's saved model (their current BT + history)
 *   2. ANALYZE — Extract training signals from their real interactions
 *   3. GENERATE — Create conversation variants from their actual patterns
 *   4. SWARM   — Run N instances, each starting from their current tree
 *   5. HARVEST — Extract newly compiled branches from all instances
 *   6. CLUSTER — Group convergent patterns
 *   7. MERGE   — Add species branches to the person's tree (additive, not replacing)
 *   8. VALIDATE — Benchmark improved tree against previous; reject if regression
 *   9. SAVE    — Persist the improved model
 *
 * Why this works better than generic swarm:
 *   - Explores THEIR conversation space, not a generic one
 *   - Each instance starts from THEIR tree (preserves existing learning)
 *   - Variations target THEIR weak spots (topics that escalated most)
 *   - Species patterns are personalized to THEIR interaction style
 *
 * Schedule: Run nightly via cron. The person wakes up to a smarter assistant.
 */

import type { PersonModel } from "../ecs/types.js";
import type { ConversationScript, SwarmResult, SpeciesTree } from "./types.js";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes, insertBranch } from "../bt/evaluator.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { createCompilerContext, resolveDecisionFailure, type CompilerContext } from "../compiler/bt-compiler.js";
import { createTraceContext, type TraceContext } from "../compiler/plan-compiler.js";
import { runBenchmark, DEFAULT_BENCHMARK } from "../engine/benchmark.js";
import { harvestBranches } from "./branch-harvester.js";
import { clusterBranches, DEFAULT_CLUSTER_CONFIG } from "./pattern-clusterer.js";
import { buildSpeciesTree } from "./species-merger.js";
import { loadPerson, savePerson } from "../persistence/store.js";
import { maintainTree, type MaintenanceResult } from "../compiler/tree-maintenance.js";
import { evolvePrompt, registerPrompt, getEvolutionStats } from "../compiler/prompt-evolution.js";

// =============================================================================
// TRAINING SIGNALS — extracted from the person's real history
// =============================================================================

export interface TrainingSignals {
  /** Topics the person discusses (frequency-ranked) */
  topicFrequency: Map<string, number>;
  /** Emotional states they experience */
  emotionFrequency: Map<string, number>;
  /** Messages that escalated (BT couldn't handle) — these are training targets */
  escalationExamples: string[];
  /** Topics with highest escalation rate — weakest spots */
  weakTopics: string[];
  /** Average conversation depth */
  avgConversationDepth: number;
  /** Total interactions recorded */
  totalInteractions: number;
}

/**
 * Analyze a person's model to extract training signals.
 * These signals shape what the swarm explores.
 */
export function extractTrainingSignals(model: PersonModel): TrainingSignals {
  const topicFreq = new Map<string, number>();
  const emotionFreq = new Map<string, number>();
  const escalationExamples: string[] = [];

  // Mine topics from memory + entities + hypotheses
  for (const mem of model.memory) {
    for (const topic of mem.topics) {
      topicFreq.set(topic, (topicFreq.get(topic) || 0) + 1);
    }
  }

  for (const entity of model.entities) {
    const topic = entity.type === "project" ? "work"
      : entity.type === "person" ? "social"
      : entity.type === "place" ? "social"
      : "general";
    topicFreq.set(topic, (topicFreq.get(topic) || 0) + entity.mentionCount);
  }

  // Mine emotional patterns from conversation history
  for (const msg of model.conversation.recentMessages) {
    if (msg.emotionalTone) {
      emotionFreq.set(msg.emotionalTone, (emotionFreq.get(msg.emotionalTone) || 0) + 1);
    }
  }

  // Use hypotheses as topic signals
  for (const hyp of model.hypotheses) {
    topicFreq.set(hyp.domain, (topicFreq.get(hyp.domain) || 0) + 2);
  }

  // Use recent messages as escalation examples (we don't track per-message escalation,
  // but we can use messages that don't match common patterns as proxies)
  for (const msg of model.conversation.recentMessages) {
    if (msg.role === "user" && msg.content.length > 20) {
      escalationExamples.push(msg.content);
    }
  }

  // Find weakest topics: topics mentioned often but with low hypothesis confidence
  const weakTopics: string[] = [];
  for (const [topic, freq] of topicFreq) {
    const hyp = model.hypotheses.find(h => h.domain === topic);
    if (!hyp || hyp.confidence < 0.5) {
      weakTopics.push(topic);
    }
  }

  return {
    topicFrequency: topicFreq,
    emotionFrequency: emotionFreq,
    escalationExamples: escalationExamples.slice(-20), // Last 20
    weakTopics: weakTopics.slice(0, 5),
    avgConversationDepth: model.conversation.turnsThisSession,
    totalInteractions: model.totalMessages,
  };
}

// =============================================================================
// PERSONAL TASK GENERATION
// =============================================================================

const EMOTION_WORDS: Record<string, string[]> = {
  stressed: ["stressed", "overwhelmed", "anxious", "worried", "under pressure"],
  excited: ["excited", "thrilled", "pumped", "stoked", "energized"],
  frustrated: ["frustrated", "annoyed", "fed up", "irritated"],
  sad: ["down", "bummed", "disappointed", "feeling low"],
  neutral: ["thinking about", "considering", "looking into"],
};

const CONVERSATION_SHAPES = [
  // Shape 1: Topic deep-dive (problem → exploration → resolution)
  (topic: string, emotion: string, example: string) => [
    `I'm feeling ${emotion} about ${topic}`,
    `The ${topic} situation is getting more complicated. Can you help me think through it?`,
    `That's a good point about ${topic}. What would you prioritize first?`,
    `Thanks, I think I have a clearer picture of the ${topic} situation now.`,
  ],
  // Shape 2: Quick update + pivot
  (topic: string, emotion: string, example: string) => [
    `Quick update on ${topic} — things have changed`,
    `Yeah, I'm kind of ${emotion} about the whole ${topic} thing now`,
    `What do you think I should do differently about ${topic}?`,
  ],
  // Shape 3: Escalation from example (uses real message as seed)
  (topic: string, emotion: string, example: string) => [
    example || `I need to talk about ${topic}`,
    `Can you help me figure out the ${topic} situation?`,
    `That's helpful. I'll try that approach with ${topic}.`,
  ],
  // Shape 4: Emotional processing
  (topic: string, emotion: string, example: string) => [
    `I've been really ${emotion} about ${topic} lately`,
    `I think the ${topic} thing is affecting me more than I realized`,
    `You're right. I should probably address the ${topic} situation directly.`,
    `Thanks for listening about ${topic}. That actually helped.`,
  ],
  // Shape 5: Planning + tool request
  (topic: string, emotion: string, example: string) => [
    `I need to get organized about ${topic}`,
    `Can you help me make a plan for the ${topic} situation?`,
    `Good thinking. Can you make me a checklist for ${topic}?`,
    `Perfect. I feel better about ${topic} now that there's a plan.`,
  ],
];

/**
 * Generate conversation scripts personalized to this person.
 * Focuses exploration on their actual topics and weak spots.
 */
export function generatePersonalScripts(
  signals: TrainingSignals,
  count: number,
  seed: number,
): ConversationScript[] {
  const rng = createRng(seed);
  const scripts: ConversationScript[] = [];

  // Rank topics by frequency (most discussed first)
  const rankedTopics = Array.from(signals.topicFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic);

  // Rank emotions
  const rankedEmotions = Array.from(signals.emotionFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([emotion]) => emotion);

  // Mix: 60% weak topics (where learning is needed), 40% strong topics (where patterns should solidify)
  const weakPool = signals.weakTopics.length > 0 ? signals.weakTopics : rankedTopics.slice(0, 3);
  const strongPool = rankedTopics.filter(t => !weakPool.includes(t)).slice(0, 3);
  const topicPool = [...weakPool, ...weakPool, ...weakPool, ...strongPool, ...strongPool];

  // Fallback pools if person has no history
  const defaultTopics = ["work", "personal goals", "daily routine", "health", "relationships"];
  const defaultEmotions = ["stressed", "neutral", "excited"];

  for (let i = 0; i < count; i++) {
    const topic = topicPool.length > 0
      ? topicPool[i % topicPool.length]
      : defaultTopics[i % defaultTopics.length];

    const emotionKey = rankedEmotions.length > 0
      ? rankedEmotions[i % rankedEmotions.length]
      : defaultEmotions[i % defaultEmotions.length];

    const emotionWords = EMOTION_WORDS[emotionKey] || EMOTION_WORDS.neutral;
    const emotion = emotionWords[Math.floor(rng() * emotionWords.length)];

    // Pick a conversation shape
    const shape = CONVERSATION_SHAPES[i % CONVERSATION_SHAPES.length];

    // Optionally seed with a real escalation example
    const example = signals.escalationExamples.length > 0
      ? signals.escalationExamples[Math.floor(rng() * signals.escalationExamples.length)]
      : "";

    const messages = shape(topic, emotion, example);

    scripts.push({
      id: `personal_${i}_${topic}`,
      category: topic,
      messages,
      description: `${topic}: ${emotion} (${weakPool.includes(topic) ? "weak spot" : "reinforcement"})`,
    });
  }

  return scripts;
}

/** Simple seeded PRNG (xorshift32). */
function createRng(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

// =============================================================================
// NIGHTLY TRAINING PIPELINE
// =============================================================================

export interface NightlyConfig {
  /** Person ID to train */
  personId: string;
  /** Data directory for person files */
  dataDir: string;
  /** Number of swarm instances */
  instanceCount: number;
  /** Max new branches to add (safety cap) */
  maxNewBranches: number;
  /** Minimum convergence score to include in merge */
  minConvergence: number;
  /** Reject if escalation rate increases by more than this */
  maxRegressionPp: number;
  /** Dry run — analyze and report but don't save */
  dryRun: boolean;
}

export const DEFAULT_NIGHTLY_CONFIG: NightlyConfig = {
  personId: "default",
  dataDir: "./data",
  instanceCount: 15,
  maxNewBranches: 10,
  minConvergence: 0,
  maxRegressionPp: 5,
  dryRun: false,
};

export interface NightlyResult {
  personId: string;
  timestamp: number;

  // Before
  beforeNodes: number;
  beforeBranches: number;
  beforeEscalationRate: number;

  // Swarm
  instancesRun: number;
  branchesHarvested: number;
  clustersFormed: number;
  convergentClusters: number;

  // After
  afterNodes: number;
  afterBranches: number;
  afterEscalationRate: number;

  // Delta
  nodesAdded: number;
  branchesAdded: number;
  escalationDelta: number; // Negative = improvement

  // Maintenance
  pruned: number;
  deduplicated: number;
  chanceNodesRemoved: number;

  // Prompt evolution
  promptEvolutions: Array<{ name: string; changeSummary: string }>;

  // Validation
  validated: boolean;
  regressionDetected: boolean;
  saved: boolean;

  // Training focus
  weakTopicsTargeted: string[];
  topicsCovered: string[];

  elapsedMs: number;
}

/**
 * Run the full nightly training pipeline for a person.
 */
export async function runNightlyTraining(
  config: NightlyConfig,
  log: (msg: string) => void = console.log,
): Promise<NightlyResult> {
  const start = Date.now();

  // 1. LOAD
  log(`Loading person: ${config.personId}`);
  let model = loadPerson(config.personId, config.dataDir);
  if (!model) {
    log(`No saved model for "${config.personId}" — creating fresh`);
    model = createPersonModel(config.personId);
    model.policy.tree = createBootstrapTree();
    model.policy.totalNodes = countNodes(model.policy.tree);
  }

  const beforeNodes = model.policy.totalNodes;
  const beforeBranches = model.policy.compiledBranches;

  // Baseline benchmark (average 3 runs for stability)
  log(`Running baseline benchmark...`);
  const baselineEsc = await averageBenchmark(model, 3);

  // 2. ANALYZE
  log(`Analyzing conversation history...`);
  const signals = extractTrainingSignals(model);
  log(`  Topics: ${Array.from(signals.topicFrequency.keys()).slice(0, 5).join(", ") || "(none yet)"}`);
  log(`  Emotions: ${Array.from(signals.emotionFrequency.keys()).join(", ") || "(none yet)"}`);
  log(`  Weak spots: ${signals.weakTopics.join(", ") || "(none identified)"}`);
  log(`  Escalation examples: ${signals.escalationExamples.length}`);

  // 3. GENERATE personal conversation scripts
  log(`Generating ${config.instanceCount} training scenarios...`);
  const scripts = generatePersonalScripts(
    signals,
    config.instanceCount,
    Date.now(),
  );

  // 4. SWARM — run instances starting from the person's CURRENT tree
  //    Now PARALLEL thanks to per-instance CompilerContext
  log(`Running swarm (${config.instanceCount} instances, parallel)...`);

  const swarmPromises = scripts.map(async (script, i) => {
    // Each instance gets its own compiler context — no shared state
    const compilerCtx = createCompilerContext();
    const traceCtx = createTraceContext();
    const instanceModel = cloneModelForTraining(model, `train_${i}`);

    let escalations = 0;
    for (const message of script.messages) {
      try {
        const result = await processTurn(message, instanceModel, compilerCtx, traceCtx);
        if (result.escalated) escalations++;
      } catch {
        escalations++;
      }
    }

    return {
      instanceId: `train_${i}_${script.category}`,
      model: instanceModel,
      turnsProcessed: script.messages.length,
      escalations,
      compiledCount: instanceModel.policy.compiledBranches - model.policy.compiledBranches,
      treeNodes: instanceModel.policy.totalNodes,
      elapsedMs: 0,
    };
  });

  const instanceResults = await Promise.all(swarmPromises);

  const totalNewBranches = instanceResults.reduce((s, r) => s + r.compiledCount, 0);
  log(`  New branches compiled across swarm: ${totalNewBranches}`);

  // 5. HARVEST
  log(`Harvesting branches...`);
  const harvest = harvestBranches(instanceResults);
  log(`  Harvested: ${harvest.branches.length} from ${harvest.contributingInstances} instances`);

  if (harvest.branches.length === 0) {
    log(`No new patterns found — model is well-trained for current topics.`);
    return {
      personId: config.personId,
      timestamp: Date.now(),
      beforeNodes, beforeBranches, beforeEscalationRate: baselineEsc,
      instancesRun: config.instanceCount,
      branchesHarvested: 0, clustersFormed: 0, convergentClusters: 0,
      afterNodes: beforeNodes, afterBranches: beforeBranches,
      afterEscalationRate: baselineEsc,
      nodesAdded: 0, branchesAdded: 0, escalationDelta: 0,
      pruned: 0, deduplicated: 0, chanceNodesRemoved: 0,
      promptEvolutions: [],
      validated: true, regressionDetected: false, saved: false,
      weakTopicsTargeted: signals.weakTopics, topicsCovered: [],
      elapsedMs: Date.now() - start,
    };
  }

  // 6. CLUSTER
  log(`Clustering patterns...`);
  const clusterResult = clusterBranches(
    harvest.branches,
    config.instanceCount,
    DEFAULT_CLUSTER_CONFIG,
  );
  log(`  Clusters: ${clusterResult.clusters.length} (${clusterResult.convergentClusters} convergent)`);

  // 7. MERGE — add species branches to the person's tree (ADDITIVE)
  log(`Merging patterns into personal tree...`);
  const speciesTree = buildSpeciesTree(clusterResult.clusters, config.minConvergence);

  // Additive merge: take species branches and insert into the person's existing tree
  let branchesAdded = 0;
  for (const speciesBranch of speciesTree.branches) {
    if (branchesAdded >= config.maxNewBranches) {
      log(`  Hit max new branches cap (${config.maxNewBranches})`);
      break;
    }
    model.policy.tree = insertBranch(model.policy.tree!, speciesBranch.node);
    model.policy.compiledBranches++;
    branchesAdded++;
  }
  model.policy.totalNodes = countNodes(model.policy.tree!);
  model.policy.version++;
  model.policy.lastCompiled = Date.now();

  const afterNodes = model.policy.totalNodes;
  const afterBranches = model.policy.compiledBranches;

  log(`  Added ${branchesAdded} branches: ${beforeNodes} → ${afterNodes} nodes`);

  // 7b. MAINTAIN — prune stale/conflicting branches, remove chance nodes
  log(`Maintaining tree (prune, deduplicate, clean)...`);
  const maintenance = maintainTree(model);
  log(`  Pruned: ${maintenance.pruned}, Deduplicated: ${maintenance.deduplicated}, Chance nodes removed: ${maintenance.chanceNodesRemoved}`);
  log(`  Tree after maintenance: ${model.policy.totalNodes} nodes, ${model.policy.compiledBranches} branches`);

  // Update after-maintenance stats
  const afterMaintenanceNodes = model.policy.totalNodes;
  const afterMaintenanceBranches = model.policy.compiledBranches;

  // 7c. EVOLVE — iterate on system prompts
  log(`Evolving system prompts...`);
  const promptEvolutions: Array<{ name: string; changeSummary: string }> = [];
  const promptNames = ['escalation_system', 'runtime_system', 'analysis_system'];
  for (const promptName of promptNames) {
    // Register prompts if not already registered (first nightly run)
    registerPrompt(promptName, `Default ${promptName} prompt`);
    try {
      const result = await evolvePrompt(promptName, model, async (promptContent) => {
        // Score = escalation rate with this prompt variant
        const benchModel = cloneModelForTraining(model, `prompt_eval`);
        const run = await runBenchmark(benchModel);
        resolveDecisionFailure();
        return run.results.filter(r => r.escalated).length / run.results.length;
      });
      if (result) {
        promptEvolutions.push({ name: promptName, changeSummary: result.changeSummary });
        log(`  ${promptName}: evolved → "${result.changeSummary}"`);
      } else {
        log(`  ${promptName}: current version is best`);
      }
    } catch (err) {
      log(`  ${promptName}: evolution failed — ${(err as Error).message}`);
    }
  }

  // 8. VALIDATE — benchmark the improved tree
  log(`Validating improved tree...`);
  const afterEsc = await averageBenchmark(model, 3);
  const escDelta = afterEsc - baselineEsc;
  const regressionDetected = escDelta > config.maxRegressionPp / 100;

  log(`  Escalation: ${(baselineEsc * 100).toFixed(0)}% → ${(afterEsc * 100).toFixed(0)}% (${escDelta > 0 ? "+" : ""}${(escDelta * 100).toFixed(1)}pp)`);

  if (regressionDetected) {
    log(`  REGRESSION DETECTED: escalation increased by ${(escDelta * 100).toFixed(1)}pp > ${config.maxRegressionPp}pp threshold`);
    log(`  Rejecting changes.`);
  }

  // 9. SAVE (unless dry run or regression)
  let saved = false;
  if (!config.dryRun && !regressionDetected) {
    savePerson(model, config.dataDir);
    saved = true;
    log(`  Saved improved model.`);
  } else if (config.dryRun) {
    log(`  Dry run — not saving.`);
  }

  const topicsCovered = [...new Set(clusterResult.clusters.flatMap(c => c.topics))];

  return {
    personId: config.personId,
    timestamp: Date.now(),
    beforeNodes, beforeBranches, beforeEscalationRate: baselineEsc,
    instancesRun: config.instanceCount,
    branchesHarvested: harvest.branches.length,
    clustersFormed: clusterResult.clusters.length,
    convergentClusters: clusterResult.convergentClusters,
    afterNodes: afterMaintenanceNodes, afterBranches: afterMaintenanceBranches, afterEscalationRate: afterEsc,
    nodesAdded: afterMaintenanceNodes - beforeNodes,
    branchesAdded,
    escalationDelta: escDelta,
    pruned: maintenance.pruned,
    deduplicated: maintenance.deduplicated,
    chanceNodesRemoved: maintenance.chanceNodesRemoved,
    promptEvolutions,
    validated: true,
    regressionDetected,
    saved,
    weakTopicsTargeted: signals.weakTopics,
    topicsCovered,
    elapsedMs: Date.now() - start,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Clone a person model for training — preserves tree structure but
 * creates independent conversation state so instances don't interfere.
 */
function cloneModelForTraining(source: PersonModel, newId: string): PersonModel {
  const clone: PersonModel = JSON.parse(JSON.stringify(source));
  clone.personId = newId;
  // Reset conversation state (each instance gets a fresh session)
  clone.conversation = {
    recentMessages: [],
    currentTopics: [],
    emotionalState: "neutral",
    sessionStart: Date.now(),
    turnsThisSession: 0,
  };
  return clone;
}

/**
 * Run benchmark N times and average the escalation rate.
 * Runs are independent (separate model clones) — safe to parallelize
 * when handlers are stateless (real LLM APIs). Sequential for mock
 * handlers that share module-level pendingCapture state.
 */
async function averageBenchmark(model: PersonModel, runs: number): Promise<number> {
  // Sequential for now — pendingCapture is module-level.
  // TODO: With per-instance capture state, these can be Promise.all.
  let totalEsc = 0;
  for (let i = 0; i < runs; i++) {
    const benchModel = cloneModelForTraining(model, `bench_${i}`);
    const run = await runBenchmark(benchModel);
    resolveDecisionFailure();
    totalEsc += run.results.filter(r => r.escalated).length / run.results.length;
  }
  return totalEsc / runs;
}
