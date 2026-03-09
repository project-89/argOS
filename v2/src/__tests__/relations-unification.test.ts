import { AdjacentTo, ContainedIn, OccupiedBy, OnTopOf, OwnedBy } from "../world/schema";
import { AllRelations, LocatedIn } from "../ecs/relations";

describe("schema relations are backed by ECS relations", () => {
  test("WorldSchema relation exports point at AllRelations", () => {
    expect(OnTopOf).toBe(AllRelations.OnTopOf);
    expect(OccupiedBy).toBe(AllRelations.OccupiedBy);
    expect(OwnedBy).toBe(AllRelations.OwnedBy);
    expect(AdjacentTo).toBe(AllRelations.AdjacentTo);
  });

  test("ContainedIn is a legacy alias of LocatedIn", () => {
    expect(ContainedIn).toBe(LocatedIn);
    expect(AllRelations.ContainedIn).toBe(LocatedIn);
  });
});

