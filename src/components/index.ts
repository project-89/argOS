import { Action, ActionComponent } from "./Action";
import { Cleanup, CleanupComponent } from "./Cleanup";
import { Agent, AgentComponent } from "./Agent";
import { Appearance, AppearanceComponent } from "./Appearance";
import { Goal, GoalComponent } from "./Goals";
import { Memory } from "./Memory";
import { Perception, PerceptionComponent } from "./Perception";
import { Plan, PlanComponent } from "./Plans";
import { RecentActions, RecentActionsComponent } from "./RecentActions";
import { Room, RoomComponent } from "./Room";
import { Stimulus, StimulusComponent } from "./Stimulus";

// Export all components
export * from "./Action";
export * from "./Agent";
export * from "./Appearance";
export * from "./Goals";
export * from "./Memory";
export * from "./Perception";
export * from "./Plans";
export * from "./RecentActions";
export * from "./Room";
export * from "./Stimulus";
export * from "./Cleanup";
// Central array of all component definitions
export const ALL_COMPONENTS = [
  ActionComponent,
  AgentComponent,
  AppearanceComponent,
  GoalComponent,
  PerceptionComponent,
  PlanComponent,
  RecentActionsComponent,
  RoomComponent,
  StimulusComponent,
  CleanupComponent,
] as const;

// Export the actual component instances for direct use
export {
  Action,
  Agent,
  Appearance,
  Goal,
  Memory,
  Perception,
  Plan,
  RecentActions,
  Room,
  Stimulus,
  Cleanup,
};
