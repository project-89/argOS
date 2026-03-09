import { validateSystemCode, type SystemDesignDoc } from "../../god/system-baker";

function designWith(modifiedComponents: string[]): SystemDesignDoc {
  return {
    name: "TestSystem",
    purpose: "Validation test",
    inputs: ["Agent", "Mind"],
    modifiedComponents,
    outputs: [],
    pseudocode: "test",
    frequency: 5000,
  };
}

describe("validateSystemCode", () => {
  it("accepts Goal modifications through cognitive helper APIs", () => {
    const code = `
      const agents = Array.from(ctx.query(world, [Agent]));
      for (const eid of agents) {
        ctx.cognitive.createGoal(world, eid, {
          description: "Find food",
          priority: 7,
          status: "active"
        });
      }
    `;

    const result = validateSystemCode(code, designWith(["Goal"]));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("still flags missing writes when a declared component is untouched", () => {
    const code = `
      const agents = Array.from(ctx.query(world, [Agent, Mind]));
      for (const eid of agents) {
        Mind.focus[eid] = "idle";
      }
    `;

    const result = validateSystemCode(code, designWith(["Needs"]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("Needs"))).toBe(true);
  });
});

