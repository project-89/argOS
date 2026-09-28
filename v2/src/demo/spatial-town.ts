/** Authored town seed, not an autonomous generation result. Occupations and
 * visual assets describe people/places; only installed native actions confer
 * capabilities. The cafe has finite food; the garden has ornamental plants. */
import type { SpatialResident } from "./spatial-scenario";
import type { SpatialBlueprint, SpatialBounds, SpatialPoint, SpatialProp, SpatialRoom } from "./spatial-catalog";

export type TownResident = SpatialResident;

/** 97×73 cells at .5m =7,081 cells. The pure .25m catalog flood fill also
 * remains bounded (193×145 =27,985 cells), including non-walkable margins. */
export const TOWN_WORLD_BOUNDS: SpatialBounds = { minX: 0, minY: 0, maxX: 48, maxY: 36 };
export const TOWN_NAVIGATION_CELL_SIZE = .5;
const homes = [
  { id: "willow-house", name: "Willow House", x: 3, floor: "#b9c2a6", wallColor: "#e5dcc7", roofColor: "#556876", residents: ["Mara", "Ivo", "Tess"] },
  { id: "brick-house", name: "Brick House", x: 15, floor: "#c4a690", wallColor: "#d9ab85", roofColor: "#a65543", residents: ["Ada", "Leon", "Eli"] },
  { id: "blue-house", name: "Blue House", x: 27, floor: "#a4bbc7", wallColor: "#c6dadd", roofColor: "#4f817d", residents: ["Sera", "Noor"] },
  { id: "sun-house", name: "Sun House", x: 39, floor: "#d2c08c", wallColor: "#efdfb3", roofColor: "#8a6256", residents: ["Bea", "Otis"] },
] as const;
const rooms: SpatialRoom[] = homes.map(h => ({ id: h.id, name: h.name,
  description: "A detached single-room cottage with a sofa, table, chair, lamp and residents' phones. Its front doorway opens onto the broad green Common Square.",
  bounds: { minX: h.x, minY: 3, maxX: h.x + 7, maxY: 9 }, entry: { x: h.x + 3.5, y: 8 }, floor: h.floor, environment: "indoor",
  building: { style: "cottage", wallColor: h.wallColor, roofColor: h.roofColor, front: "south" } }));
rooms.push(
  { id: "common-square", name: "Common Square", description: "A spacious outdoor park common between four widely spaced cottages, the Corner Cafe, Shared Workshop and Community Garden. Tree-lined borders, open lawns, pedestrian paths and scattered seats leave plenty of room to walk.",
    bounds: { minX: 0, minY: 9, maxX: 48, maxY: 27 }, entry: { x: 24, y: 18 }, floor: "#94ab7c", environment: "outdoor" },
  { id: "town-cafe", name: "Corner Cafe", description: "A small neighborhood meeting place with tables, chairs and four ready-to-eat pastries laid out for anyone to take or eat.",
    bounds: { minX: 2, minY: 27, maxX: 11, maxY: 34 }, entry: { x: 6.5, y: 28.5 }, floor: "#d2b18d", environment: "indoor",
    building: { style: "cafe", wallColor: "#eedbbf", roofColor: "#9d5847", front: "north" } },
  { id: "town-workshop", name: "Shared Workshop", description: "A quiet shared room with a sturdy worktable, a chair, a lamp and an empty supplies box. Neighbors use it to sit and discuss practical ideas.",
    bounds: { minX: 15, minY: 27, maxX: 24, maxY: 34 }, entry: { x: 19.5, y: 28.5 }, floor: "#a5aaa1", environment: "indoor",
    building: { style: "workshop", wallColor: "#c3c6b5", roofColor: "#566b69", front: "north" } },
  { id: "town-garden", name: "Community Garden", description: "A large open-air ornamental garden with four trees, planted borders and seats, opening directly onto the green common. Open grass leaves room to wander or sit away from the buildings.",
    bounds: { minX: 28, minY: 27, maxX: 46, maxY: 35 }, entry: { x: 37, y: 28.5 }, floor: "#93ae80", environment: "outdoor" },
);

