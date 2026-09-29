/** The homestead curriculum: several lives on fresh land, the skill graph kept
 * between them, memories not. Each life has one goal; the table shows how the
 * model's share of the work (planner calls) falls as the graph grows, and what
 * happens when the land changes or the world has to grow.
 *
 *   npx tsx src/learning/homestead/run-homestead.ts            # offline stand-in planner
 *   npx tsx src/learning/homestead/run-homestead.ts --live     # Gemini plans (bounded)
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { reportGap } from "../../spirits/observation-aggregator";
import { SkillGraph, countActs } from "../skill-graph";
import { SkillSolver, type Planner } from "../skill-runtime";
import { GROWTH_PATCHES, HOMESTEAD, RAFT, variantHomestead, type HomesteadDef } from "./recipes";
import { Homestead } from "./world";
import { geminiPlanner, manualPlanner, type GeminiPlannerStats } from "./planners";

export type Life = { goal: string; land: "home" | "variant"; commission?: "raft" };
export const CURRICULUM: Life[] = [
  { goal: "cabin", land: "home" },
  { goal: "cabin", land: "home" },
  { goal: "cabin", land: "variant" },
  { goal: "raft", land: "home", commission: "raft" },
  { goal: "raft", land: "variant", commission: "raft" },
];

export type LifeReport = { life: number; goal: string; land: string; done: boolean; plannerCalls: number; acts: number;
  skillRuns: number; skillFailures: number; learned: number; graphSize: number; gaps: string[]; grew: string[] };

/** Apply what the world has grown so far to a fresh land's definition. */
function grownDef(base: HomesteadDef, grown: readonly string[]): HomesteadDef {
  const def = structuredClone(base);
  const firstPlaceOf = (kind: string) => def.places.find(p => p.kind === kind)?.id;
  for (const item of grown) {
    const patch = GROWTH_PATCHES[item];
    if (!patch) continue;
    // Patches name kinds of place ("woods"); land them in this land's place of that kind.
    def.things.push(...patch.things.map(t => ({ ...t, id: `${t.id}-${def.id}`, place: firstPlaceOf(t.place) ?? t.place })));
    def.recipes.push(...patch.recipes);
  }
  return def;
}

export async function runCurriculum(options: { planner: "manual" | "gemini"; lives?: Life[]; graph?: SkillGraph; log?: (line: string) => void;
  maxPlannerCalls?: number }): Promise<{ reports: LifeReport[]; graph: SkillGraph; gemini?: GeminiPlannerStats }> {
  const graph = options.graph ?? new SkillGraph();
  const gemini: GeminiPlannerStats = { calls: 0, tokensIn: 0, tokensOut: 0, malformed: 0 };
  const grown: string[] = [];
  const reports: LifeReport[] = [];
  let land: Homestead | undefined;
  const planner: Planner = options.planner === "gemini" ? geminiPlanner(gemini, { log: options.log }) : manualPlanner(() => land!);
  for (const life of options.lives ?? CURRICULUM) {
    graph.lives++;
    const base = life.land === "home" ? HOMESTEAD : variantHomestead();
    land = new Homestead(grownDef(base, grown));
    if (life.commission === "raft") land.addStructure(RAFT); // God commissions a raft
    const before = graph.skills.size;
    const gaps: string[] = [], grew: string[] = [];
    const solver = new SkillSolver(land, graph, planner, { life: graph.lives, maxPlannerCalls: options.maxPlannerCalls ?? 40, log: options.log,
      onGap: (item, detail) => { gaps.push(item); reportGap("homestead", "resource_gap", `Residents lack ${item}`, detail, "medium", land!.world); } });
    let done = await solver.solve(life.goal, 1);
    // The world grows where residents keep lacking something nothing gives.
    for (const item of gaps.filter(item => GROWTH_PATCHES[item] && !grown.includes(item))) {
      const patch = GROWTH_PATCHES[item];
      for (const thing of patch.things) land.addThing({ ...thing, place: land.def.places.find(p => p.kind === thing.place)?.id ?? thing.place });
      for (const recipe of patch.recipes) land.addRecipe(recipe);
      grown.push(item); grew.push(item);
      solver.clearGap(item); solver.clearGap(life.goal);
      options.log?.(`world grew: ${patch.reason}`);
    }
    if (!done && grew.length) done = await solver.solve(life.goal, 1);
    reports.push({ life: graph.lives, goal: life.goal, land: land.def.id, done, plannerCalls: solver.stats.plannerCalls, acts: solver.stats.acts,
      skillRuns: solver.stats.skillRuns, skillFailures: solver.stats.skillFailures, learned: graph.skills.size - before, graphSize: graph.skills.size,
      gaps: [...new Set(gaps)], grew });
    land.stop();
  }
  return { reports, graph, gemini: options.planner === "gemini" ? gemini : undefined };
}

export function formatReports(reports: LifeReport[]): string {
  const head = "life  goal   land                   done  planner calls  acts  skill runs  new skills  graph  notes";
  return [head, ...reports.map(r => [String(r.life).padEnd(5), r.goal.padEnd(6), r.land.padEnd(22), (r.done ? "yes" : "NO").padEnd(5),
    String(r.plannerCalls).padEnd(14), String(r.acts).padEnd(5), `${r.skillRuns}${r.skillFailures ? ` (${r.skillFailures} failed)` : ""}`.padEnd(11),
    String(r.learned).padEnd(11), String(r.graphSize).padEnd(6),
    [r.gaps.length ? `lacked ${r.gaps.join(", ")}` : "", r.grew.length ? `world grew: ${r.grew.join(", ")}` : ""].filter(Boolean).join("; ")].join(" "))].join("\n");
}

async function main(argv: string[]) {
  const live = argv.includes("--live");
  const graphPath = argv.includes("--graph") ? resolve(argv[argv.indexOf("--graph") + 1]) : undefined;
  if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) { console.log("--live needs GOOGLE_GENERATIVE_AI_API_KEY"); return 2; }
  const graph = graphPath && existsSync(graphPath) ? SkillGraph.fromJson(JSON.parse(readFileSync(graphPath, "utf8"))) : new SkillGraph();
  const verbose = argv.includes("--verbose");
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { if (verbose) originalLog(...args); }; // engine chatter off
  const { reports, gemini } = await runCurriculum({ planner: live ? "gemini" : "manual", graph, maxPlannerCalls: live ? 30 : 40,
    log: verbose ? line => originalLog(line) : undefined });
  console.log = originalLog;
  console.log(`Homestead curriculum — planner: ${live ? "Gemini (live)" : "manual stand-in (offline)"}\n`);
  console.log(formatReports(reports));
  if (gemini) console.log(`\nGemini: ${gemini.calls} calls, ${gemini.tokensIn}/${gemini.tokensOut} tokens in/out, ${gemini.malformed} malformed`);
  console.log(`\nSkills (${graph.skills.size}):`);
  for (const skill of graph.skills.values())
    console.log(`  ${skill.id}  gives ${JSON.stringify(skill.effect.gives)}  needs ${JSON.stringify(skill.effect.needs)}  uses ${skill.effect.requires.join(",") || "-"}  acts ${countActs(skill.tree)}  ${skill.stats.successes}/${skill.stats.runs} ok`);
  console.log(`\nHow a cabin is made now:\n${JSON.stringify(graph.expand("cabin"), null, 1).slice(0, 4000)}`);
  if (graphPath) writeFileSync(graphPath, JSON.stringify(graph.toJson(), null, 2) + "\n");
  return reports.every(r => r.done) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(code => process.exit(code));
