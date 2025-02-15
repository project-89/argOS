import { z } from "zod";

// Define Zod schemas for components
const PositionSchema = z
  .object({
    x: z.number().describe("The x-coordinate of the entity's position"),
    y: z.number().describe("The y-coordinate of the entity's position"),
  })
  .describe("Represents the 2D position of an entity in the world");

const NameSchema = z
  .object({
    value: z.string().describe("The name of the entity"),
  })
  .describe("Represents the name of an entity");

const DescriptionSchema = z
  .object({
    value: z
      .string()
      .describe(
        "A detailed description of the entity.  Be sure to be descriptive of the thing itself"
      ),
  })
  .describe("Provides a textual description of an entity.");

const GoalSchema = z
  .object({
    value: z.string().describe("The current goal or objective of the entity"),
  })
  .describe("Represents the current goal or motivation of an entity");

const InventorySchema = z
  .object({
    items: z
      .array(z.string())
      .describe("An array of item names in the entity's possession"),
  })
  .describe("Represents the inventory or possessions of an entity");

// Component type definitions
export interface PositionComponent {
  x: number[];
  y: number[];
}

export interface ValueComponent {
  value: string[];
}

export interface InventoryComponent {
  items: string[][];
}

// Define components using simple arrays
export const Position: PositionComponent = {
  x: [],
  y: [],
};

export const Name: ValueComponent = {
  value: [],
};

export const Description: ValueComponent = {
  value: [],
};

export const Goal: ValueComponent = {
  value: [],
};

export const Inventory: InventoryComponent = {
  items: [],
};

// Create a component map with both the component and its schema
export const componentMap = {
  Position,
  Name,
  Description,
  Goal,
  Inventory,
} as const;

// Create a schema map separately
export const schemaMap = {
  Position: PositionSchema,
  Name: NameSchema,
  Description: DescriptionSchema,
  Goal: GoalSchema,
  Inventory: InventorySchema,
} as const;

export type ComponentName = keyof typeof componentMap;
