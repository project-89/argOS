import { AttentionFilter, touchesCue } from "../autopilot-attention";

describe("attention over autopilot", () => {
  test("being spoken to wakes the mind; repeats of the same small thing fade; small things can add up", () => {
    const f = new AttentionFilter();
    expect(f.perceive({ kind: "addressed", source: "Tess", text: "Otis!", atMs: 0 }).level).toBe("wake");
    const g = new AttentionFilter();
    const walk = (atMs: number) => g.perceive({ kind: "approach", source: "Eli", text: "Eli walks up", atMs });
    expect(walk(0).level).toBe("notice");        // passing a coworker is not news on its own
    expect(walk(60_000).level).toBe("notice");  // and fades with repetition
    expect(walk(120_000).level).toBe("notice");
    const h = new AttentionFilter();
    h.perceive({ kind: "speech", source: "Leon", text: "the tide", atMs: 0 });
    h.perceive({ kind: "approach", source: "Mara", text: "Mara walks up", atMs: 2_000 });
    expect(h.perceive({ kind: "cue", source: "Mara", text: "Mara mentions the Net House box", atMs: 4_000 }).level).toBe("wake");
  });

  test("a surprise in the habit wakes the mind even when it recurs; addressed never fades away", () => {
    const f = new AttentionFilter();
    for (let i = 0; i < 6; i++) expect(f.perceive({ kind: "surprise", source: "habit:raw-fish", text: "the net came up empty", atMs: i * 30_000 }).level).toBe("wake");
    for (let i = 0; i < 6; i++) expect(f.perceive({ kind: "addressed", source: "Wren", text: "hello?", atMs: 400_000 + i * 30_000 }).level).toBe("wake");
  });

  test("cues match whole words", () => {
    expect(touchesCue("Have you been in the Net House lately?", ["Net House", "sea"])).toBe("Net House");
    expect(touchesCue("seasoned wood", ["sea"])).toBeUndefined();
  });
});
