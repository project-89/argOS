import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { ClientMessage } from "../types";
import { logger } from "../utils/logger";

// Validate required environment variables
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error(
    "GOOGLE_GENERATIVE_AI_API_KEY is required but not set in environment variables"
  );
}

const app = express();
app.use(cors());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Set up initial scenario with single agent
const { runtime, agentEntity, roomEntity } = setupSingleAgent();

// Track connected clients
const clients = new Set<WebSocket>();

// Handle WebSocket connections
wss.on("connection", (ws) => {
  clients.add(ws);
  logger.system("Client connected");

  // Send initial world state
  const worldState = runtime.getWorldState();
  ws.send(
    JSON.stringify({
      type: "WORLD_STATE",
      data: worldState,
      timestamp: Date.now(),
    })
  );

  // Handle client messages
  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      switch (message.type) {
        case "CHAT":
          // TODO: Handle chat messages
          break;
        case "START":
          runtime.start();
          break;
        case "STOP":
          runtime.stop();
          break;
        case "RESET":
          runtime.reset();
          break;
      }
    } catch (error) {
      logger.error(`Error processing message: ${error}`);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    logger.system("Client disconnected");
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  logger.system(`Server running on port ${port}`);
});
