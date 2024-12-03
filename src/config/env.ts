import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find and load the root .env file
const rootEnvPath = join(__dirname, "../../.env");
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  console.warn(".env file not found at:", rootEnvPath);
}

// Export the API key using the correct environment variable name
export const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";

if (!GOOGLE_API_KEY) {
  console.warn(
    "GOOGLE_GENERATIVE_AI_API_KEY is not set in environment variables"
  );
}
