import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApartmentSitcom } from "./demo/apartment-sitcom";
import { createSitcomDemoApp } from "./demo/sitcom-server";
import { spawnSitcomEpisode } from "./demo/sitcom-restart";
import { sitcomLaunchProfile } from "./demo/sitcom-launch-profile";
import { sitcomH3LaunchOptions } from "./demo/sitcom-h3-chunk";
import { validateDirectorResolution } from "./rendering/director-projection";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
const token = randomBytes(24).toString("hex"), port = Number(process.env.ARGOS_SITCOM_PORT ?? 3464);
if (!Number.isSafeInteger(port) || (port !== 0 && port < 1024) || port > 65535) throw new Error("Invalid local port");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "sitcom-live-"));
const profile = sitcomLaunchProfile(process.argv.slice(2));
const h3 = sitcomH3LaunchOptions(process.argv.slice(2), {
  ARGOS_H3_SCRIPT_QUEUE: process.env.ARGOS_H3_SCRIPT_QUEUE,
  ARGOS_H3_CHUNK_SECONDS: process.env.ARGOS_H3_CHUNK_SECONDS,
  ARGOS_H3_MEMORY: process.env.ARGOS_H3_MEMORY,
});
const testbed = await ApartmentSitcom.create(profile);
const receiver = await createSitcomDemoApp({ testbed, directory, token,
  ...h3,
  h3Resolution: validateDirectorResolution(process.env.ARGOS_H3_RESOLUTION ?? "768p"),
  seconds: Number(process.env.ARGOS_DEMO_SECONDS ?? 600), allowVideo: !process.argv.includes("--no-video") && Boolean(process.env.FAL_KEY?.trim()),
  newEpisode: () => spawnSitcomEpisode(fileURLToPath(import.meta.url), process.argv.slice(2)) });
const server = receiver.app.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local episode address");
  const url = `http://127.0.0.1:${address.port}/#${token}`;
  console.log(`SITCOM_DEMO_READY ${url}`);
  console.log(`SITCOM_RECORDINGS ${directory}`);
  console.log(`SITCOM_COGNITION narrativeMind=${profile.narrativeMind} experienceReconsideration=${profile.experienceReconsideration}`);
  console.log(`SITCOM_PROFILE ${JSON.stringify(testbed.options)}`);
  console.log(`SITCOM_RENDERER ${h3.scriptQueue ? `script_append / plain directions / realtime 1:1 / ${h3.h3ChunkSeconds ?? 10}s source packets / one queued successor` : "direct / realtime 1:1 / follows Elaine's room / 10.125s opening + 8.5s continuation"}`);
  process.send?.({ type: "sitcom_ready", url });
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void receiver.stop().finally(() => server.close());
  setTimeout(() => process.exit(0), 5000).unref();
});
