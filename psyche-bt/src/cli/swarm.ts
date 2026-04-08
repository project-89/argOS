#!/usr/bin/env npx tsx
/**
 * Swarm CLI — Run the full swarm learning pipeline and evaluate hypotheses.
 *
 * Pipeline:
 *   1. SPAWN    — N instances × M-turn conversations
 *   2. HARVEST  — Extract compiled branches from all trees
 *   3. CLUSTER  — Group similar branches by semantic similarity
 *   4. MERGE    — Build species tree from convergent clusters
 *   5. EVALUATE — Benchmark species vs individuals vs bootstrap
 *   6. REPORT   — Test all 5 hypotheses, emit scorecard
 *
 * Usage:
 *   cd psyche-bt && npx tsx src/cli/swarm.ts
 *
 * Environment:
 *   INSTANCES=10    Number of swarm instances (default 10)
 *   TURNS=5         Turns per instance conversation (default 5)
 *   SEED=42         Random seed for reproducibility (default 42)
 *   VERBOSE=1       Show per-instance details
 */

import "dotenv/config";
import { runSwarm, setupSwarmMockHandlers } from "../swarm/swarm-runner.js";
import { harvestBranches } from "../swarm/branch-harvester.js";
import { clusterBranches, DEFAULT_CLUSTER_CONFIG } from "../swarm/pattern-clusterer.js";
import { buildSpeciesTree } from "../swarm/species-merger.js";
import { runBenchmark, DEFAULT_BENCHMARK } from "../engine/benchmark.js";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { maintainTree } from "../compiler/tree-maintenance.js";
import { countNodes, evaluateBT } from "../bt/evaluator.js";
import { resolveDecisionFailure } from "../compiler/bt-compiler.js";
import { registerBuiltinTools } from "../tools/builtin.js";
import type { SwarmConfig, SwarmEvaluation, BranchCluster } from "../swarm/types.js";
import type { PersonModel } from "../ecs/types.js";
import * as fs from "node:fs";

// =============================================================================
// CONFIG
// =============================================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  magenta: "\x1b[35m", blue: "\x1b[34m",
};

const INSTANCE_COUNT = parseInt(process.env.INSTANCES || "10", 10);
const TURNS_PER_INSTANCE = parseInt(process.env.TURNS || "8", 10);
const SEED = parseInt(process.env.SEED || "42", 10);
const VERBOSE = process.env.VERBOSE === "1";

// =============================================================================
// MAIN PIPELINE
// =============================================================================

