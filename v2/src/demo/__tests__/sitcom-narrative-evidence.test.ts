import { jest } from "@jest/globals";
import { ApartmentSitcom } from "../apartment-sitcom";
import { getWorldNarrativeEvidence } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { estimateSpeechDurationMs } from "../../cognition/timed-speech";

let t: ApartmentSitcom;
beforeEach(async () => {
  drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No inference in narrative evidence tests"));
  t = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" }); await t.start();
});
afterEach(() => { t?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
const evidence = () => getWorldNarrativeEvidence(t.sim.world) as Array<Record<string, any>>;

test("narrator gets current local ECS evidence without phone bodies, contact cards or planted thoughts", () => {
  t.setPhoneContact({ name: "SECRET_CONTACT", relationship: "SECRET_RELATIONSHIP", context: "SECRET_HISTORY" });
  t.text("SECRET_INCOMING_BODY"); t.advance(200); t.plantThought("Elaine", "SECRET_THOUGHT");
  expect(evidence()).toHaveLength(2);
  expect(evidence().map(row => row.room)).toEqual(["Living Room", "Living Room"]);
  expect(JSON.stringify(evidence())).not.toMatch(/SECRET_/);
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  const elaine = evidence().find(row => row.character === "Elaine")!;
  expect(elaine.room).toBe("Kitchen");
  expect(elaine.visibleObjects).toContainEqual(expect.objectContaining({ name: "Elaine's phone", container: "Kitchen counter" }));
  expect(elaine.visibleObjects.map((row: any) => row.name)).not.toContain("Last black-and-white cookie");
  expect(JSON.stringify(evidence())).not.toMatch(/SECRET_/);
});

test("new disclosure supersedes an empty narrator evidence feed without exposing a future speech suffix", () => {
  const words = "Our dinner is cancelled. Alex ended the relationship today.";
  t.dispatch("Elaine", { type: "speak", target: "Jerry", content: words });
  expect(JSON.stringify(evidence())).not.toContain(words);
  t.advance(500);
  expect(JSON.stringify(evidence())).not.toContain("relationship today");
  t.advance(estimateSpeechDurationMs(words) + 1);
  const jerry = evidence().find(row => row.character === "Jerry")!;
  expect(jerry.personallyDeliveredDialogue).toContainEqual(expect.objectContaining({ speaker: "Elaine", own: false, words, status: "completed" }));
  expect(jerry.personallyHeardPrefixes).toEqual([]);
});
