import { scriptComparisonConfigs, scriptComparisonLines } from "./h3-script-comparison";

/** Renderer-only density experiment. Duration estimates are hypotheses, not timing guarantees. */
export const fullerSpeechLines = [
  "The blue envelope arrived this morning. Inside was a photograph of our old house, with a handwritten invitation to visit the people living there now.",
  "I left the brass key beside the window. Please bring it when you come upstairs, because the spare blanket is locked inside the wooden chest.",
  "Our train leaves at seven on Tuesday. We should meet outside the station early enough to buy coffee and find our seats before everyone arrives.",
  "The garden gate needs a fresh coat of paint. I bought a tin of dark green yesterday, and the brushes are waiting in the shed.",
  "I ordered tomato soup for lunch. The waiter brought warm bread with it, and I spent the afternoon reading my book at the corner table.",
  "Please put the green notebook on the shelf. It contains the measurements for the curtains, along with a small drawing of how the room looked.",
];

export function speechDensityConfigs() {
  const base = scriptComparisonConfigs().preloaded;
  return {
    sparse: base,
    fuller: { ...base, script: fullerSpeechLines.map((line, index) => ({
      offset: index * 10, prompt: `Alex says: ${JSON.stringify(line)}`,
    })) },
  };
}

export const speechDensityProtocol = {
  experiment: "Sparse versus fuller complete dialogue in identical ten-second preloaded beats. Only spoken text changes; no simulation calls or prompt updates.",
  target: "Fuller beats contain 25 words, approximately eight seconds at 188 words/minute. Actual delivery must be measured; no rate instruction is sent.",
  source: "h3-speech-density.ts frozen fixture; no NPCs",
  expected: { sparse: scriptComparisonLines, fuller: fullerSpeechLines },
  retries: 0,
};
