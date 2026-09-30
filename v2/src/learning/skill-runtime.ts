/** Running the skill graph: get N of something.
 *
 * 1. Have enough already: done.
 * 2. A learned skill gives it: run its tree. `ensure` nodes recurse into this
 *    same solver (composition by effect). A skill that fails is recorded and
 *    the next producer is tried.
 * 3. Nothing learned gives it: ask the planner (the model) once for the direct
 *    steps. When a step reports what it lacks, that becomes a sub-goal solved
 *    the same way, and the step is retried. If the item was gained, the
 *    executed steps — with an `ensure` wherever a sub-goal filled a gap — are
 *    kept as a new skill with its observed needs and gives.
 * 4. Nothing works: report the gap (the world may need to grow).
 *
 * The planner is called only for what the graph cannot yet make, so the
 * model's share of the work shrinks as the graph grows. */
import type { Act, ActResult } from "./homestead/world";
import { SkillGraph, stockDelta, type GraphSkill, type Ref, type SkillNode, type Stock } from "./skill-graph";

/** What the runtime needs from a world. Acts may take (simulated) time: a
 * timed world resolves the promise when the act completes. */
export interface SkillEnv {
  have(): Stock;
  act(action: Act): ActResult | Promise<ActResult>;
  observation(): string;
  /** The concrete name for a kind of thing here / a place (undefined: none suitable). */
  bind(ref: Ref): string | undefined;
  /** A concrete act as kinds: the target's kind, or where a following act's target stands. */
  abstract(action: Act, next?: Act): { verb: string; target?: Ref; arg?: string };
  /** Walk to where a kind of thing is (walking is native, not learned). */
  approach(ref: Ref): boolean | Promise<boolean>;
  /** Kinds that are not made (coin, a lifetime): never a sub-goal. */
  unsolvable?(kind: string): boolean;
  /** The world's clock (seconds), to learn how long ways of doing things take. */
  now?(): number;
}

export type PlannedStep = Act;
export type PlanRequest = { goal: { item: string; count: number }; have: Stock; observation: string; knownSkills: string[]; failures: string[] };
export type Planner = (request: PlanRequest) => Promise<PlannedStep[]>;

export type SolveStats = { plannerCalls: number; acts: number; skillRuns: number; skillFailures: number; learned: string[]; gaps: string[] };
export type SolverOptions = { maxDepth?: number; maxPlannerCalls?: number; maxIterations?: number; life?: number;
  onGap?: (item: string, detail: string) => void; log?: (line: string) => void;
  /** Checked before every act: true abandons the current work (something more urgent, like thirst). */
  interrupt?: () => boolean;
  /** A learned way failed for a reason other than shortage: a surprise worth attention. */
  onSurprise?: (item: string, skillId: string, detail: string) => void };

/** One plan's own record: its acts, and what those acts themselves took and
 * gave (not what sub-goals made along the way — that is their skills' effect). */
type FrameAct = { node: SkillNode; gave?: Stock; took?: Stock; used?: string[] };
type Frame = { acts: FrameAct[]; requires: Set<string>; gives: Stock; needs: Stock };
const addStock = (into: Stock, delta: Stock) => { for (const [k, n] of Object.entries(delta)) into[k] = (into[k] ?? 0) + n; };

export class SkillSolver {
  readonly stats: SolveStats = { plannerCalls: 0, acts: 0, skillRuns: 0, skillFailures: 0, learned: [], gaps: [] };
  private readonly active = new Set<string>();
  /** Set when an act failed for want of goods (not knowledge) since the last check. */
  private scarcity = false;
  /** Set when an act lacked a material that could not be got (short of stone for a foundation) since the last check. */
  private shortOf?: string;
  /** What the world said the last time an act failed. */
  private lastFailure?: string;
  private readonly soughtAlternative = new Set<string>();
  private readonly maxDepth: number; private readonly maxPlannerCalls: number; private readonly maxIterations: number;

  constructor(private readonly env: SkillEnv, readonly graph: SkillGraph, private readonly planner: Planner, private readonly options: SolverOptions = {}) {
    this.maxDepth = options.maxDepth ?? 8;
    this.maxPlannerCalls = options.maxPlannerCalls ?? 40;
    this.maxIterations = options.maxIterations ?? 40;
  }
  private log(line: string) { this.options.log?.(line); }
  private have(item: string) { return this.env.have()[item] ?? 0; }

