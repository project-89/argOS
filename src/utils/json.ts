export function parseJSON<T>(text: string): T {
  try {
    // Check size limit (500KB)
    const MAX_JSON_SIZE = 500 * 1024;
    if (text.length > MAX_JSON_SIZE) {
      throw new Error(`JSON text too large: ${text.length} bytes`);
    }

    // First cleanup pass - remove markdown and formatting
    let cleanText = text
      .replace(/```json\s*/g, "") // Remove json code block starts
      .replace(/```\s*/g, "") // Remove code block ends
      .replace(/~~~json\s*/g, "") // Alternative code block syntax
      .replace(/~~~/g, "")
      .replace(/^\s*```\s*$[\s\S]*?^\s*```\s*$/gm, "") // Remove entire code blocks if nested
      .split("\n")
      .map((line) =>
        line
          .replace(/^\[\d+\]\s+/, "") // Remove line number prefixes
          .replace(/^\/\/.*$/, "") // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//, "") // Remove multi-line comments
          .trim()
      )
      .filter((line) => line.length > 0) // Remove empty lines
      .join("\n")
      .trim();

    try {
      return JSON.parse(cleanText) as T;
    } catch (error) {
      // Second cleanup pass - try to extract and fix JSON content
      const jsonStart = cleanText.indexOf("{");
      const jsonEnd = cleanText.lastIndexOf("}");

      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleanText = cleanText.slice(jsonStart, jsonEnd + 1);

        // Fix common JSON issues
        const fixedJson = cleanText
          .replace(/,(\s*[}\]])/g, "$1") // Fix trailing commas
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Fix missing quotes on property names
          .replace(/:\s*'([^']*?)'/g, ':"$1"') // Replace single quotes with double quotes
          .replace(/:\s*`([^`]*?)`/g, ':"$1"') // Replace backticks with double quotes
          .replace(/[\x00-\x1F\x7F-\x9F]/g, "") // Remove control chars
          .replace(/,\s*([}\]])/g, "$1") // Remove trailing commas
          .replace(/\\'/g, "'") // Fix escaped single quotes
          .replace(/\\"/g, '"') // Fix escaped double quotes
          .replace(/\\\\/g, "\\") // Fix double escaped backslashes
          .replace(/"\s*\n\s*([^"]*?)\s*\n\s*"/g, '"$1"') // Fix multiline strings
          .replace(/\n/g, " "); // Convert newlines to spaces in values

        try {
          return JSON.parse(fixedJson) as T;
        } catch (e) {
          // If still invalid, try to balance braces
          const balancedJson = balanceJsonBraces(fixedJson);
          try {
            return JSON.parse(balancedJson) as T;
          } catch (e2) {
            // Fall through to error handling
          }
        }
      }

      // If all parsing attempts fail, log details and return a type-appropriate default
      console.error("Failed to parse JSON:", {
        original: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
        cleaned:
          cleanText.slice(0, 200) + (cleanText.length > 200 ? "..." : ""),
        error: error instanceof Error ? error.message : String(error),
      });

      return createDefaultResponse<T>(text);
    }
  } catch (error) {
    console.error(
      "JSON parsing error:",
      error instanceof Error ? error.message : String(error)
    );
    return createDefaultResponse<T>(text);
  }
}

function balanceJsonBraces(json: string): string {
  const stack: string[] = [];
  let balanced = "";

  // First pass: count opening braces and build balanced portion
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === "{" || char === "[") {
      stack.push(char);
      balanced += char;
    } else if (char === "}" || char === "]") {
      if (stack.length > 0) {
        const last = stack.pop()!;
        if ((last === "{" && char === "}") || (last === "[" && char === "]")) {
          balanced += char;
        }
      }
    } else {
      balanced += char;
    }
  }

  // Second pass: close any remaining open braces
  while (stack.length > 0) {
    const last = stack.pop()!;
    balanced += last === "{" ? "}" : "]";
  }

  return balanced;
}

function createDefaultResponse<T>(text: string): T {
  // Detect the type of response needed based on content
  if (text.includes("perception") || text.includes("observation")) {
    return {
      summary: "Error processing perception",
      significance: "none",
      relatedThoughts: [],
      analysis: {
        keyObservations: [],
        potentialImplications: [],
        suggestedFocus: "Continue normal operation",
        goalRelevance: {
          affectedGoals: [],
          opportunities: [],
          challenges: [],
        },
      },
    } as T;
  }

  if (text.includes("task") && text.includes("complete")) {
    return {
      evaluation: {
        complete: false,
        failed: false,
        reason: "Error parsing task evaluation response",
      },
    } as T;
  }

  if (text.includes("goal") || text.includes("plan")) {
    return {
      analysis: {
        significant_change: false,
        changes: [],
        recommendation: "maintain_goals",
        reasoning: ["Error parsing goal/plan analysis"],
      },
    } as T;
  }

  // Generic fallback
  return {
    error: true,
    message: "Failed to parse response",
    timestamp: Date.now(),
  } as T;
}
