import { readFileSync } from "node:fs";
import ts from "typescript";
import { builtinComponentSchema } from "../builtin-component-schema";

// Jest uses isolatedModules, so this independently checks the source even when
// a test run does not execute the mapped-type / `satisfies` TypeScript check.
test("built-in scalar metadata matches every registered exported SoA declaration", () => {
  const file = ts.createSourceFile("components.ts", readFileSync(new URL("../components.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = new Map<string, ts.VariableDeclaration>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, declaration);
    }
  }
  const all = exported.get("AllComponents")?.initializer;
  if (!all || !ts.isObjectLiteralExpression(all)) throw new Error("AllComponents must explicitly list its exported component declarations");
  const declared: Record<string, Record<string, string>> = {};
  for (const entry of all.properties) {
    if (!ts.isShorthandPropertyAssignment(entry)) throw new Error(`Unsupported AllComponents entry: ${entry.getText(file)}`);
    const name = entry.name.text, component = exported.get(name)?.initializer;
    if (!component || !ts.isObjectLiteralExpression(component)) throw new Error(`Missing exported component declaration: ${name}`);
    const fields: Record<string, string> = {};
    for (const property of component.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)
        || !ts.isAsExpression(property.initializer) || !ts.isArrayTypeNode(property.initializer.type)) {
        throw new Error(`Unsupported scalar declaration in ${name}: ${property.getText(file)}`);
      }
      const element = property.initializer.type.elementType;
      const kind = element.kind === ts.SyntaxKind.StringKeyword ? "string"
        : element.kind === ts.SyntaxKind.NumberKeyword ? "number"
        : element.kind === ts.SyntaxKind.BooleanKeyword ? "boolean" : undefined;
      if (!kind) throw new Error(`Non-scalar metadata needs an explicit contract: ${name}.${property.name.text}`);
      fields[property.name.text] = kind;
    }
    declared[name] = fields;
  }
  expect(Object.keys(declared).length).toBeGreaterThan(0);
  expect(builtinComponentSchema).toEqual(declared);
});
