import { createWorld } from "bitecs";
import { characterPastSchema } from "../../cognition/character-past-schema";
import { getWorldAuthoringContext, getWorldCharacterSeed, getWorldSpecification, parseWorldSpecification, setWorldSpecification } from "../../world/world-specification";
import { SPATIAL_ASSETS, type SpatialRoom } from "../spatial-catalog";
import { createTownScenario } from "../spatial-town-fixtures";
import { createLovecraftTownScenario, createLovecraftWorldSpecification, LOVECRAFT_TOWN_NARRATOR_PROMPT, LOVECRAFT_TOWN_STYLE } from "../spatial-lovecraft-town";
import { spatialAgentConfig, validateSpatialScenario } from "../spatial-scenario";

const geometry = ({ name: _name, description: _description, floor: _floor, building, ...room }: SpatialRoom) => ({
  ...room, ...(building ? { building: { style: building.style, front: building.front } } : {}),
});

test("Saltmere preflights on the unchanged bounded town geometry and exact native identities", () => {
  const base = createTownScenario(), scenario = createLovecraftTownScenario();
  expect(validateSpatialScenario(scenario)).toEqual(scenario);
  expect(scenario.id).toBe("saltmere-coastal-mystery-v1");
  expect(scenario.blueprint.id).toBe(scenario.id);
  expect(scenario.blueprint.author).toBe("operator");
  expect(scenario.navigationCellSize).toBe(.5);
  expect(scenario.bounds).toEqual(base.bounds);
  expect(scenario.maxWorldEntities).toBe(base.maxWorldEntities);
  expect(scenario.blueprint.rooms.map(geometry)).toEqual(base.blueprint.rooms.map(geometry));
  expect(scenario.blueprint.walls).toEqual(base.blueprint.walls);
  expect(scenario.blueprint.doors).toEqual(base.blueprint.doors);
  expect(scenario.blueprint.spawns).toEqual(base.blueprint.spawns);
  expect(scenario.blueprint.props.map(({ name, description, ...p }) => p)).toEqual(base.blueprint.props.map(({ name, description, ...p }) => p));
  expect(scenario.blueprint.props.filter(p => p.assetId === "tree")).toEqual(base.blueprint.props.filter(p => p.assetId === "tree"));
  expect(scenario.blueprint.rooms.map(r => r.name)).toEqual([
    "Lantern House", "Rook House", "Tidemark House", "Gull House", "Saltmere Common", "The Waking Gull Cafe", "The Net House", "Widow's Garden",
  ]);
  for (const resident of scenario.residents) {
    const before = base.residents.find(r => r.id === resident.id)!;
    expect({ id: resident.id, name: resident.name, phoneId: resident.phoneId, home: resident.homeRoomId,
      start: resident.startRoomId, assetId: resident.assetId, appearance: resident.appearance }).toEqual({
      id: before.id, name: before.name, phoneId: before.phoneId, home: before.homeRoomId,
      start: before.startRoomId, assetId: before.assetId, appearance: before.appearance,
    });
    expect(resident.startRoom).toBe(scenario.blueprint.rooms.find(r => r.id === resident.startRoomId)!.name);
  }
});

test("factories return detached scenarios and specification histories without changing the ordinary town", () => {
  const base = createTownScenario(), first = createLovecraftTownScenario(), second = createLovecraftTownScenario();
  const spec = createLovecraftWorldSpecification();
  first.residents[0].past!.memories[0].recollection = "caller mutation";
  first.residents[0].aspirations.length = 0;
  first.blueprint.props[0].description = "caller mutation";
  first.blueprint.rooms[0].building!.roofColor = "#ffffff";
  spec.inhabitants![0].past!.memories[0].recollection = "spec mutation";
  expect(createLovecraftTownScenario()).toEqual(second);
  expect(createTownScenario()).toEqual(base);
  expect(JSON.stringify(createLovecraftWorldSpecification())).not.toMatch(/caller mutation|spec mutation/);
});

