/** Offline, native mechanics/catalogue checks; not autonomous behavior evidence. */
import { jest } from "@jest/globals";
import { SpatialDemo } from "../spatial-demo";
import { getDirectContainer } from "../../ecs/location";
import { getAvailableAffordances, getKnownAffordances } from "../../world/affordance-availability";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { buildAvailableActionsContext, formatActionsForPrompt } from "../../cognition/action-registry";
import { generateStimuliForAgent } from "../../cognition/sensory-system";
import { validateGeneratedPlan, type GeneratedPlan } from "../../cognition/planning-system";

let demo: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline capability projection"));
  demo = await SpatialDemo.create({ live: false, automaticClock: false }); await demo.start();
});
afterEach(() => { demo?.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const actor = (name = "Mara") => demo.snapshot().actors.find(a => a.name === name)!;
const prop = (id: string) => demo.snapshot().entities.find(e => e.id === demo.byId.get(id))!;
const unsupported = /\b(?:use_phone|make_call|answer_call|end_call|power_on|power_off|send_text)\b/;
const names = (kind: "available" | "known", who: number, target: number) =>
  (kind === "available" ? getAvailableAffordances : getKnownAffordances)(demo.sim.world, who, target).map(a => a.name);
function takePhone() {
  const mara = actor(), phone = prop("maras-phone");
  demo.dispatch(mara.key, "pickup", phone.key); demo.advance(6000);
  expect(getDirectContainer(demo.sim.world, phone.id)).toBe(mara.id);
  return { mara, phone, w: demo.sim.world };
}

test("held phone menus advertise only implemented commands, including perception and foreground", () => {
  const { mara, phone, w } = takePhone();
  for (const kind of ["available", "known"] as const) {
    const offered = names(kind, mara.id, phone.id);
    expect(offered).toEqual(expect.arrayContaining(["examine", "drop", "read_phone"]));
    expect(offered.join(" ")).not.toMatch(unsupported);
  }
  expect(formatActionsForPrompt(w, mara.id)).not.toMatch(unsupported);
  expect(generateStimuliForAgent(w, mara.id, []).filter(s => s.type === "affordances").map(s => s.content).join("\n")).not.toMatch(unsupported);
});

test("planner rejects unimplemented phone operations but retains pickup then private read", () => {
  const mara = actor(), phone = prop("maras-phone"), w = demo.sim.world;
  const plan = (content: string): GeneratedPlan => ({ goalDescription: "Check my phone", steps: [
    { description: "Pick up my phone", actionType: "pickup", target: phone.name },
    { description: "Use my phone", actionType: "interact", target: phone.name, content },
  ], estimatedCompletion: "short", potentialObstacles: [] });
  expect(validateGeneratedPlan(w, mara.id, "Check my phone", plan("read_phone"))).toMatchObject({ ok: true });
  for (const command of ["use_phone", "make_call", "power_off"]) {
    expect(validateGeneratedPlan(w, mara.id, "Check my phone", plan(command))).toMatchObject({ ok: false,
      issues: expect.arrayContaining([expect.stringContaining("invalid affordance command")]) });
  }
  expect(getDirectContainer(w, phone.id)).not.toBe(mara.id);
  expect(getPrivateCommunications(w, mara.id)).toEqual([]);
});

test("known phone operations do not bypass possession, personal reading or private contents", () => {
  const mara = actor(), ivo = actor("Ivo"), phone = prop("maras-phone"), w = demo.sim.world;
  const message = demo.text(mara.key, "PRIVATE_CAPABILITY_BOUNDARY");
  expect(buildAvailableActionsContext(w, mara.id).objectAffordances).toContainEqual(expect.objectContaining({ action: "pickup", target: phone.name }));
  expect(names("available", mara.id, phone.id)).not.toContain("read_phone");
  expect(names("available", mara.id, phone.id)).not.toContain("reply");
  expect(getKnownAffordances(w, mara.id, phone.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "read_phone", opensEvidenceBoundary: true }),
    expect.objectContaining({ name: "reply", requiresFreshDecision: true }),
  ]));
  expect(JSON.stringify(getKnownAffordances(w, ivo.id, phone.id))).not.toContain("PRIVATE_CAPABILITY_BOUNDARY");
  takePhone();
  expect(names("available", mara.id, phone.id)).not.toContain("reply");
  expect(names("available", ivo.id, phone.id)).toEqual([]);
  demo.dispatch(mara.key, "interact", phone.key, "read_phone"); demo.advance(1200);
  expect(actor().messages.find(m => m.id === message)?.status).toBe("read");
  expect(names("available", mara.id, phone.id)).toContain("reply");
  expect(getPrivateCommunications(w, ivo.id)).toEqual([]);
  expect(getAgentWorldCapabilities(w, ivo.id)!.context()).not.toContain("PRIVATE_CAPABILITY_BOUNDARY");
  demo.dispatch(mara.key, "interact", phone.key, `reply {"replyTo":${message},"text":"Received."}`); demo.advance(2000);
  expect(actor().messages.filter(m => m.direction === "out").map(m => m.text)).toEqual(["Received."]);
});

test("native examination and real physical food/seating operations remain available", () => {
  const mara = actor(), w = demo.sim.world, snack = prop("apartment-snack"), chair = prop("apartment-chair");
  expect(names("available", mara.id, snack.id)).toEqual(expect.arrayContaining(["examine", "take", "eat"]));
  expect(names("available", mara.id, chair.id)).toEqual(expect.arrayContaining(["examine", "sit"]));
  // This package deliberately delegates inspection to native evidence handling.
  expect(getAgentWorldCapabilities(w, mara.id)!.execute({ type: "examine", target: snack.name })).toBe(false);
});
