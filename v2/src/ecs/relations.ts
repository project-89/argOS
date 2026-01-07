import { createRelation, withAutoRemoveSubject, makeExclusive, withStore } from "bitecs";

export const ChildOf = createRelation(withAutoRemoveSubject);

export const OccupiesRoom = createRelation(makeExclusive);

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

export const AllRelations = {
  ChildOf,
  OccupiesRoom,
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
};

export type RelationName = keyof typeof AllRelations;
