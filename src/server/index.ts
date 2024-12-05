import { WebSocketServer, WebSocket as WS } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventEmitter } from "./EventEmitter";
import { ServerMessage } from "../types";
import { setupSingleAgent } from "../examples/single-agent-setup";
import { Room, Agent } from "../components/agent/Agent";

const { runtime } = setupSingleAgent();
const eventEmitter = new EventEmitter();

const wss = new WebSocketServer({ port: 3000 });

// Helper to send message to a WebSocket client
const sendMessage = (ws: WS, message: ServerMessage) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

wss.on("connection", (ws) => {
  // Send initial world state
  const worldState = runtime.getWorldState();
  sendMessage(ws, {
    type: "WORLD_STATE",
    data: worldState,
    timestamp: Date.now(),
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "SUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;

        // Subscribe to room events
        eventEmitter.subscribe(ws, { room: roomId });
        // Also subscribe to the runtime events for this room
        runtime.subscribeToRoom(Number(roomId), (event) => {
          sendMessage(ws, {
            type: "ROOM_STATE",
            data: { roomId, event },
            timestamp: Date.now(),
          });
        });
        break;
      }

      case "SUBSCRIBE_AGENT": {
        const { agentId, roomId } = message;
        if (!agentId || !roomId) break;

        // Subscribe to agent events
        eventEmitter.subscribe(ws, { room: roomId, agent: agentId });
        // Also subscribe to the runtime events for this agent
        runtime.subscribeToAgent(Number(agentId), (event) => {
          sendMessage(ws, {
            type: "AGENT_STATE",
            data: {
              agentId,
              agentName: Agent.name[Number(agentId)],
              ...event,
            },
            timestamp: Date.now(),
          });
        });
        break;
      }

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
  });

  ws.on("close", () => {
    eventEmitter.removeClient(ws);
  });
});

// Subscribe to runtime events and relay them through event emitter
runtime.onAgentUpdate((agentId, roomId, data) => {
  const stringRoomId = Room.id[roomId] || String(roomId);
  const stringAgentId = Agent.id[agentId] || String(agentId);

  eventEmitter.emit({
    type: "AGENT_UPDATE",
    channel: {
      room: stringRoomId,
      agent: stringAgentId,
    },
    data,
    timestamp: Date.now(),
  });
});

runtime.onRoomUpdate((roomId, data) => {
  const stringRoomId = Room.id[roomId] || String(roomId);
  eventEmitter.emit({
    type: "ROOM_UPDATE",
    channel: { room: stringRoomId },
    data,
    timestamp: Date.now(),
  });
});

runtime.onWorldUpdate((data) => {
  eventEmitter.emit({
    type: "WORLD_UPDATE",
    channel: { room: "global" },
    data,
    timestamp: Date.now(),
  });
});
