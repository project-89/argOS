/** Planners for the homestead: what the resident asks when no learned skill
 * gives what they need. Both plan only the direct steps for one goal; missing
 * materials come back as sub-goals.
 *
 * - manualPlanner: an offline stand-in for the model. It reads the same manual
 *   a resident reads (the world's recipes and what stands where) and answers
 *   like a competent but short-sighted planner. It costs nothing, so tests and
 *   curves can run offline; it is not evidence of what a model would do.
 * - geminiPlanner: the model, given the resident's observation as text. */
import { generateText } from "ai";
import { Name } from "../../ecs/components";
import { listDirectContents } from "../../ecs/location";
import { agentModel } from "../../llm/config";
import { extractJSON } from "../../llm/json-extract";
import type { Planner, PlannedStep } from "../skill-runtime";
import type { Homestead } from "./world";

export function manualPlanner(land: () => Homestead): Planner {
  return async ({ goal }) => {
    const h = land(), def = h.def;
    const rooms = [...h.rooms.values()];
    const thingOf = (kind: string, portable?: boolean) => {
      for (const room of rooms) for (const eid of listDirectContents(h.world, room)) {
        if (h.kindOf(eid) !== kind || (h.usesLeft(eid) ?? 1) <= 0) continue;
        if (portable !== undefined && portable !== !!def.things.find(t => t.kind === kind)?.portable) continue;
        return { room, eid };
      }
      return undefined;
    };
    const at = (kind: string, act: (name: string) => PlannedStep): PlannedStep[] => {
      const found = thingOf(kind);
      return found ? [{ verb: "move", target: Name.value[found.room] }, act(Name.value[found.eid])] : [];
    };
    const [structureKind, part] = goal.item.split(".");
    const structures = h.structuresView();
    const structure = structures.find(s => s.kind === structureKind);
    if (structure) {
      const site = thingOf(structure.site);
      if (!site) return [];
      const built = h.have();
      const parts = part ? [part] : structure.parts.map(p => p.part).filter(p => !built[`${structure.kind}.${p}`]);
      return [{ verb: "move", target: Name.value[site.room] }, ...parts.map(p => ({ verb: "build", target: Name.value[site.eid], arg: p }))];
    }
    // Lying about: pick it up. Otherwise make it where it is made.
    const loose = thingOf(goal.item, true);
    if (loose) return [{ verb: "move", target: Name.value[loose.room] }, { verb: "pickup", target: Name.value[loose.eid] }];
    const recipe = h.recipesView().find(r => (r.gives?.[goal.item] ?? 0) > 0);
    if (recipe) return at(recipe.at, name => ({ verb: recipe.verb, target: name, ...(recipe.product ? { arg: recipe.product } : {}) }));
    return [];
  };
}

export type GeminiPlannerStats = { calls: number; tokensIn: number; tokensOut: number; malformed: number };

export function geminiPlanner(stats: GeminiPlannerStats, options: { model?: typeof agentModel; log?: (line: string) => void; persona?: string; verbs?: string } = {}): Planner {
  return async request => {
    stats.calls++;
    const prompt = `${request.observation}

Goal: have ${request.goal.count} ${request.goal.item}${request.goal.item.includes(".") ? " (a built part)" : ""}.
You already know how to get: ${request.knownSkills.join("; ") || "nothing yet"}. Those happen by themselves when needed.
${request.failures.length ? `What went wrong before: ${request.failures.join(" | ")}\n` : ""}
Plan only the direct steps for this goal, using exact names from above. If a step needs materials or tools you lack,
still include it: whatever is missing is fetched first, automatically. Verbs: move <place>, pickup <thing>, ${options.verbs ?? ""}or the verbs in
"How things are made here" with target = the thing's exact name and arg = the product or part (e.g. craft … planks, build … frame).
JSON only: {"steps":[{"verb":"...","target":"...","arg":"..."}]}`;
    const response = await generateText({ model: options.model ?? agentModel, maxRetries: 1, maxOutputTokens: 2500,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      system: options.persona ?? "You plan practical steps for someone building a homestead. Be brief and exact.",
      messages: [{ role: "user", content: prompt }] });
    stats.tokensIn += Number(response.usage?.inputTokens ?? 0) || 0;
    stats.tokensOut += Number(response.usage?.outputTokens ?? 0) || 0;
    const json = extractJSON(response.text);
    try {
      const steps = JSON.parse(json ?? "{}")?.steps;
      if (!Array.isArray(steps)) throw new Error("no steps");
      return steps.filter((s: any) => s && typeof s.verb === "string").slice(0, 12)
        .map((s: any) => ({ verb: String(s.verb), ...(s.target ? { target: String(s.target) } : {}), ...(s.arg ? { arg: String(s.arg) } : {}) }));
    } catch { stats.malformed++; options.log?.(`malformed plan (${response.finishReason}): ${response.text.slice(0, 300).replace(/\s+/g, " ")}`); return []; }
  };
}
