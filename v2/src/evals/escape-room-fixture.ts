/** Explicitly SCRIPTED physical oracle. This proves solvability, never autonomous
 * cognition. It reads committed local clues and uses the production executor;
 * it never writes ECS state, supplies a hidden answer, or calls a model. */
import assert from "node:assert/strict";
import { LastAction, Name } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { getWorkingMemory } from "../cognition/working-memory";
import type { AgentAction } from "../cognition/agent-mind";
import { estimateSpeechDurationMs } from "../cognition/timed-speech";
import type { EscapeRoomTestbed, EscapeTopology } from "../demo/escape-room";

export type EscapeActor = "Mara" | "Ivo" | "Sera";
export type EscapeFixtureStage = "locker" | "drained" | "optics" | "exit" | "escaped";
export interface EscapeFixtureReport {
  mode: "scripted-physical-oracle";
  topology: EscapeTopology;
  completedThrough: EscapeFixtureStage;
  actions: number;
  elapsedMs: number;
  lockerCode: string;
  alignment?: string;
  exitCode?: string;
  pumpInterruption?: { interruptedAtMs: number; retryAtMs: number; helperUntilMs: number };
  checkpoints: Array<{ stage: EscapeFixtureStage; elapsedMs: number }>;
}

/** Fixture-only dispatch helpers retain the causal distinction between accepted
 * work and a completed consequence. Tests may use these without borrowing the
 * runtime's own invariant checks. */
export class EscapeFixtureDriver {
  actions = 0;
  constructor(readonly room: EscapeRoomTestbed) {}
  act(actor: EscapeActor, action: AgentAction, success = true) {
    this.actions++;
    this.room.dispatch(actor, action);
    if (action.type === "speak" && this.room.sim.world.meta.timedSpeech && action.content)
      this.room.advance(estimateSpeechDurationMs(action.content));
    const remaining = this.room.activity.untilMs[this.room.ids[actor]] - this.room.elapsedMs;
    if (this.room.activity.phase[this.room.ids[actor]] === "handling" && remaining > 0) this.room.advance(remaining);
    assert.equal(LastAction.success[this.room.ids[actor]], success,
      `${actor}: ${action.type} ${action.target ?? ""} ${action.content ?? ""}`);
  }
  interact(actor: EscapeActor, target: string, content: string, success = true) {
    this.act(actor, { type: "interact", target, content }, success);
  }
  move(actor: EscapeActor, destination: string) {
    this.actions++;
    this.room.dispatch(actor, { type: "move", target: destination });
    this.room.advance(3_000);
    assert.equal(LastAction.success[this.room.ids[actor]], true, `${actor} reaches ${destination}`);
    assert.equal(Name.value[getRoomForEntity(this.room.sim.world, this.room.ids[actor])!], destination);
  }
  begin(actor: EscapeActor, target: string, content: string) {
    this.actions++;
    this.room.dispatch(actor, { type: "interact", target, content });
    assert.notEqual(this.room.activity.phase[this.room.ids[actor]], "idle", `${target}: timed work must really begin`);
  }
  read(actor: EscapeActor, target: string): string {
    const eid = this.room.ids[actor];
    const seen = new Set(getWorkingMemory(this.room.sim.world, eid).receipts.map(receipt => receipt.id));
    this.interact(actor, target, "read");
    const own = getWorkingMemory(this.room.sim.world, eid).receipts.filter(receipt =>
      !seen.has(receipt.id) && receipt.provenance === "own_action" && receipt.succeeded);
    assert.ok(own.length, `Reading ${target} must create an actor-owned committed receipt`);
    return own.map(receipt => receipt.summary).join("\n");
  }
  possessedBy(item: number, actor: EscapeActor) {
    assert.equal(getDirectContainer(this.room.sim.world, item), this.room.ids[actor]);
  }
}

/** The answer is assembled from inspected text, not seed or operator snapshot.
 * An optional checkpoint supports adversarial tests at intermediate gates. */
