import type { World } from "bitecs";
import { z } from "zod/v3";
import { characterPastSchema } from "../cognition/character-past-schema";

const text = (max: number) => z.string().trim().min(1).max(max);
const guidance = z.array(text(800)).max(16).default([]);
const inhabitant = z.object({
  name: text(100), role: text(300), description: text(1200).optional(),
  systemPrompt: text(2000).optional(), startRoom: text(100).optional(),
  past: characterPastSchema.optional(),
}).strict();

/** Authoring intent, not another world state or an execution grant. Concrete
 * relationships/knowledge are authored through existing ECS tools and each
 * character's private past; the brief cannot create either by implication. */
export const worldSpecificationSchema = z.object({
  version: z.literal(1),
  setting: z.object({ name: text(100), genre: text(200), premise: text(2400), tone: text(300) }).strict(),
  story: z.object({ style: text(1200), tensions: guidance }).strict(),
  inhabitants: z.array(inhabitant).max(32).default([]),
  opportunities: guidance,
  discovery: guidance,
  constraints: guidance,
}).strict().superRefine((spec, ctx) => {
  const names = spec.inhabitants.map(actor => actor.name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inhabitant names must be unique" });
  if (JSON.stringify(spec).length > 64_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "World specification exceeds 64000 characters" });
});

export type WorldSpecification = z.infer<typeof worldSpecificationSchema>;
export type WorldSpecificationInput = z.input<typeof worldSpecificationSchema>;
const specifications = new WeakMap<World, WorldSpecification>();

export function parseWorldSpecification(input: unknown): WorldSpecification {
  return worldSpecificationSchema.parse(input);
}

/** Immutable for this world's lifetime. Detached reads prevent prompt consumers
 * from changing the brief or transferring authority between worlds. */
export function setWorldSpecification(world: World, input: WorldSpecificationInput): void {
  const spec = parseWorldSpecification(input), previous = specifications.get(world);
  if (previous && JSON.stringify(previous) !== JSON.stringify(spec)) throw new Error("World specification is immutable; create a new world to change its authoring brief");
  if (!previous) specifications.set(world, spec);
}

export function getWorldSpecification(world: World): WorldSpecification | undefined {
  const spec = specifications.get(world);
  return spec ? structuredClone(spec) : undefined;
}

/** Builder/supervisor style projection. Never include private cast authorship. */
export function getWorldAuthoringContext(world: World): string {
  const spec = specifications.get(world);
  if (!spec) return "";
  const { inhabitants: _privateCast, ...publicBrief } = spec;
  return `WORLD AUTHORING BRIEF (design intent, not observed facts or permission):\n${JSON.stringify(publicBrief)}\nCreate usable opportunities consistent with this setting. Actual state, actor knowledge, native capabilities and current grants remain authoritative.`;
}

/** God is an author, not an NPC. Only this projection includes private seeds. */
export function getWorldGenesisContext(world: World): string {
  const spec = specifications.get(world);
  if (!spec) return "";
  return `${getWorldAuthoringContext(world)}\nPRIVATE CHARACTER CREATION SEEDS:\n${JSON.stringify(spec.inhabitants)}\nWhen creating a requested inhabitant named here, use their own history. These seeds are not ongoing requests to spawn, recreate or reset the cast. A memory of another person establishes only its owner's recollection, not reciprocal knowledge or a present entity. Use native relationship tools for actual relationships; keep secrets out of public descriptions. This brief does not establish events or authorize changing existing minds.`;
}

export function getWorldCharacterSeed(world: World, name: string): WorldSpecification["inhabitants"][number] | undefined {
  const seed = specifications.get(world)?.inhabitants.find(actor => actor.name.toLowerCase() === name.trim().toLowerCase());
  return seed ? structuredClone(seed) : undefined;
}

export function getWorldTheme(world: World): string | undefined {
  const setting = specifications.get(world)?.setting;
  return setting ? `${setting.genre}; ${setting.tone}` : undefined;
}
