import { ConversationFraming } from "../sitcom-conversation-framing";
import type { SceneActor } from "../../rendering/scene-director";
import type { ScreenBeat } from "../sitcom-screenplay";
const actors = [1, 2, 3].map(id => ({id, identityKey: `life-${id}`, roomId: 10})) as SceneActor[];
const beats = (...ids: number[]): ScreenBeat[] => ids.map(actorId => ({kind: "speech", actorId,
  actorKey: `life-${actorId}`, atSimMs: 0, roomId: 10, direction: "Hello", evidence: []}));
function ready() {
  const camera = new ConversationFraming();
  expect(camera.select("world", 10, 0, 8500, beats(1), actors)).toBeUndefined();
  expect(camera.select("world", 10, 8500, 17000, beats(2), actors)).toBeUndefined();
  return camera;
}
test("an alternating exchange earns a held pair, then an ensemble cooldown", () => {
  const camera = ready();
  const pair = camera.select("world",10,17000,25500,beats(1),actors);
  expect(pair?.map(a => a.id)).toEqual([1,2]);
  expect(camera.select("world",10,25500,34000,beats(2),actors)).toEqual(pair);
  expect(camera.select("world",10,34000,42500,beats(1),actors)).toBeUndefined();
  expect(camera.select("world",10,42500,51000,beats(2,1,2),actors)).toBeUndefined();
});
test.each(["third speaker", "movement", "replacement", "room", "world", "gap"])("%s cancels the held setup", mode => {
  const camera = ready(); camera.select("world",10,17000,25500,beats(1),actors);
  const input = mode === "third speaker" ? beats(3) : mode === "movement"
    ? [{kind:"action",operation:"move",roomId:10,atSimMs:26000,direction:"walk",evidence:[]}] as ScreenBeat[] : [];
  expect(camera.select(mode === "world" ? "other" : "world",mode === "room" ? 20 : 10,
    mode === "gap" ? 26000 : 25500,34000,input,
    mode === "replacement" ? actors.map(a=>a.id===1 ? {...a,identityKey:"new-life"}:a) : actors)).toBeUndefined();
});
test("discarded candidates cannot advance editorial memory", () => {
  const original = ready();
  expect(original.clone().select("world",10,17000,25500,beats(1),actors)).toBeDefined();
  expect(original.select("world",10,17000,25500,[],actors)).toBeUndefined();
});
