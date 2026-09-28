/** I/O contract for the existing personal-review lane. No world access, actions,
 * goal authority, or tolerant extraction of a plausible object from prose. */
import { z } from "zod";
import { NoObjectGeneratedError, JSONParseError, TypeValidationError } from "ai";
import { parseJSONEnvelope, summarizeSchemaIssues, type JSONEnvelopeFormat,
  type JSONEnvelopeFailureCode, type SchemaIssueDiagnostic } from "../llm/json-envelope";

const text = (max: number) => z.string().trim().min(1).max(max);
const followUp = z.object({ undertakingId: text(300), reviewAtSimMs: z.number().int().safe().nonnegative().optional(),
  reason: text(400).optional() }).strict().refine(value =>
  (value.reviewAtSimMs === undefined) === (value.reason === undefined), { path: ["reviewAtSimMs"] });
const intentionFields = { goal: text(300).min(3), motivation: text(400), priority: z.number().int().min(1).max(10) };
const socialIntention = z.object({ ...intentionFields, kind: z.literal("social"), followUp: followUp.optional() }).strict();
// A practical inquiry uses the existing exploratory lifecycle. It acquires no
// native success proof, direct action, or social-undertaking link authority.
const exploratoryIntention = z.object({ ...intentionFields, kind: z.literal("custom") }).strict();
const noGoal = z.object({ goal: z.null() }).strict();
export const personalReviewResponseSchema = z.union([noGoal, socialIntention, exploratoryIntention]);
export type PersonalReviewResponse = z.infer<typeof personalReviewResponseSchema>;
const PATHS = ["goal", "motivation", "priority", "kind", "followUp", "followUp.undertakingId", "followUp.reviewAtSimMs", "followUp.reason"];
export interface PersonalReviewOutputDiagnostic {
  responseChars?: number; outputFormat?: JSONEnvelopeFormat; parseCode?: JSONEnvelopeFailureCode;
  schemaIssues?: readonly SchemaIssueDiagnostic[];
  finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
}
export function personalReviewFinishReason(value: unknown): PersonalReviewOutputDiagnostic["finishReason"] {
  return typeof value === "string" && ["stop", "length", "content-filter", "tool-calls", "error", "other"].includes(value)
    ? value as PersonalReviewOutputDiagnostic["finishReason"] : undefined;
}
export function parsePersonalReviewResponse(raw: unknown):
  | { success: true; value: PersonalReviewResponse; metadata: PersonalReviewOutputDiagnostic }
  | { success: false; reason: "invalid_json" | "invalid_schema"; metadata: PersonalReviewOutputDiagnostic } {
  const envelope = parseJSONEnvelope(raw);
  const metadata: PersonalReviewOutputDiagnostic = { responseChars: envelope.responseChars,
    ...(envelope.format ? { outputFormat: envelope.format } : {}) };
  if (!envelope.success) return { success: false, reason: "invalid_json", metadata: { ...metadata, parseCode: envelope.code } };
  // Select only for clearer structural diagnostics; all alternatives remain
  // closed objects and cannot silently accept another branch's authority.
  const value = envelope.value;
  const branch = value && typeof value === "object" && "goal" in value && value.goal === null ? noGoal
    : value && typeof value === "object" && "kind" in value && value.kind === "custom" ? exploratoryIntention : socialIntention;
  const parsed = branch.safeParse(envelope.value);
  return parsed.success ? { success: true, value: parsed.data, metadata }
    : { success: false, reason: "invalid_schema", metadata: { ...metadata, schemaIssues: summarizeSchemaIssues(parsed.error.issues, PATHS) } };
}
/** The SDK may throw before returning text. Such errors contain private output,
 * validation values and provider metadata: inspect, but never log them. */
export function personalReviewOutputError(error: unknown): { reason: "invalid_json" | "invalid_schema";
  metadata: PersonalReviewOutputDiagnostic } | undefined {
  if (!NoObjectGeneratedError.isInstance(error)) return;
  const syntax = JSONParseError.isInstance(error.cause), schema = TypeValidationError.isInstance(error.cause);
  if (!syntax && !schema) return;
  const parsed = parsePersonalReviewResponse(error.text);
  return { reason: syntax ? "invalid_json" : "invalid_schema", metadata: {
    ...parsed.metadata, finishReason: personalReviewFinishReason(error.finishReason) } };
}
