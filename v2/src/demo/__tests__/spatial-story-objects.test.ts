import { jest } from "@jest/globals";
import { SpatialDemo } from "../spatial-demo";
import { Name, ObjectState, Perception, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getAgentVisualEntities, getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getCurrentActivity, getSchedule } from "../../cognition/schedule-system";
import { Schedule } from "../../ecs/components";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

// Offline, manually clocked checks of Saltmere's story objects and the object
// verbs (read/give/show/put/hide/knock/write_note). No model is called.
const demos: SpatialDemo[] = [];
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Story object checks stay offline"));
  jest.spyOn(console, "log").mockImplementation(() => {}); drainPendingStimuli();
});
afterEach(() => {
  for (const demo of demos.splice(0)) demo.stop();
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});
async function saltmere() {
  const demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true, live: false, automaticClock: false, seconds: 300 });
  demos.push(demo); await demo.start(); return demo;
}
const who = (demo: SpatialDemo, name: string) => demo.snapshot().actors.find(a => a.name === name)!;
const keyOf = (demo: SpatialDemo, id: string) => WorkingMemoryIdentity.id[demo.byId.get(id)!];
const perceived = (demo: SpatialDemo, eid: number) => getAgentPerceptions(demo.sim.world, eid).map(p => Perception.content[p]).join("\n");
const remembered = (demo: SpatialDemo, eid: number) => JSON.stringify(getWorkingMemory(demo.sim.world, eid));
const roomKey = (demo: SpatialDemo, name: string) => demo.snapshot().rooms.find(r => r.name === name)!.key;

test("story objects start where the story puts them: hidden, pocketed or on the right tables", async () => {
  const demo = await saltmere(), w = demo.sim.world, room = (id: string) => Name.value[getRoomForEntity(w, demo.byId.get(id)!)!];
  const chest = demo.byId.get("gull-house-chest")!, logbook = demo.byId.get("marrow-star-logbook")!;
  expect(getDirectContainer(w, logbook)).toBe(chest);
  expect(room("gull-house-chest")).toBe("Gull House"); expect(ObjectState.current[chest]).toBe("closed");
  const otis = who(demo, "Otis"), mara = who(demo, "Mara");
  expect(getRoomForEntity(w, otis.id)).toBe(getRoomForEntity(w, chest));
  expect(getAgentVisualEntities(w, otis.id)).toContain(chest);
  expect(getAgentVisualEntities(w, otis.id)).not.toContain(logbook); // Shut inside the chest.
  expect(demo.snapshot().entities.some(e => e.id === logbook)).toBe(false);
  expect(getDirectContainer(w, demo.byId.get("maras-letter")!)).toBe(mara.id);
  for (const other of demo.actors.filter(id => id !== mara.id)) expect(getAgentVisualEntities(w, other)).not.toContain(demo.byId.get("maras-letter"));
  expect(Name.value[getDirectContainer(w, demo.byId.get("agnes-diary")!)!]).toBe("Tidemark House table");
  expect(Name.value[getDirectContainer(w, demo.byId.get("otis-pocketknife")!)!]).toBe("Gull House table");
  expect(Name.value[getDirectContainer(w, demo.byId.get("leons-heart-pills")!)!]).toBe("Rook House table");
  for (const house of ["willow-house", "brick-house", "blue-house", "sun-house"]) expect(room(`${house}-knocker`)).toBe("Saltmere Common");
  // The resident prompt offers the verbs and names what Mara is carrying.
  const context = getAgentWorldCapabilities(w, mara.id)!.context();
  expect(context).toContain("You are carrying: Mara's mother's letter.");
  expect(context).toMatch(/content="read".*content="give <person>".*content="show <person>".*content="put <box or table>".*content="hide <box>".*content="knock".*content="write_note <your words>"/s);
  expect(getAgentWorldCapabilities(w, mara.id)!.affordances!(demo.byId.get("maras-letter")!).map(a => a.name))
    .toEqual(expect.arrayContaining(["read", "give", "show", "put", "hide"]));
});

