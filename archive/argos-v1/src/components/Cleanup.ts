import { createComponent } from "./createComponent";
import { z } from "zod";

// Simple schema with no data - just used as a tag
export const CleanupSchema = z.object({});

export const CleanupComponent = createComponent("Cleanup", CleanupSchema, {});

export const Cleanup = CleanupComponent.component;
