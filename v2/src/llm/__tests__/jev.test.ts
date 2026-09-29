import { jest } from "@jest/globals";
import { JevClient, JEV_ENDPOINT } from "../jev";
import { SettlementAutopilot, type AutopilotHost } from "../../demo/spatial-autopilot";

const reply = (answers: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 120, output_tokens: 3 } }), { status });

describe("Jev client", () => {
  test("asks typed questions over one state with a bearer key, and retries when overloaded", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses = [new Response("busy", { status: 529 }), reply({ wake: { type: "noul", noul: .82 }, errand: { type: "choice", choice: "o1", confidence: .7 } })];
    const fetcher = jest.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return responses.shift()!; }) as unknown as typeof fetch;
    const jev = new JevClient({ apiKey: "test-key", fetch: fetcher });
    const res = await jev.ask({ character: "Otis" }, { wake: { type: "noul", instructions: "Look up?" },
      errand: { type: "choice", instructions: "What now?", criteria: { o0: "carry on", o1: "bring fish to Leon" } } });
    expect(res.answers.wake.noul).toBe(.82);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(JEV_ENDPOINT);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ model: "jev-latest", state: { character: "Otis" }, questions: { wake: { type: "noul" } } });
    expect(jev.stats).toMatchObject({ calls: 1, questions: 2, inputTokens: 120 });
    expect(JevClient.fromEnv({})).toBeUndefined();
  });
});

describe("autopilot with a fast judge", () => {
  test("a notable thing is remembered without waking the mind; a gripping one wakes it", async () => {
    const remembered: Array<{ text: string; importance: number }> = [], informed: string[] = [];
    let judged: { wake: number; remember: number; importance: number } = { wake: .1, remember: .9, importance: .75 };
    let now = 0;
    const host: AutopilotHost = { world: {} as any, now: () => now, managed: () => [7], cuesOf: () => ["Net House"],
      inform: (_e, _s, text) => informed.push(text), engaged: () => false, errandOptions: () => ({ people: [], items: [], places: [] }),
      onErrand: () => {}, record: () => {}, mindAvailable: () => true,
      appraise: async () => judged, remember: (_e, text, importance) => remembered.push({ text, importance }) };
    const pilot = new SettlementAutopilot(host);
    pilot.perceive(7, { kind: "cue", source: "Mara", atMs: now, text: 'Mara says: "someone has been at the Net House box"' });
    await Promise.resolve(); await Promise.resolve();
    pilot.tick();
    expect(remembered).toEqual([{ text: 'Mara says: "someone has been at the Net House box"', importance: .75 }]);
    expect(pilot.holds(7)).toBe(false);
    judged = { wake: .9, remember: .9, importance: 1 };
    now = 60_000;
    pilot.perceive(7, { kind: "cue", source: "Ada", atMs: now, text: 'Ada says: "the nets came up with something in them"' });
    await Promise.resolve(); await Promise.resolve();
    pilot.tick();
    expect(pilot.holds(7)).toBe(true);
    expect(informed).toEqual(['Ada says: "the nets came up with something in them"']);
    // Not demanding attention now, but it matters a great deal to them: it grips them anyway.
    const other = new SettlementAutopilot({ ...host, appraise: async () => ({ wake: .59, remember: .8, importance: .99 }) });
    other.perceive(7, { kind: "cue", source: "Mara", atMs: now, text: "the lid was forced" });
    await Promise.resolve(); await Promise.resolve();
    other.tick();
    expect(other.holds(7)).toBe(true);
  });
});
