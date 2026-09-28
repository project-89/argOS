/** Frozen rendering fixture, not a simulation or production action controller. */
export const continuousSpeechLines = [
  "I'm meeting David for dinner. Please leave the cookies alone.",
  "You trust a restaurant, but you don't trust me?",
  "The restaurant doesn't sneak into my kitchen at midnight.",
];
const set = "Painterly 1990s New York apartment kitchen, cream cabinets, wooden counter and refrigerator. Elaine is a slender woman in her late thirties with long curly dark brown hair, a burgundy jacket and black trousers. Jerry is a slim man in his late thirties with short curly dark brown hair, a blue button-down shirt and jeans. Elaine stands to the left of Jerry at the counter. Only these two people are present. Preserve their faces, clothes and positions. No subtitles, UI, music or laugh track.";
const tail = "After the sentence ends, both remain quiet with mouths closed. Quiet room tone only. No repeated dialogue, additional words or vocal sounds.";
export const continuousSpeechConfigure = {
  type: "configure", protocol_version: 1, prompt_version: 1,
  prompt: `${set}\nLocked medium close shot of Elaine; Jerry is outside the frame to her right. Elaine speaks once in clear English at a natural conversational pace: "${continuousSpeechLines[0]}" Jerry is silent. ${tail}`,
  chunk_duration: 10, resolution: "480p", aspect_ratio: "16:9", memory: 12, seed: 891209,
};
export const continuousSpeechUpdates = [
  { type: "prompt", prompt_version: 2, replan: true,
    prompt: `Cut once to a locked medium two-shot of the same kitchen counter: Elaine on the left in her burgundy jacket, Jerry on the right in his blue shirt. Jerry speaks once in his male voice, in clear English at a natural conversational pace: "${continuousSpeechLines[1]}" Elaine listens with her mouth closed. ${tail}` },
  { type: "prompt", prompt_version: 3, replan: true,
    prompt: `Keep the same locked two-shot and unchanged appearance: Elaine on the left in her burgundy jacket, Jerry on the right in his blue shirt. Elaine speaks once in her established female voice, in clear English at a natural conversational pace: "${continuousSpeechLines[2]}" Jerry listens with his mouth closed. ${tail}` },
  { type: "prompt", prompt_version: 4, replan: true,
    prompt: "Keep the same locked two-shot, clothes and positions. Elaine and Jerry remain quietly at the counter with their mouths closed. Quiet room tone only. No speech, repeated dialogue, vocal sounds, music, camera cuts or new actions." },
];

/** One update per newly observed issued version; stale receipts never resend. */
export function nextContinuousSpeechUpdate(sentVersion: number, observedVersion: number) {
  if (observedVersion !== sentVersion) return undefined;
  return continuousSpeechUpdates.find(update => update.prompt_version === sentVersion + 1);
}
