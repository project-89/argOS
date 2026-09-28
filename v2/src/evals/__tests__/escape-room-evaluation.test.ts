import { evaluateEscapeRoomRun, formatEscapeRoomEvaluation } from "../escape-room-evaluation";
import type { TestbedEvent } from "../../demo/generative-agents";

const cast = ["Mara", "Ivo", "Sera"].map((name, id) => ({ id, name, room: "Courtyard" }));
const state = { elapsedMs: 10000, escaped: true, actors: cast };
const action = (id: number, sequence = id + 1): TestbedEvent => ({ sequence, elapsedMs: 5000, tick: 10,
  kind: "action", actorId: id, visibility: "public", status: "succeeded", text: "Arrived outside",
  action: { type: "move", target: "Courtyard" } });
const exits = cast.map(a => action(a.id));
const cognition = cast.flatMap(a => [
  { sequence: a.id + 10, elapsedMs: 1000, tick: 2, kind: "thought", actorId: a.id, visibility: "operator", text: "Choose next work" },
  { sequence: a.id + 20, elapsedMs: 1000, tick: 2, kind: "decision_latency", actorId: a.id, visibility: "operator", text: "1200" },
] as TestbedEvent[]);
const offline = { live: false, violations: [] };

test("unrequested intervention and offline cognition are not reported as observed evidence", () => {
  const result = evaluateEscapeRoomRun(exits, state, offline);
  const report = formatEscapeRoomEvaluation(result);
  expect(result.passed).toBe(true);
  for (const gate of ["requestedInterruptionOccurred", "interruptedUnlockRecovered", "liveCognitionObserved", "topologyCausalProof"])
    expect(report).toContain(`| ${gate} | not applicable |`);
});
test("requested but missing intervention remains a failed applicable gate", () => {
  const result = evaluateEscapeRoomRun(exits, state, { ...offline, interruptionRequested: true });
  expect(result.passed).toBe(false);
  expect(formatEscapeRoomEvaluation(result)).toContain("| requestedInterruptionOccurred | not observed |");
});

test("an explicit fixture with committed exits proves mechanics, not autonomous cognition", () => {
  const r = evaluateEscapeRoomRun(exits, state, offline);
  expect(r.passed).toBe(true); expect(r.provenance).toContain("scripted");
  expect(r.byActor[0].decisionP95Ms).toBeNull();
  expect(evaluateEscapeRoomRun(exits, state, { ...offline, live: true }).passed).toBe(false);
});
test("live escape requires real cognition coverage for every expected actor", () => {
  expect(evaluateEscapeRoomRun([...exits, ...cognition], state, { ...offline, live: true }).passed).toBe(true);
  expect(evaluateEscapeRoomRun([...exits, ...cognition.filter(e => e.actorId !== 2)], state, { ...offline, live: true }).passed).toBe(false);
});
test("saying escaped cannot stand in for movement or final physical state", () => {
  const speech = exits.map(e => ({ ...e, kind: "speech", action: { type: "speak" as const, content: "Everyone is outside" } }));
  expect(evaluateEscapeRoomRun(speech, state, offline).passed).toBe(false);
  expect(evaluateEscapeRoomRun(exits, { ...state, escaped: false }, offline).passed).toBe(false);
  expect(evaluateEscapeRoomRun(exits, { ...state, actors: cast.map((a, i) => i ? a : { ...a, room: "Atrium" }) }, offline).passed).toBe(false);
});
test("pending and failed exits do not pass, even with a claimed successful snapshot", () => {
  for (const status of ["pending", "failed"] as const)
    expect(evaluateEscapeRoomRun(exits.map(e => ({ ...e, status })), state, offline).passed).toBe(false);
});
test("empty and duplicated casts are missing evidence rather than vacuous success", () => {
  expect(evaluateEscapeRoomRun([], { ...state, actors: [] }, offline).passed).toBe(false);
  expect(evaluateEscapeRoomRun(exits, { ...state, actors: [cast[0], cast[0], cast[0]] }, offline).passed).toBe(false);
});
test("duplicate and future receipts cannot manufacture missing actors or latency coverage", () => {
  expect(evaluateEscapeRoomRun([exits[0], ...exits.map(e => ({ ...e, sequence: 1 })),
    { ...exits[2], sequence: 900, elapsedMs: 20000 }], state, offline).passed).toBe(false);
});
test("runtime and invariant failures remain failures even when the cast reaches outside", () => {
  expect(evaluateEscapeRoomRun(exits, state, { ...offline, violations: ["Remote unlock bypass"] }).passed).toBe(false);
  expect(evaluateEscapeRoomRun(exits, state, { ...offline, runtimeError: "provider unavailable" }).passed).toBe(false);
});
test("a requested but unapplied disruption cannot qualify as recovery", () => {
  expect(evaluateEscapeRoomRun(exits, state, { ...offline, interruptionRequested: true }).passed).toBe(false);
  expect(evaluateEscapeRoomRun(exits, state, { ...offline, interruptionRequested: true, interruptionApplied: true }).passed).toBe(true);
});
test("world movement receipts count once, not again for their private explanatory detail", () => {
  const movements = exits.map(e => ({ ...e, kind: "movement" }));
  const details = exits.map(e => ({ ...e, kind: "action_detail", sequence: e.sequence + 100 }));
  const result = evaluateEscapeRoomRun([...movements, ...details], state, offline);
  expect(result.passed).toBe(true);
  expect(result.mechanics.terminalActions).toBe(3);
  expect(result.diagnostics).toEqual(evaluateEscapeRoomRun(movements, state, offline).diagnostics);
  expect(evaluateEscapeRoomRun(details, state, offline).passed).toBe(false);
});
test("successful movement uses the same case and whitespace tolerance as the physical executor", () => {
  expect(evaluateEscapeRoomRun(exits.map(e => ({ ...e, action: { type: "move", target: " courtyard " } })), state, offline).passed).toBe(true);
});
test("interpretations retain their thought provenance without being relabelled as decisions", () => {
  const r = evaluateEscapeRoomRun([...exits, ...cognition,
    { ...cognition[0], sequence: 101, thoughtType: "insight" },
    { ...cognition[0], sequence: 102, thoughtType: "reasoning" }], state, offline);
  expect(r.byActor[0].thoughtTypes).toEqual({ unclassified: 1, insight: 1, reasoning: 1 });
  expect(r.byActor[0].decisions).toBe(1);
});
test("argument attempts count canonical case and whitespace variants without counting bare observations", () => {
  const extra = [" UNLOCK\t5271 ", "ENTER 8732", "read"].map((content, index) => ({ ...exits[0],
    sequence: 100 + index, action: { type: "interact" as const, target: "Control", content } }));
  expect(evaluateEscapeRoomRun([...exits, ...extra], state, offline).mechanics.codeAttempts).toBe(2);
});
test("wait-shaped receipts have truthful diagnostic labels without changing any physical gate", () => {
  const wait: TestbedEvent = { ...exits[0], sequence: 101, action: { type: "wait", foregroundDecisionId: "plausible-id" } };
  const baseline = evaluateEscapeRoomRun(exits, state, offline), result = evaluateEscapeRoomRun([...exits, wait], state, offline);
  expect(result.gates).toEqual(baseline.gates);
  expect(result.diagnostics.actions).toMatchObject({ rawWaitOrRestReceipts: 1, explicitWaitOrRestActions: 1,
    intentionalModelWaits: null, unattributedWaitOrRestReceipts: 1 });
  expect(formatEscapeRoomEvaluation(result)).toContain("intentional model-wait attribution: unavailable");
});
