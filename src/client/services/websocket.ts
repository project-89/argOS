import {
  ServerMessage,
  ClientMessage,
  Agent,
  ConnectionUpdateMessage,
  AgentState,
} from "../../types";
import { useSimulationStore } from "../../state/simulation";

export class WebSocketService {
  private ws: WebSocket;
  private handlers: Set<(message: ServerMessage) => void> = new Set();
  private currentRoomId: string | null = null;
  private currentRoomAgentSubscriptions: Set<string> = new Set();
  private url: string;
  private messageQueue: ServerMessage[] = [];
  private isProcessingQueue = false;
  private processingInterval: number | null = null;
  private readonly PROCESS_INTERVAL = 100; // Process a message every 100ms
  private lastMessageTimes: Map<string, number> = new Map();
  private readonly DEDUPE_INTERVAL = 100; // Deduplicate messages within 100ms

  constructor(url: string) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.setupWebSocket();
    this.startQueueProcessor();
  }

  private setupWebSocket() {
    this.ws.onopen = () => {
      this.broadcast({
        type: "CONNECTION_UPDATE",
        connected: true,
        timestamp: Date.now(),
      } as ConnectionUpdateMessage);
    };

    this.ws.onclose = () => {
      this.broadcast({
        type: "CONNECTION_UPDATE",
        connected: false,
        timestamp: Date.now(),
      } as ConnectionUpdateMessage);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      this.broadcast(message);
    };
  }

  connect() {
    if (this.ws.readyState === WebSocket.CLOSED) {
      this.ws = new WebSocket(this.url);
      this.setupWebSocket();
    }
  }

  disconnect() {
    this.stopQueueProcessor();
    this.ws.close();
  }

  subscribe(handler: (message: ServerMessage) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private broadcast(message: ServerMessage) {
    // Special handling for connection updates - send immediately
    if (message.type === "CONNECTION_UPDATE") {
      this.handlers.forEach((handler) => handler(message));
      return;
    }

    // Queue other messages
    this.messageQueue.push(message);
  }

  send(message: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribeToRoom(roomId: string) {
    if (this.currentRoomId === roomId) return; // Already subscribed to this room

    this.unsubscribeFromCurrentRoom();
    this.currentRoomId = roomId;

    this.send({
      type: "SUBSCRIBE_ROOM",
      roomId,
      timestamp: Date.now(),
    });
  }

  subscribeToRoomAgent(agentId: string, roomId: string) {
    if (this.currentRoomAgentSubscriptions.has(agentId)) return; // Already subscribed

    this.currentRoomAgentSubscriptions.add(agentId);
    this.send({
      type: "SUBSCRIBE_AGENT",
      agentId,
      roomId,
      timestamp: Date.now(),
    });
  }

  unsubscribeFromCurrentRoom() {
    if (this.currentRoomId) {
      this.send({
        type: "UNSUBSCRIBE_ROOM",
        roomId: this.currentRoomId,
        timestamp: Date.now(),
      });

      this.currentRoomAgentSubscriptions.forEach((agentId) => {
        this.send({
          type: "UNSUBSCRIBE_AGENT",
          agentId,
          timestamp: Date.now(),
        });
      });
      this.currentRoomAgentSubscriptions.clear();
      this.currentRoomId = null;
    }
  }

  unsubscribeFromRoom(roomId: string) {
    if (this.currentRoomId === roomId) {
      this.unsubscribeFromCurrentRoom();
    }
  }

  subscribeToAgent(agentId: string, roomId: string) {
    useSimulationStore.getState().setSelectedAgent(agentId);
    this.send({
      type: "SUBSCRIBE_AGENT",
      agentId,
      roomId,
      timestamp: Date.now(),
    });
  }

  unsubscribeFromAgent(agentId: string) {
    useSimulationStore.getState().setSelectedAgent(null);
    this.send({
      type: "UNSUBSCRIBE_AGENT",
      agentId,
      timestamp: Date.now(),
    });
  }

  startSimulation() {
    this.send({
      type: "START",
      timestamp: Date.now(),
    });
  }

  stopSimulation() {
    this.send({
      type: "STOP",
      timestamp: Date.now(),
    });
  }

  resetSimulation() {
    this.send({
      type: "RESET",
      timestamp: Date.now(),
    });
  }

  sendChat(message: string, roomId?: string) {
    this.send({
      type: "CHAT",
      message,
      target: roomId,
      timestamp: Date.now(),
    });
  }

  private startQueueProcessor() {
    if (this.processingInterval) return;

    this.processingInterval = window.setInterval(() => {
      this.processNextMessage();
    }, this.PROCESS_INTERVAL);
  }

  private stopQueueProcessor() {
    if (this.processingInterval) {
      window.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  private processNextMessage() {
    if (this.messageQueue.length === 0 || this.isProcessingQueue) return;

    this.isProcessingQueue = true;
    const message = this.messageQueue.shift();

    if (message) {
      // Skip duplicate state updates that are close together
      if (this.shouldSkipMessage(message)) {
        this.isProcessingQueue = false;
        return;
      }

      try {
        this.handlers.forEach((handler) => handler(message));
      } catch (error) {
        console.error("Error processing message:", error);
      }
    }

    this.isProcessingQueue = false;

    // Process next message if queue not empty
    if (this.messageQueue.length > 0) {
      setTimeout(() => this.processNextMessage(), this.PROCESS_INTERVAL);
    }
  }

  private shouldSkipMessage(message: ServerMessage): boolean {
    // Don't skip non-state messages
    if (message.type !== "AGENT_UPDATE" && message.type !== "ROOM_UPDATE") {
      return false;
    }

    // For state updates, check if we've recently processed a similar one
    const key =
      message.type === "AGENT_UPDATE"
        ? `${message.channel.agent}:${message.data.category}`
        : `${message.data.roomId}:${message.data.type}`;

    const now = Date.now();
    const lastUpdate = this.lastMessageTimes.get(key);

    if (lastUpdate && now - lastUpdate < this.DEDUPE_INTERVAL) {
      return true;
    }

    this.lastMessageTimes.set(key, now);
    return false;
  }
}
