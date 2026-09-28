import { characterPastSchema } from "../../cognition/character-past-schema";
import { createTownScenario } from "../spatial-town-fixtures";
import { createStoryTownScenario, STORY_TOWN_NARRATOR_PROMPT, STORY_TOWN_STYLE } from "../spatial-town-story";
import { spatialAgentConfig, validateSpatialScenario } from "../spatial-scenario";

test("active story director uses granted native operations without scripting resident reactions", () => {
  const prompt = STORY_TOWN_NARRATOR_PROMPT;
  expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(180);
  expect(prompt).toContain("Create pressure before anyone fails or stalls");
  expect(prompt).toContain("intervention with needed:true and type:world_effect");
  expect(prompt).toContain("exact operation/content schema, target and issued evidenceIds");
  expect(prompt).toContain("prose and requests to God do not execute it");
  expect(prompt).toContain("Available operations and remaining budgets define your authority");
  expect(prompt).toContain("Observe residents' actual responses before adding another complication");
  expect(prompt).toContain("Optional nudge_character suggestions require issued evidenceIds");
  expect(prompt).toContain("only after a successful native receipt");
  expect(prompt).toContain("private thoughts and unread messages remain private");
  expect(prompt).toContain("no event timer, quota or predetermined resolution");
});

test("story town is opt-in, detached and keeps the same physical world and identities", () => {
  const ordinary = createTownScenario(), story = createStoryTownScenario();
  expect(validateSpatialScenario(story)).toEqual(story);
  expect(story.id).not.toBe(ordinary.id);
  expect(story.residents).toHaveLength(10);
  expect(story.blueprint.props).toEqual(ordinary.blueprint.props);
  expect(story.blueprint.walls).toEqual(ordinary.blueprint.walls);
  expect(story.blueprint.doors).toEqual(ordinary.blueprint.doors);
  expect(story.blueprint.spawns).toEqual(ordinary.blueprint.spawns);
  expect(story.blueprint.rooms.map(({ description, ...r }) => r)).toEqual(ordinary.blueprint.rooms.map(({ description, ...r }) => r));
  expect(story.bounds).toEqual(ordinary.bounds);
  expect(story.navigationCellSize).toBe(ordinary.navigationCellSize);
  expect(story.maxWorldEntities).toBe(ordinary.maxWorldEntities);
  for (const resident of story.residents) {
    const before = ordinary.residents.find(r => r.id === resident.id)!;
    expect({ ...resident, role: before.role, personality: before.personality, aspirations: before.aspirations,
      systemPrompt: before.systemPrompt, past: before.past, initialGoal: before.initialGoal, initialObservation: before.initialObservation }).toEqual(before);
  }
  story.residents[0].past!.memories[0].recollection = "changed only in caller";
  story.residents[0].aspirations.length = 0;
  story.blueprint.props[0].description = "changed only in caller";
  expect(createTownScenario()).toEqual(ordinary);
  expect(createStoryTownScenario().residents[0].past!.memories[0].recollection).not.toContain("changed only");
  expect(createStoryTownScenario().residents[0].aspirations).toHaveLength(3);
  expect(createTownScenario("cafe-seat-need").blueprint.props.some(p => p.id === "cafe-seat-1")).toBe(false);
});

test("every resident has four schema-valid private memories, distinct motives and named relationships", () => {
  const story = createStoryTownScenario();
  const names = story.residents.map(r => r.name);
  expect(new Set(story.residents.map(r => r.initialGoal.description)).size).toBe(10);
  expect(new Set(story.residents.map(r => r.role)).size).toBe(10);
  for (const resident of story.residents) {
    const past = characterPastSchema.parse(resident.past);
    expect(past.memories).toHaveLength(4);
    expect(past.memories.every(m => m.provenance === "authored-history")).toBe(true);
    expect(past.memories.some(m => m.period === "yesterday")).toBe(true);
    expect(past.memories.some(m => /childhood|school|early |apprenticeship|training|when I moved/.test(m.period))).toBe(true);
    expect(past.drives).toEqual(resident.aspirations);
    expect(names.filter(name => name !== resident.name && past.background.includes(name)).length).toBeGreaterThanOrEqual(2);
    expect(past.background).toContain("Privately");
    expect(resident.initialGoal.priority).toBe(6);
    expect(resident.initialGoal.description).toMatch(/Cafe|Workshop|Garden/);
    expect(resident.systemPrompt).toContain("Your memories are your own recollections");
    expect(spatialAgentConfig(resident).past).toEqual(past);
    const publicWorld = JSON.stringify(story.blueprint);
    for (const memory of past.memories) expect(publicWorld).not.toContain(memory.recollection);
    expect(publicWorld).not.toContain(past.background);
  }
});

test("misunderstanding is perspective-specific, not injected as common knowledge or completed events", () => {
  const story = createStoryTownScenario();
  const get = (id: string) => story.residents.find(r => r.id === id)!;
  const otis = JSON.stringify(get("otis").past);
  const ada = JSON.stringify(get("ada").past);
  const leon = JSON.stringify(get("leon").past);
  expect(otis).toContain("I told Leon it would be available");
  expect(otis).toContain("I know those accounts do not match");
  expect(ada).toContain("I do not know what he has told everyone else");
  expect(ada).not.toContain("I told Leon it would be available");
  expect(leon).toContain("I heard that from him, not Ada");
  expect(get("tess").past!.background).toContain("I do not know whether he did");
  expect(get("ivo").past!.background).toContain("I have not checked its current contents");
  expect(JSON.stringify(story.blueprint)).not.toMatch(/Privately|misunderstanding|overdue favor|accounts do not match/);
  expect(STORY_TOWN_STYLE.narratorContext).toContain("Characters choose their own reactions");
  expect(STORY_TOWN_STYLE.narratorContext).toContain("Private recollections and plans are not public facts");
});

test("setting prose stays compatible with consumption and growth and grants no new affordances", () => {
  const story = createStoryTownScenario();
  for (const room of story.blueprint.rooms) {
    expect(room.description).not.toMatch(/four |two |empty |no chairs|no supplies|pastries|ready-to-eat|closed|occupied/);
  }
  const cafe = story.blueprint.rooms.find(r => r.id === "town-cafe")!;
  expect(cafe.description).toContain("neighborhood meeting place");
  expect(story.blueprint.props.filter(p => p.assetId === "food")).toHaveLength(4);
  expect(story.blueprint.props.filter(p => p.assetId === "food").every(p => p.description.includes("does not replenish itself"))).toBe(true);
  for (const resident of story.residents) {
    expect(resident.initialGoal.description).not.toMatch(/cook|harvest|buy|sell|pay|farm|craft|send a message|text /i);
    expect(JSON.stringify(resident)).not.toMatch(/SpatialPlacement|cafe-extra-seat|Weaver|godCommand|must cooperate|must confess|must forgive/);
  }
  expect(STORY_TOWN_STYLE.id).toBe("community-drama");
  expect(Object.isFrozen(STORY_TOWN_STYLE)).toBe(true);
});
