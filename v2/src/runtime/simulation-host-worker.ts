/** Internal IPC worker. Exactly one construction per process; no eval RPC. */
import { createSimulation, type ArgosSimulation } from "../index";
import { serializeWorld } from "../persistence/world-persistence";
import { registryCreateComponent, attachToEntity } from "../ecs/component-registry";
import { query } from "bitecs";
import { Name } from "../ecs/components";
import { getAllSystemHealth } from "../ecs/dynamic-systems";

if (!process.send || process.env.ARGOS_PROCESS_WORLD_HOST !== "1") throw new Error("Use createSimulationHost to start this worker");
let sim: ArgosSimulation | undefined, initialized = false, chain = Promise.resolve();
const snapshot = () => ({ pid: process.pid, stats: sim!.getStats(), world: serializeWorld(sim!.world, sim!.god.systemRegistry),
  runtime: { godEid: sim!.god.eid, godTick: sim!.god.tick, indexedEntities: [...sim!.god.registry.byName.entries()] } });
async function handle(method: string, args: any[]) {
  if (method === "initialize") {
    if (initialized) throw new Error("A worker may construct only one world; reset requires a new process");
    initialized = true; sim = await createSimulation(args[0]); return;
  }
  if (!sim) throw new Error("Worker is not initialized");
  switch (method) {
    case "getCodingStatus": return sim.getCodingStatus();
    case "requestSystemBuild": return sim.requestSystemBuild(args[0]);
    case "health": {
      // Read-only: never drain errors/events needed by the maintenance loop.
      const systems = getAllSystemHealth(sim.god.systemRegistry);
      return { pid: process.pid, stats: sim.getStats(), totalSystems: systems.length,
        truncated: systems.length > 500,
        systems: systems.slice(0, 500).map(system => ({ ...system,
          name: system.name.slice(0, 512),
          lastError: system.lastError?.slice(0, 2048) ?? null,
          disabledReason: system.disabledReason?.slice(0, 2048) ?? null,
        })) };
    }
    case "snapshot": return snapshot();
    case "step": await sim.step(args[0] ?? undefined); return snapshot();
    case "start": await sim.start(); return;
    case "pause": sim.pause(); return;
    case "stimulate": sim.stimulate(args[0], args[1], args[2] ?? undefined); return;
    case "defineComponent": registryCreateComponent(args[0]); return;
    case "attachComponent": {
      const entities = [...query(sim.world, [Name])].filter(eid => Name.value[eid] === args[0]);
      if (entities.length !== 1) throw new Error("Component attachment needs one unambiguous entity name");
      attachToEntity(sim.world, entities[0], args[1], args[2]); return;
    }
    default: throw new Error(`Unsupported host command: ${method}`);
  }
}
process.on("message", (message: any) => {
  chain = chain.then(async () => {
    if (!Number.isSafeInteger(message?.id) || typeof message.method !== "string" || !Array.isArray(message.args)) return;
    try {
      const value = await handle(message.method, message.args);
      process.send?.({ id: message.id, ok: true, value });
    } catch (error) { process.send?.({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
});
process.on("SIGTERM", () => { sim?.stop(); process.exit(0); });
process.on("disconnect", () => { sim?.stop(); process.exit(0); });
process.send({ ready: true });
