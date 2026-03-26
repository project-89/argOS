/**
 * Shared JSON extraction utility for LLM outputs.
 *
 * LLMs wrap JSON in markdown fences, explanatory prose, or trailing
 * commentary. A greedy regex like /\{[\s\S]*\}/ captures too much when
 * multiple JSON objects or stray braces appear in the output. The
 * balanced-brace approach below extracts the first syntactically valid
 * JSON object reliably.
 */

/**
 * Extract the first valid JSON object from LLM text output using
 * balanced brace matching. Returns the raw JSON string, or null if
 * no valid object is found.
 *
 * Handles:
 * - Markdown ```json fences
 * - Explanatory prose before/after the JSON
 * - Escaped characters inside strings
 * - Multiple JSON-like blocks (returns the first valid one)
 */
export function extractJSON(text: string): string | null {
  // Strip markdown code fences
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        // Validate that it actually parses
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // Brace-matched but not valid JSON -- keep scanning
          continue;
        }
      }
    }
  }

  // Fallback: greedy regex (last resort, may over-capture)
  const fallback = cleaned.match(/\{[\s\S]*\}/);
  if (fallback) {
    try {
      JSON.parse(fallback[0]);
      return fallback[0];
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Extract and parse the first JSON object from text.
 * Returns the parsed object, or null on failure.
 */
export function parseJSONFromText<T = any>(text: string): T | null {
  const raw = extractJSON(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Extract the first valid JSON array from LLM text output.
 * Useful for prompts that ask for array responses like ["fact1", "fact2"].
 */
export function extractJSONArray(text: string): string | null {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const start = cleaned.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          continue;
        }
      }
    }
  }

  // Fallback
  const fallback = cleaned.match(/\[[\s\S]*\]/);
  if (fallback) {
    try {
      JSON.parse(fallback[0]);
      return fallback[0];
    } catch {
      return null;
    }
  }

  return null;
}
