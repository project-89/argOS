export function parseJSON<T>(text: string): T {
  try {
    // Check size limit (500KB)
    const MAX_JSON_SIZE = 500 * 1024;
    if (text.length > MAX_JSON_SIZE) {
      throw new Error(`JSON text too large: ${text.length} bytes`);
    }

    // First try: Just remove code blocks and try parsing
    let cleanText = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    try {
      return JSON.parse(cleanText) as T;
    } catch (initialError) {
      // If basic cleanup fails, try more aggressive fixes
      cleanText = cleanText
        .split("\n")
        .map((line) => line.replace(/^\[\d+\]\s+/, "")) // Remove line numbers
        .join("\n");

      // Extract JSON content - look for the largest valid JSON object
      const jsonMatches = cleanText.match(/{[\s\S]*?}/g) || [];
      let largestValidJson = null;
      let maxLength = 0;

      for (const match of jsonMatches) {
        try {
          // Try to fix common JSON issues
          const fixedJson = match
            .replace(/,(\s*[}\]])/g, "$1") // Fix trailing commas
            .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Fix missing quotes
            .replace(/'/g, '"') // Fix single quotes
            .replace(/[\x00-\x1F\x7F-\x9F]/g, ""); // Remove control chars

          // Try to parse
          const parsed = JSON.parse(fixedJson);
          if (match.length > maxLength) {
            maxLength = match.length;
            largestValidJson = parsed;
          }
        } catch (e) {
          // Skip invalid JSON
          continue;
        }
      }

      if (largestValidJson) {
        return largestValidJson as T;
      }

      // If no valid JSON found, try to repair truncated JSON
      const lastBrace = cleanText.lastIndexOf("}");
      if (lastBrace !== -1) {
        const truncatedJson = cleanText.substring(0, lastBrace + 1);
        try {
          const fixedJson = truncatedJson
            .replace(/,(\s*[}\]])/g, "$1")
            .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
            .replace(/'/g, '"')
            .replace(/[\x00-\x1F\x7F-\x9F]/g, "");
          return JSON.parse(fixedJson) as T;
        } catch (e) {
          // Fall through to default
        }
      }

      throw new Error("No valid JSON object found");
    }
  } catch (error) {
    // Log the problematic text for debugging
    console.error("FAILED TO PARSE:", text.slice(0, 1000) + "...");
    console.error("Parse error:", error);

    // Return a safe default object based on the expected type
    return {
      analysis: {
        significant_change: false,
        changes: [],
        recommendation: "maintain_goals",
        reasoning: ["Error in parsing response"],
      },
    } as T;
  }
}