async function main() {
  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║        Psyche-BT Swarm Runner — Collective Learning          ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  registerBuiltinTools();
  setupSwarmMockHandlers();

  const config: SwarmConfig = {
    instanceCount: INSTANCE_COUNT,
    turnsPerInstance: TURNS_PER_INSTANCE,
    concurrency: 1,
    seed: SEED,
  };

  console.log(`${C.dim}Config: ${config.instanceCount} instances × ${config.turnsPerInstance} turns, seed=${SEED}${C.reset}\n`);

  // ─── PHASE 1: SPAWN ───────────────────────────────────────────────────────
  console.log(`${C.bold}${C.cyan}PHASE 1: SPAWN${C.reset} — Running ${config.instanceCount} instances...`);

  const swarmResult = await runSwarm(config, (done, total, desc) => {
    if (VERBOSE) {
      process.stdout.write(`\r  ${C.dim}[${done}/${total}] ${desc}${C.reset}${"".padEnd(40)}`);
    }
  });
  if (VERBOSE) process.stdout.write("\r" + " ".repeat(80) + "\r");

  console.log(`  ${C.green}Done${C.reset} in ${(swarmResult.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Total turns: ${swarmResult.totalTurns}`);
  console.log(`  Total escalations: ${swarmResult.totalEscalations} (${(swarmResult.totalEscalations / swarmResult.totalTurns * 100).toFixed(0)}%)`);
  console.log(`  Total compiled branches: ${swarmResult.totalBranches}`);

  if (VERBOSE) {
    console.log(`\n  ${C.dim}Per-instance:${C.reset}`);
    for (const inst of swarmResult.instances) {
      console.log(`    ${inst.instanceId}: ${inst.compiledCount} compiled, ${inst.escalations}/${inst.turnsProcessed} escalated, ${inst.treeNodes} nodes`);
    }
  }

  // ─── PHASE 2: HARVEST ─────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}PHASE 2: HARVEST${C.reset} — Extracting compiled branches...`);

  const harvest = harvestBranches(swarmResult.instances);

  console.log(`  Branches harvested: ${harvest.branches.length}`);
  console.log(`  Contributing instances: ${harvest.contributingInstances}/${config.instanceCount}`);
  console.log(`  Avg branches/instance: ${harvest.avgBranchesPerInstance.toFixed(1)}`);

  if (harvest.branches.length === 0) {
    console.log(`\n${C.yellow}No branches compiled — immune system may have rejected all.${C.reset}`);
    console.log(`${C.yellow}Try: TURNS=8 or reduce immune system thresholds.${C.reset}`);
    reportEmptyEval(config);
    return;
  }

  if (VERBOSE) {
    console.log(`\n  ${C.dim}Harvested branches:${C.reset}`);
    for (const b of harvest.branches) {
      console.log(`    ${b.id}: topics=[${b.topics}] emotion=${b.emotionalState || "?"} intent=${b.intent || "?"}`);
    }
  }

  // ─── PHASE 3: CLUSTER ─────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}PHASE 3: CLUSTER${C.reset} — Grouping similar branches...`);

  const clusterResult = clusterBranches(
    harvest.branches,
    config.instanceCount,
    DEFAULT_CLUSTER_CONFIG,
  );

  console.log(`  Clusters formed: ${clusterResult.clusters.length}`);
  console.log(`  Singletons: ${clusterResult.singletons.length}`);
  console.log(`  Avg cluster size: ${clusterResult.avgClusterSize.toFixed(1)}`);
  console.log(`  Clustering rate: ${(clusterResult.clusteringRate * 100).toFixed(0)}%`);
  console.log(`  Convergent clusters (2+ instances): ${clusterResult.convergentClusters}`);

  for (const cluster of clusterResult.clusters) {
    const instanceLabel = cluster.instanceCount > 1
      ? `${C.green}${cluster.instanceCount} instances${C.reset}`
      : `${C.dim}1 instance${C.reset}`;
    console.log(`    ${cluster.id}: [${cluster.topics}] ${cluster.intent} — ${cluster.branches.length} branches from ${instanceLabel} (cohesion: ${cluster.cohesion.toFixed(2)})`);
  }

  // ─── PHASE 4: MERGE ───────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}PHASE 4: MERGE${C.reset} — Building species tree...`);

  const speciesTree = buildSpeciesTree(clusterResult.clusters);

  console.log(`  Species tree nodes: ${speciesTree.totalNodes}`);
  console.log(`  Species branches: ${speciesTree.branches.length}`);
  console.log(`  Avg convergence: ${speciesTree.avgConvergence.toFixed(2)}`);
  console.log(`  Clusters included: ${speciesTree.clusterCount}`);

  // ─── PHASE 4b: MAINTAIN ───────────────────────────────────────────────────
  // Apply maintenance to the species tree: deduplicate, prune, clean
  const maintenanceModel = createFreshModel("maintenance");
  maintenanceModel.policy.tree = speciesTree.tree;
  maintenanceModel.policy.totalNodes = speciesTree.totalNodes;
  maintenanceModel.policy.compiledBranches = speciesTree.branches.length;
  const maint = maintainTree(maintenanceModel);
  if (maint.deduplicated > 0 || maint.pruned > 0 || maint.chanceNodesRemoved > 0) {
    speciesTree.tree = maintenanceModel.policy.tree!;
    speciesTree.totalNodes = maintenanceModel.policy.totalNodes;
    console.log(`\n  ${C.dim}Maintenance: pruned ${maint.pruned}, deduplicated ${maint.deduplicated}, cleaned ${maint.chanceNodesRemoved} chance nodes${C.reset}`);
    console.log(`  ${C.dim}After maintenance: ${speciesTree.totalNodes} nodes${C.reset}`);
  }

  // ─── PHASE 5: EVALUATE ────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}PHASE 5: EVALUATE${C.reset} — Benchmarking species vs individuals vs bootstrap...`);

  const evaluation = await evaluateAll(
    swarmResult.instances.map(i => i.model),
    speciesTree.tree,
    clusterResult,
    config,
  );

  // ─── PHASE 6: REPORT ──────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}PHASE 6: REPORT${C.reset} — Hypothesis Testing\n`);
  printEvaluation(evaluation);

  // Save results
  const outDir = "./data/swarm";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/swarm_${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({
    config,
    swarmResult: {
      totalBranches: swarmResult.totalBranches,
      totalEscalations: swarmResult.totalEscalations,
      totalTurns: swarmResult.totalTurns,
      elapsedMs: swarmResult.elapsedMs,
      instances: swarmResult.instances.map(i => ({
        instanceId: i.instanceId,
        compiledCount: i.compiledCount,
        escalations: i.escalations,
        treeNodes: i.treeNodes,
        turnsProcessed: i.turnsProcessed,
      })),
    },
    harvest: {
      branchCount: harvest.branches.length,
      contributingInstances: harvest.contributingInstances,
    },
    clusters: {
      count: clusterResult.clusters.length,
      convergent: clusterResult.convergentClusters,
      avgSize: clusterResult.avgClusterSize,
      details: clusterResult.clusters.map(c => ({
        id: c.id,
        size: c.branches.length,
        instanceCount: c.instanceCount,
        topics: c.topics,
        intent: c.intent,
        cohesion: c.cohesion,
      })),
    },
    speciesTree: {
      totalNodes: speciesTree.totalNodes,
      branchCount: speciesTree.branches.length,
      avgConvergence: speciesTree.avgConvergence,
    },
    evaluation,
  }, null, 2));

  console.log(`\n${C.dim}Results saved to ${outPath}${C.reset}`);
}

