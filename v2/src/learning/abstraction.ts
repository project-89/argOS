/** Abstraction: turn one world's concrete learned skill into a world-portable
 * library skill. Names become queries (a kind of thing, place or person) and
 * placeholders; a skill that cannot be expressed that way is non-transferable
 * and skipped, never stored with a dangling name. Story-bound skills are scoped
 * to their scenario. Pure reads of the world at harvest time. */
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Room } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import type { ProceduralSkillV1 } from "../cognition/procedural-skills";
import type { BehaviorNode } from "../cognition/behavior-policy";
import type { AbstractStep, LibraryTrigger, PlaceQuery, SkillScope, TargetQuery } from "./library";
import { entityKind, entityObjectType, entityTraits, getSkillWorldAdapter, homeRoomOf, placeKindOf, workplaceRoomOf } from "./world-adapter";

// ---------------------------------------------------------------------------
// Names -> placeholders
// ---------------------------------------------------------------------------

type Category = "person" | "place" | "object";
export type NameIndex = { entries: Array<{ name: string; eid: number; category: Category; pattern: RegExp }>; byName: Map<string, number> };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildNameIndex(world: World): NameIndex {
  const byName = new Map<string, number>();
  const entries: NameIndex["entries"] = [];
  for (const eid of query(world, [Name])) {
    const name = String(Name.value[eid] || "").trim();
    if (name.length < 2 || !entityExists(world, eid)) continue;
    const category: Category = hasComponent(world, eid, Agent) ? "person" : hasComponent(world, eid, Room) ? "place" : "object";
    const key = name.toLowerCase();
    if (byName.has(key)) continue; // first identity wins; ambiguity is not resolved by guessing
    byName.set(key, eid);
    entries.push({ name, eid, category, pattern: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?=$|[^\\p{L}\\p{N}])`, "giu") });
  }
  // Longest first: "Net House supplies box" before "Net House".
  entries.sort((a, b) => b.name.length - a.name.length);
  return { entries, byName };
}

/** Replace known names with placeholders. `addressee` names the step's own person. */
export function abstractText(index: NameIndex, text: string, options: { addressee?: string } = {}): { text: string; mentioned: number[] } {
  let out = text;
  const mentioned: number[] = [];
  for (const entry of index.entries) {
    entry.pattern.lastIndex = 0;
    if (!entry.pattern.test(out)) continue;
    entry.pattern.lastIndex = 0;
    mentioned.push(entry.eid);
    const placeholder = entry.category === "person"
      ? options.addressee && entry.name.toLowerCase() === options.addressee.toLowerCase() ? "{addressee}" : "{person}"
      : entry.category === "place" ? "{place}" : "{object}";
    out = out.replace(entry.pattern, (_match, lead: string) => `${lead}${placeholder}`);
  }
  return { text: out, mentioned };
}

const STOPWORDS = new Set(("a an and are as at be been but by can could did do does for from get go going got had has have her him his how i if in into is it its "
  + "just me my myself no not now of on or our out over she so some than that the their them then there they this to too up us was we what when where which "
  + "while who whom why will with would you your yourself about after again all also any back before being both each few more most other own same "
  + "should such only very don let make sure try want need find").split(" "));

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Content keywords of an (abstracted) intention, placeholders and names excluded. */
export function goalKeywords(text: string, limit = 12): string[] {
  const words = text.toLowerCase().replace(/\{[a-z]+\}/g, " ").split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && !STOPWORDS.has(word)).map(stem);
  return [...new Set(words)].slice(0, limit);
}

/** Share of a macro's pattern an intention must contain. */
export const GOAL_PATTERN_MIN_COVERAGE = 0.6;
/** A remembered way of doing things applies to an intention with the same gist:
 * the intention mentions most of the pattern's words (at least two), and the
 * pattern is not lost in a much larger, different intention. */
export function goalPatternMatches(pattern: readonly string[], keywords: readonly string[], minCoverage = GOAL_PATTERN_MIN_COVERAGE): boolean {
  if (pattern.length < 2 || !keywords.length) return false;
  const k = new Set(keywords);
  const shared = pattern.filter(word => k.has(word)).length;
  const union = new Set([...pattern, ...keywords]).size;
  return shared >= 2 && shared / pattern.length >= minCoverage && shared / union >= 0.2;
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export type AbstractedProcedure = {
  kind: "procedure"; name: string; abstractSignature: string; trigger: LibraryTrigger; steps: AbstractStep[]; scope: SkillScope;
};
export type AbstractionResult = { ok: true; skill: AbstractedProcedure } | { ok: false; reason: string };

type Ctx = { world: World; actor: number; index: NameIndex; scenario: boolean };

function describeTarget(world: World, eid: number, affordance?: string): TargetQuery | undefined {
  const objectType = entityObjectType(world, eid), kind = entityKind(world, eid), traits = entityTraits(eid).slice(0, 3);
  if (!objectType && !kind && !traits.length) return undefined;
  return { ...(objectType ? { objectType } : {}), ...(kind ? { kind } : {}), ...(traits.length && !objectType && !kind ? { traits } : {}),
    ...(affordance ? { affordance } : {}) };
}

function markScenarioText(ctx: Ctx, text: string, mentioned: number[]): void {
  const adapter = getSkillWorldAdapter(ctx.world);
  if (mentioned.some(eid => { try { return adapter.isScenarioEntity?.(eid) === true; } catch { return false; } })) ctx.scenario = true;
  const lower = text.toLowerCase();
  if (adapter.scenarioTerms?.some(term => term && lower.includes(term.toLowerCase()))) ctx.scenario = true;
}
function markScenarioEntity(ctx: Ctx, eid: number): void {
  try { if (getSkillWorldAdapter(ctx.world).isScenarioEntity?.(eid)) ctx.scenario = true; } catch { /* no oracle */ }
}

function abstractContent(ctx: Ctx, content: string | undefined, addressee?: string): string | undefined {
  if (!content?.trim()) return undefined;
  const { text, mentioned } = abstractText(ctx.index, content.trim(), { addressee });
  markScenarioText(ctx, text, mentioned);
  return text.slice(0, 400);
}

/** A named entity; for a numbered thing that no longer exists (a pastry that
 * was eaten), a surviving sibling of the same series stands in for its kind. */
function lookup(ctx: Ctx, name: string | undefined): number | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase(), exact = ctx.index.byName.get(key);
  if (exact !== undefined) return exact;
  const stem = key.replace(/\s*#?\d+$/, "");
  if (stem === key || stem.length < 3) return undefined;
  const sibling = ctx.index.entries.find(e => e.category === "object" && e.name.toLowerCase().replace(/\s*#?\d+$/, "") === stem);
  return sibling?.eid;
}

function placeFor(ctx: Ctx, room: number, next: Array<ProceduralSkillV1["steps"][number]>): PlaceQuery | undefined {
  if (room === homeRoomOf(ctx.world, ctx.actor)) return { place: "home" };
  if (room === workplaceRoomOf(ctx.world, ctx.actor)) return { place: "workplace" };
  // Otherwise: the kind of place that has what the next physical step needs.
  for (const step of next) {
    if (step.type === "move") break;
    if (step.type !== "interact" && step.type !== "observe") continue;
    const target = lookup(ctx, step.target);
    if (target === undefined || hasComponent(ctx.world, target, Agent) || hasComponent(ctx.world, target, Room)) continue;
    const q = describeTarget(ctx.world, target);
    if (!q || (!q.objectType && !q.kind)) continue;
    const kindQuery = { ...(q.objectType ? { objectType: q.objectType } : {}), ...(q.kind ? { kind: q.kind } : {}) };
    const inRoom = getRoomForEntity(ctx.world, target) === room
      || listDirectContents(ctx.world, room).some(eid => entityObjectType(ctx.world, eid) === q.objectType && entityKind(ctx.world, eid) === q.kind);
    if (inRoom) return { place: "room-with", ...kindQuery };
  }
  // Else the kind of public place it is (the square, the cafe), where the world names one.
  const kind = placeKindOf(ctx.world, room);
  return kind ? { place: "kind", kind } : undefined;
}

export function stepShape(step: AbstractStep): string {
  const t = step.targetQuery, p = step.placeQuery;
  const thing = t ? [t.objectType, t.kind, ...(t.traits ?? [])].filter(Boolean).join("/") : "";
  const place = p ? p.place === "room-with" ? `room-with ${[p.objectType, p.kind].filter(Boolean).join("/")}` : p.place === "kind" ? `kind ${p.kind}` : p.place : "";
  const person = step.person ? step.person.person === "role" ? `role:${step.person.role}` : step.person.person : "";
  const affordance = step.type === "interact" ? (t?.affordance ?? step.content?.split(/\s+/)[0] ?? "") : "";
  return `${step.type}(${[affordance, thing, place, person].filter(Boolean).join(" ")})`;
}

/** The goal an existing macro was learned for. */
export function macroGoalText(skill: ProceduralSkillV1): string | undefined {
  if (skill.trigger.goal?.trim()) return skill.trigger.goal.trim();
  const fromName = skill.name.replace(/^(Macro|How I):\s*/i, "").trim();
  if (fromName && fromName !== skill.name) return fromName;
  const sig = skill.signature;
  if (sig.startsWith("goal:") || sig.startsWith("plan:")) return sig.slice(sig.indexOf(":") + 1, sig.indexOf("|") > 0 ? sig.indexOf("|") : undefined).trim() || undefined;
  return undefined;
}

const PERCEPTION_AFFORDANCES = new Set(["examine", "inspect", "look", "observe", "look_at"]);

export function abstractProcedure(world: World, actor: number, skill: ProceduralSkillV1, index = buildNameIndex(world)): AbstractionResult {
  const ctx: Ctx = { world, actor, index, scenario: false };
  const adapter = getSkillWorldAdapter(world);
  const scenarioVerbs = new Set((adapter.scenarioVerbs ?? []).map(v => v.toLowerCase()));
  const isMacro = skill.trigger.affordance === "__goal_macro__" || skill.trigger.affordance === "__plan_macro__";
  const steps: AbstractStep[] = [];
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    if (step.type === "await" || step.waitFor) return { ok: false, reason: "evidence waits are not portable" };
    if ([step.onMatchNext, step.onMismatchNext, step.onSuccessNext, step.onFailureNext].some(n => n !== undefined))
      return { ok: false, reason: "branching procedures are not portable yet" };
    // Already abstract (a seeded/library step): keep as is.
    if (step.targetQuery || step.placeQuery || step.person) {
      steps.push({ type: step.type as AbstractStep["type"], ...(step.targetQuery ? { targetQuery: step.targetQuery } : {}),
        ...(step.placeQuery ? { placeQuery: step.placeQuery } : {}), ...(step.person ? { person: step.person } : {}),
        ...(step.content ? { content: step.content } : {}) });
      continue;
    }
    if (step.type === "wait") { steps.push({ type: "wait" }); continue; }
    if (step.type === "think") {
      const content = abstractContent(ctx, step.content);
      if (content) steps.push({ type: "think", content });
      continue;
    }
    if (step.type === "move") {
      const room = lookup(ctx, step.target);
      if (room === undefined || !hasComponent(world, room, Room)) return { ok: false, reason: `move to unknown place ${step.target ?? "?"}` };
      const place = placeFor(ctx, room, skill.steps.slice(i + 1));
      if (!place) return { ok: false, reason: `non-transferable place ${Name.value[room]}` };
      steps.push({ type: "move", placeQuery: place });
      continue;
    }
    const target = lookup(ctx, step.target);
    if (step.type === "speak") {
      const person = target !== undefined && hasComponent(world, target, Agent);
      const content = abstractContent(ctx, step.content, person ? Name.value[target!] : undefined);
      if (!content) continue;
      steps.push({ type: "speak", ...(person ? { person: { person: "addressee" as const } } : {}), content });
      continue;
    }
    if (step.type === "observe") {
      if (target === undefined) return { ok: false, reason: `observed unknown ${step.target ?? "?"}` };
      if (hasComponent(world, target, Room)) { steps.push({ type: "observe", placeQuery: { place: "current" } }); continue; }
      if (hasComponent(world, target, Agent)) { steps.push({ type: "observe", person: { person: "anyone-present" } }); continue; }
      const q = describeTarget(world, target);
      if (!q) return { ok: false, reason: `untyped object ${Name.value[target]}` };
      markScenarioEntity(ctx, target);
      steps.push({ type: "observe", targetQuery: q });
      continue;
    }
    // interact
    const [affordanceRaw = "", ...rest] = String(step.content || "").trim().split(/\s+/);
    const affordance = affordanceRaw.toLowerCase();
    if (!affordance) return { ok: false, reason: "interaction without an affordance" };
    if (scenarioVerbs.has(affordance)) ctx.scenario = true;
    const args = rest.join(" ").trim();
    const abstractArgs = args ? abstractContent(ctx, args) : undefined;
    const content = abstractArgs ? `${affordance} ${abstractArgs}` : affordance;
    if (target === undefined) return { ok: false, reason: `interaction with unknown ${step.target ?? "?"}` };
    if (hasComponent(world, target, Agent)) { steps.push({ type: "interact", person: { person: "anyone-present" }, content }); continue; }
    if (hasComponent(world, target, Room)) return { ok: false, reason: "interaction with a place" };
    const q = describeTarget(world, target, affordance);
    if (!q) return { ok: false, reason: `untyped object ${Name.value[target]}` };
    markScenarioEntity(ctx, target);
    steps.push({ type: "interact", targetQuery: q, content });
  }
  const meaningful = steps.filter(step => step.type !== "wait" && step.type !== "think");
  if (!meaningful.length) return { ok: false, reason: "no portable action" };
  if (isMacro && meaningful.length < 2) return { ok: false, reason: "macro too small after abstraction" };

  let trigger: LibraryTrigger, name: string, triggerKey: string;
  if (isMacro) {
    const goal = macroGoalText(skill);
    if (!goal) return { ok: false, reason: "macro without a goal" };
    const abstracted = abstractText(index, goal);
    markScenarioText(ctx, abstracted.text, abstracted.mentioned);
    const goalPattern = goalKeywords(abstracted.text);
    if (goalPattern.length < 2) return { ok: false, reason: "goal too vague to match" };
    trigger = { type: "goal", goalPattern, goalExample: abstracted.text.slice(0, 200) };
    name = `How to: ${abstracted.text.slice(0, 80)}`;
    triggerKey = `goal:${[...goalPattern].sort().join(",")}`;
  } else {
    if (steps.length !== 1 || steps[0].type !== "interact") return { ok: false, reason: "habit is not a single interaction" };
    const affordance = skill.trigger.affordance.trim().toLowerCase();
    if (!affordance || affordance.startsWith("__")) return { ok: false, reason: "unknown habit trigger" };
    // Looking at things is perception, not a skill worth carrying between lives.
    if (PERCEPTION_AFFORDANCES.has(affordance)) return { ok: false, reason: "perception is not a habit" };
    if (scenarioVerbs.has(affordance)) ctx.scenario = true;
    trigger = { type: "affordance", affordance, ...(skill.trigger.requiredTraits?.length ? { requiredTraits: skill.trigger.requiredTraits.slice(0, 6) } : {}),
      ...(skill.trigger.toolId ? { toolId: skill.trigger.toolId } : {}) };
    const q = steps[0].targetQuery;
    name = `Use ${affordance}${q ? ` on ${q.kind ?? q.objectType ?? q.traits?.join("/") ?? "something"}` : " with someone"}`;
    triggerKey = `affordance:${affordance}${steps[0].content && steps[0].content !== affordance ? `:${steps[0].content}` : ""}`;
  }
  const scope: SkillScope = ctx.scenario && adapter.scenarioId ? { scenario: adapter.scenarioId } : "general";
  // A story-bound skill in a world that does not name its scenario cannot be scoped: keep it out.
  if (ctx.scenario && !adapter.scenarioId) return { ok: false, reason: "story-bound skill in an unnamed scenario" };
  const abstractSignature = `procedure|${triggerKey}|${steps.map(stepShape).join(">")}`;
  return { ok: true, skill: { kind: "procedure", name, abstractSignature, trigger, steps, scope } };
}

// ---------------------------------------------------------------------------
// Behaviour trees
// ---------------------------------------------------------------------------

export type AbstractedTree = { kind: "behavior_tree"; name: string; abstractSignature: string; trigger: LibraryTrigger; tree: BehaviorNode; scope: SkillScope };

const NAMED_CONDITIONS = new Set(["in_room", "not_in_room", "room_has_named", "impression_above", "impression_below"]);

/** Interactions with named things become trait interactions; anything still
 * naming a person, place or object makes the tree non-transferable. */
export function abstractBehaviorTree(world: World, name: string, description: string, tree: BehaviorNode, index = buildNameIndex(world)):
  { ok: true; skill: AbstractedTree } | { ok: false; reason: string } {
  const adapter = getSkillWorldAdapter(world);
  const scenarioVerbs = new Set((adapter.scenarioVerbs ?? []).map(v => v.toLowerCase()));
  let scenario = false, reason = "";
  const walk = (node: BehaviorNode, depth: number): BehaviorNode | null => {
    if (depth > 12) { reason = "tree too deep"; return null; }
    switch (node.type) {
      case "selector": case "sequence": {
        const children: BehaviorNode[] = [];
        for (const child of node.children) { const c = walk(child, depth + 1); if (!c) return null; children.push(c); }
        return { type: node.type, children };
      }
      case "weighted_random": {
        const choices: Array<{ weight: number; child: BehaviorNode }> = [];
        for (const choice of node.choices) { const c = walk(choice.child, depth + 1); if (!c) return null; choices.push({ weight: choice.weight, child: c }); }
        return { type: "weighted_random", choices };
      }
      case "condition":
        if (NAMED_CONDITIONS.has(node.op.type)) { reason = `condition ${node.op.type} names a particular`; return null; }
        return node;
      case "interact_with_trait":
        if (scenarioVerbs.has(node.affordance.toLowerCase())) scenario = true;
        return node;
      case "use_procedure": case "skill": reason = `${node.type} references another world's memory`; return null;
      case "llm_say": case "llm_pick": {
        // A decision leaf's words are a gist: names become placeholders.
        const text = node.type === "llm_say" ? node.gist : node.content;
        const abstracted = text ? abstractText(index, text) : undefined;
        const question = node.type === "llm_pick" ? abstractText(index, node.question) : undefined;
        if (abstracted?.mentioned.some(eid => { try { return adapter.isScenarioEntity?.(eid) === true; } catch { return false; } })) scenario = true;
        if (node.type === "llm_say") return { ...node, gist: abstracted!.text };
        return { ...node, question: question!.text, ...(abstracted ? { content: abstracted.text } : {}) };
      }
      case "llm_ask": {
        const yes = walk(node.yes, depth + 1); if (!yes) return null;
        const no = walk(node.no, depth + 1); if (!no) return null;
        return { type: "llm_ask", question: abstractText(index, node.question).text, yes, no };
      }
      case "action": {
        const action = node.action;
        if (action.type === "move") { reason = "move to a named place"; return null; }
        if (action.type === "interact") {
          const target = action.target ? index.byName.get(action.target.toLowerCase()) : undefined;
          const affordance = String(action.content || "").split(/\s+/)[0]?.toLowerCase();
          if (target === undefined || !affordance) { reason = "interaction with unknown target"; return null; }
          const traits = entityTraits(target);
          if (!traits.length) { reason = `untyped object ${action.target}`; return null; }
          if (scenarioVerbs.has(affordance)) scenario = true;
          try { if (adapter.isScenarioEntity?.(target)) scenario = true; } catch { /* no oracle */ }
          return { type: "interact_with_trait", trait: traits[0], affordance, scope: "room" };
        }
        if (action.target && index.byName.has(action.target.toLowerCase())) { reason = "action names a particular"; return null; }
        if (action.content) {
          const abstracted = abstractText(index, action.content);
          if (abstracted.mentioned.length) { reason = "action text names a particular"; return null; }
        }
        return node;
      }
      default:
        return node;
    }
  };
  const abstract = walk(tree, 0);
  if (!abstract) return { ok: false, reason: reason || "non-transferable tree" };
  if (scenario && !adapter.scenarioId) return { ok: false, reason: "story-bound skill in an unnamed scenario" };
  const canonical = JSON.stringify(abstract);
  const cleanDescription = abstractText(index, description).text.slice(0, 200);
  return { ok: true, skill: { kind: "behavior_tree", name: name.replace(/^lib:/, "").slice(0, 80), abstractSignature: `behavior_tree|${canonical}`,
    trigger: { type: "skill", description: cleanDescription }, tree: abstract, scope: scenario ? { scenario: adapter.scenarioId! } : "general" } };
}
