import "dotenv/config";
import { createArgosServer } from "./server/argos-server";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set in .env");
  process.exit(1);
}

const server = createArgosServer(3000);
server.start();
