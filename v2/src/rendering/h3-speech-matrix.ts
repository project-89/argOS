/** Pure experiment specification; importing this never starts paid work. */
export const speechMatrixLine = "A restaurant where you don't leave your sweet tooth to chance, Jerry!";
export const speechMatrixScene = "Painterly 1990s New York apartment kitchen, cream cabinets, cereal boxes, wooden counter and refrigerator. Locked medium close shot of Elaine, a slender woman in her late thirties with long curly dark brown hair, burgundy jacket and black trousers. She is the only visible person. Jerry is offscreen and silent. No cuts, subtitles or UI.";
export const speechMatrixPrompt = `${speechMatrixScene}\nElaine begins promptly and says once in clear English, at a natural conversational pace: "${speechMatrixLine}"\nAfter finishing the sentence she closes her mouth and stays quietly in place. No additional speech, repeated words or vocal sounds. Quiet room tone only under the voice and afterward. No music.`;
export function speechMatrixConfigs() {
  return Object.fromEntries(([5, 10] as const).flatMap(seconds => (["direct", "script"] as const).map(path => [ `${path}-${seconds}`, {
    type: "configure", protocol_version: 1, prompt_version: 1,
    prompt: path === "direct" ? speechMatrixPrompt : speechMatrixScene,
    ...(path === "script" ? { script: [{ offset: 0, prompt: speechMatrixPrompt }] } : {}),
    chunk_duration: seconds, resolution: "480p", aspect_ratio: "16:9", memory: 12, seed: 891209,
  } ])));
}
