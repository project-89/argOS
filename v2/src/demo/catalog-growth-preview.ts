/** Offline preview of data-driven catalog growth in Saltmere: no model calls.
 * Builds a few registered kinds through the same validated growth path spirits
 * and God use (free placement near a named landmark), then serves the viewer.
 *   npx tsx src/demo/catalog-growth-preview.ts
 * Prints CATALOG_PREVIEW_READY <url>. Stop with Ctrl-C. */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { SpatialDemo } from "./spatial-demo";
import { createSpatialDemoApp } from "./spatial-server";
import { materializeApprovedEntity } from "../engineering/entity-materialization";
import { withSimulationTask } from "../runtime/task-scope";
import { SPATIAL_ASSETS } from "./spatial-catalog";

const demo = await SpatialDemo.create({ live: false, evolving: true, scenario: "town", story: "coastal-mystery", seconds: 600 });
await demo.start();
const rooms = new Map(demo.snapshot().rooms.map(room => [room.name, room.id] as const));
const builds: Array<[room: string, assetId: string, name: string, near?: string]> = [
  ["Saltmere Common", "lantern-post", "Harbour lantern", "Common bench"],
  ["Saltmere Common", "harbour-bench", "Salt-bleached bench", "Harbour lantern"],
  ["Saltmere Common", "net-rack", "Drying nets"],
  ["Saltmere Common", "ship-bell", "The drowned men's bell", "Drying nets"],
  ["The Net House", "sea-chest", "Callum Brand's sea chest", "Net House supplies box"],
  ["The Net House", "lobster-pot", "Split lobster pot", "Net House supplies box"],
  ["The Waking Gull Cafe", "bookcase", "Tess's shelf of old tide tables"],
  ["Widow's Garden", "barrel", "Rain barrel"],
];
const controller = new AbortController();
for (const [room, assetId, name, near] of builds) {
  const roomEid = rooms.get(room);
  try {
    if (roomEid === undefined) throw Error(`no room ${room}`);
    const eid = await withSimulationTask(controller.signal, async () => materializeApprovedEntity(demo.sim.world, { type: "object", name, description: `${name}.`, roomEid,
      components: [{ name: "ObjectType", values: { typeId: SPATIAL_ASSETS[assetId].objectType } },
        { name: "SpatialPlacement", values: { assetId, ...(near ? { near } : {}) } }] }));
    console.log(`BUILT ${assetId} "${name}" in ${room} -> entity ${eid}`);
  } catch (error) { console.log(`REJECTED ${assetId} "${name}" in ${room}: ${error instanceof Error ? error.message : error}`); }
}
const token = randomBytes(24).toString("hex");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "catalog-preview-"));
const receiver = await createSpatialDemoApp({ demo, token, directory });
const server = receiver.app.listen(Number(process.env.ARGOS_SPATIAL_PORT ?? 0), "127.0.0.1", () => {
  const address = server.address(); if (!address || typeof address === "string") throw Error("no address");
  console.log(`CATALOG_PREVIEW_READY http://127.0.0.1:${address.port}/#${token}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void receiver.stop().finally(() => server.close()); setTimeout(() => process.exit(0), 3000).unref(); });
