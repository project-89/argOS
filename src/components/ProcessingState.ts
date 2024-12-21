import { z } from "zod";
import { createComponent } from "./createComponent";

export enum ProcessingMode {
  ACTIVE = "active",
  REFLECTIVE = "reflective",
  WAITING = "waiting",
}

export const ProcessingStateSchema = z.object({
  mode: z.nativeEnum(ProcessingMode),
  duration: z.number(),
  lastModeChange: z.number(),
});

export type ProcessingStateType = z.infer<typeof ProcessingStateSchema>;

export const ProcessingStateComponent = createComponent(
  "ProcessingState",
  ProcessingStateSchema,
  {
    mode: [],
    duration: [],
    lastModeChange: [],
  }
);

export const ProcessingState = ProcessingStateComponent.component;
