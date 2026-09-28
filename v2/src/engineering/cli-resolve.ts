/** Locate a coding-agent CLI (codex, claude) the way a person's shell would,
 * plus the places version managers hide them. The daemon runs under whatever
 * Node launched Argos, which is often not the Node a CLI was installed with. */
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

function executable(file: string): boolean {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}

export function resolveCodingCli(name: "codex" | "claude", options: { explicit?: string; path?: string; home?: string } = {}): string | undefined {
  const explicit = options.explicit?.trim();
  // An explicit absolute path is authoritative: use it or fail, never guess past it.
  if (explicit && isAbsolute(explicit)) return executable(explicit) ? explicit : undefined;
  const home = options.home ?? homedir();
  const onPath = (options.path ?? process.env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, name));
  const nvmRoot = join(home, ".nvm", "versions", "node");
  const nvm = existsSync(nvmRoot) ? readdirSync(nvmRoot).sort().reverse().map(version => join(nvmRoot, version, "bin", name)) : [];
  const common = [join(home, ".local", "bin", name), join(home, ".bun", "bin", name), join(home, ".npm-global", "bin", name),
    "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name];
  return [...onPath, ...common, ...nvm].find(executable);
}

/** Child PATH that runs a script CLI under the Node it was installed beside. */
export function cliChildPath(binary: string, basePath = process.env.PATH ?? ""): string {
  return [dirname(binary), ...basePath.split(delimiter).filter(Boolean)].join(delimiter);
}
