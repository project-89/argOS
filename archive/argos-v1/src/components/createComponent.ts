import { z } from "zod";

// Create a type that converts an object type to arrays
type ArraysFromShape<T> = {
  [K in keyof T]: T[K] extends z.ZodType ? T[K]["_output"][] : never;
};

export interface ComponentWithSchema<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  component: ArraysFromShape<T["shape"]>;
  type: z.infer<T>;
}

export function createComponent<T extends z.ZodObject<any>>(
  name: string,
  schema: T,
  componentArrays: Record<string, any[]>
): ComponentWithSchema<T> {
  // Create the component with arrays for each field
  const component = {} as ArraysFromShape<T["shape"]>;

  // Populate the arrays with type assertion for each field
  for (const [key, zodType] of Object.entries(schema.shape)) {
    const k = key as keyof T["shape"];
    component[k] = (componentArrays[key] || []) as ArraysFromShape<
      T["shape"]
    >[typeof k];
  }

  return {
    name,
    schema,
    component,
    type: {} as z.infer<T>, // Type-only property for TypeScript
  };
}
