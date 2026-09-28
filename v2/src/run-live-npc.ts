/**
 * Single-prompt live NPC runner.
 *
 * Emits newline-delimited JSON suitable for a text client, OBS sidecar, or a
 * future video projection worker. Agent events are deliberately released a
 * few simulation ticks late so renderers get a stable look-ahead window.
 */
import "dotenv/config";
import {
  createSimulation,
  type AgentEvent,
  type SimulationEvent,
} from "./index";

const prompt = process.argv.slice(2).join(" ").trim()
  || "A solitary lighthouse keeper tends an impossible beacon while something beneath the tide learns her name.";
const requestedNpc = String(process.env.ARGOS_NPC || "").trim();
const lagTicks = Math.max(0, Number.parseInt(process.env.ARGOS_RENDER_LAG_TICKS || "4", 10) || 0);
const port = Number.parseInt(process.env.ARGOS_DEV_PORT || "3456", 10);
const serverEnabled = process.env.ARGOS_ENABLE_SERVER === "1";

const sim = await createSimulation({
  name: "Live NPC World",
  narrative: prompt,
  genesis: { seed: prompt },
  enableNarrativeEngine: true,
  enableServer: serverEnabled,
  serverPort: port,
  dualLoop: true,
  enableSpirits: true,
});

const agents = sim.getAgents();
const selectedNpc = requestedNpc
  ? agents.find((agent) => agent.name.toLowerCase() === requestedNpc.toLowerCase())
  : agents[0];

if (!selectedNpc) {
  throw new Error(requestedNpc
    ? `Genesis did not create an NPC named "${requestedNpc}"`
    : "Genesis did not create an NPC");
}
const npc = selectedNpc;

type BufferedProjection = {
  sourceTick: number;
  event: AgentEvent;
};
const projectionBuffer: BufferedProjection[] = [];

function writeProjection(event: SimulationEvent, sourceTick: number, releaseTick: number): void {
  process.stdout.write(`${JSON.stringify({
    kind: "argos.live-npc.v1",
    npc: npc.name,
    sourceTick,
    releaseTick,
    event,
  })}\n`);
}

sim.onAgent((event) => {
  if (event.agentName !== npc.name) return;
  projectionBuffer.push({ sourceTick: sim.tick, event });
}, npc.name);

sim.onSystem((event) => {
  if (event.type === "system:build") {
    process.stdout.write(`${JSON.stringify({kind:"argos.engineering.v1",tick:sim.tick,event})}\n`);
  }
});

sim.onWorld((event) => {
  if (event.type !== "world:state") return;
  const releaseBefore = event.tick - lagTicks;
  while (projectionBuffer.length > 0 && projectionBuffer[0].sourceTick <= releaseBefore) {
    const next = projectionBuffer.shift()!;
    writeProjection(next.event, next.sourceTick, event.tick);
  }
});

process.stderr.write(
  `[ArgOS] Live NPC: ${npc.name} (${npc.role}) in ${npc.room || "nowhere"}; projection lag=${lagTicks} ticks${serverEnabled ? `; server=http://localhost:${port}` : ""}\n`
);

const stop = () => {
  sim.stop();
  for (const pending of projectionBuffer) {
    writeProjection(pending.event, pending.sourceTick, sim.tick);
  }
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await sim.start();
