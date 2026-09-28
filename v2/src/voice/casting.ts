/** Deterministic, LLM-free voice casting. Each resident's persona (pronouns,
 * age words, role, and their own "how you talk" notes) scores the 30 Gemini
 * prebuilt voices; a global greedy assignment keeps voices distinct. The
 * persona's own voice notes become the delivery style. */
import { createHash } from "node:crypto";

export type VoiceGender = "f" | "m";
export type VoiceAge = "young" | "adult" | "old";
export type PrebuiltVoice = { name: string; descriptor: string; gender: VoiceGender; age: VoiceAge; tags: readonly string[] };

/** Gemini TTS prebuilt voices (ai.google.dev/gemini-api/docs/speech-generation,
 * 30 voices; descriptor is Google's). Gender/age/tags are our casting heuristics
 * from the AI Studio previews, not an API field. */
export const PREBUILT_VOICES: readonly PrebuiltVoice[] = [
  { name: "Zephyr", descriptor: "Bright", gender: "f", age: "young", tags: ["bright", "lively", "quick"] },
  { name: "Puck", descriptor: "Upbeat", gender: "m", age: "young", tags: ["upbeat", "quick", "jokes", "playful"] },
  { name: "Charon", descriptor: "Informative", gender: "m", age: "old", tags: ["deep", "measured", "calm", "vast"] },
  { name: "Kore", descriptor: "Firm", gender: "f", age: "adult", tags: ["firm", "direct", "low"] },
  { name: "Fenrir", descriptor: "Excitable", gender: "m", age: "young", tags: ["excitable", "quick", "loud"] },
  { name: "Leda", descriptor: "Youthful", gender: "f", age: "young", tags: ["youthful", "earnest", "soft"] },
  { name: "Orus", descriptor: "Firm", gender: "m", age: "adult", tags: ["firm", "plain", "direct"] },
  { name: "Aoede", descriptor: "Breezy", gender: "f", age: "adult", tags: ["breezy", "warm", "light"] },
  { name: "Callirrhoe", descriptor: "Easy-going", gender: "f", age: "adult", tags: ["easy", "warm", "plain"] },
  { name: "Autonoe", descriptor: "Bright", gender: "f", age: "adult", tags: ["bright", "clear", "performer"] },
  { name: "Enceladus", descriptor: "Breathy", gender: "m", age: "adult", tags: ["breathy", "soft", "quiet"] },
  { name: "Iapetus", descriptor: "Clear", gender: "m", age: "adult", tags: ["clear", "formal", "polite", "precise"] },
  { name: "Umbriel", descriptor: "Easy-going", gender: "m", age: "adult", tags: ["easy", "warm", "laugh"] },
  { name: "Algieba", descriptor: "Smooth", gender: "m", age: "adult", tags: ["smooth", "charm", "courtly"] },
  { name: "Despina", descriptor: "Smooth", gender: "f", age: "adult", tags: ["smooth", "vivid", "soft", "dreamy"] },
  { name: "Erinome", descriptor: "Clear", gender: "f", age: "adult", tags: ["clear", "precise", "clipped", "dry"] },
  { name: "Algenib", descriptor: "Gravelly", gender: "m", age: "old", tags: ["gravelly", "rough", "plain"] },
  { name: "Rasalgethi", descriptor: "Informative", gender: "m", age: "adult", tags: ["measured", "formal", "precise"] },
  { name: "Laomedeia", descriptor: "Upbeat", gender: "f", age: "young", tags: ["upbeat", "quick", "teasing", "lively"] },
  { name: "Achernar", descriptor: "Soft", gender: "f", age: "adult", tags: ["soft", "gentle", "quiet"] },
  { name: "Alnilam", descriptor: "Firm", gender: "m", age: "adult", tags: ["firm", "loud", "strong"] },
  { name: "Schedar", descriptor: "Even", gender: "m", age: "adult", tags: ["even", "calm", "slow", "plain"] },
  { name: "Gacrux", descriptor: "Mature", gender: "f", age: "old", tags: ["mature", "slow", "earthy", "plain"] },
  { name: "Pulcherrima", descriptor: "Forward", gender: "f", age: "adult", tags: ["forward", "performer", "teasing", "bold"] },
  { name: "Achird", descriptor: "Friendly", gender: "m", age: "adult", tags: ["friendly", "warm", "laugh", "jokes"] },
  { name: "Zubenelgenubi", descriptor: "Casual", gender: "m", age: "adult", tags: ["casual", "jokes", "easy"] },
  { name: "Vindemiatrix", descriptor: "Gentle", gender: "f", age: "old", tags: ["gentle", "soft", "calm"] },
  { name: "Sadachbia", descriptor: "Lively", gender: "m", age: "adult", tags: ["lively", "loud", "charm", "quick"] },
  { name: "Sadaltager", descriptor: "Knowledgeable", gender: "m", age: "old", tags: ["storyteller", "lyrical", "measured", "courtly"] },
  { name: "Sulafat", descriptor: "Warm", gender: "f", age: "adult", tags: ["warm", "low", "direct"] },
];

