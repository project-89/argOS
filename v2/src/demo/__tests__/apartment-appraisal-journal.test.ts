import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../apartment-sitcom");
const { queueExperiencedEvent, runExperienceAppraisal } = await import("../../cognition/experience-appraisal");
const { Appearance } = await import("../../ecs/components");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");

test("real appraisal outcomes reach the episode journal, not rendered scenes", async () => {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid appraisal calls"));
  let t: Awaited<ReturnType<typeof ApartmentSitcom.create>> | undefined;
  try {
    t = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null }); await t.start();
    const world = t.sim.world, actor = t.ids.Elaine;
    world.meta.aiEnabled = true;
    const run = async (id: string) => {
      queueExperiencedEvent(world, actor, { id, channel: "test:phone", source: "Personally read text",
        content: "PRIVATE_RECEIPT_CONTENT", atSimMs: 0 });
      return runExperienceAppraisal(world, actor);
    };
    generate.mockResolvedValueOnce({ text: JSON.stringify({ innerThought: "PRIVATE_PROVIDER_INTERPRETATION" }) });
    expect(await run("read:current")).toMatchObject({ status: "admitted", integration: "current" });
    generate.mockImplementationOnce(async () => {
      Appearance.expression[actor] = "smiling";
      return { text: JSON.stringify({ innerThought: "OLDER_PRIVATE_INTERPRETATION" }) };
    });
    expect(await run("read:historical")).toMatchObject({ status: "admitted", integration: "historical_only" });
    generate.mockResolvedValueOnce({ text: "MALFORMED_PRIVATE_OUTPUT" });
    expect(await run("read:failed")).toMatchObject({ status: "failed", reason: "invalid_json" });
    const rows = t.snapshot().events.filter(e => e.kind === "experience_appraisal");
    expect(rows.map(e => e.appraisal?.status)).toEqual(["requested", "admitted", "requested", "admitted", "requested", "failed"]);
    expect(rows.every(e => e.visibility === "operator" && e.actor === "Elaine")).toBe(true);
    expect(rows[3].appraisal).toMatchObject({ integration: "historical_only", omittedUpdatesReason: "affect_changed" });
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_RECEIPT_CONTENT|PRIVATE_PROVIDER_INTERPRETATION|OLDER_PRIVATE_INTERPRETATION|MALFORMED_PRIVATE_OUTPUT/);
    expect(JSON.stringify(t.scenes())).not.toContain("experience_appraisal");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    t?.stop(); drainPendingStimuli(); jest.restoreAllMocks();
    if (key === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  }
});
