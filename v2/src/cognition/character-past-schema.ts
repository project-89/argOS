/** Creation data, not an action script. Author-only provenance never becomes
 * another character's knowledge or evidence that an event happened this run. */
import { z } from "zod/v3";
const prose = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u001f\u007f]/u.test(s));
export const identityMeaningSchema = z.object({
  selfBelief: prose(300), meaning: prose(500), cues: z.array(prose(60)).min(1).max(8),
}).strict();
export const formativeOriginSchema = z.object({ period: prose(100),
  provenance: z.enum(["authored-history", "uncertain-recollection", "implanted"]).default("authored-history"),
}).strict();
export const characterPastSchema = z.object({
  background: prose(2000),
  drives: z.array(prose(180)).min(1).max(6),
  memories: z.array(z.object({
    recollection: prose(1200), emotionalTone: prose(80), importance: z.number().finite().min(0).max(1),
    ...identityMeaningSchema.shape, ...formativeOriginSchema.shape,
  }).strict()).min(1).max(6),
}).strict();
export type CharacterPast = z.infer<typeof characterPastSchema>;
export const narrativeIdentitySchema = z.object({
  anchorId: prose(160), ...identityMeaningSchema.shape,
  emotionalTone: prose(80).optional(),
  origin: formativeOriginSchema.optional(),
  revises: prose(160).optional(),
}).strict();
export type NarrativeIdentity = z.infer<typeof narrativeIdentitySchema>;
export const identityRevisionSchema = z.object({ anchorId: prose(160), ...identityMeaningSchema.shape }).strict();
export type IdentityRevision = z.infer<typeof identityRevisionSchema>;
