import express from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import { createWorld } from "bitecs";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { ClientMessage, ServerMessage } from "../types";
import { logger } from "../utils/logger";

const app = express();
app.use(cors());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Create world and runtime
const world = createWorld();
const runtime = new SimulationRuntime(world);

// Set up initial scenario with single agent
const { agentEntity, roomEntity } = setupSingleAgent(runtime);

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
    type: "WORLD_STATE",
    data: state,
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

runtime.on("error", (error) => {
  broadcast({
    type: "ERROR",
    data: { message: error.message },
    timestamp: Date.now(),
  });
});

// WebSocket connection handling
wss.on("connection", (ws) => {
  clients.add(ws);
  logger.system("Client connected");

  // Send initial state
  ws.send(
    JSON.stringify({
      type: "SYSTEM_STATE",
      data: {
        isRunning: runtime.running,
        agents: runtime.getWorldState().agents,
        rooms: runtime.getWorldState().rooms,
      },
      timestamp: Date.now(),
    })
  );

  ws.on("message", async (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "CHAT":
          // Handle chat messages
          if (message.data.target) {
            // Direct message to agent
            logger.system(
              `Message to ${message.data.target}: ${message.data.message}`
            );
            // TODO: Route message to specific agent
          } else {
            // Message to room
            logger.system(`Message to main room: ${message.data.message}`);
            // TODO: Route message to room
          }
          break;

        case "START":
          runtime.start();
          break;
        case "STOP":
          runtime.stop();
          break;
        case "RESET":
          runtime.reset();
          setupSingleAgent(runtime);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.system(`Server running on port ${PORT}`);
});
