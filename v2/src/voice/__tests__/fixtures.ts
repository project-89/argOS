import { addComponent, addEntity, createWorld } from "bitecs";
import { Agent, Name } from "../../ecs/components";
import { createLovecraftTownScenario } from "../../demo/spatial-lovecraft-town";
import { pcmToWav, type VoiceClient } from "../gemini-voice";

/** A Saltmere-shaped read-only demo: real ECS Agents whose prompts are composed
 * exactly as initializeAgentEntity composes them. */
export function saltmereDemo() {
  const world = createWorld(), actors: number[] = [], visuals = new Map<number, { key: string }>();
  for (const resident of createLovecraftTownScenario().residents) {
    const eid = addEntity(world); addComponent(world, eid, Agent); addComponent(world, eid, Name);
    Name.value[eid] = resident.name; Agent.role[eid] = resident.role; Agent.active[eid] = true;
    const past = resident.past!;
    Agent.systemPrompt[eid] = resident.systemPrompt + `\nPRIVATE LIFE BEFORE THIS SCENE:\n${past.background}`
      + (past.voice ? `\nHOW YOU TALK: ${past.voice}` : "") + (past.secret ? `\nWHAT YOU HIDE: ${past.secret}` : "");
    actors.push(eid); visuals.set(eid, { key: `actor:${resident.id}` });
  }
  return { actors, visuals, sim: { world }, snapshot: () => ({ scenario: { theme: "lovecraft" } }) };
}

export function tone(ms: number, sampleRate = 24_000) {
  const pcm = Buffer.alloc(Math.round(sampleRate * ms / 1000) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
  return pcm;
}

export function fakeClient(overrides: Partial<VoiceClient> = {}) {
  const calls = { synthesize: [] as Array<{ text: string; voiceName: string; style?: string; model?: string }>, transcribe: 0 };
  const client: VoiceClient = {
    synthesize: async request => { calls.synthesize.push({ text: request.text, voiceName: request.voiceName, style: request.style,
      ...(request.model ? { model: request.model } : {}) });
      return { wav: pcmToWav(tone(100)), sampleRate: 24_000, channels: 1, durationMs: 100 }; },
    transcribe: async () => { calls.transcribe++; return "the sea takes what it's given"; },
    ...overrides,
  };
  return { client, calls };
}