export type VoiceCast = { voice: string; style: string };

export const GOD_VOICE: VoiceCast = Object.freeze({
  voice: process.env.ARGOS_GOD_VOICE || "Charon",
  style: "The voice of God: warm and vast, slightly amused, utterly unhurried; intimate, as if speaking from very far away and from just beside the listener at once.",
});

/** What the caster reads about a resident. All fields are optional prose. */
export type PersonaInput = {
  key: string; name: string; role?: string; personality?: string;
  /** The persona's own "how you talk" notes. */
  voiceNotes?: string;
  /** Visible age descriptor (Appearance.age), e.g. "adult", "elderly". */
  age?: string;
  /** e.g. "a small English coastal town"; adds an accent/place cue to the style. */
  setting?: string;
};

const KEYWORDS: Array<[RegExp, string[]]> = [
  [/lyric|storytell|cadence|old-fashioned/, ["storyteller", "lyrical"]],
  [/courtly|charm|salesman|promises/, ["charm", "courtly"]],
  [/laugh|joke|funny|jok/, ["laugh", "jokes"]],
  [/warm|loving|generous|big-hearted/, ["warm", "friendly"]],
  [/quick|fast|rapid|patter/, ["quick"]],
  [/\blow\b|flat/, ["low"]],
  [/\bdry\b|sarcas/, ["dry"]],
  [/direct|blunt|brisk|plainness|\bplain\b/, ["direct", "plain", "firm"]],
  [/clipped|exact|precise|measurement/, ["precise", "clipped", "clear"]],
  [/soft|gentle|whisper|hushed/, ["soft", "gentle", "quiet"]],
  [/vivid|images|colou?rs|imaginative|dream/, ["vivid", "dreamy", "smooth"]],
  [/slow|sparing|unhurried/, ["slow", "calm", "even"]],
  [/earthy|weather|bread|spade|sayings/, ["earthy", "plain", "mature"]],
  [/perform|teasing|flirt|darling/, ["performer", "teasing", "forward"]],
  [/polite|formal|accent|earnest/, ["formal", "polite", "earnest"]],
  [/loud|louder|\bbig\b/, ["loud", "lively"]],
  [/tough|stubborn|relentless/, ["firm"]],
  [/excit|eager/, ["excitable", "upbeat"]],
];
const OLD = /\b(old|elderly|aged|retired|dying|grandmother|grandfather|widow(?:er)?|pensioner|veteran)\b/;
const YOUNG = /\b(young|youth(?:ful)?|boy|girl|teen(?:age|ager)?|student|kid|child|newcomer|earnest)\b/;

function hash(text: string) { return createHash("sha256").update(text).digest().readUInt32BE(0); }

export function inferGender(persona: PersonaInput): VoiceGender | undefined {
  const text = ` ${[persona.role, persona.personality, persona.voiceNotes].filter(Boolean).join(" ")} `.toLowerCase();
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const f = count(/\b(she|her|hers|herself|woman|daughter|landlady|mother|grandmother|sister|widow|wife|girl|lady)\b/g);
  const m = count(/\b(he|him|his|himself|man|son|grandson|father|grandfather|brother|widower|husband|boy|gentleman)\b/g);
  return f > m ? "f" : m > f ? "m" : undefined;
}

