import { jest } from "@jest/globals";

// Capture real prompt assembly without contacting any model provider.
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
const generateObject = jest.fn<(...args: any[]) => Promise<{ object: any }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate, generateObject }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { addComponent } = await import("bitecs");
const { Needs } = await import("../../ecs/components");
const { addPerception } = await import("../agent-mind");
const { groundedThink, clearSessionMemory, recordEvent } = await import("../grounded-cognition");
const { generateSchedule } = await import("../schedule-system");
const { formatActionsForPrompt } = await import("../action-registry");
const { formatStimuliForPrompt } = await import("../sensory-system");
const { selectFailureRecoveryAction } = await import("../failure-recovery");
const { generateSystemPromptFromPersona, generateSinglePersona, generatePersona, PersonaSchema } = await import("../../ecs/persona");

function fixture(withRoom = true) {
  const world = createArgosWorld("Prompt contract");
  initializePrefabs(world);
  const room = withRoom ? createRoomEntity(world, { name: "Workshop", description: "A bench beside the window." }) : undefined;
  const actor = createAgentEntity(world, { name: "Mara", role: "keeper", systemPrompt: "Keep the workshop running.", roomId: room });
  clearSessionMemory(actor);
  return { world, room, actor };
}

beforeEach(() => { generate.mockReset(); generateObject.mockReset(); });

test("grounded context presents messages once and allows a quiet action", async () => {
  const f = fixture();
  createAgentEntity(f.world, { name: "Ivo", role: "electrician", systemPrompt: "Test", roomId: f.room });
  const elsewhere = createRoomEntity(f.world, { name: "Storage" });
  createAgentEntity(f.world, { name: "Sera", role: "gardener", systemPrompt: "Test", roomId: elsewhere });
  addPerception(f.world, f.actor, { type: "speech", source: "Ivo", content: "The panel is secure." });
  addPerception(f.world, f.actor, { type: "slack_message", source: "slack_external", content: "Sera in #repairs: No reply needed; the cloth is ready." });
  recordEvent(f.actor, { tick: 1, type: "thought", actor: "Mara", content: "Maybe the light works now." });
  generate.mockResolvedValue({ text: JSON.stringify({ situationAnalysis: "Ivo is holding the panel.", relevantPerceptions: "The panel is secure.", reasoning: "I can wait while the joint sets.", action: { type: "wait" } }) });

  expect(await groundedThink(f.world, f.actor, { availableActions: ["speak", "wait", "use"], slackChannels: ["#repairs"] })).toEqual({ type: "wait", target: undefined, content: undefined });
  const call = generate.mock.calls[0][0];
  const combined = `${call.system}\n${call.messages[0].content}`;
  expect(combined.split("The panel is secure.")).toHaveLength(2);
  expect(combined.split("No reply needed; the cloth is ready.")).toHaveLength(2);
  expect(call.system).toContain("Ivo (electrician)");
  expect(call.system).not.toContain("Sera (gardener)");
  expect(call.system).toContain('Mara thought: "Maybe the light works now."');
  expect(call.system).toContain("Missing information is unknown.");
  expect(combined).not.toMatch(/MUST|CRITICAL RULES|You should respond|ONLY reference|#general/);
  expect(call.messages[0].content).toContain('"Post to <channel>: <message>"');
  expect(call.messages[0].content).toContain("#repairs");
  for (const key of ["situationAnalysis", "relevantPerceptions", "reasoning", "action", "target", "content"]) expect(call.messages[0].content).toContain(`"${key}"`);
  clearSessionMemory(f.actor);
});

test("Slack observations do not introduce an unavailable use action", async () => {
  const f = fixture();
  addPerception(f.world, f.actor, { type: "slack_message", source: "slack_external", content: "Status from #repairs." });
  generate.mockResolvedValue({ text: '{"action":{"type":"wait"}}' });
  await groundedThink(f.world, f.actor, { availableActions: ["wait", "observe"] });
  const prompt = generate.mock.calls[0][0].messages[0].content;
  expect(prompt).toContain("AVAILABLE ACTIONS: wait, observe");
  expect(prompt).not.toContain("Post to");
  clearSessionMemory(f.actor);
});

test.each([true, false])("schedule prompt preserves its JSON and timing contract (room=%s)", async withRoom => {
  const f = fixture(withRoom);
  const activities = Array.from({ length: 5 }, (_, i) => ({ name: `activity_${i}`, startHour: i * 4, duration: 4, priority: 5, interruptible: true }));
  generate.mockResolvedValue({ text: JSON.stringify({ activities, flexibility: 0.4, personality: "A steady routine." }) });
  expect(await generateSchedule(f.world, f.actor)).toEqual({ activities, flexibility: 0.4, personality: "A steady routine." });
  const call = generate.mock.calls[0][0];
  expect(call.system).toContain(withRoom ? "Workshop" : "No locations supplied");
  expect(call.system).not.toContain("Various locations");
  expect(call.prompt).toContain("5-8 activities");
  expect(call.prompt).toContain("otherwise omit the location");
  expect(call.prompt).toContain("Hours are 0-23. Duration is in hours. Priority is 1-10.");
  for (const key of ["activities", "name", "startHour", "duration", "location", "priority", "interruptible", "description", "flexibility", "personality"]) expect(call.prompt).toContain(`"${key}"`);
});

test("needs are measurements, while executable action requirements remain explicit", () => {
  const f = fixture();
  addComponent(f.world, f.actor, Needs);
  Needs.hunger[f.actor] = 80; Needs.energy[f.actor] = 20; Needs.social[f.actor] = 10;
  const prompt = formatActionsForPrompt(f.world, f.actor);
  expect(prompt).toContain("Hunger: 80% (high)");
  expect(prompt).toContain("Energy: 20% (low)");
  expect(prompt).toContain("Social satisfaction: 10% (low)");
  expect(prompt).toContain("(requires target)");
  expect(prompt).toContain("(requires content)");
  expect(prompt).not.toMatch(/CRITICAL|find food!|need rest!|seek company!/);
});

test("plain failure feedback remains compatible with deterministic recovery", () => {
  const f = fixture();
  createObjectEntity(f.world, { name: "Keycard", roomId: f.room, traits: ["takeable"] });
  const formatted = formatStimuliForPrompt([{ modality: "cognitive", type: "action_failed", source: "interaction", content: 'Cannot unlock the door. → PICK UP "Keycard" first to gain hasKeycard', intensity: 1, timestamp: Date.now() }], f.actor, f.world);
  expect(formatted).toContain("🚨 CRITICAL - YOUR LAST ACTION FAILED");
  expect(formatted).not.toContain("DO NOT proceed");
  addPerception(f.world, f.actor, { type: "action_failed", source: "interaction", content: formatted });
  expect(selectFailureRecoveryAction(f.world, f.actor)).toMatchObject({ type: "pickup", target: "Keycard" });
});

const persona = PersonaSchema.parse({
  name: "Mara", age: 42, gender: "woman", nationality: "Canada", residence: "Harbor House", education: "Electrical apprenticeship",
  occupation: { title: "keeper", description: "Maintains the workshop" }, longTermGoals: ["Keep the workshop open"], shortTermGoals: ["Mend the lamp"],
  personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.3, agreeableness: 0.6, neuroticism: 0.2 },
  style: { tone: "warm", verbosity: "concise", formality: "informal", expressiveness: "reserved" },
  beliefs: [{ topic: "repair", position: "Useful things deserve care", strength: "strong" }], skills: [{ name: "wiring", level: "expert" }],
  behaviors: ["Checks the power before working"], quirks: ["Keeps bent nails"], backstory: "Rebuilt her first radio at twelve.", currentSituation: "Preparing the hall for guests.",
});