const props: SpatialProp[] = [], walls: SpatialBlueprint["walls"] = [], doors: SpatialBlueprint["doors"] = [];
function prop(id: string, roomId: string, assetId: string, name: string, x: number, y: number,
  extras: Partial<SpatialProp> = {}, anchor: SpatialPoint = { x: 0, y: 1 }): void {
  props.push({ id, roomId, assetId, name, description: name, position: { x, y }, elevation: 0,
    rotationY: 0, interactionAnchors: [anchor], reach: 1.1, ...extras });
}
function wall(id: string, roomId: string, x: number, y: number, halfWidth: number, halfDepth: number, height = 2.5): void {
  walls.push({ id, roomId, position: { x, y }, halfWidth, halfDepth, height });
}
function passage(id: string, from: string, to: string, x: number, y: number, enteringNorth: boolean): void {
  prop(`${id}-opening`, from, "passage", `${rooms.find(r => r.id === from)!.name} passage`, x, y,
    { description: "A permanently open pedestrian passage; there is no operable door or lock." }, { x: 0, y: enteringNorth ? 1 : -1 });
  doors.push({ id, from, to, propId: `${id}-opening`, position: { x, y }, axis: "y", width: 2 });
}
for (const h of homes) {
  prop(`${h.id}-sofa`, h.id, "sofa", `${h.name} sofa`, h.x + 2, 4.5);
  prop(`${h.id}-table`, h.id, "table", `${h.name} table`, h.x + 4.5, 5.5);
  prop(`${h.id}-chair`, h.id, "chair", `${h.name} chair`, h.x + 6, 5.5);
  prop(`${h.id}-lamp`, h.id, "lamp", `${h.name} reading lamp`, h.x + 1, 7.5, {}, { x: 1, y: 0 });
  h.residents.forEach((name, i) => prop(`${name.toLowerCase()}-phone`, h.id, "phone", `${name}'s phone`, h.x + 4 + i * .5, 5.5,
    { elevation: .77, supportedBy: `${h.id}-table`, description: `A physical phone belonging to ${name}. Its screen contents are private.` }));
  wall(`${h.id}-north`, h.id, h.x + 3.5, 3, 3.5, .08);
  wall(`${h.id}-west`, h.id, h.x, 6, .08, 3);
  wall(`${h.id}-east`, h.id, h.x + 7, 6, .08, 3);
  wall(`${h.id}-south-left`, h.id, h.x + 1.25, 9, 1.25, .08);
  wall(`${h.id}-south-right`, h.id, h.x + 5.75, 9, 1.25, .08);
  passage(`${h.id}-square`, h.id, "common-square", h.x + 3.5, 9, false);
}
// Actual floors, not scenery, form the large open park. Furniture leaves a
// continuous east-west walking spine at y18 and broad north-south crossings.
for (const [i, p] of [16, 21].flatMap(y => [8, 16, 32, 40].map(x => ({ x, y }))).entries())
  prop(`square-seat-${i + 1}`, "common-square", "chair", `Square seat ${i + 1}`, p.x, p.y);
for (const [i, x] of [20, 28].entries()) prop(`square-planter-${i + 1}`, "common-square", "plant", `Square planter ${i + 1}`, x, 22, {}, { x: 0, y: -1 });
const parkTrees = [
  ...[2, 12, 14, 24, 26, 36, 38, 46].map(x => ({ x, y: 11 })),
  ...[15, 20, 25].flatMap(y => [{ x: 2, y }, { x: 46, y }]),
  ...[6, 10, 14, 18, 22, 26, 34, 40].map(x => ({ x, y: 25 })),
];
for (const [i, p] of parkTrees.entries()) prop(`square-tree-${i + 1}`, "common-square", "tree", `Common tree ${i + 1}`, p.x, p.y,
  { description: "A shade tree with a solid trunk and leafy canopy." }, { x: p.x === 46 ? -1 : p.x === 2 ? 1 : 0, y: p.x === 2 || p.x === 46 ? 0 : 1 });

