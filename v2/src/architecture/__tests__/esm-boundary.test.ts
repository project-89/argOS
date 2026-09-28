import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

function walkTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

describe("ESM architecture boundary", () => {
  test("production TypeScript contains no live require() calls", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const violations: string[] = [];

    for (const filename of walkTypeScriptFiles(sourceRoot)) {
      const source = fs.readFileSync(filename, "utf8");
      const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "require"
        ) {
          const location = tree.getLineAndCharacterOfPosition(node.getStart(tree));
          violations.push(`${path.relative(sourceRoot, filename)}:${location.line + 1}`);
        }
        ts.forEachChild(node, visit);
      };

      visit(tree);
    }

    expect(violations).toEqual([]);
  });
});