  /** Get to at least `count` of `item`. */
  async solve(item: string, count: number, depth = 0, stack: string[] = []): Promise<boolean> {
    if (this.have(item) >= count) return true;
    if (depth > this.maxDepth || this.stats.gaps.includes(item) || this.env.unsolvable?.(item) || this.options.interrupt?.()) return false;
    const path = [...stack, item];
    // A skill already running further up (mine needs a pickaxe needs a stone) is not a way out here.
    const failed = new Set<string>(this.active);
    const failures: string[] = [];
    let stalls = 0, scarce = false;
    for (let i = 0; i < this.maxIterations && this.have(item) < count; i++) {
      if (this.options.interrupt?.()) return false; // broken off, not a gap
      const before = this.have(item);
      const skill = this.graph.producers(item).find(s => !failed.has(s.id));
      if (skill) {
        this.scarcity = false; this.shortOf = undefined;
        this.stats.skillRuns++; skill.stats.runs++;
        this.log(`${"  ".repeat(depth)}skill ${skill.id} for ${item} (${this.have(item)}/${count})`);
        this.active.add(skill.id);
        const started = this.env.now?.();
        const ok = await this.runNode(skill.tree, depth, path).finally(() => this.active.delete(skill.id));
        if (ok && this.have(item) > before) {
          skill.stats.successes++; stalls = 0;
          if (started !== undefined) { skill.stats.seconds = (skill.stats.seconds ?? 0) + (this.env.now!() - started); skill.stats.timedRuns = (skill.stats.timedRuns ?? 0) + 1; }
          continue;
        }
        failed.add(skill.id);
        // Short of goods is not a failure of the skill, and asking how will not help.
        if (this.scarcity) { scarce = true; failures.push(`The usual way (${skill.id}) is short of goods right now.`); continue; }
        // Short of a material nobody could get: the way is sound; asking how, or looking up in surprise, will not help.
        if (this.shortOf) { scarce = true; failures.push(`The usual way (${skill.id}) is short of ${this.shortOf}.`); continue; }
        skill.stats.failures++; this.stats.skillFailures++;
        failures.push(`The usual way (${skill.id}) did not work this time.`);
        if (!this.options.interrupt?.()) this.options.onSurprise?.(item, skill.id, this.lastFailure ?? "it did not work this time");
        continue;
      }
      // Short of goods every known way: look once for another way (then wait for stock).
      if (scarce && this.soughtAlternative.has(item)) break;
      if (scarce) this.soughtAlternative.add(item);
      if (this.stats.plannerCalls >= this.maxPlannerCalls) break;
      this.scarcity = false; this.shortOf = undefined;
      const learned = await this.plan(item, count, depth, path, failures);
      if (this.have(item) > before) { stalls = 0; continue; }
      // The plan ran into a shortage (a spent tree, a material nobody could get): short, not a gap in knowing how.
      if (!learned && (this.scarcity || this.shortOf)) { scarce = true; if (this.soughtAlternative.has(item)) break; this.soughtAlternative.add(item); }
      if (!learned && ++stalls >= 2) break;
    }
    if (this.have(item) >= count) return true;
    if (scarce) { this.scarcity = true; return false; } // not a gap in the world's making, only in its stock
    if (this.options.interrupt?.()) return false;
    const detail = `Could not get ${count} ${item} (have ${this.have(item)}). ${failures.slice(-3).join(" ")}`.trim();
    if (!this.stats.gaps.includes(item)) { this.stats.gaps.push(item); this.options.onGap?.(item, detail); }
    return false;
  }

  /** Ask the planner for direct steps toward the item, run them, and keep what worked. */
  private async plan(item: string, count: number, depth: number, path: string[], failures: string[]): Promise<boolean> {
    this.stats.plannerCalls++;
    const knownSkills = [...this.graph.skills.values()].map(s => `${Object.keys(s.effect.gives).join("+")} (${s.id})`);
    const steps = await this.planner({ goal: { item, count }, have: this.env.have(), observation: this.env.observation(), knownSkills, failures: failures.slice(-4) })
      .catch(error => { failures.push(`Planning failed: ${error instanceof Error ? error.message : error}`); return [] as PlannedStep[]; });
    this.log(`${"  ".repeat(depth)}plan for ${item}: ${steps.map(s => `${s.verb} ${s.target ?? ""}${s.arg ? ` ${s.arg}` : ""}`).join(" → ") || "(none)"}`);
    if (!steps.length) { failures.push(`No plan for ${item}.`); return false; }
    const startHave = this.env.have();
    const frame: Frame = { acts: [], requires: new Set(), gives: {}, needs: {} };
    for (let i = 0; i < steps.length; i++) {
      const result = await this.actWithRecovery(steps[i], depth, path, frame, steps[i + 1]);
      if (!result.ok) { failures.push(`${steps[i].verb} ${steps[i].target ?? ""}: ${result.summary}`); break; }
    }
    const { gained } = stockDelta(startHave, this.env.have());
    const succeeded = gained[item] > 0 && frame.gives[item] > 0 && frame.acts.length > 0;
    this.keepSteps(frame, succeeded ? item : undefined);
    if (!succeeded) return false;
    const skill = this.graph.learn({ item, count }, { kind: "seq", children: frame.acts.map(a => a.node) },
      { needs: frame.needs, requires: [...frame.requires].filter(r => !(frame.gives[r] > 0)), gives: frame.gives }, this.options.life ?? 0);
    if (!this.stats.learned.includes(skill.id)) this.stats.learned.push(skill.id);
    this.log(`${"  ".repeat(depth)}learned ${skill.id}: needs ${JSON.stringify(skill.effect.needs)} gives ${JSON.stringify(skill.effect.gives)}`);
    return true;
  }

