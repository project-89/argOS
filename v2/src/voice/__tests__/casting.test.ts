import { getSaltmereAuthorCast } from "../../demo/spatial-lovecraft-town";
import { castVoices, GOD_VOICE, inferAge, inferGender, PREBUILT_VOICES, VoiceCastBook, type PersonaInput } from "../casting";
import { personaFromPrompt } from "../routes";
import { saltmereDemo } from "./fixtures";
import { Agent, Name } from "../../ecs/components";

const authored = (): PersonaInput[] => getSaltmereAuthorCast().map(c => ({ key: c.name, name: c.name, role: c.role, personality: c.personality, voiceNotes: c.voice }));
const voice = (name: string) => PREBUILT_VOICES.find(v => v.name === name)!;

test("the catalogue is the 30 documented prebuilt voices", () => {
  expect(PREBUILT_VOICES).toHaveLength(30);
  expect(new Set(PREBUILT_VOICES.map(v => v.name)).size).toBe(30);
  expect(PREBUILT_VOICES.some(v => v.name === GOD_VOICE.voice)).toBe(true);
});

test("Saltmere residents get distinct, gender- and age-matched voices, never God's", () => {
  const personas = authored(), cast = castVoices(personas);
  expect(cast.size).toBe(10);
  const voices = [...cast.values()].map(c => c.voice);
  expect(new Set(voices).size).toBe(10);
  expect(voices).not.toContain(GOD_VOICE.voice);
  const expectedGender: Record<string, "f" | "m"> = { Mara: "f", Ivo: "m", Tess: "f", Ada: "f", Leon: "m", Eli: "m", Sera: "f", Noor: "f", Bea: "f", Otis: "m" };
  for (const p of personas) {
    expect(inferGender(p)).toBe(expectedGender[p.name]);
    expect(voice(cast.get(p.key)!.voice).gender).toBe(expectedGender[p.name]);
  }
  expect(inferAge(personas.find(p => p.name === "Leon")!)).toBe("old");
  expect(inferAge(personas.find(p => p.name === "Sera")!)).toBe("adult"); // her grandmother's diary is not her age
  expect(voice(cast.get("Leon")!.voice).age).toBe("old");
  expect(cast.get("Leon")!.style).toContain("Old-fashioned and lyrical");
  for (const { style } of cast.values()) expect(style.length).toBeLessThanOrEqual(400);
});

test("casting is deterministic and independent of input order", () => {
  const a = castVoices(authored()), b = castVoices([...authored()].reverse());
  expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
});

test("runtime prompts (as the ECS stores them) cast exactly like the author sheet and never read private history", () => {
  const demo = saltmereDemo();
  const runtime = demo.actors.map(id => personaFromPrompt({ key: Name.value[id], name: Name.value[id], role: Agent.role[id], systemPrompt: Agent.systemPrompt[id] }));
  for (const p of runtime) { expect(p.personality).not.toMatch(/WHAT YOU HIDE|PRIVATE LIFE/); expect(p.voiceNotes).toBeTruthy(); }
  const fromRuntime = castVoices(runtime), fromAuthor = castVoices(authored());
  for (const [key, cast] of fromAuthor) expect(fromRuntime.get(key)!.voice).toBe(cast.voice);
});

test("the cast book keeps voices stable when someone new arrives", () => {
  const book = new VoiceCastBook(), personas = authored();
  const first = new Map(book.ensure(personas));
  const visitor: PersonaInput = { key: "visitor", name: "Visitor", personality: "She is curious and quick." };
  const second = book.ensure([...personas, visitor]);
  for (const [key, cast] of first) expect(second.get(key)).toEqual(cast);
  const used = [...first.values()].map(c => c.voice);
  expect(used).not.toContain(second.get("visitor")!.voice);
  expect(voice(second.get("visitor")!.voice).gender).toBe("f");
});

test("more residents than voices of one gender reuse gender-matched voices", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ key: `w${i}`, name: `W${i}`, personality: "She is kind." }));
  const cast = castVoices(many);
  expect(cast.size).toBe(20);
  for (const c of cast.values()) expect(voice(c.voice).gender).toBe("f");
});
