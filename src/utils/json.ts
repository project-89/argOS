export function parseJSON<T>(text: string): T {
  try {
    // Clean markdown JSON blocks if present
    let cleanText = text.replace(/```json\n|\n```/g, "").trim();

    // Find the first { and last } to extract just the JSON object
    const start = cleanText.indexOf("{");
    const end = cleanText.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) {
      cleanText = cleanText.slice(start, end);
    }

    return JSON.parse(cleanText) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error}`);
  }
}
