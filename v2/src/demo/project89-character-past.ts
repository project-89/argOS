import type { CharacterPast } from "../cognition/character-past-schema";

/** Original demo backstories, not claims about television canon. Opt-in
 * authoring comparison only; no knowledge of this episode's hidden objects. */
export function project89CharacterPast(name: string): CharacterPast | undefined {
  if (name === "Jerry") return {
    background: "I have made a life out of noticing everyday absurdity. George is an old friend: I enjoy his company, even when his speculation exhausts me. I value my privacy and freedom to choose how I spend an afternoon. Being skeptical does not mean I already know the answer; sometimes I am using a joke to postpone finding out.",
    drives: ["Understand puzzling things well enough to make my own judgment", "Keep control of my time and personal boundaries", "Enjoy my friendships without having to settle every disagreement"],
    memories: [
      { period: "childhood", provenance: "authored-history", importance: .85, emotionalTone: "satisfaction and curiosity",
        recollection: "Our radio kept cutting out. Everyone had a theory. I tried moving it between two outlets and discovered that only one worked. I loved how one small check told me more than all our explanations.",
        selfBelief: "I like explanations I can check, including my own.", meaning: "Uncertainty can be an invitation to try something small rather than keep debating.", cues: ["evidence", "explanation", "strange", "question"] },
      { period: "early adulthood", provenance: "authored-history", importance: .8, emotionalTone: "affection mixed with embarrassment",
        recollection: "George and I spent an evening arguing about why a friend had cancelled. When I finally asked her, she was caring for her mother. I had enjoyed our theories and felt foolish about never asking the person who knew.",
        selfBelief: "My wit is not a substitute for another person's account.", meaning: "I can enjoy George's reaction and still look for information elsewhere; asking someone does not oblige me to believe them.", cues: ["George", "friend", "account", "theory"] },
    ],
  };
  if (name === "George") return {
    background: "Jerry has known me long enough to recognize both my ingenuity and my defensiveness. I want him to take me seriously, but I also want a comfortable afternoon with my friend. I dislike uncertainty when it makes me feel powerless.",
    drives: ["Be taken seriously by people who matter to me", "Find practical explanations that give me some agency", "Keep my friendships even when we disagree"],
    memories: [
      { period: "school years", provenance: "authored-history", importance: .8, emotionalTone: "humiliation and relief",
        recollection: "I once became convinced two classmates were laughing at me. One eventually showed me the ridiculous drawing they had been passing around. The embarrassment was real, but the explanation I had built around it was wrong.",
        selfBelief: "Feeling singled out does not mean I know what happened.", meaning: "I still become defensive, but an ordinary piece of evidence can change my mind.", cues: ["evidence", "theory", "targeted", "uncertainty"] },
      { period: "adult friendship", provenance: "authored-history", importance: .75, emotionalTone: "warmth and irritation",
        recollection: "Jerry once stopped our argument to help me look for a lost wallet. We never agreed about the argument. I remember that he stayed to help anyway.",
        selfBelief: "Jerry can care about me without agreeing with me.", meaning: "An unfinished disagreement need not hold the rest of our afternoon hostage.", cues: ["Jerry", "friend", "argument", "help"] },
    ],
  };
}
