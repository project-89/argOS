/** Explicit offline oracle for interruption recovery. All puzzle knowledge is
 * learned through committed reads; all repair/retry work uses native actions. */
import assert from "node:assert/strict";
import { LastAction } from "../ecs/components";
import type { EscapeRoomTestbed } from "../demo/escape-room";
import { EscapeFixtureDriver, runEscapeRoomFixture, type EscapeActor } from "./escape-room-fixture";

export function runEscapeRoomRecoveryFixture(room: EscapeRoomTestbed, options: {
  actors?: readonly [EscapeActor, EscapeActor, EscapeActor];
} = {}) {
  const actors = options.actors ?? ["Sera", "Mara", "Ivo"] as const;
  const [reader, helper, operator] = actors;
  const report = runEscapeRoomFixture(room, { actors, stopAfter: "optics" });
  const d = new EscapeFixtureDriver(room), i = room.ids;
  d.interact(operator, "Power router", "route exit");
  d.move(helper, "Atrium"); d.move(reader, "Atrium");
  d.begin(helper, "Exit release", "hold");
  const holdUntilMs = room.activity.untilMs[i[helper]];
  d.begin(reader, "Exit keypad", `enter ${report.exitCode}`);
  room.advance(1500);
  assert.equal(room.canPerturbAfter("exit_unlock_started"), true);
  assert.deepEqual(room.perturb({ after: "exit_unlock_started" }), { changed: true });
  const interruptedAtMs = room.elapsedMs;
  assert.equal(LastAction.success[i[reader]], false, "The original entry failed; it was not silently resumed");
  assert.equal(room.activity.phase[i[reader]], "idle");
  assert.equal(room.activity.phase[i[helper]], "holding_release", "Power loss is not a helper release");
  assert.equal(room.activity.untilMs[i[helper]], holdUntilMs, "A trip cannot refresh the helper deadline");
  assert.equal(room.snapshot().state.exitOpen, false);
  room.advance(500); // The old entry's due time cannot open the door.
  assert.equal(room.snapshot().state.exitOpen, false);
  d.interact(operator, "Power router", "route exit");
  d.begin(reader, "Exit keypad", `enter ${report.exitCode}`);
  const retryAtMs = room.elapsedMs;
  room.advance(1999);
  assert.equal(room.snapshot().state.exitOpen, false, "A retry owes the full two seconds");
  assert.equal(room.activity.phase[i[helper]], "holding_release");
  room.advance(1);
  assert.equal(room.snapshot().state.exitOpen, true);
  assert.equal(LastAction.success[i[reader]], true);
  assert.equal(LastAction.success[i[helper]], true, "The helper completes only with the actual unlock");
  d.move(operator, "Atrium");
  for (const actor of room.characters) d.move(actor, "Courtyard");
  assert.equal(room.snapshot().escaped, true);
  return { mode: "scripted-physical-recovery-oracle" as const, seed: room.options.seed, actors,
    interruptedAtMs, retryAtMs, holdUntilMs, elapsedMs: room.elapsedMs, actions: report.actions + d.actions };
}
