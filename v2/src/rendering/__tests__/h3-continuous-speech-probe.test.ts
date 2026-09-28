import { continuousSpeechConfigure, continuousSpeechLines, continuousSpeechUpdates, nextContinuousSpeechUpdate } from "../h3-continuous-speech-probe";

test("continuous fixture is native text-only with three unique lines and one requested cut", () => {
  const messages = [continuousSpeechConfigure, ...continuousSpeechUpdates];
  const all = messages.map(m => m.prompt).join("\n");
  for (const line of continuousSpeechLines) expect(all.split(line)).toHaveLength(2);
  expect(all.match(/Cut once/g)).toHaveLength(1);
  for (const message of messages) {
    expect(message).not.toHaveProperty("script");
    expect(message).not.toHaveProperty("audio_url");
  }
  expect(continuousSpeechUpdates[2].prompt).toContain("No speech");
});

test("stale/repeated receipts cannot replay a line or skip to another one", () => {
  expect(nextContinuousSpeechUpdate(1, 1)?.prompt_version).toBe(2);
  expect(nextContinuousSpeechUpdate(2, 1)).toBeUndefined();
  expect(nextContinuousSpeechUpdate(2, 3)).toBeUndefined();
  expect(nextContinuousSpeechUpdate(2, 2)?.prompt_version).toBe(3);
  expect(nextContinuousSpeechUpdate(3, 3)?.prompt_version).toBe(4);
  expect(nextContinuousSpeechUpdate(4, 4)).toBeUndefined();
});
