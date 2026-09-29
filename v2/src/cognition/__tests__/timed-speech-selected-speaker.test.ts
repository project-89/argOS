/** Conversation's "selected next speaker": the person a line was addressed to
 * answers next; others within earshot give them a beat instead of taking the floor. */
import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTimeline, clearSimulationTimeline } from "../../runtime/simulation-timeline";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { beginTimedSpeech, clearTimedSpeech, estimateSpeechDurationMs, readLocalSpeechOpportunity, requestConversationTurn,
  SELECTED_SPEAKER_BEAT_MS, SELECTED_SPEAKER_WINDOW_MS } from "../timed-speech";

const LINE = "Ada, what did you see at the Net House last night?";
const worlds: ReturnType<typeof createArgosWorld>[] = [];
afterEach(() => { for (const w of worlds.splice(0)) { clearTimedSpeech(w); clearSimulationTimeline(w); } });
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); worlds.push(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId: room });
  const ada = actor("Ada"), bo = actor("Bo"), cy = actor("Cy");
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const say = (speaker: number, addresseeId?: number) =>
    beginTimedSpeech(world, speaker, LINE, `line-${speaker}-${Math.random()}`, jest.fn(), jest.fn(), addresseeId === undefined ? {} : { addresseeId });
  return { world, ada, bo, cy, advance, say, spoken: estimateSpeechDurationMs(LINE) };
}

test("the addressed person answers first; bystanders wait a beat, then may speak", () => {
  const f = fixture();
  requestConversationTurn(f.world, f.cy, undefined, () => true); // Cy was already waiting to talk
  expect(f.say(f.bo, f.ada)).toBe(true);
  f.advance(f.spoken + 300);
  expect(readLocalSpeechOpportunity(f.world, f.ada)).toMatchObject({ available: true });
  expect(readLocalSpeechOpportunity(f.world, f.cy)).toMatchObject({ available: false, reason: "queued_turn" });
  f.advance(SELECTED_SPEAKER_BEAT_MS);
  expect(readLocalSpeechOpportunity(f.world, f.cy).reason).not.toBe("queued_turn");
});

test("an unaddressed line selects no one; the claim expires after its window", () => {
  const f = fixture();
  expect(f.say(f.bo)).toBe(true);
  f.advance(f.spoken + 300);
  expect(readLocalSpeechOpportunity(f.world, f.cy)).toMatchObject({ available: true });
  const g = fixture();
  expect(g.say(g.bo, g.ada)).toBe(true);
  g.advance(g.spoken + 300);
  expect(readLocalSpeechOpportunity(g.world, g.cy).reason).toBe("queued_turn"); // giving Ada her beat
  g.advance(SELECTED_SPEAKER_WINDOW_MS);
  // Ada never answered: nobody is held waiting on her any longer.
  expect(readLocalSpeechOpportunity(g.world, g.cy)).toMatchObject({ available: true });
});
