import { z } from "zod";

export interface ComponentWithSchema<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  component: Record<string, any[]>;
  type: z.infer<T>;
}

export function createComponent<T extends z.ZodObject<any>>(
  name: string,
  schema: T,
  componentArrays: Record<string, any[]>
): ComponentWithSchema<z.ZodObject<any>> {
  // Create the component with arrays for each field
  const component = Object.keys(schema.shape).reduce((acc, key) => {
    acc[key] = componentArrays[key] || [];
    return acc;
  }, {} as Record<string, any[]>);

  return {
    name,
    schema,
    component,
    type: {} as z.infer<T>, // Type-only property for TypeScript
  } as ComponentWithSchema<T>;
}
