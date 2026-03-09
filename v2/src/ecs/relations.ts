import { createRelation, withAutoRemoveSubject, makeExclusive, withStore } from "bitecs";

export const ChildOf = createRelation(withAutoRemoveSubject);

export const OccupiesRoom = createRelation(makeExclusive);

/**
 * Canonical containment/location relation.
 * Exclusive: an entity can be located in only one container at a time.
 */
export const LocatedIn = createRelation(withAutoRemoveSubject, makeExclusive);

// World/physical relations (used by WorldSchema + rendering)
export const OnTopOf = createRelation(withAutoRemoveSubject, makeExclusive);
export const OccupiedBy = createRelation(makeExclusive);
export const OwnedBy = createRelation(makeExclusive);
export const AdjacentTo = createRelation();

// Legacy alias (kept for compatibility with older schema/content).
export const ContainedIn = LocatedIn;

export const Knows = createRelation(
  withStore(() => ({
    familiarity: [] as number[],
    sentiment: [] as number[],
    lastInteraction: [] as number[],
  }))
);

export const RelatesTo = createRelation(
  withStore(() => ({
    type: [] as string[],
    weight: [] as number[],
    confidence: [] as number[],
  }))
);

export const Causes = createRelation(
  withStore(() => ({
    strength: [] as number[],
  }))
);

export const Supports = createRelation(
  withStore(() => ({
    strength: [] as number[],
  }))
);

export const Contradicts = createRelation(
  withStore(() => ({
    strength: [] as number[],
  }))
);

export const Contains = createRelation();

export const Perceives = createRelation(
  withStore(() => ({
    clarity: [] as number[],
    attention: [] as number[],
  }))
);

export const Targets = createRelation(makeExclusive);

export const BelongsTo = createRelation(withAutoRemoveSubject);

export const HasMemory = createRelation();

export const HasBelief = createRelation();

export const HasImpression = createRelation(
  withStore(() => ({
    sentiment: [] as number[],
    lastUpdated: [] as number[],
  }))
);

export const HasThought = createRelation();

export const HasPerception = createRelation();

export const HasConversation = createRelation();

export const HasGoal = createRelation();

export const HasPlan = createRelation();

export const HasToolResult = createRelation();

export const HasSchedule = createRelation(makeExclusive);

export const HasReflectionState = createRelation(makeExclusive);

// Optional non-location semantic relations (used by affordances/rules)
export const SittingOn = createRelation(makeExclusive);
export const SleepingOn = createRelation(makeExclusive);

export const AllRelations = {
  ChildOf,
  OccupiesRoom,
  LocatedIn,
  OnTopOf,
  OccupiedBy,
  OwnedBy,
  AdjacentTo,
  ContainedIn,
  Knows,
  RelatesTo,
  Causes,
  Supports,
  Contradicts,
  Contains,
  Perceives,
  Targets,
  BelongsTo,
  HasMemory,
  HasBelief,
  HasImpression,
  HasThought,
  HasPerception,
  HasConversation,
  HasGoal,
  HasPlan,
  HasToolResult,
  HasSchedule,
  HasReflectionState,
  SittingOn,
  SleepingOn,
};

export type RelationName = keyof typeof AllRelations;
