/** The skill graph: learned ways of making things, each with what it needs and
 * what it gives, composed by what they produce.
 *
 * A skill is a small tree: acts on kinds of things and places, and `ensure`
 * nodes — "have N of X first" — that are satisfied at run time by whichever
 * learned skill gives X (or, failing that, by asking the planner once). So
 * "build the frame" does not contain chopping; it ensures planks, and planks
 * ensure logs, and logs ensure an axe. Composition is by effect, not by name:
 * a better way of getting stone learned later is used by every skill that
 * needs stone.
 *
 * Nothing here names a particular entity; the graph is portable between
 * worlds and grows across lives. Pure data + selection; execution lives in
 * skill-runtime.ts. */
export type Stock = Record<string, number>;

/** A kind of thing ("tree") or a kind of place: where a kind of thing stands, or the place's own kind. */
export type Ref = { thing: string } | { where: string } | { place: string };

export type SkillNode =
  | { kind: "act"; verb: string; target?: Ref; arg?: string }
  | { kind: "ensure"; item: string; count: number }
  | { kind: "seq"; children: SkillNode[] };

export type SkillEffect = {
  /** Net consumed from what was in hand when it started. */
  needs: Stock;
  /** Held tools and standing facts it relied on (not consumed). */
  requires: string[];
  /** Net gained per run. */
  gives: Stock;
};

export type GraphSkill = {
  id: string;
  /** What it was learned for. */
  goal: { item: string; count: number };
  tree: SkillNode;
  effect: SkillEffect;
  stats: { runs: number; successes: number; failures: number; seconds?: number; timedRuns?: number };
  learned: { life: number; from: "planner" | "revision" };
};

export type SkillGraphJson = { format: "argos-skill-graph"; version: 1; lives: number; skills: GraphSkill[] };

export function nodeShape(node: SkillNode): string {
  if (node.kind === "seq") return `[${node.children.map(nodeShape).join(",")}]`;
  if (node.kind === "ensure") return `ensure(${node.item}×${node.count})`;
  const ref = node.target ? "thing" in node.target ? node.target.thing : "where" in node.target ? `@${node.target.where}` : `#${node.target.place}` : "";
  return `${node.verb}(${[ref, node.arg].filter(Boolean).join(" ")})`;
}
const skillId = (goal: string, tree: SkillNode) => {
  let hash = 0x811c9dc5;
  const text = `${goal}|${nodeShape(tree)}`;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `gs-${goal.replace(/[^a-z0-9]+/gi, "-")}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const successRate = (skill: GraphSkill) => (skill.stats.successes + 1) / (skill.stats.runs + 2);

export class SkillGraph {
  readonly skills = new Map<string, GraphSkill>();
  lives = 0;

  static fromJson(json: SkillGraphJson | undefined): SkillGraph {
    const graph = new SkillGraph();
    if (!json) return graph;
    if (json.format !== "argos-skill-graph" || json.version !== 1 || !Array.isArray(json.skills)) throw new Error("Not an Argos skill graph");
    graph.lives = json.lives;
    for (const skill of json.skills) graph.skills.set(skill.id, skill);
    return graph;
  }
  toJson(): SkillGraphJson { return { format: "argos-skill-graph", version: 1, lives: this.lives, skills: [...this.skills.values()] }; }

  /** Skills that give this item, most reliable first, then the shortest. */
  /** Skills that give this item: reliable ones first (in bands), and among
   * those the quickest per item as measured in the world (buying beats fishing
   * when both work), then the shortest. */
  producers(item: string): GraphSkill[] {
    const band = (s: GraphSkill) => Math.floor(successRate(s) * 4);
    const perItem = (s: GraphSkill) => (s.stats.timedRuns ? (s.stats.seconds ?? 0) / s.stats.timedRuns : Infinity) / Math.max(1, s.effect.gives[item] ?? 1);
    return [...this.skills.values()].filter(skill => (skill.effect.gives[item] ?? 0) > 0)
      .sort((a, b) => band(b) - band(a) || perItem(a) - perItem(b) || countActs(a.tree) - countActs(b.tree) || a.id.localeCompare(b.id));
  }

  /** Keep a way of making something that just worked. The same shape again is more evidence, not a new skill. */
  learn(goal: { item: string; count: number }, tree: SkillNode, effect: SkillEffect, life: number, from: GraphSkill["learned"]["from"] = "planner"): GraphSkill {
    const id = skillId(goal.item, tree);
    const existing = this.skills.get(id);
    if (existing) { existing.stats.runs++; existing.stats.successes++; return existing; }
    const skill: GraphSkill = { id, goal: { ...goal }, tree, effect, stats: { runs: 1, successes: 1, failures: 0 }, learned: { life, from } };
    this.skills.set(id, skill);
    return skill;
  }

  /** The composed tree for making an item, expanded through the skills that
   * currently produce what it ensures (for inspection; running re-resolves). */
  expand(item: string, depth = 0, seen = new Set<string>()): unknown {
    const skill = this.producers(item)[0];
    if (!skill || depth > 8 || seen.has(item)) return { item, skill: null };
    const inner = (node: SkillNode): unknown => node.kind === "seq" ? node.children.map(inner)
      : node.kind === "ensure" ? { ensure: `${node.item}×${node.count}`, by: this.expand(node.item, depth + 1, new Set([...seen, item])) } : nodeShape(node);
    return { item, skill: skill.id, tree: inner(skill.tree) };
  }
}

export function countActs(node: SkillNode): number {
  return node.kind === "act" ? 1 : node.kind === "seq" ? node.children.reduce((n, c) => n + countActs(c), 0) : 0;
}

export function stockDelta(before: Stock, after: Stock): { gained: Stock; lost: Stock } {
  const gained: Stock = {}, lost: Stock = {};
  for (const kind of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[kind] ?? 0) - (before[kind] ?? 0);
    if (d > 0) gained[kind] = d; else if (d < 0) lost[kind] = -d;
  }
  return { gained, lost };
}
