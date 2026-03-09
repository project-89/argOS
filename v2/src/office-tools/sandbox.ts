import * as fs from "node:fs";
import * as path from "node:path";

import type { World } from "../ecs/world";

function slugify(input: string): string {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "simulation";
}

export function getOfficeSandboxBaseDir(): string {
  const configured = String(process.env.OFFICE_TOOLS_SANDBOX_BASE_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "stress-test-output", "office-sandboxes");
}

/**
 * Returns a per-world sandbox directory for office tools (terminal, workspace file ops).
 *
 * Note: this is not an OS-level sandbox. It only sets a working directory and constrains
 * our own workspace-* tools to paths under this directory.
 */
export function ensureOfficeSandboxDir(world: World): string {
  const disabled = String(process.env.OFFICE_TOOLS_DISABLE_SANDBOX || "").trim() === "1";
  if (disabled) return process.cwd();

  const base = getOfficeSandboxBaseDir();
  const worldName = slugify((world as any)?.meta?.name || "world");
  const createdAt = Number((world as any)?.meta?.createdAt || Date.now());

  const runDir = path.join(base, `${worldName}-${createdAt}`, "workspace");
  const tmpDir = path.join(runDir, "tmp");

  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, ".argos_sandbox"), `name=${worldName}\ncreatedAt=${createdAt}\n`, { flag: "a" });

  return runDir;
}

/**
 * Returns a per-device workspace directory inside the per-world sandbox.
 *
 * This enables multi-agent "office" simulations where each Computer/Terminal device has its
 * own filesystem + cwd, while still staying under the run's sandbox root.
 */
export function ensureOfficeDeviceSandboxDir(world: World, deviceEid: number | undefined): string {
  const base = ensureOfficeSandboxDir(world);
  const disabled = String(process.env.OFFICE_TOOLS_DISABLE_SANDBOX || "").trim() === "1";
  if (disabled) return base;

  const id = typeof deviceEid === "number" && Number.isFinite(deviceEid) && deviceEid >= 0 ? deviceEid : 0;
  const runDir = path.join(base, "devices", `device-${id}`);
  const tmpDir = path.join(runDir, "tmp");

  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, ".argos_sandbox"), `deviceEid=${id}\n`, { flag: "a" });

  return runDir;
}
