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

      // Extract JSON content
      const jsonRegex = /{[\s\S]*}/;
      const match = cleanText.match(jsonRegex);

      if (!match) {
        throw new Error("No JSON object found");
      }

      let jsonText = match[0];

      // Fix common JSON issues
      jsonText = jsonText
        .replace(/,(\s*[}\]])/g, "$1") // Fix trailing commas
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Fix missing quotes
        .replace(/'/g, '"') // Fix single quotes
        .replace(/[\x00-\x1F\x7F-\x9F]/g, ""); // Remove control chars

      return JSON.parse(jsonText) as T;
    }
  } catch (error) {
    // Log the problematic text for debugging
    console.error("FAILED TO PARSE:", text.slice(0, 1000) + "...");
    console.error("Parse error:", error);

    // Return a safe default object
    return {
      plan: {
        id: `fallback-${Date.now()}`,
        steps: [
          {
            id: "fallback-step",
            description: "Fallback plan due to parsing error",
            status: "pending",
            expectedOutcome: "Recover from error state",
          },
        ],
        status: "active",
      },
    } as T;
  }
}
