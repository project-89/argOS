import { Description, Agent, Personality } from "../components";
import { createArgosWorld } from "../world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../prefabs";
import { applyPersonaToEntity, type Persona } from "../persona";
import { executeActions } from "../../cognition/cognition-system";
import { createSystemRegistry } from "../dynamic-systems";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

test("applying a persona keeps its backstory private when another character examines it", () => {
  const world = createArgosWorld("Persona visibility"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: room });
  const observer = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "test", roomId: room });
  const persona: Persona = { name: "Mara", age: 34, gender: "woman", nationality: "islander", residence: "Storm House",
    education: "apprenticeship", occupation: { title: "keeper", description: "Tends the light" },
    longTermGoals: ["Protect the island"], personality: { openness: 0.6, conscientiousness: 0.8, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.3 },
    style: { tone: "warm", verbosity: "concise", formality: "neutral", expressiveness: "reserved" },
    backstory: "PRIVATE: I hid the brass key under the floorboards.", currentSituation: "PRIVATE: I am afraid Ivo will discover it." };
  applyPersonaToEntity(actor, persona);
  expect(Description.value[actor]).toBe("Mara, 34, keeper");
  expect(Agent.systemPrompt[actor]).toContain(persona.backstory);
  expect(Agent.systemPrompt[actor]).toContain(persona.currentSituation);
  for (const field of Object.keys(persona.personality) as Array<keyof Persona["personality"]>) {
    expect(Personality[field][actor]).toBe(persona.personality[field]);
  }
  executeActions(world, [{ eid: observer, action: { type: "examine", target: "Mara" } }], createSystemRegistry());
  const observations = drainPendingStimuli(new Set([observer])).map(stimulus => stimulus.content).join("\n");
  expect(observations).toContain("Mara, 34, keeper");
  expect(observations).not.toContain("PRIVATE:");
  expect(Agent.systemPrompt[observer]).not.toContain("floorboards");
  drainPendingStimuli();
});