test("ten distinct residents carry private formative and recent memories, core drives and actionable concerns", () => {
  const scenario = createLovecraftTownScenario(), names = scenario.residents.map(r => r.name);
  expect(scenario.residents).toHaveLength(10);
  expect(new Set(scenario.residents.map(r => r.role)).size).toBe(10);
  expect(new Set(scenario.residents.map(r => r.initialGoal.description)).size).toBe(10);
  for (const resident of scenario.residents) {
    const past = characterPastSchema.parse(resident.past);
    expect(past.memories).toHaveLength(3);
    expect(past.memories.every(m => m.provenance === "authored-history")).toBe(true);
    expect(past.memories.some(m => /childhood|school years|teenage years|apprenticeship|training/.test(m.period))).toBe(true);
    expect(past.memories.some(m => /yesterday|last week|last month/.test(m.period))).toBe(true);
    expect(past.drives).toHaveLength(3);
    expect(resident.aspirations).toHaveLength(3);
    expect(past.drives).not.toEqual(resident.aspirations);
    expect(names.filter(name => name !== resident.name && past.background.includes(name)).length).toBeGreaterThanOrEqual(2);
    expect(past.background).toContain("Privately");
    expect(resident.initialGoal).toMatchObject({ kind: "custom", priority: 6 });
    expect(resident.initialGoal.description.length).toBeLessThanOrEqual(300);
    expect(resident.systemPrompt).toContain("Your memories are your own recollections");
    expect(spatialAgentConfig(resident).past).toEqual(past);
    expect(resident.initialGoal.description).not.toMatch(/\b(cook|harvest|buy|sell|pay|farm|craft|repair|unlock|activate|cast|summon)\b/i);
    expect(JSON.stringify(resident)).not.toMatch(/SpatialPlacement|Weaver|godCommand|must confess|must believe|must cooperate/);
  }
  expect(scenario.residents.find(r => r.id === "ivo")!.initialGoal.description).toContain("have an available pastry");
  expect(scenario.residents.find(r => r.id === "noor")!.initialGoal.description).toContain("seated break");
  expect(scenario.residents.find(r => r.id === "noor")!.needs.energy).toBe(42);
});

test("public inspectable detail has no private answer or hidden content and adds no affordance", () => {
  const scenario = createLovecraftTownScenario();
  const get = (id: string) => scenario.blueprint.props.find(p => p.id === id)!;
  expect(get("workshop-box").description).toContain("Three shallow hooked cuts cross the outer lid, with pale paint caught in the middle cut.");
  expect(get("cafe-table-1").description).toContain("Three curved scratches interrupt an old circular stain");
  expect(get("garden-plant-1").description).toContain("A crooked pale stripe crosses three older hooked lines");
  for (const id of ["workshop-box", "cafe-table-1", "garden-plant-1"]) {
    expect(SPATIAL_ASSETS[get(id).assetId].affordances).toContain("examine");
    expect(get(id).description).not.toMatch(/Ada|Otis|Bea|secret|inside is|contains a|proof of|unlock/i);
  }
  expect(SPATIAL_ASSETS[get("workshop-box").assetId].initialState).toBe("closed");
  expect(scenario.blueprint.props.some(p => p.supportedBy === "workshop-box")).toBe(false);
  expect(scenario.blueprint.props.filter(p => p.assetId === "food")).toHaveLength(4);
  expect(scenario.blueprint.props.filter(p => p.assetId === "food").every(p => p.description.includes("does not replenish itself"))).toBe(true);
  expect(scenario.blueprint.props.filter(p => p.assetId === "phone")).toHaveLength(10);
  expect(SPATIAL_ASSETS.sofa.affordances).toEqual(["examine"]);
  expect(SPATIAL_ASSETS.chair.affordances).toContain("sit");
  for (const room of scenario.blueprint.rooms) {
    expect(room.description).not.toMatch(/four pastries|box is empty|currently raining|Ada made|Otis lied|Bea painted/);
  }
});

test("different accounts are limited to their owners, not delivered as town knowledge", () => {
  const scenario = createLovecraftTownScenario(), get = (id: string) => scenario.residents.find(r => r.id === id)!;
  const adaMemory = "I made the outer two cuts myself to line up a repair last winter. I do not remember making the middle one.";
  expect(JSON.stringify(get("ada").past)).toContain(adaMemory);
  expect(JSON.stringify(get("ivo").past)).not.toContain(adaMemory);
  expect(get("mara").initialObservation).toContain("not a personal inspection");
  expect(get("eli").past!.background).toContain("did not see what he did inside");
  expect(get("otis").past!.background).toContain("I do not know whether anyone noticed");
  expect(get("leon").past!.background).toContain("Otis told me he spent yesterday afternoon outside");
  expect(get("leon").past!.background).not.toContain("closed the supplies box");
  const publicData = JSON.stringify([scenario.blueprint, LOVECRAFT_TOWN_STYLE, LOVECRAFT_TOWN_NARRATOR_PROMPT]);
  for (const resident of scenario.residents) {
    expect(publicData).not.toContain(resident.past!.background);
    for (const m of resident.past!.memories) {
      expect(publicData).not.toContain(m.recollection);
      for (const other of scenario.residents.filter(r => r.id !== resident.id)) {
        expect(JSON.stringify([other.past, other.initialObservation, other.systemPrompt])).not.toContain(m.recollection);
      }
    }
  }
});