test("reading reveals a document's words to the reader alone; onlookers only see them reading", async () => {
  const demo = await saltmere(), w = demo.sim.world, mara = who(demo, "Mara"), ivo = who(demo, "Ivo");
  const secret = "Ask Leon what the sea was paid";
  demo.dispatch(mara.key, "interact", keyOf(demo, "maras-letter"), "read"); demo.advance(1000);
  expect(remembered(demo, mara.id)).not.toContain(secret); // Reading takes time.
  demo.advance(6000);
  expect(remembered(demo, mara.id)).toContain(secret);
  expect(perceived(demo, mara.id)).toContain(secret);
  expect(perceived(demo, ivo.id)).toContain("Mara reads Mara's mother's letter.");
  for (const other of demo.actors.filter(id => id !== mara.id)) {
    expect(perceived(demo, other)).not.toContain(secret);
    expect(remembered(demo, other)).not.toContain(secret);
  }
  expect(JSON.stringify(demo.snapshot().events)).not.toContain(secret);
  expect(demo.snapshot().events.map(e => e.text)).toContain("Mara: Read Mara's mother's letter.");
});

test("giving transfers possession and both people perceive it; the recipient still has to read it", async () => {
  const demo = await saltmere(), w = demo.sim.world, mara = who(demo, "Mara"), ivo = who(demo, "Ivo"), letter = demo.byId.get("maras-letter")!;
  demo.dispatch(mara.key, "interact", keyOf(demo, "maras-letter"), "give Nobody"); demo.advance(500);
  expect(getDirectContainer(w, letter)).toBe(mara.id);
  demo.dispatch(mara.key, "interact", keyOf(demo, "maras-letter"), "give Ivo"); demo.advance(2000);
  expect(getDirectContainer(w, letter)).toBe(ivo.id);
  expect(perceived(demo, ivo.id)).toContain("Mara hands you Mara's mother's letter.");
  expect(remembered(demo, mara.id)).toContain("You handed Mara's mother's letter to Ivo");
  expect(perceived(demo, ivo.id)).not.toContain("what the sea was paid");
  demo.dispatch(ivo.key, "interact", keyOf(demo, "maras-letter"), "read"); demo.advance(7000);
  expect(perceived(demo, ivo.id)).toContain("Ask Leon what the sea was paid");
  // The native give action (recipient as target, item as content) works too.
  demo.dispatch(ivo.key, "give", mara.key, "Mara's mother's letter"); demo.advance(2000);
  expect(getDirectContainer(w, letter)).toBe(mara.id);
});

test("showing a document lets the named viewer see its open page, not the whole text", async () => {
  const demo = await saltmere(), w = demo.sim.world, sera = who(demo, "Sera"), noor = who(demo, "Noor"), diary = demo.byId.get("agnes-diary")!;
  demo.dispatch(sera.key, "pickup", keyOf(demo, "agnes-diary")); demo.advance(15_000);
  expect(getDirectContainer(w, diary)).toBe(sera.id);
  demo.dispatch(sera.key, "interact", keyOf(demo, "agnes-diary"), "show Noor"); demo.advance(2000);
  const seen = perceived(demo, noor.id);
  expect(seen).toContain("Sera shows you Agnes Wick's diary.");
  expect(seen).toContain("L. came to the garden again and cried");
  expect(seen).not.toContain("Gran was not brave");
  expect(getDirectContainer(w, diary)).toBe(sera.id);
});

test("hiding puts a held object inside a box and shuts it out of everyone's sight", async () => {
  const demo = await saltmere(), w = demo.sim.world, otis = who(demo, "Otis");
  const knife = demo.byId.get("otis-pocketknife")!, chest = demo.byId.get("gull-house-chest")!, logbook = demo.byId.get("marrow-star-logbook")!;
  demo.dispatch(otis.key, "pickup", keyOf(demo, "otis-pocketknife")); demo.advance(15_000);
  expect(getDirectContainer(w, knife)).toBe(otis.id);
  demo.dispatch(otis.key, "interact", keyOf(demo, "otis-pocketknife"), "put Gull House sea chest"); demo.advance(1000);
  expect(getDirectContainer(w, knife)).toBe(otis.id); // A shut box refuses "put"; only "hide" opens and shuts it.
  demo.dispatch(otis.key, "interact", keyOf(demo, "otis-pocketknife"), "hide Gull House sea chest"); demo.advance(15_000);
  expect(getDirectContainer(w, knife)).toBe(chest);
  expect(ObjectState.current[chest]).toBe("closed");
  for (const id of demo.actors) expect(getAgentVisualEntities(w, id)).not.toContain(knife);
  expect(demo.snapshot().entities.some(e => e.id === knife)).toBe(false);
  // Opening the chest reveals what was hidden; taking the logbook is ordinary pickup.
  demo.dispatch(otis.key, "interact", keyOf(demo, "gull-house-chest"), "open"); demo.advance(3000);
  expect(getAgentVisualEntities(w, otis.id)).toEqual(expect.arrayContaining([knife, logbook]));
  demo.dispatch(otis.key, "pickup", keyOf(demo, "marrow-star-logbook")); demo.advance(3000);
  expect(getDirectContainer(w, logbook)).toBe(otis.id);
  demo.dispatch(otis.key, "interact", keyOf(demo, "marrow-star-logbook"), "put Gull House sea chest"); demo.advance(3000);
  expect(getDirectContainer(w, logbook)).toBe(chest);
});

