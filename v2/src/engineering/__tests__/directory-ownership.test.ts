import { mkdtempSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimEngineeringDirectory } from "../directory-ownership";

test("directory aliases cannot acquire a second lease; release permits reuse", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "argos-owner-test-"));
  const directory = path.join(root, "store"), alias = path.join(root, "alias");
  const release = claimEngineeringDirectory(directory);
  symlinkSync(directory, alias);
  expect(() => claimEngineeringDirectory(alias)).toThrow(/already owned/);
  release(); release();
  claimEngineeringDirectory(alias)();
});

test("release never deletes a replaced ownership token", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "argos-owner-test-"));
  const release = claimEngineeringDirectory(root);
  const file = path.join(root, ".argos-host-owner");
  writeFileSync(file, "replacement-owner");
  release();
  expect(readFileSync(file, "utf8")).toBe("replacement-owner");
  expect(() => claimEngineeringDirectory(root)).toThrow(/already owned/);
});