for (const [i, x] of [4.5, 8.5].entries()) {
  const table = `cafe-table-${i + 1}`;
  prop(table, "town-cafe", "table", `Cafe table ${i + 1}`, x, 30.5);
  prop(`cafe-seat-${i + 1}`, "town-cafe", "chair", `Cafe seat ${i + 1}`, x, 32.5, {}, { x: 1, y: 0 });
  for (const [j, dx] of [-.5, .5].entries()) {
    const n = i * 2 + j + 1;
    prop(`cafe-pastry-${n}`, "town-cafe", "food", `Cafe pastry ${n}`, x + dx, 30.5,
      { elevation: .77, supportedBy: table, description: "One ready-to-eat pastry. Eating consumes this actual portion; it does not replenish itself." });
  }
}
prop("workshop-table", "town-workshop", "table", "Workshop worktable", 17.5, 30.5);
prop("workshop-chair", "town-workshop", "chair", "Workshop chair", 22, 30.5);
prop("workshop-box", "town-workshop", "supply-box", "Empty workshop supplies box", 22, 32.5, {}, { x: -1, y: 0 });
prop("workshop-lamp", "town-workshop", "lamp", "Workshop floor lamp", 16.5, 32.5, {}, { x: 1, y: 0 });
for (const [i, p] of [{ x: 36, y: 28.5 }, { x: 38, y: 28.5 }, { x: 36, y: 34 }, { x: 38, y: 34 }].entries())
  prop(`garden-plant-${i + 1}`, "town-garden", "plant", `Garden ornamental plant ${i + 1}`, p.x, p.y, {}, { x: 0, y: i < 2 ? 1 : -1 });
for (const [i, p] of [31, 33].flatMap(y => [35, 39].map(x => ({ x, y }))).entries())
  prop(`garden-seat-${i + 1}`, "town-garden", "chair", `Garden seat ${i + 1}`, p.x, p.y, {}, { x: 1, y: 0 });
for (const [i, p] of [30, 33].flatMap(y => [31, 43].map(x => ({ x, y }))).entries())
  prop(`garden-tree-${i + 1}`, "town-garden", "tree", `Garden tree ${i + 1}`, p.x, p.y,
    { description: "An ornamental tree with a solid trunk and leafy canopy." }, { x: p.x === 31 ? 1 : -1, y: 0 });

for (const [roomId, left, right, opening] of [["town-cafe", 2, 11, 6.5], ["town-workshop", 15, 24, 19.5]] as const) {
  wall(`${roomId}-west`, roomId, left, 30.5, .08, 3.5);
  wall(`${roomId}-east`, roomId, right, 30.5, .08, 3.5);
  wall(`${roomId}-south`, roomId, (left + right) / 2, 34, (right - left) / 2, .08);
  wall(`${roomId}-north-left`, roomId, (left + opening - 1) / 2, 27, (opening - 1 - left) / 2, .08);
  wall(`${roomId}-north-right`, roomId, (opening + 1 + right) / 2, 27, (right - opening - 1) / 2, .08);
  passage(`${roomId}-square`, roomId, "common-square", opening, 27, true);
}
// Garden has no house walls. Visible grass between buildings is decorative
// landscape outside the registered floors, not an extra walkable destination.
passage("town-garden-square", "town-garden", "common-square", 37, 27, true);

