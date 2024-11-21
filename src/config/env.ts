import { config } from "dotenv";
import { join } from "path";

// Load environment variables from .env file
config({ path: join(process.cwd(), ".env") });

// Validate required environment variables
const requiredEnvVars = ["GOOGLE_GENERATIVE_AI_API_KEY"] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Export typed environment variables
export const env = {
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
} as const;