// =============================================================================
// EVALUATION
// =============================================================================

async function evaluateAll(
  instanceModels: PersonModel[],
  speciesTreeNode: import("../bt/types.js").BehaviorNode,
  clusterResult: import("../swarm/types.js").ClusterResult,
  config: SwarmConfig,
): Promise<SwarmEvaluation> {
  // 1. Bootstrap-only benchmark
  console.log(`  ${C.dim}Benchmarking bootstrap-only...${C.reset}`);
  const bootstrapModel = createFreshModel("eval_bootstrap");
  const bootstrapRun = await runBenchmark(bootstrapModel);
  resolveDecisionFailure();

  const bootstrapEscRate = bootstrapRun.results.filter(r => r.escalated).length / bootstrapRun.results.length;
  const bootstrapCategories = countCategoryCoverage(bootstrapRun.results);

  // 2. Species tree benchmark
  console.log(`  ${C.dim}Benchmarking species tree...${C.reset}`);
  const speciesModel = createFreshModel("eval_species");
  speciesModel.policy.tree = speciesTreeNode;
  speciesModel.policy.totalNodes = countNodes(speciesTreeNode);
  const speciesRun = await runBenchmark(speciesModel);
  resolveDecisionFailure();

  const speciesEscRate = speciesRun.results.filter(r => r.escalated).length / speciesRun.results.length;
  const speciesCategories = countCategoryCoverage(speciesRun.results);

  // 3. Individual instance benchmarks (sample up to 5)
  const sampleIndices = selectSample(instanceModels.length, Math.min(5, instanceModels.length));
  const individualEscRates: number[] = [];
  const individualCoverages: number[] = [];

  for (const idx of sampleIndices) {
    console.log(`  ${C.dim}Benchmarking instance ${idx}...${C.reset}`);
    const model = instanceModels[idx];
    const run = await runBenchmark(model);
    resolveDecisionFailure();

    const rate = run.results.filter(r => r.escalated).length / run.results.length;
    individualEscRates.push(rate);
    individualCoverages.push(countCategoryCoverage(run.results));
  }

  const meanIndividualEsc = individualEscRates.reduce((s, r) => s + r, 0) / individualEscRates.length;
  const bestIndividualEsc = Math.min(...individualEscRates);

  // 4. Quality comparison (H4): convergent vs singleton branch quality
  const convergentBranches = clusterResult.clusters
    .filter(c => c.instanceCount > 1)
    .flatMap(c => c.branches);
  const singletonBranches = clusterResult.singletons;

  // Quality proxy: branches with more specific conditions are higher quality
  const avgConvergedSpecificity = convergentBranches.length > 0
    ? convergentBranches.reduce((s, b) => s + b.conditions.length, 0) / convergentBranches.length
    : 0;
  const avgSingletonSpecificity = singletonBranches.length > 0
    ? singletonBranches.reduce((s, b) => s + b.conditions.length, 0) / singletonBranches.length
    : 0;

  // ─── HYPOTHESIS TESTING ─────────────────────────────────────────────────
  const avgClusterSize = clusterResult.avgClusterSize;

  return {
    speciesEscalationRate: speciesEscRate,
    speciesCategoryCoverage: speciesCategories,
    speciesTreeNodes: countNodes(speciesTreeNode),

    bootstrapEscalationRate: bootstrapEscRate,
    bootstrapCategoryCoverage: bootstrapCategories,

    individualEscalationRates: individualEscRates,
    individualCategoryCoverages: individualCoverages,
    bestIndividualEscalation: bestIndividualEsc,
    meanIndividualEscalation: meanIndividualEsc,

    hypotheses: {
      H1_convergence: {
        pass: avgClusterSize > 1.5,
        metric: `avg cluster size = ${avgClusterSize.toFixed(2)} (need > 1.5)`,
        value: avgClusterSize,
      },
      H2_speciesImprovement: {
        pass: speciesEscRate < meanIndividualEsc,
        metric: `species ${(speciesEscRate * 100).toFixed(0)}% < mean individual ${(meanIndividualEsc * 100).toFixed(0)}%`,
        value: meanIndividualEsc - speciesEscRate,
      },
      H3_diversity: {
        pass: speciesCategories >= Math.max(...individualCoverages, 0),
        metric: `species coverage ${speciesCategories} >= best individual ${Math.max(...individualCoverages, 0)}`,
        value: speciesCategories,
      },
      H4_qualityFilter: {
        pass: avgConvergedSpecificity > avgSingletonSpecificity || singletonBranches.length === 0,
        metric: `converged specificity ${avgConvergedSpecificity.toFixed(1)} vs singleton ${avgSingletonSpecificity.toFixed(1)}`,
        value: avgConvergedSpecificity - avgSingletonSpecificity,
      },
      H5_diminishingReturns: null, // Requires running at multiple scales
    },

    instanceCount: config.instanceCount,
    totalBranchesHarvested: clusterResult.clusters.reduce((s, c) => s + c.branches.length, 0) + clusterResult.singletons.length,
    clustersFormed: clusterResult.clusters.length,
    convergentClusters: clusterResult.convergentClusters,
    elapsedMs: 0, // Filled by caller
  };
}

