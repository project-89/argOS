import { WebSocketServer, WebSocket as WS } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventEmitter } from "./EventEmitter";
import {
  ServerMessage,
  ChatMessage,
  AgentUpdateMessage,
  RoomUpdateMessage,
} from "../types";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { Agent, Room } from "../components/agent/Agent";
import { createAuditoryStimulus } from "../utils/stimulus-utils";
import { World, removeEntity } from "bitecs";
import { logger } from "../utils/logger";
import { createUser, moveUserToRoom } from "../utils/agent-factory";
import { findRoomByStringId } from "../utils/queries";

// Track user connections with Map
const connectionUsers = new Map<
  WS,
  {
    entity: number;
    lastHeartbeat: number;
  }
>();

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 45000; // 45 seconds

// Helper to send message to a WebSocket client
const sendMessage = (ws: WS, message: ServerMessage) => {
  if (ws.readyState === WS.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

// Add cleanup helper function
async function cleanupUserConnection(ws: WS, userConn: { entity: number }) {
  logger.system(`Connection cleanup for user entity: ${userConn.entity}`);

  // First remove from tracking maps to prevent new operations
  activeUserEntities.delete(userConn.entity);
  connectionUsers.delete(ws);

  // Then cleanup event subscriptions
  eventEmitter.removeClient(ws);

  // Finally remove the entity and notify
  try {
    removeEntity(runtime.world, userConn.entity);
    // Wait a tick to ensure entity removal is processed
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.emitWorldState();
  } catch (error) {
    logger.error(`Error cleaning up user entity: ${error}`);
  }
}

// Clean up inactive users
async function cleanupInactiveUsers() {
  const now = Date.now();
  const cleanupPromises: Promise<void>[] = [];

  for (const [ws, userConn] of connectionUsers.entries()) {
    if (now - userConn.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      logger.system(`Cleaning up inactive user: ${userConn.entity}`);
      cleanupPromises.push(
        cleanupUserConnection(ws, userConn).then(() => {
          ws.close();
        })
      );
    }
  }

  await Promise.all(cleanupPromises);
}

// Start heartbeat interval
setInterval(cleanupInactiveUsers, HEARTBEAT_INTERVAL);

// Set up initial runtime and event emitter
let { runtime } = setupSingleAgent();
const eventEmitter = new EventEmitter();

// Track active user entities
const activeUserEntities = new Set<number>();

// Set up runtime event handlers
function setupRuntimeEventHandlers(runtime: SimulationRuntime) {
  runtime.onAgentUpdate((agentId, roomId, data) => {
    const stringRoomId = Room.id[roomId] || String(roomId);
    const stringAgentId = String(agentId);

    // Send agent updates only to direct agent subscribers
    wss.clients.forEach((client: WS) => {
      const subs = eventEmitter.getSubscriptions(client);
      if (
        subs?.has(`${stringRoomId}:${stringAgentId}`) &&
        client.readyState === WS.OPEN
      ) {
        // Send as AGENT_UPDATE to direct agent subscribers
        const message: AgentUpdateMessage = {
          type: "AGENT_UPDATE",
          channel: {
            room: stringRoomId,
            agent: stringAgentId,
          },
          data: data.data,
          timestamp: data.timestamp,
        };
        sendMessage(client, message);
      }
    });
  });

  runtime.onRoomUpdate((roomId, data) => {
    // Send room events to room subscribers
    wss.clients.forEach((client: WS) => {
      const subs = eventEmitter.getSubscriptions(client);
      if (subs?.has(roomId) && client.readyState === WS.OPEN) {
        // Format as ROOM_UPDATE
        const message: RoomUpdateMessage = {
          type: "ROOM_UPDATE",
          data: {
            ...data,
            roomId,
            agentId: data.agentId,
            agentName: data.agentId
              ? runtime
                  .getWorldState()
                  .agents.find((a) => a.id === data.agentId)?.name
              : undefined,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
        sendMessage(client, message);
      }
    });
  });

  // Add world update handler
  runtime.onWorldUpdate((worldState) => {
    // Send world update to all connected clients
    console.log("Sending world update to clients");
    // console.log(JSON.stringify(worldState, null, 2));
    wss.clients.forEach((client: WS) => {
      if (client.readyState === WS.OPEN) {
        sendMessage(client, {
          type: "WORLD_UPDATE",
          data: worldState,
          timestamp: Date.now(),
        });
      }
    });
  });
}

// Set up initial event handlers
setupRuntimeEventHandlers(runtime);

const wss = new WebSocketServer({ port: 3000 });

wss.on("connection", (ws: WS) => {
  // Check if this connection already has a user entity
  if (connectionUsers.has(ws)) {
    logger.warn("Connection already has a user entity");
    ws.close();
    return;
  }

  // Create user entity only if none exists for this connection
  const userEntity = createUser(runtime.world);

  // Double check entity wasn't created during async gap
  if (activeUserEntities.has(userEntity)) {
    logger.warn("User entity already exists");
    removeEntity(runtime.world, userEntity);
    ws.close();
    return;
  }

  // Add to tracking in synchronized way
  activeUserEntities.add(userEntity);
  connectionUsers.set(ws, {
    entity: userEntity,
    lastHeartbeat: Date.now(),
  });

  logger.system(
    `New connection established, created user entity: ${userEntity}`
  );

  // Send initial world state
  const worldState = runtime.getWorldState();
  sendMessage(ws, {
    type: "WORLD_UPDATE",
    data: worldState,
    timestamp: Date.now(),
  });

  // Set up ping-pong for connection health check
  ws.on("pong", () => {
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      userConn.lastHeartbeat = Date.now();
    }
  });

  // Update error and close handlers
  ws.on("error", async (error) => {
    logger.error(`WebSocket error: ${error}`);
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      await cleanupUserConnection(ws, userConn);
    }
    ws.close();
  });

  ws.on("close", async () => {
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      await cleanupUserConnection(ws, userConn);
      clearInterval(pingInterval);
    }
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const userConn = connectionUsers.get(ws);

    if (!userConn) {
      logger.error("No user entity found for connection");
      return;
    }

    // Update heartbeat on any message
    userConn.lastHeartbeat = Date.now();

    switch (message.type) {
      case "CONNECTION_UPDATE":
        // Just acknowledge the connection, don't create new user
        sendMessage(ws, {
          type: "CONNECTION_UPDATE",
          connected: true,
          timestamp: Date.now(),
        });
        break;

      case "HEARTBEAT":
        // Client explicitly sending heartbeat
        sendMessage(ws, {
          type: "CONNECTION_UPDATE",
          connected: true,
          timestamp: Date.now(),
        });
        break;

      case "SUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;

        // First unsubscribe from current room if any
        eventEmitter.unsubscribeFromCurrentRoom(ws);

        console.log(`Client subscribing to room ${roomId}`);

        // Find room entity
        const roomEntity = findRoomByStringId(runtime.world, roomId);
        if (!roomEntity) {
          logger.error(`Room ${roomId} not found`);
          break;
        }

        eventEmitter.subscribe(ws, { room: roomId });

        // Move user entity to the subscribed room
        runtime.moveAgentToRoom(userConn.entity, roomEntity);

        // Emit updated world state after moving user
        runtime.emitWorldState();
        break;
      }

      case "CHAT": {
        const chatData = message as ChatMessage;
        const { message: chatMessage, target: roomId } = chatData;

        if (roomId) {
          // Create auditory stimulus from the user entity
          createAuditoryStimulus(runtime.world, {
            sourceEntity: userConn.entity,
            roomId,
            message: chatMessage,
            tone: "neutral",
          });
        } else {
          // Broadcast to all rooms
          const rooms = runtime.getRooms();
          rooms.forEach((room) => {
            createAuditoryStimulus(runtime.world, {
              sourceEntity: userConn.entity,
              roomId: Room.id[room.eid],
              message: chatMessage,
              tone: "neutral",
            });
          });
        }
        break;
      }

      case "START":
        runtime.start();
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: runtime.getWorldState(),
          timestamp: Date.now(),
        });
        break;

      case "STOP":
        runtime.stop();
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: {
            ...runtime.getWorldState(),
            isRunning: false,
          },
          timestamp: Date.now(),
        });
        break;

      case "RESET":
        // Clean up old runtime
        runtime.cleanup();
        // Create fresh runtime
        const setup = setupSingleAgent();
        runtime = setup.runtime;
        // Set up event handlers for new runtime
        setupRuntimeEventHandlers(runtime);
        // Send fresh world state
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: { ...runtime.getWorldState(), isRunning: false },
          timestamp: Date.now(),
        });
        break;
    }
  });

  // Start sending pings to this client
  const pingInterval = setInterval(() => {
    if (ws.readyState === WS.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, HEARTBEAT_INTERVAL);

  // Clear ping interval on close
  ws.on("close", () => clearInterval(pingInterval));
});
