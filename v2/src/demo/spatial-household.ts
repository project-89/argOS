/** A small authored social testbed, not a script for its residents. Every
 * present object has an installed native affordance. Promises and concerns
 * belong to private histories; they confer neither custody nor secret facts
 * on anyone else. Weather and furnishing authority remain host decisions. */
import type { CharacterPast } from "../cognition/character-past-schema";
import { extendedBlackoutSpatialBlueprint, type SpatialBlueprint, type SpatialProp } from "./spatial-catalog";
import { validateSpatialScenario, type SpatialResident, type SpatialScenarioDefinition } from "./spatial-scenario";

export const HOUSEHOLD_STORY_STYLE = {
  name: "An evening at home",
  premise: "Four adult friends share a small home, a kitchen and an outdoor patio. Ordinary appetites, hospitality, rest and relationships can pull them in different directions. What they actually choose changes the evening.",
  narratorContext: "Intimate, grounded household drama. Follow public choices and their consequences, including changes of purpose and acts of care. A useful complication puts an existing concern in contact with a physical opportunity or cost; it does not prescribe anyone's reaction. Use only installed native permissions. Private memories and phone contents are not public evidence. Unused intervention budget is not a reason to invent an event, and an observation is not an applied change.",
};

/** One location whose reachability is tested both before and after adding the
 * chair. A site is a possible design, not permission or a promised outcome. */
export const HOUSEHOLD_GROWTH_SITES = [{
  id: "household-sitting-seat", roomId: "household-sitting-room",
  position: { x: 6, y: 3 }, anchors: [{ x: 0, y: 1 }], allowedAssets: ["chair"] as Array<"chair">,
}];

const SITTING = "household-sitting-room", KITCHEN = "household-kitchen", PATIO = "household-patio";
const makeProp = (id: string, roomId: string, assetId: string, name: string, x: number, y: number,
  extra: Partial<SpatialProp> = {}): SpatialProp => ({ id, roomId, assetId, name, description: name,
  position: { x, y }, elevation: 0, rotationY: 0, interactionAnchors: [{ x: 0, y: 1 }], reach: 1.1, ...extra });

