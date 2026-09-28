import { Action, ActionComponent } from "./Action";
import { ActionMemory, ActionMemoryComponent } from "./ActionMemory";
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
import { WorkingMemory, WorkingMemoryComponent } from "./WorkingMemory";
import { ProcessingState, ProcessingStateComponent } from "./ProcessingState";
import { Thought, ThoughtComponent } from "./Thought";
import { ReasoningContext, ReasoningContextComponent } from "./ReasoningContext";
import { Attention, AttentionComponent } from "./Attention";

// Export createComponent function
export { createComponent } from "./createComponent";

// Export all components
export * from "./Action";
export * from "./ActionMemory";
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
export * from "./WorkingMemory";
export * from "./ProcessingState";
export * from "./Thought";
export * from "./ReasoningContext";
export * from "./Attention";
// Central array of all component definitions
export const ALL_COMPONENTS = [
  ActionComponent,
  ActionMemoryComponent,
  AgentComponent,
  AppearanceComponent,
  GoalComponent,
  PerceptionComponent,
  PlanComponent,
  RecentActionsComponent,
  RoomComponent,
  StimulusComponent,
  CleanupComponent,
  WorkingMemoryComponent,
  ProcessingStateComponent,
  ThoughtComponent,
  ReasoningContextComponent,
  AttentionComponent,
] as const;

// Export the actual component instances for direct use
export {
  Action,
  ActionMemory,
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
  WorkingMemory,
  ProcessingState,
  Thought,
  ReasoningContext,
  Attention,
};
