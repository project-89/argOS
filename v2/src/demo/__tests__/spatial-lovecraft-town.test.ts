import { createWorld } from "bitecs";
import { characterPastSchema } from "../../cognition/character-past-schema";
import { getWorldAuthoringContext, getWorldCharacterSeed, getWorldSpecification, parseWorldSpecification, setWorldSpecification } from "../../world/world-specification";
import { SPATIAL_ASSETS, type SpatialRoom } from "../spatial-catalog";
import { createTownScenario } from "../spatial-town-fixtures";
import { createLovecraftTownScenario, createLovecraftWorldSpecification, getSaltmereAuthorCast, LOVECRAFT_TOWN_STYLE } from "../spatial-lovecraft-town";
import { spatialAgentConfig, validateSpatialScenario } from "../spatial-scenario";

const geometry = ({ name: _name, description: _description, floor: _floor, building, ...room }: SpatialRoom) => ({
  ...room, ...(building ? { building: { style: building.style, front: building.front } } : {}),
});
const STORY_PROPS = ["willow-house-knocker", "brick-house-knocker", "blue-house-knocker", "sun-house-knocker",
  "gull-house-chest", "marrow-star-logbook", "maras-letter", "agnes-diary", "otis-pocketknife", "leons-heart-pills"];

test("Saltmere preflights on the unchanged town geometry, adding only its story objects", () => {
  const base = createTownScenario(), scenario = createLovecraftTownScenario();
  expect(validateSpatialScenario(scenario)).toEqual(scenario);
  expect(scenario.id).toBe("saltmere-what-the-sea-was-paid-v2");
  expect(scenario.blueprint.id).toBe(scenario.id);
  expect(scenario.navigationCellSize).toBe(.5);
  expect(scenario.bounds).toEqual(base.bounds);
  expect(scenario.blueprint.rooms.map(geometry)).toEqual(base.blueprint.rooms.map(geometry));
  expect(scenario.blueprint.walls).toEqual(base.blueprint.walls);
  expect(scenario.blueprint.doors).toEqual(base.blueprint.doors);
  expect(scenario.blueprint.spawns).toEqual(base.blueprint.spawns);
  const kept = scenario.blueprint.props.filter(p => !STORY_PROPS.includes(p.id));
  expect(kept.map(({ name, description, ...p }) => p)).toEqual(base.blueprint.props.map(({ name, description, ...p }) => p));
  expect(scenario.blueprint.props.map(p => p.id)).toEqual(expect.arrayContaining(STORY_PROPS));
  expect(scenario.blueprint.rooms.map(r => r.name)).toEqual([
    "Lantern House", "Rook House", "Tidemark House", "Gull House", "Saltmere Common", "The Waking Gull Cafe", "The Net House", "Widow's Garden",
  ]);
  for (const resident of scenario.residents) {
    const before = base.residents.find(r => r.id === resident.id)!;
    expect({ id: resident.id, name: resident.name, phoneId: resident.phoneId, home: resident.homeRoomId, start: resident.startRoomId, assetId: resident.assetId })
      .toEqual({ id: before.id, name: before.name, phoneId: before.phoneId, home: before.homeRoomId, start: before.startRoomId, assetId: before.assetId });
  }
});

test("factories return detached scenarios, specifications and author cast sheets", () => {
  const base = createTownScenario(), first = createLovecraftTownScenario(), second = createLovecraftTownScenario();
  const spec = createLovecraftWorldSpecification(), cast = getSaltmereAuthorCast();
  first.residents[0].past!.memories[0].recollection = "caller mutation";
  first.residents[0].schedule![0].name = "caller mutation";
  first.blueprint.props.find(p => p.id === "maras-letter")!.item!.text = "caller mutation";
  spec.inhabitants![0].past!.secret = "spec mutation";
  cast[0].secret = "cast mutation";
  expect(createLovecraftTownScenario()).toEqual(second);
  expect(createTownScenario()).toEqual(base);
  expect(JSON.stringify([createLovecraftWorldSpecification(), getSaltmereAuthorCast()])).not.toMatch(/caller mutation|spec mutation|cast mutation/);
});

