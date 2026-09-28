/** A separate authored comparison, not a replacement for the original evening.
 * Scarcity and asymmetric memories create choices; none of them dispatches an
 * action, assigns ownership to food, or determines a character's reaction. */
import type { CharacterPast } from "../cognition/character-past-schema";
import { createHouseholdScenario } from "./spatial-household";
import { validateSpatialScenario, type SpatialScenarioDefinition } from "./spatial-scenario";

export const HOUSEHOLD_CHALLENGE_STORY_STYLE = {
  name: "One quiet evening, competing wants",
  premise: "Four friends share a home and a limited set of comforts. Their unfinished errands, appetites, private relationships and different ideas of a good evening need not fit neatly together.",
  narratorContext: "Grounded domestic drama. Watch public choices, discoveries and costs; follow an unresolved undertaking into its next consequence. The same resource can matter differently to different people. Weather can change the cost of spending time outdoors. Offer opportunities within installed permissions, not prescribed reactions or guaranteed resolutions. Private memories and messages remain private. An interpretation is not a world change.",
};

const remembered = (recollection: string, selfBelief: string, meaning: string, cues: string[], emotionalTone: string): CharacterPast["memories"][number] => ({
  recollection, selfBelief, meaning, cues, emotionalTone, importance: .8, period: "Earlier today", provenance: "authored-history",
});

/** Uses the original collision-checked shell and native objects, but returns a
 * distinct detached scenario. Host permissions, weather and inference are not
 * part of construction, and the original scenario remains reproducible. */
