/** Parse one complete response envelope, not the first plausible object hidden
 * inside it. Format tolerance never repairs JSON or relaxes a caller's schema. */
export const MAX_JSON_ENVELOPE_CHARS = 32_768;
export type JSONEnvelopeFormat = "bare" | "fenced";
export type JSONEnvelopeFailureCode = "not_text" | "too_large" | "invalid_fence" | "invalid_json";
export type JSONEnvelopeResult =
  | { readonly success: true; readonly value: unknown; readonly format: JSONEnvelopeFormat; readonly responseChars: number }
  | { readonly success: false; readonly code: JSONEnvelopeFailureCode; readonly format?: JSONEnvelopeFormat; readonly responseChars: number };

/** Accept bare JSON or exactly one whole multiline ```json / ``` envelope.
 * Surrounding whitespace is allowed; prose, extra blocks, alternative languages,
 * comments, trailing commas and incomplete responses are not. Scalars/arrays
 * remain valid JSON here: the caller's strict schema decides their admissibility.
 * No error object/message is returned: JSON.parse errors can quote private text. */
export function parseJSONEnvelope(input: unknown): JSONEnvelopeResult {
  if (typeof input !== "string") return { success: false, code: "not_text", responseChars: 0 };
  const responseChars = input.length;
  if (responseChars > MAX_JSON_ENVELOPE_CHARS) return { success: false, code: "too_large", responseChars };
  let text = input.trim();
  let format: JSONEnvelopeFormat = "bare";
  if (text.startsWith("```")) {
    format = "fenced";
    const envelope = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*```$/i.exec(text);
    if (!envelope) return { success: false, code: "invalid_fence", format, responseChars };
    text = envelope[1];
  }
  try { return { success: true, value: JSON.parse(text), format, responseChars }; }
  catch { return { success: false, code: "invalid_json", format, responseChars }; }
}

const SCHEMA_ISSUE_CODES = ["invalid_type", "invalid_literal", "custom", "invalid_union", "invalid_union_discriminator",
  "invalid_enum_value", "unrecognized_keys", "invalid_arguments", "invalid_return_type", "invalid_date", "invalid_string",
  "too_small", "too_big", "invalid_intersection_types", "not_multiple_of", "not_finite"] as const;
export interface SchemaIssueDiagnostic {
  /** An exact caller-allowlisted schema field path, or "$" for root/unknown. */
  readonly path: string;
  readonly code: (typeof SCHEMA_ISSUE_CODES)[number] | "invalid_schema";
}
/** Redact validation details to bounded, structural diagnostics. In particular,
 * Zod messages, received enum values and unrecognized property names may contain
 * private model output. Never log the original error/issue alongside this list.
 * allowedPaths must be static schema paths supplied by the caller, not output. */
export function summarizeSchemaIssues(issues: unknown, allowedPaths: readonly string[]): readonly SchemaIssueDiagnostic[] {
  if (!Array.isArray(issues)) return [];
  const paths = new Set(allowedPaths), codes = new Set<string>(SCHEMA_ISSUE_CODES);
  return Object.freeze(issues.slice(0, 8).map(issue => {
    const item = issue && typeof issue === "object" ? issue as { path?: unknown; code?: unknown } : {};
    const path = Array.isArray(item.path) && item.path.every(part => typeof part === "string") ? item.path.join(".") : "";
    return Object.freeze({ path: path && paths.has(path) ? path : "$",
      code: typeof item.code === "string" && codes.has(item.code) ? item.code as SchemaIssueDiagnostic["code"] : "invalid_schema" as const });
  }));
}
