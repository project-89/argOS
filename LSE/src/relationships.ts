import { z } from "zod";
import { createRelation, Relation } from "bitecs";

// Define relation schemas
const ContainsSchema = z.object({
  capacity: z
    .number()
    .optional()
    .describe("Maximum number of items that can be contained"),
});

const SupportedBySchema = z.object({
  weight: z.number().describe("Weight supported by the relationship"),
});

const AdjacentToSchema = z.object({
  direction: z
    .enum(["north", "south", "east", "west", "up", "down"])
    .describe("Direction of adjacency"),
});

const PartOfSchema = z.object({
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe("Importance of this part to the whole"),
});

const LocatedInSchema = z.object({
  since: z
    .number()
    .describe("Timestamp of when the entity was located in this place"),
});

// Define relations
export const Contains: Relation<z.infer<typeof ContainsSchema>> =
  createRelation({
    store: () => ContainsSchema.parse({}),
  });

export const SupportedBy: Relation<z.infer<typeof SupportedBySchema>> =
  createRelation({
    store: () => SupportedBySchema.parse({ weight: 0 }),
  });

export const AdjacentTo: Relation<z.infer<typeof AdjacentToSchema>> =
  createRelation({
    store: () => AdjacentToSchema.parse({ direction: "north" }),
  });

export const PartOf: Relation<z.infer<typeof PartOfSchema>> = createRelation({
  store: () => PartOfSchema.parse({ importance: 0.5 }),
});

export const LocatedIn: Relation<z.infer<typeof LocatedInSchema>> =
  createRelation({
    store: () => LocatedInSchema.parse({ since: Date.now() }),
  });

// Export schemas for use in componentMap
export const relationSchemas = {
  Contains: ContainsSchema,
  SupportedBy: SupportedBySchema,
  AdjacentTo: AdjacentToSchema,
  PartOf: PartOfSchema,
  LocatedIn: LocatedInSchema,
};

export const relationMap = {
  Contains,
  SupportedBy,
  AdjacentTo,
  PartOf,
  LocatedIn,
};