test("specification matches the authored cast while the public builder brief excludes all private character data", () => {
  const scenario = createLovecraftTownScenario(), input = createLovecraftWorldSpecification();
  const spec = parseWorldSpecification(input);
  expect(spec.setting.name).toBe("Saltmere");
  expect(spec.inhabitants).toEqual(scenario.residents.map(({ name, role, description, systemPrompt, startRoom, past }) => ({
    name, role, description, systemPrompt, startRoom, past,
  })));
  const world = createWorld(), otherWorld = createWorld();
  setWorldSpecification(world, input);
  const publicBrief = getWorldAuthoringContext(world);
  expect(publicBrief).toContain("not observed facts or permission");
  expect(publicBrief).toContain("inspectable text");
  expect(publicBrief).toContain("not newly installed 3D decals");
  expect(publicBrief).toContain("No forced confession");
  expect(getWorldAuthoringContext(otherWorld)).toBe("");
  for (const resident of scenario.residents) {
    expect(getWorldCharacterSeed(world, resident.name)?.past).toEqual(resident.past);
    expect(publicBrief).not.toContain(resident.past!.background);
    expect(publicBrief).not.toContain(resident.systemPrompt!);
    for (const m of resident.past!.memories) expect(publicBrief).not.toContain(m.recollection);
  }
  const { inhabitants: _private, ...publicSpec } = spec;
  expect(JSON.stringify(publicSpec)).not.toMatch(/Privately|I made the outer two cuts|closed the supplies box lid/);
  expect(getWorldSpecification(world)).toEqual(spec);
  expect(Object.keys(spec).sort()).toEqual(["version", "setting", "story", "inhabitants", "opportunities", "discovery", "constraints"].sort());
});

test("renaming leaves no stale place references in resident or object authorship and preserves phone relationships", () => {
  const scenario = createLovecraftTownScenario();
  const prose = JSON.stringify([scenario.residents, scenario.blueprint.rooms, scenario.blueprint.props]);
  for (const old of createTownScenario().blueprint.rooms.map(r => r.name)) expect(prose).not.toContain(old);
  expect(scenario.residents.filter(r => r.phoneContact).map(r => [r.name, r.phoneContact!.name])).toEqual([
    ["Mara", "Alex"], ["Ivo", "Nadia"], ["Noor", "Anika"],
  ]);
  for (const resident of scenario.residents) {
    const phone = scenario.blueprint.props.find(p => p.id === resident.phoneId)!;
    expect(phone).toMatchObject({ roomId: resident.homeRoomId, assetId: "phone", supportedBy: `${resident.homeRoomId}-table` });
    expect(phone.description).toContain("screen contents are private");
    if (resident.phoneContact) expect(resident.phoneContact.memory).toContain(scenario.blueprint.rooms.find(r => r.id === resident.homeRoomId)!.name);
  }
});

test("Narrator directs future grounded opportunities without an event timer or execution privilege", () => {
  expect(Object.isFrozen(LOVECRAFT_TOWN_STYLE)).toBe(true);
  const prompt = LOVECRAFT_TOWN_NARRATOR_PROMPT;
  expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(190);
  expect(prompt).toContain("intervention with needed:true and type:world_effect");
  expect(prompt).toContain("Available operations and remaining budgets define your authority");
  expect(prompt).toContain("Observe the consequences before adding another complication");
  expect(prompt).toContain("only after a successful native receipt");
  expect(prompt).toContain("private memories and unread messages remain private");
  expect(prompt).toContain("There is no required confession, discovery or ending");
  expect(LOVECRAFT_TOWN_STYLE.narratorContext).toContain("no supernatural explanation or guilty resident is predetermined");
  expect(LOVECRAFT_TOWN_STYLE.scope).toContain("existing host grants");
});

test("evening fiction allows imperfect motives without placing engine disclaimers in personal histories", () => {
  const scenario = createLovecraftTownScenario(), get = (id: string) => scenario.residents.find(r => r.id === id)!;
  expect(LOVECRAFT_TOWN_STYLE.premise).toContain("An evening");
  expect(get("tess").past!.background).toContain("this evening");
  expect(get("ivo").past!.background).toContain("normal evening");
  expect(get("mara").phoneContact!.description).toContain("evening");
  const fiction = JSON.stringify([scenario.residents.map(r => r.past), scenario.blueprint.rooms, scenario.blueprint.props]);
  expect(fiction).not.toMatch(/installed in|tools promised|grants no|crop system|no harvest|not a traversable|bounded neighborhood|does not establish/);
  expect(get("leon").past!.drives).toContain("Be taken seriously by people whose respect matters to me");
  expect(get("leon").initialGoal.description).toContain("decide how much of the old story to tell");
  expect(get("sera").past!.background).toContain("my grandmother died last year");
  expect(get("sera").personality).toContain("mistakes a cherished possibility for the most likely one");
  expect(get("otis").initialGoal.description).toContain("decide how much I want to explain");
  expect(get("otis").initialGoal.description).not.toMatch(/confess|correct|apologize/);
  expect(get("otis").past!.memories[2].emotionalTone).toContain("defensiveness");
});