test("ten residents with a voice, a secret, charged memories and a goal that puts them in someone's way", () => {
  const scenario = createLovecraftTownScenario();
  expect(scenario.residents).toHaveLength(10);
  expect(new Set(scenario.residents.map(r => r.role)).size).toBe(10);
  expect(new Set(scenario.residents.map(r => r.initialGoal.description)).size).toBe(10);
  const names = scenario.residents.map(r => r.name);
  for (const resident of scenario.residents) {
    const past = characterPastSchema.parse(resident.past);
    expect(past.secret!.length).toBeGreaterThan(200);
    expect(past.voice!.length).toBeGreaterThan(40);
    expect(past.memories.length).toBeGreaterThanOrEqual(3);
    expect(past.memories.length).toBeLessThanOrEqual(4);
    expect(past.drives.length).toBeGreaterThanOrEqual(3);
    expect(resident.aspirations).toHaveLength(3);
    // Relationships crisscross: every history names at least three neighbours.
    expect(names.filter(name => name !== resident.name && past.background.includes(name)).length).toBeGreaterThanOrEqual(3);
    expect(resident.initialGoal).toMatchObject({ kind: "custom", priority: 7 });
    expect(resident.initialGoal.description.length).toBeLessThanOrEqual(300);
    expect(spatialAgentConfig(resident).past).toEqual(past);
    // Persona first; no engine disclaimers in the character's own prompt.
    expect(resident.systemPrompt!.startsWith(`You are ${resident.name}, ${resident.role}.`)).toBe(true);
    expect(resident.systemPrompt).not.toMatch(/not other people's private knowledge|proof of the present state|valid to do nothing/);
    expect(JSON.stringify(resident)).not.toMatch(/must confess|must believe|SpatialPlacement|godCommand/);
  }
  const goal = (id: string) => scenario.residents.find(r => r.id === id)!.initialGoal.description;
  expect(goal("mara")).toMatch(/Leon/); expect(goal("ada")).toMatch(/Eli/); expect(goal("ivo")).toMatch(/Otis/);
  expect(goal("tess")).toMatch(/Bea/); expect(goal("bea")).toMatch(/Tess/); expect(goal("otis")).toMatch(/logbook/);
  expect(goal("sera")).toMatch(/diary/); expect(goal("leon")).toMatch(/Noor/); expect(goal("noor")).toMatch(/Mara/);
  expect(scenario.residents.find(r => r.id === "noor")!.needs.energy).toBe(42);
});

test("each secret belongs to its owner; witnesses remember what they saw, not what it means to others", () => {
  const scenario = createLovecraftTownScenario(), get = (id: string) => scenario.residents.find(r => r.id === id)!;
  expect(get("mara").past!.secret).toContain("Ask Leon what the sea was paid");
  expect(get("ivo").past!.secret).toContain("forcing the old supplies box");
  expect(get("tess").past!.secret).toContain("I scratched the three curves into Cafe table 1 myself");
  expect(get("ada").past!.secret).toContain("three knocks");
  expect(get("leon").past!.secret).toContain("smuggling run");
  expect(get("eli").past!.secret).toContain("Ruben Voss");
  expect(get("sera").past!.secret).toContain("L. knows. He tells the sea story so no one asks about the cargo.");
  expect(get("noor").past!.secret).toContain("I let them go out");
  expect(get("bea").past!.secret).toContain("Keep the sea from counting");
  expect(get("otis").past!.secret).toContain("logbook");
  for (const resident of scenario.residents) {
    for (const other of scenario.residents.filter(r => r.id !== resident.id)) {
      expect(JSON.stringify([other.past, other.systemPrompt, other.initialObservation])).not.toContain(resident.past!.secret!);
    }
  }
  const publicData = JSON.stringify([scenario.blueprint.rooms, scenario.blueprint.props.map(({ item: _item, ...p }) => p), LOVECRAFT_TOWN_STYLE]);
  for (const resident of scenario.residents) {
    expect(publicData).not.toContain(resident.past!.secret!);
    expect(publicData).not.toContain(resident.past!.background);
  }
});

test("story objects: private text lives in item data, never in the inspectable description", () => {
  const scenario = createLovecraftTownScenario(), get = (id: string) => scenario.blueprint.props.find(p => p.id === id)!;
  expect(get("marrow-star-logbook")).toMatchObject({ roomId: "sun-house", assetId: "book", item: { containedBy: "gull-house-chest" } });
  expect(get("gull-house-chest")).toMatchObject({ roomId: "sun-house", assetId: "supply-box" });
  expect(get("maras-letter")).toMatchObject({ roomId: "willow-house", assetId: "paper", item: { carriedBy: "mara" } });
  expect(get("agnes-diary")).toMatchObject({ roomId: "blue-house", supportedBy: "blue-house-table" });
  expect(get("otis-pocketknife")).toMatchObject({ roomId: "sun-house", supportedBy: "sun-house-table", item: { portable: true } });
  expect(get("leons-heart-pills")).toMatchObject({ roomId: "brick-house", supportedBy: "brick-house-table" });
  expect(get("otis-pocketknife").description).toContain("Pale paint");
  for (const id of ["marrow-star-logbook", "maras-letter", "agnes-diary"]) {
    const prop = get(id);
    expect(prop.item!.text!.length).toBeGreaterThan(200);
    expect(prop.item!.text).toContain(prop.item!.excerpt!.slice(0, 40));
    expect(prop.description).not.toContain(prop.item!.text!.slice(0, 40));
  }
  expect(get("maras-letter").item!.text).toContain("Ask Leon what the sea was paid");
  expect(get("agnes-diary").item!.text).toContain("L. knows. He tells the sea story so no one asks about the cargo.");
  expect(get("marrow-star-logbook").item!.text).toMatch(/C\. Brand.*Three Hooks/s);
  for (const house of ["willow-house", "brick-house", "blue-house", "sun-house"])
    expect(get(`${house}-knocker`)).toMatchObject({ roomId: "common-square", assetId: "knocker", item: { knockFor: house } });
  for (const asset of ["book", "paper", "trinket", "knocker"]) expect(SPATIAL_ASSETS[asset].affordances).toEqual(["examine"]);
});

test("the marks carry their human explanations in plain sight for anyone who looks closely", () => {
  const scenario = createLovecraftTownScenario(), get = (id: string) => scenario.blueprint.props.find(p => p.id === id)!;
  expect(get("workshop-box").description).toContain("the middle one fresh and splintered");
  expect(get("workshop-box").description).toContain("pale paint caught in the middle cut");
  expect(get("cafe-table-1").description).toContain("spaced almost too evenly");
  expect(get("garden-plant-1").description).toContain("three old hooked lines cut long ago show through");
  for (const id of ["workshop-box", "cafe-table-1", "garden-plant-1"]) expect(get(id).description).not.toMatch(/Ada|Otis|Bea|Tess|Agnes/);
  expect(scenario.blueprint.props.filter(p => p.assetId === "food")).toHaveLength(4);
  expect(scenario.blueprint.props.filter(p => p.assetId === "phone")).toHaveLength(10);
});

test("residents carry their own evening rhythms at real Saltmere places", () => {
  const scenario = createLovecraftTownScenario(), rooms = new Set(scenario.blueprint.rooms.map(r => r.name));
  const at18 = scenario.residents.map(r => r.schedule!.find(a => (18 - a.startHour + 24) % 24 < a.duration)!);
  expect(at18.every(Boolean)).toBe(true);
  expect(new Set(at18.map(a => a.name)).size).toBe(10);
  for (const activity of scenario.residents.flatMap(r => r.schedule!)) if (activity.location) expect(rooms.has(activity.location)).toBe(true);
  expect(scenario.residents.flatMap(r => r.schedule!).some(a => /leisure|relax/.test(a.name))).toBe(false);
});

test("the specification gives the author the whole cast, including secrets, while the builder brief stays public", () => {
  const scenario = createLovecraftTownScenario(), input = createLovecraftWorldSpecification();
  const spec = parseWorldSpecification(input);
  expect(spec.setting.name).toBe("Saltmere");
  expect(spec.inhabitants).toEqual(scenario.residents.map(({ name, role, description, systemPrompt, startRoom, past }) => ({
    name, role, description, systemPrompt, startRoom, past })));
  expect(spec.inhabitants!.every(i => i.past?.secret)).toBe(true);
  expect(JSON.stringify([spec.story, spec.opportunities, spec.discovery, spec.constraints])).not.toMatch(/clue-combination|No forced confession|public design intent only/);
  expect(spec.discovery!.join(" ")).toContain("Combining clues");
  const world = createWorld(), other = createWorld();
  setWorldSpecification(world, input);
  const brief = getWorldAuthoringContext(world);
  expect(getWorldAuthoringContext(other)).toBe("");
  for (const resident of scenario.residents) {
    expect(getWorldCharacterSeed(world, resident.name)?.past).toEqual(resident.past);
    expect(brief).not.toContain(resident.past!.secret!);
  }
  expect(getWorldSpecification(world)).toEqual(spec);
  const cast = getSaltmereAuthorCast();
  expect(cast.map(c => c.name)).toEqual(scenario.residents.map(r => r.name));
  expect(cast.find(c => c.name === "Otis")).toMatchObject({ home: "Gull House", secret: expect.stringContaining("logbook"), voice: expect.stringContaining("friend") });
});

test("phones keep their owners; the collector reaches both people he is courting", () => {
  const scenario = createLovecraftTownScenario();
  expect(scenario.residents.filter(r => r.phoneContact).map(r => [r.name, r.phoneContact!.name])).toEqual([
    ["Mara", "Alex"], ["Ivo", "Nadia"], ["Tess", "Harlan Pryce"], ["Noor", "Anika"], ["Otis", "Harlan Pryce"],
  ]);
  for (const resident of scenario.residents) {
    const phone = scenario.blueprint.props.find(p => p.id === resident.phoneId)!;
    expect(phone).toMatchObject({ roomId: resident.homeRoomId, assetId: "phone", supportedBy: `${resident.homeRoomId}-table` });
    if (resident.phoneContact) expect(resident.phoneContact.memory).toContain(scenario.blueprint.rooms.find(r => r.id === resident.homeRoomId)!.name);
  }
  const prose = JSON.stringify([scenario.residents, scenario.blueprint.rooms, scenario.blueprint.props]);
  for (const old of createTownScenario().blueprint.rooms.map(r => r.name)) expect(prose).not.toContain(old);
});
