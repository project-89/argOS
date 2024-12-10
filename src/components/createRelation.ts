import { z } from "zod";
import { Relation, createRelation, withStore } from "bitecs";

export interface RelationWithSchema<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  relation: Relation<Record<string, any[]>>;
  type: z.infer<T>;
}

export function createSchemaRelation<T extends z.ZodObject<any>>(
  name: string,
  schema: T,
  options: { exclusive?: boolean } = {}
): RelationWithSchema<T> {
  const store = withStore<Record<string, any[]>>(() => {
    const arrays = Object.keys(schema.shape).reduce((acc, key) => {
      acc[key] = [];
      return acc;
    }, {} as Record<string, any[]>);
    return arrays;
  });

  const relation = options.exclusive
    ? createRelation(store, (r) => r)
    : createRelation(store);

  return {
    name,
    schema,
    relation,
    type: {} as z.infer<T>,
  };
}