function blueprint(): SpatialBlueprint {
  // Reuse the established, connected apartment/utility/storeroom shell. This
  // factory is detached; none of the original repair puzzle is registered.
  const source = extendedBlackoutSpatialBlueprint();
  const roomIds: Record<string, string> = { apartment: SITTING, utility: KITCHEN, storeroom: PATIO };
  const rooms: SpatialBlueprint["rooms"] = [
    { id: SITTING, name: "Sitting Room", description: "A shared indoor sitting room with an open east passage into the Kitchen. It offers a separate space from the kitchen and the outdoor patio.",
      bounds: { minX: 0, minY: 0, maxX: 8, maxY: 7 }, entry: { x: 4, y: 5.5 }, floor: "#ba9e7e", environment: "indoor" },
    { id: KITCHEN, name: "Kitchen", description: "A roofed indoor kitchen and gathering space. An open passage leads west to the Sitting Room; another opens south onto the outdoor Patio. The room offers shelter from rain.",
      bounds: { minX: 8, minY: 0, maxX: 16, maxY: 7 }, entry: { x: 9.5, y: 5 }, floor: "#a4aea0", environment: "indoor" },
    { id: PATIO, name: "Patio", description: "A small outdoor patio open to the sky. The open north passage leads directly into the sheltered Kitchen; the sitting room is another room beyond it.",
      bounds: { minX: 8, minY: 7, maxX: 16, maxY: 11 }, entry: { x: 14, y: 8.25 }, floor: "#9da78c", environment: "outdoor" },
  ];
  const props = [
    makeProp("household-sofa", SITTING, "sofa", "Old sofa", 2, 1.1,
      { description: "An old sofa. Its upholstery can be examined; it is not an installed usable seat in this prototype." }),
    makeProp("household-phone-table", SITTING, "table", "Sitting room table", 4, 3),
    makeProp("household-lamp", SITTING, "lamp", "Standing lamp", .7, 3,
      { interactionAnchors: [{ x: .8, y: 0 }] }),
    makeProp("household-kitchen-table", KITCHEN, "table", "Kitchen table", 12, 3),
    makeProp("household-apple-pastry", KITCHEN, "food", "Apple pastry", 11.6, 3,
      { elevation: .77, supportedBy: "household-kitchen-table", description: "One ready-to-eat apple pastry. Eating it consumes this portion." }),
    makeProp("household-pear-pastry", KITCHEN, "food", "Pear pastry", 12.4, 3,
      { elevation: .77, supportedBy: "household-kitchen-table", description: "One ready-to-eat pear pastry. Eating it consumes this portion." }),
    makeProp("household-empty-box", KITCHEN, "supply-box", "Empty storage box", 10, 1.5,
      { description: "An ordinary empty storage box with a lid that opens and closes." }),
    makeProp("household-patio-chair", PATIO, "chair", "Patio chair", 11, 9.2,
      { interactionAnchors: [{ x: 1, y: 0 }], description: "A single chair outdoors on the patio, exposed to the weather." }),
    makeProp("household-patio-plant", PATIO, "plant", "Patio planter", 15, 9.5,
      { interactionAnchors: [{ x: -1, y: 0 }], description: "An ornamental plant in a pot." }),
    makeProp("household-kitchen-passage", SITTING, "passage", "Kitchen passage", 8, 5,
      { rotationY: Math.PI / 2, interactionAnchors: [{ x: -.8, y: 0 }], description: "A permanently open passage between the Sitting Room and Kitchen." }),
    makeProp("household-patio-passage", KITCHEN, "passage", "Patio passage", 14, 7,
      { interactionAnchors: [{ x: 0, y: -.8 }], description: "A permanently open passage between the Kitchen and Patio." }),
    ...["Tess", "Ivo", "Noor", "Mara"].map((name, i) => makeProp(`${name.toLowerCase()}-phone`, SITTING, "phone", `${name}'s phone`, 3.45 + i * .35, 3,
      { elevation: .77, supportedBy: "household-phone-table",
        // Both sides of the shared table are reachable. A resident standing
        // at a neighboring phone must not monopolize the only approach.
        interactionAnchors: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: -.65, y: 1 }, { x: .65, y: 1 }],
        description: `A physical phone belonging to ${name}. Its screen contents are private.` })),
  ];
  return { id: "household-evening-layout-v1", author: "operator", rooms, props,
    // Low patio boundaries retain the tested footprint without roofing it.
    walls: source.walls.map(w => ({ ...w, id: `household-${w.id}`, roomId: roomIds[w.roomId], height: w.roomId === "storeroom" ? .7 : w.height })),
    doors: [
      { id: "household-sitting-kitchen", from: SITTING, to: KITCHEN, propId: "household-kitchen-passage", position: { x: 8, y: 5 }, axis: "x", width: 2 },
      { id: "household-kitchen-patio", from: KITCHEN, to: PATIO, propId: "household-patio-passage", position: { x: 14, y: 7 }, axis: "y", width: 2 },
    ],
    spawns: [
      { id: "tess", name: "Tess", roomId: SITTING, assetId: "actor-a", position: { x: 4, y: 5.5 } },
      { id: "ivo", name: "Ivo", roomId: KITCHEN, assetId: "actor-b", position: { x: 10.5, y: 5 } },
      { id: "noor", name: "Noor", roomId: PATIO, assetId: "actor-a", position: { x: 14, y: 9.25 } },
      { id: "mara", name: "Mara", roomId: SITTING, assetId: "actor-f", position: { x: 2, y: 5.5 } },
    ],
  };
}

function memory(recollection: string, selfBelief: string, meaning: string, cues: string[], period: string, emotionalTone = "personally meaningful"): CharacterPast["memories"][number] {
  return { recollection, selfBelief, meaning, cues, period, emotionalTone, importance: .8, provenance: "authored-history" };
}

