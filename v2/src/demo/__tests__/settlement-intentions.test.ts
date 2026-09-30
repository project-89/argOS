import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, GoalLifecycle } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents } from "../../runtime/committed-events";
import { createGeneratedIntention, pendingIntentionReview, unsettledIntentionCount, MAX_SELF_DIRECTED_INTENTIONS } from "../../cognition/goal-lifecycle";
import { createCommunicationMotivation } from "../../cognition/communication-motivation";
import { activeOwnIntentions, LET_GO, OVERTAKEN, tendIntentions, WENT_QUIET } from "../settlement-intentions";

const RULES = { keep: 2, quietAfterMs: 60_000, letGoAfterMs: 30_000 };

function fixture() {
  const world = createArgosWorld("Saltmere resolve"); initializePrefabs(world); world.meta.aiEnabled = false; startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Saltmere Common" });
  const otis = createAgentEntity(world, { name: "Otis", role: "fisher", systemPrompt: "A fisher with a secret.", roomId: room });
  const standing = createCommunicationMotivation(world, otis, { description: "Keep in with Leon", memory: "We fished together for years.", priority: 9 }).goal;
  // The trade's duty, authored at the start: never tended away.
  const duty = createGeneratedIntention(world, otis, { description: "Keep Saltmere supplied as its fisher: raw fish on the market stall.", priority: 6, kind: "custom" }, "personal")!;
  let tick = 0;
  const later = (ms: number) => advanceSimulationTime(world, ++tick, ms);
  const resolve = (description: string) => { later(1_000); return createGeneratedIntention(world, otis, { description, priority: 9, kind: "social" }, "foreground")!; };
  return { world, otis, standing, duty, later, resolve };
}

test("a standoff's newer resolve overtakes the older: beyond the newest few, older intentions go up for reconsideration, never marked done", () => {
  const { world, otis, standing, duty, resolve } = fixture();
  const goals = ["Talk to Tess about Pryce", "Stand guard at Tent 7", "Hold my ground at the flap"].map(resolve);
  expect(unsettledIntentionCount(world, otis)).toBe(MAX_SELF_DIRECTED_INTENTIONS); // with the standing desire and the trade's duty
  const changed = tendIntentions(world, otis, RULES);
  expect(changed.map(c => c.description)).toEqual(["Talk to Tess about Pryce"]);
  expect(changed.every(c => c.outcome === "reconsider" && c.reason === OVERTAKEN)).toBe(true);
  expect(activeOwnIntentions(world, otis)).toEqual(goals.slice(1).reverse());
  expect(Goal.status[goals[0]]).toBe("paused");
  expect(pendingIntentionReview(world, otis, goals[0])?.reason).toBe(OVERTAKEN);
  // A standing desire and an authored duty are theirs to keep; tending never touches them.
  expect(Goal.status[standing]).toBe("active");
  expect(Goal.status[duty]).toBe("active");
  // Tending again changes nothing new.
  expect(tendIntentions(world, otis, RULES)).toEqual([]);
});

test("quiet resolve is reconsidered; a reconsideration nobody reviews is let go (not accomplishment), freeing room for new resolve", () => {
  const { world, otis, duty, later, resolve } = fixture();
  const goals = ["Talk to Tess about Pryce", "Stand guard at Tent 7", "Hold my ground at the flap"].map(resolve);
  tendIntentions(world, otis, RULES);
  // A paused intention still fills the quota: no room for new resolve until it is reviewed or let go.
  expect(createGeneratedIntention(world, otis, { description: "Get Bea to back me", priority: 9, kind: "social" }, "foreground")).toBeNull();
  later(35_000);
  // The overtaken one was never reviewed: let go.
  const letGo = tendIntentions(world, otis, RULES).filter(c => c.outcome === "let go");
  expect(letGo.map(c => c.goal)).toEqual([goals[0]]);
  expect(Goal.status[goals[0]]).toBe("retired");
  expect(GoalLifecycle.reason[goals[0]]).toBe(LET_GO);
  expect(resolve("Get Bea to back me")).toBeTruthy();
  // A long quiet on the rest: up for reconsideration (the oldest overtaken by the newest).
  later(61_000);
  const quiet = tendIntentions(world, otis, RULES);
  expect(quiet.filter(c => c.reason === WENT_QUIET)).toHaveLength(2);
  expect(quiet.filter(c => c.reason === OVERTAKEN)).toHaveLength(1);
  expect(activeOwnIntentions(world, otis)).toEqual([]);
  expect(goals.every(g => Goal.status[g] !== "completed")).toBe(true);
  // The duty outlasts every quiet spell.
  later(200_000); tendIntentions(world, otis, RULES);
  expect(Goal.status[duty]).toBe("active");
});
