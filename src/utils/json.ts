export function parseJSON<T>(text: string): T {
  try {
    // Clean markdown JSON blocks if present
    const cleanText = text.replace(/```json\n|\n```/g, "").trim();
    return JSON.parse(cleanText) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error}`);
  }
}
