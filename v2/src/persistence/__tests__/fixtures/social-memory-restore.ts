/** Separate-process production restore probe. No model calls or network. */
import { readFileSync } from "node:fs";
import { addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../../ecs/world";
import { initializePrefabs } from "../../../ecs/prefabs";
import { SocialMemory, GodAgent } from "../../../ecs/components";
import { createSystemRegistry } from "../../../ecs/dynamic-systems";
import { deserializeWorld, type SerializedWorld } from "../../world-persistence";
import { getCompletedContributions, getSocialDialogue, getSocialSpeechFragments,
  flushHeardSpeechFragments } from "../../../cognition/social-memory";
import { snapshotActivityReview, recordActivitySpeech } from "../../../cognition/activity-review";

globalThis.fetch = async () => { throw new Error("Network forbidden in restore probe"); };
const input = JSON.parse(readFileSync(0, "utf8")) as { saved: SerializedWorld; poison?: boolean };
const world = createArgosWorld("Fresh-process restore"); initializePrefabs(world);
for (let n = 0; n < 37; n++) addEntity(world);
if (input.poison) {
  const retired = Array.from({ length: 128 }, () => addEntity(world));
  for (const eid of retired) {
    SocialMemory.fragmentsJson[eid] = JSON.stringify([{ executionId: "FOREIGN_EXECUTION", content: "FOREIGN_PRIVATE_WORDS", complete: false, heardAtSimMs: 1 }]);
    SocialMemory.contributionsJson[eid] = JSON.stringify([{ speechId: "FOREIGN", purpose: "FOREIGN_PRIVATE_PURPOSE" }]);
    GodAgent.narrativeGoals[eid] = '["FOREIGN_NARRATIVE"]';
    for (const field of ["tension", "lastObservation", "interventionCount", "observationInterval", "stagnationScore"] as const) GodAgent[field][eid] = 999;
    removeEntity(world, eid);
  }
}
const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), input.saved);
const actors = input.saved.entities.filter(e => e.components.Agent).map(e => {
  const eid = oldToNewId.get(e.id)!;
  const dialogue = getSocialDialogue(world, eid), fragments = getSocialSpeechFragments(world, eid);
  // Deserialized data is not a producer-issued completion receipt.
  for (const turn of dialogue) recordActivitySpeech(world, eid, turn);
  const notifications = fragments.flatMap(fragment => flushHeardSpeechFragments(world, fragment.executionId));
  return { oldEid: e.id, eid, dialogue, fragments, contributions: getCompletedContributions(world, eid),
    rawContributions: SocialMemory.contributionsJson[eid], rawFragments: SocialMemory.fragmentsJson[eid],
    notifications, activity: snapshotActivityReview(world, eid) ?? null };
});
process.stdout.write(`RESTORE_RESULT ${JSON.stringify(actors)}\n`);
const gods = input.saved.entities.filter(e => e.components.GodAgent).map(e => {
  const eid = oldToNewId.get(e.id)!;
  return { oldEid: e.id, eid, fields: Object.fromEntries(Object.entries(GodAgent).map(([field, values]) => [field, values[eid]])) };
});
process.stdout.write(`GOD_RESTORE_RESULT ${JSON.stringify(gods)}\n`);