function residents(layout: SpatialBlueprint): SpatialResident[] {
  const personal: Array<Pick<SpatialResident, "id" | "role" | "personality" | "aspirations" | "past" | "needs" | "initialGoal" | "phoneContact">> = [
    { id: "tess", role: "housemate hosting a small evening together", personality: "Warm and observant, with a dry sense of humor. Values reciprocal care and sometimes conceals tiredness behind capable hosting.",
      aspirations: ["Make this home welcoming without doing every task myself", "Enjoy company rather than only arranging it", "Let friends know what I need"],
      needs: { hunger: 48, energy: 57 }, initialGoal: { description: "Find a way to enjoy this evening with my housemates without taking responsibility for everyone's comfort", priority: 5, kind: "custom" },
      past: { background: "Tess shares this home with Ivo, Noor and Mara. She invited them to spend this evening together and brought two ready-made pastries earlier. She wants to feel like a participant, not unpaid staff. She knows the three rooms of the home and that everyone's phones rest on the sitting room table.",
        drives: ["Reciprocal care", "Belonging without constant performance", "Make room for my own rest"], memories: [
          memory("At family gatherings as a child I cleared up while everyone else carried on talking. I liked being trusted but often missed the best part of the evening.", "My presence matters beyond what I provide", "Hospitality can hide a cost when I never join in.", ["hosting", "work", "evening"], "Childhood", "affection mixed with exclusion"),
          memory("Last month Noor noticed me standing after everyone else had settled. She made space for me without turning it into a big discussion.", "Friends can notice and care for me", "Small practical kindness lets me relax.", ["Noor", "seat", "rest"], "Last month", "gratitude"),
          memory("Ivo once offered to help with an evening together. I said I had it handled, then felt resentful when he believed me.", "I can say what I need", "People cannot respond to needs I conceal.", ["Ivo", "help", "resentment"], "Two weeks ago", "embarrassed recognition"),
          memory("Mara and I stood quietly on this patio after a crowded evening. The silence felt friendly; neither of us had to keep the conversation alive.", "Quiet company can be enough", "Welcome is not a demand for nonstop talk.", ["Mara", "Patio", "quiet"], "Last week", "ease"),
        ] } },
    { id: "ivo", role: "hungry housemate trying to keep a promise", personality: "Practical and affectionate, quick to offer help. Hunger can make him impatient, but keeping a small promise matters to his self-respect.",
      aspirations: ["Keep promises through ordinary actions", "Look after myself without forgetting other people", "Share responsibility for our home"],
      needs: { hunger: 78, energy: 62 }, initialGoal: { description: "Get something to eat while honoring my promise to keep the pear pastry for Noor", priority: 6, kind: "custom" },
      past: { background: "Ivo shares the home with Tess, Noor and Mara. He knows its Sitting Room, Kitchen and Patio. He has not eaten since midday. Earlier, privately with Noor, he promised to leave the pear pastry for her. The promise is a social commitment, not a locked or owned object; he has not announced it to Tess or Mara.",
        drives: ["Be dependable", "Care for my own body", "Practical kindness without taking over"], memories: [
          memory("Earlier today Noor said she was worn out and asked whether I could save the pear pastry for her. I said yes; we were alone in the kitchen.", "I want my promises to be dependable", "This particular portion matters because I gave my word.", ["Noor", "pear pastry", "promise", "hunger"], "Earlier today", "simple affection and responsibility"),
          memory("As a child I was often first to finish food. My brother once arrived late to find nothing left, and his quiet disappointment stayed with me.", "My appetite need not erase someone else's share", "Taking the last portion can affect somebody who is not present.", ["food", "share", "late", "portion"], "Childhood", "regret"),
          memory("After a long day last winter, Noor noticed I had skipped lunch and offered me half of what she was eating. I had not realized how irritable I was until I ate.", "Care for myself makes care for others easier", "Hunger is a real need, not a moral failure.", ["Noor", "eat", "hunger", "irritable"], "Last winter", "gratitude"),
          memory("Tess once said she wanted company more than another offer to organize the evening. I sat with her and we had a better time than when I tried to solve everything.", "I can contribute without managing people", "A useful response depends on what the other person actually wants.", ["Tess", "company", "help"], "Last month", "fondness"),
        ] } },
    { id: "noor", role: "tired housemate balancing rest and company", personality: "Considerate and direct when she feels safe. Wants to belong, but is learning not to turn every invitation into a duty.",
      aspirations: ["Rest without withdrawing from people I love", "Accept care without having to repay it immediately", "Make honest choices about my limits"],
      needs: { hunger: 58, energy: 28 }, initialGoal: { description: "Find somewhere comfortable to rest while deciding how much company I have energy for tonight", priority: 6, kind: "custom" },
      past: { background: "Noor shares the home with Tess, Ivo and Mara. She knows the three rooms and has just stepped onto the Patio after a tiring shift elsewhere. She wants time with her friends, but her legs ache. Earlier Ivo privately promised to save her the pear pastry in the Kitchen; she has not told the others about that exchange.",
        drives: ["Protect restorative rest", "Stay connected", "Trust reciprocal care"], memories: [
          memory("Earlier today I told Ivo I was worn out and asked him to save the pear pastry. He agreed while we were alone in the kitchen.", "I can ask for a small kindness", "Receiving care does not make me a burden.", ["Ivo", "pear pastry", "promise"], "Earlier today", "relief"),
          memory("During training I kept saying yes to every request until I became too tired to be patient. A colleague quietly told me that a real break was part of being dependable.", "My limits deserve attention", "Ignoring tiredness can make me less present with others.", ["tired", "rest", "obligation"], "Several years ago", "sobering recognition"),
          memory("Tess looked disappointed when I left an evening early once. Later she explained she had wanted to see me, not keep me there at any cost.", "Closeness can survive an honest limit", "I do not need to guess that affection requires constant availability.", ["Tess", "leave", "company", "limits"], "Last month", "tender uncertainty"),
          memory("Mara once joined me on the patio and let the conversation pause. Sitting outside together helped more than her trying to cheer me up.", "Quiet can still be shared", "Rest and companionship sometimes fit together.", ["Mara", "Patio", "seat", "quiet"], "Two weeks ago", "comfort"),
        ] } },
    { id: "mara", role: "housemate torn between company and a private relationship concern", personality: "Curious and affectionate, protective of her independence. She can be lively with friends while unsure how much of a private worry to share.",
      aspirations: ["Stay honest with people I care about", "Keep my own agency within close relationships", "Belong at home without performing cheerfulness"],
      needs: { hunger: 42, energy: 70 }, initialGoal: { description: "Decide whether to share my worry about Alex with a housemate or take some quiet time to think about our unfinished conversation", priority: 5, kind: "custom" },
      phoneContact: { name: "Alex", description: "Stay connected with Alex while deciding what I genuinely want to say.", memory: "Alex is a close friend whose relationship with me has become emotionally important. We left a personal conversation unfinished yesterday. My phone is on the sitting room table; its vibration means a message, not knowledge of who sent it or what it says." },
      past: { background: "Mara shares the home with Tess, Ivo and Noor and knows its three rooms. Alex lives elsewhere and is close to her. Yesterday Alex asked whether they were becoming more than friends; Mara said she needed time. She has not told her housemates about that conversation. She is welcome here even if she chooses privacy.",
        drives: ["Honest connection", "Personal agency", "Curiosity about my own feelings"], memories: [
          memory("Yesterday Alex asked whether we were becoming more than friends. I said I needed time, and we ended without agreeing what happens next. I have not told my housemates.", "I can be honest without having every answer", "An unfinished conversation can matter even during an ordinary evening.", ["Alex", "phone", "message", "quiet"], "Yesterday", "affection and uncertainty"),
          memory("When I moved here, Alex stayed late helping while Tess made room for my things. I felt wanted rather than managed.", "I value people who make space for me", "Help feels different when it respects my choices.", ["Alex", "Tess", "home", "moving"], "Several months ago", "warmth"),
          memory("I once kept laughing through an evening while privately upset. Noor asked if I wanted company or privacy, and accepting the choice let me breathe.", "I do not have to act cheerful to belong", "Friends can support me without knowing every detail.", ["Noor", "privacy", "company"], "Last winter", "relief"),
          memory("Ivo and I sat outside after a disagreement and eventually talked about something else. We did not need to settle every issue before the evening could continue.", "An unresolved concern need not consume everything", "A change of activity can be real without pretending the concern vanished.", ["Ivo", "Patio", "disagreement", "evening"], "Last month", "reassurance"),
        ] } },
  ];
  return personal.map(seed => {
    const spawn = layout.spawns.find(s => s.id === seed.id)!, room = layout.rooms.find(r => r.id === spawn.roomId)!;
    return { ...seed, name: spawn.name, startRoom: room.name, startRoomId: room.id, homeRoomId: SITTING, assetId: spawn.assetId,
      description: "An adult housemate wearing a simple everyday outfit.",
      systemPrompt: `You are ${spawn.name}, ${seed.role}. ${seed.personality} Choose from what you perceive, remember and care about; other people's private thoughts and messages are not your knowledge.`,
      appearance: { age: "adult", clothing: "a simple everyday outfit", posture: "standing" }, phoneId: `${seed.id}-phone`,
      initialObservation: `You are in the ${room.name} at the beginning of an evening at home. ${room.description}`,
    };
  });
}

/** Fresh, preflighted data on every call: no ECS registration, model calls,
 * mutation of the catalog, grants or scripted actions occur during creation. */
export function createHouseholdScenario(): SpatialScenarioDefinition {
  const layout = blueprint();
  return validateSpatialScenario({ id: "household-evening-v1", title: "An evening at home", blueprint: layout,
    bounds: { minX: 0, minY: 0, maxX: 16, maxY: 11 }, navigationCellSize: .5,
    residents: residents(layout), maxWorldEntities: 96 });
}
