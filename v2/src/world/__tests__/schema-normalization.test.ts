import { WorldSchema, type ObjectTypeDefinition } from "../schema";

describe("WorldSchema normalization", () => {
  it("adds decay states/transitions for edible types missing stale/rotten", () => {
    const schema = new WorldSchema();

    const def: ObjectTypeDefinition = {
      name: "apple",
      description: "A crisp apple",
      traits: ["edible", "takeable", "examinable"],
      states: {
        normal: {
          description: "A crisp apple.",
          stimuli: [{ type: "visual", template: "A crisp apple sits here", intensity: 0.4 }],
        },
      },
      defaultState: "normal",
      category: "consumable",
    };

    schema.defineObjectType(def);

    const stored = schema.getObjectType("apple");
    expect(stored).toBeDefined();
    expect(stored!.states.fresh).toBeDefined();
    expect(stored!.states.stale).toBeDefined();
    expect(stored!.states.rotten).toBeDefined();

    expect(stored!.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "fresh", to: "stale", trigger: "decay" }),
        expect.objectContaining({ from: "stale", to: "rotten", trigger: "decay" }),
      ])
    );
  });
});

