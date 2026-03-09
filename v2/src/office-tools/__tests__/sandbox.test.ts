import * as fs from "node:fs";
import * as path from "node:path";

import { createArgosWorld } from "../../ecs/world";
import { ensureOfficeDeviceSandboxDir, ensureOfficeSandboxDir, getOfficeSandboxBaseDir } from "../sandbox";

describe("office-tools sandbox", () => {
  test("creates a per-world workspace directory under stress-test-output", () => {
    const world = createArgosWorld("SandboxTestWorld") as any;
    const dir = ensureOfficeSandboxDir(world);

    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toContain(path.join("stress-test-output", "office-sandboxes"));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, ".argos_sandbox"))).toBe(true);

    const base = getOfficeSandboxBaseDir();
    expect(dir.startsWith(base)).toBe(true);
  });

  test("creates a per-device workspace directory within the per-world sandbox", () => {
    const world = createArgosWorld("SandboxTestWorldDevices") as any;
    const deviceDir = ensureOfficeDeviceSandboxDir(world, 42);

    expect(path.isAbsolute(deviceDir)).toBe(true);
    expect(deviceDir).toContain(path.join("stress-test-output", "office-sandboxes"));
    expect(deviceDir).toContain(path.join("devices", "device-42"));
    expect(fs.existsSync(deviceDir)).toBe(true);
    expect(fs.existsSync(path.join(deviceDir, ".argos_sandbox"))).toBe(true);
  });
});
