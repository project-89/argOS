import type { ClientMessage, WorldState } from "../../types";
import { useSimulationStore } from "../../state/simulation";

export class WebSocketService {
  private ws: WebSocket | null = null;
  private subscribers = new Set<(data: any) => void>();

  constructor(private url: string) {}

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.broadcast({ type: "CONNECTION_STATE", connected: true });
    };

    this.ws.onclose = () => {
      this.broadcast({ type: "CONNECTION_STATE", connected: false });
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WORLD_STATE") {
          this.handleWorldState(data.data);
        }
        this.broadcast(data);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };
  }

  subscribe(callback: (data: any) => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private broadcast(data: any) {
    this.subscribers.forEach((callback) => callback(data));
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // Convenience methods for common operations
  subscribeToRoom(roomId: string) {
    this.send({ type: "SUBSCRIBE_ROOM", roomId });
  }

  unsubscribeFromRoom(roomId: string) {
    this.send({ type: "UNSUBSCRIBE_ROOM", roomId });
  }

  subscribeToAgent(agentId: string) {
    this.send({ type: "SUBSCRIBE_AGENT", agentId });
  }

  unsubscribeFromAgent(agentId: string) {
    this.send({ type: "UNSUBSCRIBE_AGENT", agentId });
  }

  startSimulation() {
    this.send({ type: "START" });
  }

  stopSimulation() {
    this.send({ type: "STOP" });
  }

  resetSimulation() {
    this.send({ type: "RESET" });
  }

  sendChat(message: string) {
    this.send({ type: "CHAT", message });
  }

  disconnect() {
    this.ws?.close();
  }

  handleWorldState(data: WorldState) {
    console.log("Received world state with relationships:", data.relationships);
    useSimulationStore.getState().setAgents(data.agents);
    useSimulationStore.getState().setRooms(data.rooms);
    useSimulationStore.getState().setRelationships(data.relationships || []);
  }
}