export function createHouseholdChallengeScenario(): SpatialScenarioDefinition {
  const scenario = createHouseholdScenario();
  scenario.id = "household-competing-wants-v1";
  scenario.title = "One quiet evening";
  scenario.blueprint.id = "household-competing-wants-layout-v1";
  scenario.blueprint.props = scenario.blueprint.props.filter(p => p.id !== "household-apple-pastry");
  const box = scenario.blueprint.props.find(p => p.id === "household-empty-box")!;
  box.state = "open";
  box.description = "An ordinary empty storage box with a hinged lid.";

  const resident = (id: string) => scenario.residents.find(r => r.id === id)!;
  const tess = resident("tess"), ivo = resident("ivo"), noor = resident("noor"), mara = resident("mara");
  tess.role = "housemate and friend who wants to participate in her own evening";
  tess.personality = "Warm, forthright and sometimes impatient with being taken for granted. She likes small things finished, but does not want housekeeping to become her whole evening.";
  tess.needs = { hunger: 76, energy: 54 };
  tess.initialGoal = { description: "Close the storage box I left open and get something to eat, then enjoy the evening as a participant rather than everyone's host", priority: 6, kind: "custom" };
  tess.past!.background = "Tess shares this home with Ivo, Noor and Mara and knows its Sitting Room, Kitchen and outdoor Patio. She brought pastries earlier and last saw the pear pastry on the kitchen table. She has missed a meal and would like to eat. While checking the empty storage box for space earlier, she left its lid open after being interrupted. She wants that little task finished, not another evening spent managing everyone. She does not know about any private food arrangement.";
  tess.past!.memories.push(remembered(
    "I opened the empty storage box to see how much space was available, then left its lid open when I went to join Mara. I meant to close it before settling down. The pear pastry was on the table when I left.",
    "Small loose ends need not consume my whole evening", "I can finish one practical thing, feed myself and move on.", ["storage box", "Kitchen", "eat", "Mara"], "unfinished business and appetite"));

  ivo.role = "housemate and longtime friend who values being dependable";
  ivo.personality = "Affectionate, practical and occasionally defensive when he is hungry. He takes pride in keeping his word, yet dislikes treating his own needs as less important than everyone else's.";
  ivo.needs = { hunger: 83, energy: 61 };
  ivo.initialGoal = { description: "Find a fair way to handle my hunger and the pear pastry I promised Noor, without pretending either concern has disappeared", priority: 7, kind: "custom" };
  ivo.past!.background = "Ivo shares the home with Tess, Noor and Mara and knows all three rooms. He has not eaten since midday and is hungry now. Earlier, alone with Noor, he promised to leave the pear pastry for her. He last saw it on the kitchen table and has no other food with him. He has not told Tess or Mara about the promise. It gives him a personal commitment, not custody or control over anyone else's choices.";
  ivo.past!.memories.push(remembered(
    "When I last looked at the kitchen table, the pear pastry was the remaining portion. I had already promised it to Noor. I had not expected to be this hungry myself.",
    "Being dependable includes admitting when a promise has become difficult", "I need not hide a conflict or act as if remembering it resolves it.", ["pear pastry", "Noor", "hunger", "promise"], "temptation and responsibility"));

  noor.role = "housemate and longtime friend";
  noor.personality = "Dryly funny, perceptive and capable of saying what she wants. She likes unhurried time outdoors and close company, but today she is physically worn out rather than generally passive.";
  noor.aspirations = ["Make room for both solitude and close friendship", "Ask directly for what I need", "Be cared for without surrendering my independence"];
  noor.needs = { hunger: 72, energy: 25 };
  noor.initialGoal = { description: "Get a real break on the patio and have the food Ivo saved for me, while deciding whether I want quiet or company tonight", priority: 7, kind: "custom" };
  noor.past!.background = "Noor shares the home with Tess, Ivo and Mara and knows all three rooms. Today's long shift left her legs aching; on another day she might be the energetic one. She stepped onto the Patio for air and would like a seat. Earlier Ivo privately promised to save her the pear pastry. She remembers the promise but does not know whether the portion is still there. She has not told Tess or Mara about it. Quiet outside appeals to her, though she does not want to withdraw from friends.";
  noor.past!.memories.push(remembered(
    "On the way home I imagined sitting outside for a few minutes with something to eat. I was looking forward to being off my feet, not to taking care of another group of people.",
    "My current tiredness is a condition, not my whole identity", "What I want this evening may change after food, rest or an unexpected conversation.", ["Patio", "chair", "food", "rest"], "anticipation and fatigue"));

  mara.role = "housemate and friend with an unfinished private conversation";
  mara.personality = "Curious, affectionate and willing to act on an uncomfortable question. She values privacy without wanting secrecy to become distance from her friends.";
  mara.needs = { hunger: 39, energy: 69 };
  mara.initialGoal = { description: "Get my phone and find enough privacy to decide what I want to say to Alex about our unfinished conversation", priority: 6, kind: "custom" };
  mara.past!.background = "Mara shares the home with Tess, Ivo and Noor and knows all three rooms. Alex lives elsewhere. Yesterday he asked whether they were becoming more than friends; she asked for time and has not answered yet. Her phone was left on the sitting room table. She would like it with her and is considering the Patio for privacy, though it is shared space and another housemate may want to use it. She has not told the others about Alex's question. Remembering it does not mean a new message has arrived.";
  mara.past!.memories.push(remembered(
    "I left my phone on the sitting room table so I could be present with my housemates, but the unfinished conversation with Alex kept returning to mind. I wanted to find a private moment, not wait for someone else to decide for me.",
    "I can make room for an important relationship without explaining everything publicly", "Privacy may require a practical choice about my phone and where I am.", ["Alex", "phone", "Patio", "privacy"], "affection, uncertainty and resolve"));

  for (const r of scenario.residents) {
    r.systemPrompt = `You are ${r.name}, ${r.role}. ${r.personality} Choose from what you perceive, remember and care about; other people's private thoughts and messages are not your knowledge.`;
    const room = scenario.blueprint.rooms.find(room => room.id === r.startRoomId)!;
    r.initialObservation = `You are in the ${room.name} at the beginning of an evening at home. ${room.description}`;
  }
  return validateSpatialScenario(scenario);
}
