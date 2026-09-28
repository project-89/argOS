/** A contact is authored world data, not an instruction or an authority level. */
export interface PhoneContactProfile { name: string; relationship: string; context: string }

export const DEFAULT_PHONE_CONTACT: Readonly<PhoneContactProfile> = Object.freeze({
  name: "Unknown sender", relationship: "unknown", context: "",
});

/** Validate at the boundary; return a fresh value so callers cannot rewrite history. */
export function normalizePhoneContact(value: unknown): PhoneContactProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A phone contact is required.");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some(key => !["name", "relationship", "context"].includes(key)))
    throw new Error("Phone contacts contain only name, relationship and context.");
  const field = (name: string, min: number, max: number) => {
    const input = candidate[name];
    // Context is ordinary prose and may contain paragraphs; contact labels are
    // single-line. JSON serialization keeps line breaks inside their data field.
    const controlInput = typeof input === "string" && name === "context" ? input.replace(/[\n\r\t]/g, "") : input;
    if (typeof input !== "string" || typeof controlInput !== "string"
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(controlInput))
      throw new Error(`Invalid contact ${name}.`);
    const clean = input.replace(/\r\n?/g, "\n").trim();
    if (clean.length < min || clean.length > max) throw new Error(`Contact ${name} must have ${min}–${max} characters.`);
    return clean;
  };
  return { name: field("name", 1, 60), relationship: field("relationship", 1, 40), context: field("context", 0, 300) };
}
