import type { ClientMessage, ServerMessage, WorldState } from "../../types";
import { useSimulationStore } from "../../state/simulation";

export class WebSocketService {
  private ws: WebSocket | null = null;
  private subscribers = new Set<(data: ServerMessage) => void>();

  constructor(private url: string) {}

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.broadcast({
        type: "CONNECTION_STATE",
        connected: true,
        timestamp: Date.now(),
      });
    };

    this.ws.onclose = () => {
      this.broadcast({
        type: "CONNECTION_STATE",
        connected: false,
        timestamp: Date.now(),
      });
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerMessage;
        if (data.type === "WORLD_STATE") {
          this.handleWorldState(data.data);
        } else if (data.type === "AGENT_UPDATE") {
          console.log("Received agent update:", data);
          useSimulationStore.getState().addLog(data);
        }
        this.broadcast(data);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };
  }

  subscribe(callback: (data: ServerMessage) => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private broadcast(data: ServerMessage) {
    this.subscribers.forEach((callback) => callback(data));
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const messageWithTimestamp = {
        ...message,
        timestamp: Date.now(),
      };
      this.ws.send(JSON.stringify(messageWithTimestamp));
    }
  }

  // Convenience methods for common operations
  subscribeToRoom(roomId: string) {
    this.send({ type: "SUBSCRIBE_ROOM", roomId, timestamp: Date.now() });
  }

  unsubscribeFromRoom(roomId: string) {
    this.send({ type: "UNSUBSCRIBE_ROOM", roomId, timestamp: Date.now() });
  }

  subscribeToAgent(agentId: string) {
    this.send({ type: "SUBSCRIBE_AGENT", agentId, timestamp: Date.now() });
  }

  unsubscribeFromAgent(agentId: string) {
    this.send({ type: "UNSUBSCRIBE_AGENT", agentId, timestamp: Date.now() });
  }

  startSimulation() {
    this.send({ type: "START", timestamp: Date.now() });
  }

  stopSimulation() {
    this.send({ type: "STOP", timestamp: Date.now() });
  }

  resetSimulation() {
    this.send({ type: "RESET", timestamp: Date.now() });
  }

  sendChat(message: string, target?: string) {
    this.send({ type: "CHAT", message, target, timestamp: Date.now() });
  }

  disconnect() {
    this.ws?.close();
  }

  private handleWorldState(data: WorldState) {
    console.log("Received world state with relationships:", data.relationships);
    useSimulationStore.getState().setAgents(data.agents);
    useSimulationStore.getState().setRooms(data.rooms);
    useSimulationStore.getState().setRelationships(data.relationships || []);
  }
}