  /** Every act that made something is a way of making it, even inside a plan
   * that did not reach its goal: the stretch since the previous such act
   * (its walk, what it ensured, the act) is kept as a small skill. */
  private keepSteps(frame: Frame, goal: string | undefined): void {
    let start = 0;
    frame.acts.forEach((entry, index) => {
      const products = Object.keys(entry.gave ?? {}).filter(kind => kind !== goal);
      if (!products.length) return;
      const segment = frame.acts.slice(start, index + 1);
      start = index + 1;
      if (goal !== undefined && segment.length === frame.acts.length) return; // that is the whole plan, kept below
      const took: Stock = {};
      for (const row of segment) addStock(took, row.took ?? {});
      for (const product of products) {
        const skill = this.graph.learn({ item: product, count: 1 }, { kind: "seq", children: segment.map(row => row.node) },
          { needs: took, requires: (entry.used ?? []).filter(r => !((entry.gave?.[r] ?? 0) > 0)), gives: { [product]: entry.gave![product] } }, this.options.life ?? 0);
        if (!this.stats.learned.includes(skill.id)) this.stats.learned.push(skill.id);
      }
    });
  }

  /** A gap stays a gap for this life unless the world grows (clearGap). */
  clearGap(item: string): void { this.stats.gaps = this.stats.gaps.filter(gap => gap !== item); }

  /** Do one concrete step; a reported lack becomes a sub-goal, then a retry
   * (walking back to what the step is done at, if getting it led elsewhere). */
  private async actWithRecovery(step: Act, depth: number, path: string[], frame: Frame | undefined, next?: Act): Promise<ActResult> {
    const shape = this.env.abstract(step, next);
    let direct: { gained: Stock; lost: Stock } = { gained: {}, lost: {} };
    const act = async () => {
      const before = this.env.have(), outcome = await this.env.act(step);
      this.stats.acts++;
      if (outcome.ok) direct = stockDelta(before, this.env.have());
      // Coin is a side effect (pay), not what a way of making things makes.
      if (outcome.ok) for (const kind of Object.keys(direct.gained)) if (this.env.unsolvable?.(kind)) delete direct.gained[kind];
      if (outcome.ok && frame) { addStock(frame.gives, direct.gained); addStock(frame.needs, direct.lost); }
      return outcome;
    };
    if (this.options.interrupt?.()) { this.scarcity = true; return { ok: false, summary: "Interrupted by something more urgent.", scarce: true }; }
    let result = await act();
    if (!result.ok && result.scarce) this.scarcity = true;
    if (!result.ok) this.lastFailure = result.summary;
    // Walking is native: a target that stands elsewhere is walked to.
    if (!result.ok && result.elsewhere && step.verb !== "move") {
      const moved = await this.env.act({ verb: "move", target: result.elsewhere }); this.stats.acts++;
      if (moved.ok) { frame?.acts.push({ node: { kind: "act", ...this.env.abstract({ verb: "move", target: result.elsewhere }, step) } }); result = await act(); }
    }
    for (let attempt = 0; !result.ok && result.missing && attempt < 3; attempt++) {
      const need = result.missing, total = this.have(need.kind) + need.count;
      if (!(await this.solve(need.kind, total, depth + 1, path))) { this.shortOf = need.kind; return result; }
      frame?.acts.push({ node: { kind: "ensure", item: need.kind, count: total } });
      if (shape.target && "thing" in shape.target) await this.env.approach(shape.target);
      result = await act();
    }
    if (result.ok) {
      frame?.acts.push({ node: { kind: "act", ...shape }, gave: direct.gained, took: direct.lost, used: result.used });
      for (const used of result.used ?? []) frame?.requires.add(used);
    }
    return result;
  }

  /** Run a learned tree: acts are bound to what is here; ensures recurse. */
  private async runNode(node: SkillNode, depth: number, path: string[]): Promise<boolean> {
    if (node.kind === "seq") {
      for (const child of node.children) if (!(await this.runNode(child, depth, path))) return false;
      return true;
    }
    if (node.kind === "ensure") {
      // A material the way needs could not be got: the way is short, not wrong.
      const ok = await this.solve(node.item, node.count, depth + 1, path);
      if (!ok && !this.options.interrupt?.()) this.shortOf = node.item;
      return ok;
    }
    // Not here: walk to where one is (walking is native, not part of the skill).
    if (node.target && "thing" in node.target && !this.env.bind(node.target) && await this.env.approach(node.target)) this.stats.acts++;
    const target = node.target ? this.env.bind(node.target) : undefined;
    if (node.target && !target) { this.scarcity = true; return false; } // nothing usable of that kind anywhere now
    const result = await this.actWithRecovery({ verb: node.verb, ...(target ? { target } : {}), ...(node.arg ? { arg: node.arg } : {}) }, depth, path, undefined);
    return result.ok;
  }
}

export type { GraphSkill };