type ResidentSeed = {
  id: string; name: string; role: string; home: string; start: string; position: SpatialPoint; asset: "actor-a" | "actor-b" | "actor-f";
  personality: string; background: string; aspirations: string[]; memory: string; meaning: string; cues: string[];
  goal: string; hunger: number; energy: number; contact?: TownResident["phoneContact"];
};
const seeds: ResidentSeed[] = [
  { id: "mara", name: "Mara", role: "curious neighborhood resident", home: "willow-house", start: "willow-house", position: { x: 5, y: 7.5 }, asset: "actor-f",
    personality: "Thoughtful, independent and curious; values friendship without needing permission to pursue her own afternoon.",
    background: "Mara recently moved into Willow House with Ivo and Tess. Alex is a close friend who lives elsewhere. She is still learning the neighborhood and wants it to feel like home.",
    aspirations: ["Feel at home in the neighborhood", "Keep meaningful friendships", "Make space for curiosity and time alone"],
    memory: "When I moved last month, Alex stayed late helping me unpack while Ivo brought a lamp over. I remember the relief of having friends show up without making a fuss.",
    meaning: "Small acts of care and honest messages can make an unfamiliar place feel like home.", cues: ["Alex", "Willow House", "moving", "phone"],
    goal: "Take a walk into Common Square and decide where I want to spend the afternoon", hunger: 35, energy: 85,
    contact: { name: "Alex", description: "Stay in touch with Alex while making my own choices about the afternoon.", memory: "Alex is a close friend I trust. I left my phone on the Willow House table. Its double vibration signals a message, not knowledge of its contents." } },
  { id: "ivo", name: "Ivo", role: "practical neighbor", home: "willow-house", start: "willow-house", position: { x: 8, y: 7.5 }, asset: "actor-b",
    personality: "Warm, practical and unhurried; likes helping, but can take a break and enjoy himself.",
    background: "Ivo shares Willow House with Mara and Tess. He has repaired household items in the past and enjoys sitting down with neighbors after practical work.",
    aspirations: ["Be useful without taking over", "Look after myself as well as others", "Keep my relationship with my sister Nadia close"],
    memory: "My sister Nadia once found me skipping lunch to finish a repair. She brought me a sandwich and we sat outside until I could laugh at myself again.",
    meaning: "Taking care of myself is compatible with helping other people.", cues: ["Nadia", "lunch", "repair", "break"],
    goal: "Visit Corner Cafe and have a pastry before choosing something else to do", hunger: 65, energy: 68,
    contact: { name: "Nadia", description: "Keep in touch with my sister Nadia without putting the rest of my day on hold.", memory: "Nadia is my sister and lives elsewhere. We check in by text. My phone is on the Willow House table; a notification does not reveal who sent it." } },
  { id: "tess", name: "Tess", role: "cafe caretaker", home: "willow-house", start: "town-cafe", position: { x: 6.5, y: 29 }, asset: "actor-a",
    personality: "Welcoming, observant and quietly funny; likes people to feel comfortable without insisting on constant conversation.",
    background: "Tess lives at Willow House and looks after the Corner Cafe as a neighborhood meeting place. Today she put four ready-made pastries out for neighbors to enjoy.",
    aspirations: ["Make the cafe a welcoming shared place", "Get to know people beyond polite small talk", "Notice when I need a quiet break"],
    memory: "On the cafe's first afternoon, Leon sat alone looking uncomfortable. I offered him a seat near the window and then let him read in peace. He returned the next week.",
    meaning: "Welcome can mean offering company or making room for quiet.", cues: ["cafe", "Leon", "seat"],
    goal: "Check the cafe seating and decide how I want to welcome today's visitors", hunger: 40, energy: 80 },
  { id: "ada", name: "Ada", role: "bicycle mechanic taking a break", home: "brick-house", start: "town-workshop", position: { x: 19.5, y: 29 }, asset: "actor-f",
    personality: "Pragmatic, interested in how things work, and able to leave work unfinished when there is nothing useful to do next.",
    background: "Ada shares Brick House with Leon and Eli. She works on bicycles elsewhere and visits the Shared Workshop to think and meet neighbors. The current workshop has a table and an empty supplies box.",
    aspirations: ["Stay curious about practical problems", "Take real breaks from work", "Build reciprocal friendships"],
    memory: "Last week I ate lunch after fixing a neighbor's bicycle, then found a quiet seat. I went back to work less impatient and made fewer mistakes.",
    meaning: "Rest and food support the work I care about.", cues: ["lunch", "workshop", "break", "seat"],
    goal: "Leave the workshop for Corner Cafe and find something to eat", hunger: 60, energy: 65 },
  { id: "leon", name: "Leon", role: "retired librarian", home: "brick-house", start: "brick-house", position: { x: 17, y: 7.5 }, asset: "actor-b",
    personality: "Patient and reserved, with a dry sense of humor; enjoys company in small doses and chooses quiet deliberately.",
    background: "Leon retired from library work and now shares Brick House with Ada and Eli. He enjoys walking to the garden and watching neighborhood life without needing to comment on everything.",
    aspirations: ["Find a satisfying slower rhythm", "Stay connected without losing quiet time", "Learn the stories of my neighbors"],
    memory: "Tess once noticed that I wanted to be around people without making conversation. She gave me a comfortable place in the cafe and left me to it.",
    meaning: "I can belong somewhere without constantly performing sociability.", cues: ["Tess", "cafe", "quiet", "garden"],
    goal: "Walk to Community Garden and choose a quiet seat", hunger: 30, energy: 72 },
  { id: "eli", name: "Eli", role: "new neighbor", home: "brick-house", start: "common-square", position: { x: 24, y: 18 }, asset: "actor-a",
    personality: "Friendly and mildly tentative in unfamiliar groups; curious enough to act without waiting to be invited.",
    background: "Eli moved into Brick House two weeks ago. Ada and Leon are his housemates. He wants to learn which shared places he enjoys rather than spend every afternoon at home.",
    aspirations: ["Build a life in the neighborhood", "Get comfortable doing things on my own", "Find friends with different interests"],
    memory: "On my first evening, Ada drew me a simple description of the square and Leon told me the cafe was a good place to begin. I felt less like an outsider.",
    meaning: "A small introduction can make it easier to take the next step myself.", cues: ["Ada", "Leon", "cafe", "new place"],
    goal: "Visit Corner Cafe and find out whether I enjoy spending time there", hunger: 50, energy: 88 },
  { id: "sera", name: "Sera", role: "illustrator on an afternoon walk", home: "blue-house", start: "blue-house", position: { x: 29, y: 7.5 }, asset: "actor-f",
    personality: "Observant and imaginative, with a playful streak; comfortable following a small curiosity into action.",
    background: "Sera shares Blue House with Noor. She illustrates books professionally, but this afternoon is personal time. She enjoys looking at the garden's colors and listening to neighbors' stories.",
    aspirations: ["Notice ordinary things carefully", "Keep a life beyond paid work", "Spend good time with Noor and other neighbors"],
    memory: "Noor and I once took a walk without trying to make anything useful from it. The light on the garden plants stayed with me longer than the work I had been forcing that morning.",
    meaning: "Not every worthwhile experience needs to become a project.", cues: ["Noor", "garden", "walk", "plants"],
    goal: "Visit Community Garden and look at the ornamental plants", hunger: 35, energy: 90 },
  { id: "noor", name: "Noor", role: "nurse enjoying a day off", home: "blue-house", start: "blue-house", position: { x: 32, y: 7.5 }, asset: "actor-a",
    personality: "Considerate, direct and self-possessed; cares about others without treating every social moment as a duty.",
    background: "Noor shares Blue House with Sera and works as a nurse elsewhere. Today is a day off. Her sister Anika lives in another neighborhood, and their messages matter to her.",
    aspirations: ["Rest properly on days off", "Stay close to Anika and Sera", "Let other people help sometimes"],
    memory: "After a difficult shift, Anika sent a ridiculous story instead of asking me to explain everything. I laughed, ate dinner and finally felt the day loosen its grip.",
    meaning: "Connection can be light and restorative, not another obligation.", cues: ["Anika", "message", "rest", "day off"],
    goal: "Go to Common Square and decide whether I want company or a quiet break", hunger: 45, energy: 60,
    contact: { name: "Anika", description: "Stay connected with my sister Anika while protecting time to rest.", memory: "Anika is my sister and lives in another neighborhood. I welcome her messages. My phone is on the Blue House table; its vibration alone reveals no message content." } },
  { id: "bea", name: "Bea", role: "neighborhood gardener", home: "sun-house", start: "town-garden", position: { x: 37, y: 30.5 }, asset: "actor-f",
    personality: "Calm, attentive and practical; likes patient observation but does not need to supervise everyone around her.",
    background: "Bea shares Sun House with Otis. She knows about gardening and enjoys the ornamental Community Garden. Today she came to enjoy the plants and spend time outside.",
    aspirations: ["Help shared places feel cared for", "Keep learning from quiet observation", "Make time for friendship outside my usual routines"],
    memory: "Otis once joined me for a silent walk after a difficult week. We looked at the plants for a while and only talked when we wanted to. I felt understood.",
    meaning: "Shared attention can matter as much as advice.", cues: ["Otis", "garden", "quiet", "plants"],
    goal: "Look around the garden, then choose a comfortable place for a break", hunger: 40, energy: 74 },
  { id: "otis", name: "Otis", role: "community-minded neighbor", home: "sun-house", start: "sun-house", position: { x: 42.5, y: 7.5 }, asset: "actor-b",
    personality: "Sociable and good-humored, but not afraid to leave a conversation and follow another interest.",
    background: "Otis shares Sun House with Bea. He likes helping newcomers find their feet and enjoys walking across the square to see who is around.",
    aspirations: ["Keep neighborhood friendships alive", "Welcome newcomers without crowding them", "Make room for my own small pleasures"],
    memory: "When I first moved here, Leon showed me the cafe and then said I did not have to stay just to be polite. That made me want to come back.",
    meaning: "An invitation is kinder when the other person is free to decline.", cues: ["Leon", "cafe", "newcomer", "invitation"],
    goal: "Take a walk through Common Square and choose whether to visit the cafe or garden", hunger: 55, energy: 82 },
];

