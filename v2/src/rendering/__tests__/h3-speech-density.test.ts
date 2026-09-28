import { fullerSpeechLines, speechDensityConfigs } from "../h3-speech-density";
import { scriptComparisonLines } from "../h3-script-comparison";

test("density changes spoken words only, preserving all transport and visual controls", () => {
  const {sparse, fuller} = speechDensityConfigs();
  const {script: a, ...ac} = sparse, {script: b, ...bc} = fuller;
  expect(ac).toEqual(bc);
  expect(ac).toMatchObject({chunk_duration:10,memory:12,seed:891209});
  expect(a.map(x=>x.offset)).toEqual([0,10,20,30,40,50]);
  expect(b.map(x=>x.offset)).toEqual(a.map(x=>x.offset));
  expect(a.map(x=>x.prompt)).toEqual(scriptComparisonLines.map(x=>`Alex says: ${JSON.stringify(x)}`));
  expect(b.map(x=>x.prompt)).toEqual(fullerSpeechLines.map(x=>`Alex says: ${JSON.stringify(x)}`));
});

test("each fuller beat preserves its unique complete baseline sentence and adds bounded complete speech", () => {
  expect(fullerSpeechLines).toHaveLength(6);
  fullerSpeechLines.forEach((line,i) => {
    expect(line.startsWith(scriptComparisonLines[i] + " ")).toBe(true);
    expect(line.split(scriptComparisonLines[i])).toHaveLength(2);
    expect(line.endsWith(".")).toBe(true);
    expect(line.split(/\s+/)).toHaveLength(25);
  });
});
