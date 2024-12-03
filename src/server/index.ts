import express from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { ClientMessage, ServerMessage } from "../types";
import { logger } from "../utils/logger";

const app = express();
app.use(cors());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Set up initial scenario with single agent
const { runtime, agentEntity, roomEntity } = setupSingleAgent();

// Track connected clients
const clients = new Set<WebSocket>();

// Broadcast to all clients
function broadcast(message: ServerMessage) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Handle runtime events
runtime.on("worldState", (state) => {
  broadcast({
    type: "SYSTEM_STATE",
    data: {
      ...state,
      isRunning: runtime.isRunning,
    },
    timestamp: Date.now(),
  });
});

runtime.on("log", (category, data) => {
  broadcast({
    type: "LOG",
    category,
    data,
    timestamp: Date.now(),
  });
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  clients.add(ws);
  logger.system("Client connected");

  // Send initial world state
  ws.send(
    JSON.stringify({
      type: "SYSTEM_STATE",
      data: {
        ...runtime.getWorldState(),
        isRunning: runtime.isRunning,
      },
      timestamp: Date.now(),
    })
  );

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      switch (message.type) {
        case "CHAT":
          // Handle chat messages
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
