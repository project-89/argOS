/**
 * Model Configuration — Official Google Generative AI SDK.
 *
 * Three-tier hierarchy:
 *   Runtime (Flash Lite)  — cheap, fast, executes compiled plans + fills templates
 *   Reasoning (Flash)     — handles escalation, deeper thinking
 *   Teacher (Pro)         — periodic deep analysis, plan recompilation
 *
 * Using @google/genai (official SDK) for direct access to:
 *   - Structured outputs (responseSchema)
 *   - Thinking (thinkingConfig)
 *   - Caching (cachedContent)
 *   - Flex inference (lower cost for batch)
 */

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";

export const ai = new GoogleGenAI({ apiKey });

// Model names
export const RUNTIME_MODEL = "gemini-3.1-flash-lite-preview";
export const REASONING_MODEL = "gemini-3-flash-preview";
export const TEACHER_MODEL = "gemini-3.1-pro-preview";