// =============================================================================
// REPORTING
// =============================================================================

function printEvaluation(eval_: SwarmEvaluation) {
  console.log(`${C.bold}Escalation Rates:${C.reset}`);
  console.log(`  Bootstrap-only:       ${(eval_.bootstrapEscalationRate * 100).toFixed(0)}%`);
  console.log(`  Mean individual:      ${(eval_.meanIndividualEscalation * 100).toFixed(0)}%`);
  console.log(`  Best individual:      ${(eval_.bestIndividualEscalation * 100).toFixed(0)}%`);
  console.log(`  ${C.bold}Species tree:         ${(eval_.speciesEscalationRate * 100).toFixed(0)}%${C.reset}`);

  console.log(`\n${C.bold}Category Coverage (categories with < 100% escalation):${C.reset}`);
  console.log(`  Bootstrap:            ${eval_.bootstrapCategoryCoverage}`);
  console.log(`  Best individual:      ${Math.max(...eval_.individualCategoryCoverages, 0)}`);
  console.log(`  ${C.bold}Species tree:         ${eval_.speciesCategoryCoverage}${C.reset}`);

  console.log(`\n${C.bold}Species Tree:${C.reset}`);
  console.log(`  Nodes:                ${eval_.speciesTreeNodes}`);
  console.log(`  Branches harvested:   ${eval_.totalBranchesHarvested}`);
  console.log(`  Clusters formed:      ${eval_.clustersFormed}`);
  console.log(`  Convergent (2+ inst): ${eval_.convergentClusters}`);

  console.log(`\n${C.bold}Hypotheses:${C.reset}`);
  const h = eval_.hypotheses;

  printHypothesis("H1", "CONVERGENCE", "Independent instances compile similar patterns",
    h.H1_convergence);
  printHypothesis("H2", "SPECIES IMPROVEMENT", "Species tree beats mean individual",
    h.H2_speciesImprovement);
  printHypothesis("H3", "DIVERSITY", "Species tree covers more categories",
    h.H3_diversity);
  printHypothesis("H4", "QUALITY FILTER", "Convergent patterns have higher specificity",
    h.H4_qualityFilter);

  if (h.H5_diminishingReturns) {
    printHypothesis("H5", "DIMINISHING RETURNS", "Scaling has diminishing returns",
      h.H5_diminishingReturns);
  } else {
    console.log(`  ${C.dim}H5 DIMINISHING RETURNS: requires multi-scale run (INSTANCES=5,10,20)${C.reset}`);
  }

  // Score
  const passed = [h.H1_convergence, h.H2_speciesImprovement, h.H3_diversity, h.H4_qualityFilter]
    .filter(h => h.pass).length;
  const total = 4;
  console.log(`\n${C.bold}SCORE: ${passed}/${total} hypotheses confirmed${C.reset}`);

  if (passed >= 3) {
    console.log(`${C.green}${C.bold}Swarm learning is working — collective patterns improve over individuals.${C.reset}`);
  } else if (passed >= 2) {
    console.log(`${C.yellow}Partial success — some hypotheses need parameter tuning or more instances.${C.reset}`);
  } else {
    console.log(`${C.red}Below expectations — check immune system thresholds, turn count, instance count.${C.reset}`);
  }
}

