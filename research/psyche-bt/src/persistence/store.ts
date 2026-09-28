/**
 * JSON File Persistence — Save/load person models to disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PersonModel } from "../ecs/types.js";

const DEFAULT_DIR = "./data";

export function savePerson(model: PersonModel, dir: string = DEFAULT_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${model.personId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(model, null, 2));
}

export function loadPerson(personId: string, dir: string = DEFAULT_DIR): PersonModel | null {
  const filePath = path.join(dir, `${personId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function listPersons(dir: string = DEFAULT_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
}
