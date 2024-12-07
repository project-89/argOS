import { WebSocketServer, WebSocket as WS } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventEmitter } from "./EventEmitter";
import {
  ServerMessage,
  WorldUpdateMessage,
  ChatMessage,
  AgentUpdateMessage,
  RoomUpdateMessage,
} from "../types";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { Room, Agent } from "../components/agent/Agent";
import { createAuditoryStimulus } from "../utils/stimulus-utils";

// Helper to send message to a WebSocket client
const sendMessage = (ws: WS, message: ServerMessage) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

// Function to set up runtime event handlers
function setupRuntimeEventHandlers(runtime: SimulationRuntime) {
  runtime.onAgentUpdate((agentId, roomId, data) => {
    const stringRoomId = Room.id[roomId] || String(roomId);
    const stringAgentId = Agent.id[agentId] || String(agentId);

    // Send agent updates only to direct agent subscribers
    wss.clients.forEach((client) => {
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
    wss.clients.forEach((client) => {
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
}

let { runtime } = setupSingleAgent();
const eventEmitter = new EventEmitter();

// Set up initial event handlers
setupRuntimeEventHandlers(runtime);

const wss = new WebSocketServer({ port: 3000 });

wss.on("connection", (ws) => {
  // Send initial world state
  const worldState = runtime.getWorldState();
  sendMessage(ws, {
    type: "WORLD_UPDATE",
    data: worldState,
    timestamp: Date.now(),
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "SUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;

        console.log(`Client subscribing to room ${roomId}`);
        eventEmitter.subscribe(ws, { room: roomId });
        break;
      }

      case "SUBSCRIBE_AGENT": {
        const { agentId, roomId } = message;
        if (!agentId || !roomId) break;

        console.log(`Client subscribing to agent ${agentId} in room ${roomId}`);
        eventEmitter.subscribe(ws, { room: roomId, agent: agentId });
        break;
      }

      case "START":
        runtime.start();
        // Send updated world state
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: runtime.getWorldState(),
          timestamp: Date.now(),
        });
        break;

      case "STOP":
        runtime.stop();
        // Only send running status update, not full world state
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: {
            ...runtime.getWorldState(),
            isRunning: false,
            // Keep existing agents and state
            agents: runtime.getWorldState().agents,
            rooms: runtime.getWorldState().rooms,
            relationships: runtime.getWorldState().relationships,
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
        // Get the initial room ID
        const initialRoom = runtime.getRooms()[0];
        if (initialRoom) {
          // Resubscribe to the initial room
          eventEmitter.subscribe(ws, { room: initialRoom.id });
          runtime.subscribeToRoom(initialRoom.eid, (event) => {
            sendMessage(ws, event);
          });
        }
        // Send fresh world state (not running)
        const freshWorldState = runtime.getWorldState();
        sendMessage(ws, {
          type: "WORLD_UPDATE",
          data: { ...freshWorldState, isRunning: false },
          timestamp: Date.now(),
        });
        break;

      case "CHAT": {
        const chatData = message as ChatMessage;
        const { message: chatMessage, target: roomId } = chatData;

        if (roomId) {
          // Send to specific room
          createAuditoryStimulus(runtime.world, {
            sourceEntity: 0, // System/God mode
            roomId,
            message: chatMessage,
            tone: "neutral",
          });
        } else {
          // Broadcast to all rooms
          const rooms = runtime.getRooms();
          rooms.forEach((room) => {
            createAuditoryStimulus(runtime.world, {
              sourceEntity: 0, // System/God mode
              roomId: Room.id[room.eid],
              message: chatMessage,
              tone: "neutral",
            });
          });
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    eventEmitter.removeClient(ws);
  });
});