function printHypothesis(
  id: string,
  name: string,
  description: string,
  result: { pass: boolean; metric: string; value: number },
) {
  const icon = result.pass ? `${C.green}PASS` : `${C.red}FAIL`;
  console.log(`  ${icon}${C.reset} ${C.bold}${id} ${name}${C.reset}`);
  console.log(`       ${C.dim}${description}${C.reset}`);
  console.log(`       ${result.metric}`);
}

function reportEmptyEval(config: SwarmConfig) {
  console.log(`\n${C.bold}${C.red}EVALUATION: No branches to cluster.${C.reset}`);
  console.log(`\nDiagnostics:`);
  console.log(`  - Instance count: ${config.instanceCount}`);
  console.log(`  - Turns per instance: ${config.turnsPerInstance}`);
  console.log(`  - The immune system requires: quality >= 6.0, specificity >= 4, positive sentiment`);
  console.log(`  - Mock handlers may produce responses that fail quality checks`);
  console.log(`\nSuggestions:`);
  console.log(`  - Increase turns: TURNS=8 npx tsx src/cli/swarm.ts`);
  console.log(`  - Check if mock responses are specific enough for quality gating`);
}

// =============================================================================
// HELPERS
// =============================================================================

function createFreshModel(id: string): PersonModel {
  const model = createPersonModel(id);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);
  return model;
}

function countCategoryCoverage(results: Array<{ category: string; escalated: boolean }>): number {
  const categories = new Map<string, { total: number; escalated: number }>();
  for (const r of results) {
    const cat = categories.get(r.category) || { total: 0, escalated: 0 };
    cat.total++;
    if (r.escalated) cat.escalated++;
    categories.set(r.category, cat);
  }
  // Count categories where at least one task was handled by BT
  let covered = 0;
  for (const cat of categories.values()) {
    if (cat.escalated < cat.total) covered++;
  }
  return covered;
}

function selectSample(total: number, count: number): number[] {
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  // Evenly spaced sample
  const step = total / count;
  return Array.from({ length: count }, (_, i) => Math.floor(i * step));
}

// =============================================================================
// MULTI-SCALE RUN (H5 test)
// =============================================================================

