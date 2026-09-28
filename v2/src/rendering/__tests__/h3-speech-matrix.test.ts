import { speechMatrixConfigs, speechMatrixLine, speechMatrixPrompt } from "../h3-speech-matrix";

test("bounded 2x2 uses the same single utterance without imposing impossible timestamps", () => {
  const configs = speechMatrixConfigs();
  expect(Object.keys(configs)).toEqual(["direct-5", "script-5", "direct-10", "script-10"]);
  for (const [mode, config] of Object.entries(configs)) {
    const p = config.script?.[0].prompt ?? config.prompt;
    expect(p).toBe(speechMatrixPrompt);
    expect(p.split(speechMatrixLine)).toHaveLength(2);
    expect(p).not.toMatch(/5\.6|second 10|speed up|truncate/i);
    expect(config.chunk_duration).toBe(mode.endsWith("-5") ? 5 : 10);
    expect(config.seed).toBe(891209);
    if (mode.startsWith("script")) expect(config.script).toEqual([{offset:0,prompt:speechMatrixPrompt}]);
    else expect(config).not.toHaveProperty("script");
  }
});