export const TOWN_RESIDENTS: TownResident[] = seeds.map(s => {
  const startRoom = rooms.find(r => r.id === s.start)!.name;
  return {
    id: s.id, name: s.name, role: s.role, startRoom, startRoomId: s.start, homeRoomId: s.home, assetId: s.asset,
    personality: s.personality, description: "An adult resident in a simple everyday outfit.",
    systemPrompt: `You are ${s.name}, ${s.role}. ${s.personality} Choose from what you actually perceive and care about. Other people's private thoughts and phone messages are not your knowledge.`,
    aspirations: [...s.aspirations], past: { background: s.background, drives: [...s.aspirations], memories: [{
      recollection: s.memory, emotionalTone: "warm, personally meaningful", importance: .75,
      selfBelief: s.aspirations[0], meaning: s.meaning, cues: [...s.cues], period: "Before this afternoon", provenance: "authored-history",
    }] },
    // The three kit looks are reused. No unique color, hairstyle or accessory
    // is asserted until the public mesh mapping actually supports that detail.
    appearance: { age: "adult", clothing: "a simple everyday outfit", posture: "standing" },
    needs: { hunger: s.hunger, energy: s.energy }, initialGoal: { description: s.goal, priority: 5, kind: "custom" },
    initialObservation: `You are in ${startRoom} on a quiet afternoon. ${rooms.find(r => r.id === s.start)!.description}`,
    phoneId: `${s.id}-phone`, ...(s.contact ? { phoneContact: { ...s.contact } } : {}),
  };
});

export const TOWN_SPATIAL_BLUEPRINT: SpatialBlueprint = {
  id: "small-town-authored-v1", author: "operator", rooms, props, walls, doors,
  spawns: seeds.map(s => ({ id: s.id, name: s.name, roomId: s.start, assetId: s.asset, position: { ...s.position } })),
};
