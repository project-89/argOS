import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import { setupSingleAgent } from "../examples/single-agent-setup";
import type {
  ClientMessage,
  ServerMessage,
  AgentStateMessage,
  RoomStateMessage,
} from "../types";
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

// Track connected clients and their subscriptions
const clients = new Set<WebSocket>();
const roomSubscriptions = new Map<string, Set<WebSocket>>();
const agentSubscriptions = new Map<string, Set<WebSocket>>();

// Add helper function
function findRoomEntity(runtime: any, roomId: string): number | undefined {
  const world = runtime.getWorld();
  const rooms = runtime.getRooms();
  return rooms.find(
    (room: { id: string; entity: number }) => room.id === roomId
  )?.entity;
}

// Handle WebSocket connections
wss.on("connection", (ws) => {
  clients.add(ws);
  logger.system("Client connected");

  // Send initial world state
  const worldState = runtime.getWorldState();
  const worldStateMessage: ServerMessage = {
    type: "WORLD_STATE",
    data: worldState,
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(worldStateMessage));

  // Handle client messages
  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      switch (message.type) {
        case "SUBSCRIBE_ROOM": {
          const { roomId } = message;
          if (!roomId) break;
          const roomEntity = findRoomEntity(runtime, roomId);
          if (!roomEntity) break;

          if (!roomSubscriptions.has(roomId)) {
            roomSubscriptions.set(roomId, new Set());
            runtime.subscribeToRoom(roomEntity, (roomEvent) => {
              const roomStateMessage: RoomStateMessage = {
                type: "ROOM_STATE",
                data: {
                  roomId,
                  event: roomEvent,
                },
                timestamp: Date.now(),
              };
              roomSubscriptions.get(roomId)?.forEach((client) => {
                client.send(JSON.stringify(roomStateMessage));
              });
            });
          }
          roomSubscriptions.get(roomId)?.add(ws);
          break;
        }

        case "UNSUBSCRIBE_ROOM": {
          const { roomId } = message;
          if (!roomId) break;
          roomSubscriptions.get(roomId)?.delete(ws);
          break;
        }

        case "SUBSCRIBE_AGENT": {
          const { agentId } = message;
          if (!agentId) break;
          if (!agentSubscriptions.has(agentId)) {
            agentSubscriptions.set(agentId, new Set());
            runtime.subscribeToAgent(Number(agentId), (agentEvent) => {
              const agentStateMessage: AgentStateMessage = {
                type: "AGENT_STATE",
                data: {
                  agentId,
                  agentName: agentEvent.agentName,
                  category: agentEvent.category,
                  appearance: agentEvent.appearance,
                  thought: agentEvent.thought,
                  action: agentEvent.action,
                },
                timestamp: Date.now(),
              };
              agentSubscriptions.get(agentId)?.forEach((client) => {
                client.send(JSON.stringify(agentStateMessage));
              });
            });
          }
          agentSubscriptions.get(agentId)?.add(ws);
          break;
        }

        case "UNSUBSCRIBE_AGENT": {
          const { agentId } = message;
          if (!agentId) break;
          agentSubscriptions.get(agentId)?.delete(ws);
          break;
        }

        case "CHAT":
          // TODO: Handle chat messages with proper typing
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
    // Clean up subscriptions
    for (const [roomId, subscribers] of roomSubscriptions) {
      subscribers.delete(ws);
    }
    for (const [agentId, subscribers] of agentSubscriptions) {
      subscribers.delete(ws);
    }
    clients.delete(ws);
    logger.system("Client disconnected");
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  logger.system(`Server running on port ${port}`);
});