export function inferAge(persona: PersonaInput): VoiceAge {
  const visible = (persona.age ?? "").toLowerCase();
  if (/elder|old|senior|aged/.test(visible)) return "old";
  if (/young|teen|child|youth/.test(visible)) return "young";
  // Possessive phrases describe someone else ("her dead grandmother's diary",
  // "an old woman's last request", "her grandmother Agnes"; "the town's old storyteller" keeps "old storyteller").
  const text = [persona.role, persona.personality].filter(Boolean).join(" ").toLowerCase()
    .replace(/\b(?:[\w-]+\s+){0,2}[\w-]+['’]s\b/g, " ")
    .replace(/\b(?:her|his|my|their|your|our)\s+(?:(?:late|dead|own)\s+)?[\w-]+/g, " ");
  return OLD.test(text) ? "old" : YOUNG.test(text) ? "young" : "adult";
}

export function personaTags(persona: PersonaInput): string[] {
  // The first sentence of the author's manner notes is the person's everyday
  // sound (x3); the rest of the notes and the persona are situational (x1 each).
  const notes = (persona.voiceNotes ?? "").toLowerCase().trim(), cut = notes.search(/[.;](\s|$)/);
  const sources: Array<[string, number]> = [[cut < 0 ? notes : notes.slice(0, cut), 3], [cut < 0 ? "" : notes.slice(cut), 1],
    [[persona.role, persona.personality].filter(Boolean).join(" ").toLowerCase(), 1]];
  const tags: string[] = [];
  for (const [re, add] of KEYWORDS) for (const [text, weight] of sources) if (re.test(text)) for (let i = 0; i < weight; i++) tags.push(...add);
  return tags;
}

export function scoreVoice(persona: PersonaInput, voice: PrebuiltVoice, gender = inferGender(persona), age = inferAge(persona), tags = personaTags(persona)): number {
  let score = 0;
  for (const tag of tags) if (voice.tags.includes(tag)) score += 1;
  if (age === voice.age) score += age === "adult" ? 1 : 4;
  else if ((age === "old" && voice.age === "young") || (age === "young" && voice.age === "old")) score -= 4;
  if (gender && gender !== voice.gender) score -= 100;
  return score;
}

function sentenceCap(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (end > max / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim();
}

export function styleFor(persona: PersonaInput, gender = inferGender(persona), age = inferAge(persona)): string {
  const who = `${age === "old" ? "an elderly " : age === "young" ? "a young " : "an adult "}${gender === "f" ? "woman" : gender === "m" ? "man" : "person"}`;
  const place = persona.setting ? ` from ${persona.setting}` : "";
  const notes = persona.voiceNotes?.trim() ? ` ${sentenceCap(persona.voiceNotes, 300)}` : persona.personality ? ` Manner: ${sentenceCap(persona.personality, 160)}` : "";
  return sentenceCap(`Speak as ${persona.name}, ${who}${place}, in natural conversation.${notes}`, 400);
}

/** Cast a whole group at once so voices stay distinct. `taken` voices (God,
 * earlier residents) are avoided while other voices remain. Deterministic. */
export function castVoices(personas: readonly PersonaInput[], taken: Iterable<string> = [GOD_VOICE.voice]): Map<string, VoiceCast> {
  const used = new Set(taken), result = new Map<string, VoiceCast>();
  const info = new Map(personas.map(p => [p.key, { gender: inferGender(p), age: inferAge(p), tags: personaTags(p) }]));
  const pairs = personas.flatMap(p => PREBUILT_VOICES.map(v => ({ p, v,
    score: scoreVoice(p, v, info.get(p.key)!.gender, info.get(p.key)!.age, info.get(p.key)!.tags), tie: hash(`${p.name}|${v.name}`) })));
  pairs.sort((a, b) => b.score - a.score || a.tie - b.tie || a.p.key.localeCompare(b.p.key));
  const assign = (allowReuse: boolean) => {
    for (const { p, v, score } of pairs) {
      if (result.has(p.key) || (!allowReuse && used.has(v.name)) || score <= -50) continue;
      used.add(v.name); const { gender, age } = info.get(p.key)!;
      result.set(p.key, { voice: v.name, style: styleFor(p, gender, age) });
    }
  };
  assign(false);
  assign(true); // More residents of one gender than voices: reuse, still gender-matched.
  for (const p of personas) if (!result.has(p.key)) { // Unknowable gender and no voice left.
    const v = PREBUILT_VOICES[hash(p.name) % PREBUILT_VOICES.length];
    result.set(p.key, { voice: v.name, style: styleFor(p) });
  }
  return result;
}

/** Session-stable cast: the first group is cast together; later arrivals are
 * cast against the voices already in use. Nobody's voice changes mid-session. */
export class VoiceCastBook {
  private readonly cast = new Map<string, VoiceCast>();
  get(key: string) { return this.cast.get(key); }
  entries() { return Object.fromEntries(this.cast); }
  ensure(personas: readonly PersonaInput[]): Map<string, VoiceCast> {
    const fresh = personas.filter(p => !this.cast.has(p.key));
    if (fresh.length) {
      const taken = [GOD_VOICE.voice, ...[...this.cast.values()].map(c => c.voice)];
      for (const [key, value] of castVoices(fresh, taken)) this.cast.set(key, value);
    }
    return new Map(personas.map(p => [p.key, this.cast.get(p.key)!]));
  }
}
