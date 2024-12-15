import { z } from "zod";
import { createComponent } from "./createComponent";

// Room type enum
export const RoomTypeEnum = z.enum([
  "physical",
  "discord",
  "twitter",
  "private",
  "astral",
]);
export type RoomType = z.infer<typeof RoomTypeEnum>;

// Room schema and component
export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: RoomTypeEnum,
});

export type RoomComponentType = z.infer<typeof RoomSchema>;

export const RoomComponent = createComponent("Room", RoomSchema, {
  id: [] as string[],
  name: [] as string[],
  description: [] as string[],
  type: [] as RoomType[],
});

export const Room = RoomComponent.component;