export function runEscapeRoomFixture(room: EscapeRoomTestbed, options: {
  stopAfter?: EscapeFixtureStage;
  /** Reader/installer, physical helper, remote power operator. Fixture roles
   * may rotate; the world must not encode a particular character as the solver. */
  actors?: readonly [EscapeActor, EscapeActor, EscapeActor];
  /** Relay has independent optical and drainage branches; either may finish first. */
  branchOrder?: "pump-first" | "optics-first";
  /** Explicit adversarial fixture input, never a live agent decision. */
  interruptPumpWith?: "off" | "optics" | "exit";
} = {}): EscapeFixtureReport {
  assert.equal(room.options.live, false, "A scripted oracle must never drive the live cognition run");
  const d = new EscapeFixtureDriver(room), i = room.ids, w = room.sim.world;
  const [reader, helper, operator] = options.actors ?? ["Sera", "Mara", "Ivo"];
  assert.equal(new Set([reader, helper, operator]).size, 3, "The physical oracle uses three distinct people");
  assert.ok(room.options.topology === "relay" || !options.interruptPumpWith, "Powered-pump interruption belongs to the relay topology");
  const report: EscapeFixtureReport = { mode: "scripted-physical-oracle", topology: room.options.topology, completedThrough: "locker", actions: 0,
    elapsedMs: room.elapsedMs, lockerCode: "", checkpoints: [] };
  const checkpoint = (stage: EscapeFixtureStage) => {
    report.completedThrough = stage; report.actions = d.actions; report.elapsedMs = room.elapsedMs;
    report.checkpoints.push({ stage, elapsedMs: room.elapsedMs });
    return options.stopAfter === stage;
  };

  d.move(reader, "Gallery");
  const first = d.read(reader, "Gallery plaque").match(/\b(\d{2})\b/)?.[1];
  assert.ok(first, "Gallery clue must reveal an inspectable two-digit prefix");
  d.move(reader, "Atrium"); d.move(reader, "Workshop");
  const last = d.read(reader, "Workshop notebook").match(/\b(\d{2})\b/)?.[1];
  assert.ok(last, "Workshop clue must reveal an inspectable two-digit suffix");
  report.lockerCode = first + last;
  d.interact(reader, "Crank locker", `unlock ${report.lockerCode}`);
  d.act(reader, { type: "pickup", target: "Pump crank" }); d.possessedBy(i.crank, reader);
  if (checkpoint("locker")) return report;

  d.interact(reader, "Drain pump", "install");
  assert.equal(getDirectContainer(w, i.crank), i.pump, "The actual crank must be mounted");
  d.move(helper, "Workshop"); d.move(operator, "Workshop");
  const retrieveEquipment = () => {
    d.move(reader, "Archive");
    const diagram = d.read(reader, "Archive diagram");
    report.alignment = diagram.match(/\b(amber|cobalt|violet)\b/i)?.[1].toLowerCase();
    assert.ok(report.alignment, "Archive diagram must teach a usable alignment");
    d.act(reader, { type: "pickup", target: "Copper coil" }); d.possessedBy(i.coil, reader);
    d.act(reader, { type: "pickup", target: "Glass prism" }); d.possessedBy(i.prism, reader);
    d.move(reader, "Workshop"); d.interact(reader, "Generator", "install");
    assert.equal(getDirectContainer(w, i.coil), i.generator);
  };
  const drain = () => {
    if (room.options.topology === "relay") d.interact(operator, "Power router", "route pump");
    d.begin(helper, "Pump bypass", "hold"); d.begin(reader, "Drain pump", "pump");
    if (options.interruptPumpWith) {
      const helperUntilMs = room.activity.untilMs[i[helper]];
      room.advance(1500); d.interact(operator, "Power router", `route ${options.interruptPumpWith}`);
      const interruptedAtMs = room.elapsedMs;
      assert.equal(LastAction.success[i[reader]], false, "Original powered pumping really failed");
      assert.equal(room.activity.phase[i[helper]], "holding_bypass");
      assert.equal(room.activity.untilMs[i[helper]], helperUntilMs);
      room.advance(6500); // The original deadline cannot finish abandoned work.
      assert.equal(room.snapshot().state.drained, false);
      d.interact(operator, "Power router", "route pump"); d.begin(reader, "Drain pump", "pump");
      report.pumpInterruption = { interruptedAtMs, retryAtMs: room.elapsedMs, helperUntilMs };
    }
    room.advance(7_999);
    assert.equal(room.snapshot().state.drained, false, "Accepted pumping has not yet drained its actual route");
    room.advance(1);
    assert.equal(room.snapshot().state.drained, true);
    assert.equal(LastAction.success[i[reader]], true); assert.equal(LastAction.success[i[helper]], true);
    return checkpoint("drained");
  };
  const optics = () => {
    d.interact(reader, "Power router", "route optics");
    d.move(reader, "Atrium"); d.move(reader, "Gallery");
    d.interact(reader, "Optical bench", "install");
    assert.equal(getDirectContainer(w, i.prism), i.bench);
    d.interact(reader, "Optical bench", `align ${report.alignment}`);
    report.exitCode = d.read(reader, "Optical bench").match(/\b(\d{4})\b/)?.[1];
    assert.ok(report.exitCode, "Powered aligned optics must reveal an actual four-digit exit code");
    return checkpoint("optics");
  };
  if (room.options.topology === "relay") {
    retrieveEquipment();
    if (options.branchOrder === "optics-first") {
      if (optics()) return report;
      d.move(reader, "Atrium"); d.move(reader, "Workshop");
      if (drain()) return report;
    } else {
      if (drain()) return report;
      if (optics()) return report;
    }
  } else {
    if (drain()) return report;
    retrieveEquipment();
    if (optics()) return report;
  }

  // Routing away from optics destroys the current display. The actor keeps the
  // previously read answer; the fixture does not query a hidden final code.
  d.interact(operator, "Power router", "route exit");
  d.move(helper, "Atrium"); d.move(operator, "Atrium"); d.move(reader, "Atrium");
  d.begin(helper, "Exit release", "hold");
  d.begin(reader, "Exit keypad", `enter ${report.exitCode}`);
  room.advance(1_999);
  assert.equal(room.snapshot().state.exitOpen, false, "An accepted code is not yet an open door");
  room.advance(1);
  assert.equal(room.snapshot().state.exitOpen, true);
  assert.equal(room.snapshot().state.allEscaped, false, "Opening the door is not escaping");
  if (checkpoint("exit")) return report;

  for (const actor of ["Mara", "Ivo", "Sera"] as const) d.move(actor, "Courtyard");
  assert.equal(room.snapshot().state.allEscaped, true);
  for (const actor of room.characters) assert.equal(getRoomForEntity(w, i[actor]), i.outside);
  checkpoint("escaped");
  return report;
}
