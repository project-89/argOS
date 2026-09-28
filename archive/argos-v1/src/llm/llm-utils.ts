import { logger } from "../utils/logger";

interface RetryOptions {
  maxRetries: number;
  delay: number;
  backoffMultiplier?: number;
  onError?: (error: any, attempt: number) => void;
}

/**
 * Generic retry wrapper for LLM calls
 */
export async function generateWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, delay, backoffMultiplier = 1.5, onError } = options;
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (onError) {
        onError(error, attempt);
      }
      
      if (attempt < maxRetries) {
        const waitTime = delay * Math.pow(backoffMultiplier, attempt - 1);
        logger.debug(`Retrying after ${waitTime}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

/**
 * Extract JSON from text that might contain markdown code blocks
 */
export function extractJSON(text: string): any {
  // Remove markdown code blocks
  const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Try to find JSON within the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to extract JSON from text: ${error}`);
  }
}

/**
 * Validate response against expected structure
 */
export function validateResponse<T>(
  response: any,
  requiredFields: string[]
): response is T {
  if (!response || typeof response !== "object") {
    return false;
  }
  
  return requiredFields.every(field => field in response);
}

/**
 * Clean and format LLM output
 */
export function cleanLLMOutput(text: string): string {
  return text
    .trim()
    .replace(/\n{3,}/g, "\n\n") // Replace multiple newlines with double
    .replace(/^\s*[-*]\s*$/gm, "") // Remove empty list items
    .replace(/\s+$/, ""); // Remove trailing whitespace
}