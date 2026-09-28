import { z } from "zod";
import { MAX_JSON_ENVELOPE_CHARS, parseJSONEnvelope, summarizeSchemaIssues } from "../json-envelope";

const value = { innerThought: "I need a moment.", affectUpdate: { feeling: "uncertain" } };
const json = JSON.stringify(value);

test.each([json, ` \n\t${json}\r\n `])("accepts the whole bare JSON response and counts original characters", input => {
  expect(parseJSONEnvelope(input)).toEqual({ success: true, value, format: "bare", responseChars: input.length });
});

test.each([`\`\`\`json\n${json}\n\`\`\``, `\`\`\`\n${json}\n\`\`\``, ` \n\`\`\`JSON  \r\n${json}\r\n  \`\`\` \n`])(
  "accepts exactly one whole standard JSON or unlabelled multiline fence", input => {
    expect(parseJSONEnvelope(input)).toEqual({ success: true, value, format: "fenced", responseChars: input.length });
  });

test("preserves quoted braces, escapes, fence markers, Unicode and newline characters inside JSON strings", () => {
  const content = { innerThought: "Someone wrote ```json and a } brace; I said \"no\".\nStill here. 雨 🌧️", path: "C:\\tmp\\file" };
  const input = `\`\`\`json\n${JSON.stringify(content)}\n\`\`\``;
  expect(parseJSONEnvelope(input)).toMatchObject({ success: true, value: content });
});

test.each([`Here is the response: ${json}`, `${json}\nI hope this helps.`, `${json}\n${json}`,
  `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
  `A preface\n\`\`\`json\n${json}\n\`\`\``, `\`\`\`json\n${json}\n\`\`\`\nA suffix`,
  `\`\`\`json\n${json}\n${json}\n\`\`\``, `\`\`\`json\n\`\`\`json\n${json}\n\`\`\`\n\`\`\``])(
  "rejects prose, multiple values/blocks, and nested envelopes without picking a useful-looking object", input => {
    expect(parseJSONEnvelope(input).success).toBe(false);
  });

test.each([`\`\`\`javascript\n${json}\n\`\`\``, `\`\`\`json5\n${json}\n\`\`\``,
  `\`\`\`json ${json}\`\`\``, `\`\`\`json\n${json}`, `\`\`\`json\n${json}\n\`\`\`\``,
  `\`\`\`json\n${json}\n\`\`\` // comment`])("rejects nonstandard or incomplete fences", input => {
    expect(parseJSONEnvelope(input)).toMatchObject({ success: false, code: "invalid_fence", format: "fenced" });
  });

test.each(["", "   ", '{"innerThought": "unfinished', '{"innerThought":"Hi",}', "{'innerThought':'Hi'}",
  `/* comment */ ${json}`, '{"innerThought":NaN}', '{"innerThought":undefined}',
  `\`\`\`json\n{"innerThought":"bad",}\n\`\`\``])("never repairs invalid JSON", input => {
    expect(parseJSONEnvelope(input)).toMatchObject({ success: false, code: "invalid_json" });
  });

test.each(["null", "[]", "42", "true", '"plain string"'])("valid non-object JSON reaches strict schema validation instead of being misclassified as syntax failure", input => {
  const result = parseJSONEnvelope(input); expect(result).toMatchObject({ success: true, value: JSON.parse(input) });
  if (result.success) expect(z.object({ innerThought: z.string() }).strict().safeParse(result.value).success).toBe(false);
});

test("format tolerance does not coerce null optional updates or remove unexpected action fields", () => {
  const schema = z.object({ innerThought: z.string(), affectUpdate: z.object({ feeling: z.string() }).strict().optional() }).strict();
  for (const invalid of [{ innerThought: "Hi", affectUpdate: null }, { innerThought: "Hi", action: { type: "speak" } }]) {
    const parsed = parseJSONEnvelope(`\`\`\`json\n${JSON.stringify(invalid)}\n\`\`\``);
    expect(parsed.success).toBe(true);
    if (parsed.success) { expect(parsed.value).toEqual(invalid); expect(schema.safeParse(parsed.value).success).toBe(false); }
  }
});

test("JSON fields named __proto__ stay inert data", () => {
  const result = parseJSONEnvelope('{"__proto__":{"polluted":"private"},"innerThought":"Hi"}');
  expect(result.success).toBe(true); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  if (result.success) expect(Object.hasOwn(result.value as object, "__proto__")).toBe(true);
});

test("rejects oversized or non-text input before coercion/parsing and never returns exception text", () => {
  const input = " ".repeat(MAX_JSON_ENVELOPE_CHARS) + json;
  expect(parseJSONEnvelope(input)).toEqual({ success: false, code: "too_large", responseChars: input.length });
  const atLimit = json + " ".repeat(MAX_JSON_ENVELOPE_CHARS - json.length);
  expect(parseJSONEnvelope(atLimit)).toMatchObject({ success: true, value });
  const hostile = { toString: () => { throw new Error("must not coerce PRIVATE"); } };
  for (const input of [undefined, null, 123, [], hostile]) expect(parseJSONEnvelope(input)).toEqual({ success: false, code: "not_text", responseChars: 0 });
  const invalid = parseJSONEnvelope('{"innerThought":PRIVATE_MESSAGE_TEXT}');
  expect(invalid).toMatchObject({ success: false, code: "invalid_json" }); expect(JSON.stringify(invalid)).not.toContain("PRIVATE");
});

test("schema diagnostics report only allowlisted paths and structural codes, never sensitive values/messages/keys", () => {
  const schema = z.object({ innerThought: z.string().max(5), affectUpdate: z.object({ expression: z.enum(["composed", "smiling"]) }).strict() }).strict();
  const parsed = schema.safeParse({ innerThought: "PRIVATE_THOUGHT", affectUpdate: { expression: "PRIVATE_FACE_VALUE" }, PRIVATE_EXTRA_KEY: "PRIVATE_EXTRA_VALUE" });
  expect(parsed.success).toBe(false); if (parsed.success) throw new Error("Expected invalid schema");
  const result = summarizeSchemaIssues(parsed.error.issues, ["innerThought", "affectUpdate", "affectUpdate.expression"]);
  expect(result).toEqual([{ path: "innerThought", code: "too_big" }, { path: "affectUpdate.expression", code: "invalid_enum_value" }, { path: "$", code: "unrecognized_keys" }]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(Object.isFrozen(result)).toBe(true);
  expect(result.every(Object.isFrozen)).toBe(true);
});

test("unknown diagnostic fields and codes are redacted, bounded to eight, with no nested issue traversal", () => {
  const issues = [{ path: ["PRIVATE_FIELD"], code: "PRIVATE_CODE", message: "PRIVATE_MESSAGE" },
    { path: ["affectUpdate", "PRIVATE_FIELD"], code: "invalid_type", received: "PRIVATE_VALUE" },
    { path: ["affectUpdate", 0], code: "custom" },
    { path: [], code: "invalid_union", unionErrors: ["PRIVATE_NESTED_ERROR"] }, null, 42,
    ...Array.from({ length: 10 }, () => ({ path: ["innerThought"], code: "too_big" }))];
  const result = summarizeSchemaIssues(issues, ["innerThought", "affectUpdate"]);
  expect(result).toHaveLength(8); expect(result.slice(0, 4)).toEqual([
    { path: "$", code: "invalid_schema" }, { path: "$", code: "invalid_type" }, { path: "$", code: "custom" }, { path: "$", code: "invalid_union" },
  ]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(summarizeSchemaIssues(undefined, [])).toEqual([]);
});
