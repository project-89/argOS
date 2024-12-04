import { WebSocketServer } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventEmitter } from "./EventEmitter";
import { ServerMessage } from "../types";
import { setupSingleAgent } from "../examples/single-agent-setup";

const { runtime } = setupSingleAgent();

const eventEmitter = new EventEmitter();

const wss = new WebSocketServer({ port: 3000 });

wss.on("connection", (ws) => {
  // Send initial world state
  const worldState = runtime.getWorldState();
  ws.send(
    JSON.stringify({
      type: "WORLD_STATE",
      data: worldState,
      timestamp: Date.now(),
    })
  );

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "SUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;

        eventEmitter.subscribe(ws, { room: roomId });
        break;
      }

      case "UNSUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;

        eventEmitter.unsubscribe(ws, { room: roomId });
        break;
      }

      case "SUBSCRIBE_AGENT": {
        const { agentId, roomId } = message;
        if (!agentId || !roomId) break;

        eventEmitter.subscribe(ws, { room: roomId, agent: agentId });
        break;
      }

      case "UNSUBSCRIBE_AGENT": {
        const { agentId, roomId } = message;
        if (!agentId || !roomId) break;

        eventEmitter.unsubscribe(ws, { room: roomId, agent: agentId });
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
  eventEmitter.emit({
    type: "AGENT_UPDATE",
    channel: { room: roomId, agent: agentId.toString() },
    data,
    timestamp: Date.now(),
  });
});

runtime.onRoomUpdate((roomId, data) => {
  eventEmitter.emit({
    type: "ROOM_UPDATE",
    channel: { room: roomId },
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