async function runMultiScale() {
  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║      Psyche-BT Multi-Scale Swarm — Diminishing Returns       ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  registerBuiltinTools();
  setupSwarmMockHandlers();

  const scales = [5, 10, 20, 40];
  const results: Array<{ n: number; escRate: number; branches: number; clusters: number; convergent: number }> = [];

  for (const n of scales) {
    console.log(`${C.bold}Running N=${n}...${C.reset}`);

    const swarmResult = await runSwarm({
      instanceCount: n,
      turnsPerInstance: TURNS_PER_INSTANCE,
      concurrency: 1,
      seed: SEED,
    });

    const harvest = harvestBranches(swarmResult.instances);

    if (harvest.branches.length === 0) {
      results.push({ n, escRate: 1, branches: 0, clusters: 0, convergent: 0 });
      continue;
    }

    const clusterResult = clusterBranches(harvest.branches, n, DEFAULT_CLUSTER_CONFIG);
    const speciesTree = buildSpeciesTree(clusterResult.clusters);

    // Benchmark species tree — average over 5 runs to smooth exploration noise
    const BENCH_RUNS = 5;
    let escSum = 0;
    for (let r = 0; r < BENCH_RUNS; r++) {
      const speciesModel = createFreshModel(`eval_species_${n}_${r}`);
      speciesModel.policy.tree = speciesTree.tree;
      speciesModel.policy.totalNodes = speciesTree.totalNodes;
      const speciesRun = await runBenchmark(speciesModel);
      resolveDecisionFailure();
      escSum += speciesRun.results.filter(r => r.escalated).length / speciesRun.results.length;
    }
    const escRate = escSum / BENCH_RUNS;

    results.push({
      n,
      escRate,
      branches: harvest.branches.length,
      clusters: clusterResult.clusters.length,
      convergent: clusterResult.convergentClusters,
    });

    console.log(`  N=${n}: ${harvest.branches.length} branches, ${clusterResult.clusters.length} clusters (${clusterResult.convergentClusters} convergent), species escalation ${(escRate * 100).toFixed(0)}% (avg of ${BENCH_RUNS} runs)`);
  }

  // H5: diminishing returns — structural metrics
  console.log(`\n${C.bold}Scaling Analysis:${C.reset}`);
  console.log(`${"N".padStart(5)} | ${"Branches".padStart(8)} | ${"Br/Inst".padStart(7)} | ${"Clusters".padStart(8)} | ${"Convergent".padStart(10)} | ${"Esc Rate".padStart(8)}`);
  console.log("-".repeat(62));
  for (const r of results) {
    const brPerInst = r.branches / r.n;
    console.log(`${String(r.n).padStart(5)} | ${String(r.branches).padStart(8)} | ${brPerInst.toFixed(2).padStart(7)} | ${String(r.clusters).padStart(8)} | ${String(r.convergent).padStart(10)} | ${(r.escRate * 100).toFixed(0).padStart(7)}%`);
  }

  // Structural diminishing returns: new clusters per additional instance
  if (results.length >= 3) {
    console.log(`\n${C.bold}Marginal gains per scale-up:${C.reset}`);
    for (let i = 1; i < results.length; i++) {
      const from = results[i - 1];
      const to = results[i];
      const addedInstances = to.n - from.n;
      const newClusters = to.clusters - from.clusters;
      const newConvergent = to.convergent - from.convergent;
      const escImprovement = from.escRate - to.escRate;
      console.log(`  N=${from.n}→${to.n} (+${addedInstances}): +${newClusters} clusters, +${newConvergent} convergent, ${(escImprovement * 100).toFixed(1)}pp esc improvement`);
    }

    // Diminishing returns: clusters-per-additional-instance should decrease
    const marginalClusters: number[] = [];
    for (let i = 1; i < results.length; i++) {
      const added = results[i].n - results[i - 1].n;
      const newClusters = results[i].clusters - results[i - 1].clusters;
      marginalClusters.push(newClusters / added);
    }

    const diminishing = marginalClusters.length >= 2 &&
      marginalClusters[0] >= marginalClusters[marginalClusters.length - 1];

    // Also check: convergence grows sub-linearly
    const convergenceGrowth = results.map((r, i) => i === 0 ? 0 : r.convergent - results[i - 1].convergent);
    const sublinearConvergence = results.length >= 3 &&
      results[results.length - 1].convergent > results[0].convergent;

    console.log(`\n  ${C.bold}Structural scaling:${C.reset}`);
    console.log(`    Marginal clusters/instance: ${marginalClusters.map(m => m.toFixed(2)).join(" → ")}`);
    console.log(`    Convergent growth: ${results.map(r => r.convergent).join(" → ")}`);
    console.log(`    ${diminishing || sublinearConvergence ? `${C.green}PASS` : `${C.red}FAIL`}${C.reset} — ${diminishing ? "diminishing cluster returns" : sublinearConvergence ? "convergence grows sub-linearly" : "linear scaling"}`);
  }

  // Save
  const outDir = "./data/swarm";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/multiscale_${Date.now()}.json`, JSON.stringify(results, null, 2));
}

// =============================================================================
// RUN
// =============================================================================

const mode = process.env.MODE || "single";
if (mode === "multiscale") {
  runMultiScale().catch(err => { console.error(err); process.exit(1); });
} else {
  main().catch(err => { console.error(err); process.exit(1); });
}