test("knocking is heard inside the house without revealing who knocked; onlookers see the knocker", async () => {
  const demo = await saltmere(), w = demo.sim.world, mara = who(demo, "Mara"), leon = who(demo, "Leon"), sera = who(demo, "Sera");
  demo.dispatch(mara.key, "interact", roomKey(demo, "Rook House"), "knock 3");
  expect(remembered(demo, mara.id)).toContain("walk to its front door first"); // From home she cannot see it yet.
  demo.dispatch(mara.key, "move", roomKey(demo, "Saltmere Common")); demo.advance(40_000);
  expect(Name.value[getRoomForEntity(w, mara.id)!]).toBe("Saltmere Common");
  demo.dispatch(mara.key, "interact", roomKey(demo, "Rook House"), "knock 3"); demo.advance(30_000);
  const inside = perceived(demo, leon.id);
  expect(inside).toContain("Three knocks at the door of Rook House.");
  expect(inside).not.toContain("Mara knocks");
  expect(perceived(demo, sera.id)).not.toContain("knock"); // Tidemark House cannot hear it.
  expect(perceived(demo, who(demo, "Eli").id)).toContain("Mara knocks 3 times at the door of Rook House."); // Eli is out on the common.
  expect(demo.snapshot().events.map(e => e.text)).toContain("Mara: Knocked 3 times at Rook House.");
});

test("a written note is a new private object: only whoever reads it learns what it says", async () => {
  const demo = await saltmere(), w = demo.sim.world, mara = who(demo, "Mara"), ivo = who(demo, "Ivo");
  const words = "I know what you took from the Net House.";
  demo.dispatch(mara.key, "interact", keyOf(demo, "willow-house-table"), `write_note ${words}`); demo.advance(20_000);
  const note = demo.byId.get("note-1")!;
  expect(note).toBeDefined(); expect(Name.value[note]).toBe("Handwritten note 1");
  expect(getDirectContainer(w, note)).toBe(mara.id);
  expect(perceived(demo, ivo.id)).toContain("Mara writes something on a scrap of paper.");
  expect(perceived(demo, ivo.id)).not.toContain(words);
  expect(JSON.stringify(demo.snapshot().events)).not.toContain(words);
  demo.dispatch(mara.key, "interact", WorkingMemoryIdentity.id[note], "put Lantern House table"); demo.advance(10_000);
  expect(Name.value[getDirectContainer(w, note)!]).toBe("Lantern House table");
  demo.dispatch(ivo.key, "interact", WorkingMemoryIdentity.id[note], "read"); demo.advance(15_000);
  expect(perceived(demo, ivo.id)).toContain(words);
  demo.dispatch(mara.key, "interact", keyOf(demo, "willow-house-table"), `write_note ${"x".repeat(281)}`); demo.advance(1000);
  expect(demo.byId.get("note-2")).toBeUndefined();
});

test("each resident follows their own evening, not a shared chair-sitting leisure block", async () => {
  const demo = await saltmere(), w = demo.sim.world;
  const evening = demo.actors.map(id => getCurrentActivity(w, id));
  expect(evening.every(a => a !== null && a.name !== "leisure")).toBe(true);
  expect(new Set(evening.map(a => a!.name)).size).toBeGreaterThanOrEqual(8);
  const byName = Object.fromEntries(demo.actors.map(id => [Name.value[id], getCurrentActivity(w, id)!]));
  expect(byName.Tess).toMatchObject({ location: "The Waking Gull Cafe" });
  expect(byName.Bea).toMatchObject({ location: "Widow's Garden" });
  expect(byName.Ada).toMatchObject({ location: "The Net House" });
  for (const id of demo.actors) expect(Schedule.activities[getSchedule(w, id)!]).not.toContain('"leisure"');
});
