import { spawn } from "node:child_process";

/** Separate processes isolate ECS stores, pending work and late media uploads.
 * The old loopback receiver stays available for replay; no episode auto-starts. */
export function spawnSitcomEpisode(entrypoint: string, args: string[]): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, entrypoint, ...args], {
      env: { ...process.env, ARGOS_SITCOM_PORT: "0" },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      child.kill("SIGTERM");
      reject(error);
    };
    const deadline = setTimeout(() => fail(new Error("New episode did not become ready within 30 seconds")), 30_000);
    child.once("error", () => fail(new Error("Could not launch the new episode server")));
    child.once("exit", () => fail(new Error("New episode server exited before becoming ready")));
    child.on("message", message => {
      if (settled || !message || typeof message !== "object" || !("type" in message) || message.type !== "sitcom_ready" || !("url" in message)) return;
      try {
        const url = new URL(String(message.url));
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/"
          || url.username || url.password || url.search || !/^#[a-f0-9]{48}$/.test(url.hash)) throw new Error("Invalid episode URL");
        settled = true; clearTimeout(deadline); child.disconnect(); child.unref();
        resolve({ url: url.href });
      } catch { fail(new Error("New episode returned an invalid local session link")); }
    });
  });
}