test("persona context retains character details without prescribing repeated performance", () => {
  const prompt = generateSystemPromptFromPersona(persona);
  for (const detail of [persona.name, persona.occupation.description, ...persona.longTermGoals, ...persona.shortTermGoals!, persona.beliefs![0].position, persona.skills![0].name, ...persona.behaviors!, ...persona.quirks!, persona.backstory!, persona.currentSituation!]) expect(prompt).toContain(detail);
  expect(prompt).toContain("Use this background as context for your choices and speech.");
  expect(prompt).not.toMatch(/Always stay in character|Express your characteristic behaviors|INSTRUCTIONS:/);
});

test("persona creation preserves supplied constraints and structured output", async () => {
  generateObject.mockResolvedValue({ object: persona });
  expect(await generatePersona({ occupation: "keeper", age: 42 }, "Has a pet crow")).toEqual(persona);
  expect(await generateSinglePersona("A quiet keeper with a pet crow")).toEqual(persona);
  expect(generateObject.mock.calls[0][0].prompt).toContain("occupation: keeper");
  expect(generateObject.mock.calls[0][0].prompt).toContain("Has a pet crow");
  expect(generateObject.mock.calls[1][0].prompt).toContain("A quiet keeper with a pet crow");
  for (const call of generateObject.mock.calls) {
    expect(call[0].schema).toBe(PersonaSchema);
    expect(call[0].prompt).not.toContain("rich backstory");
  }
});
