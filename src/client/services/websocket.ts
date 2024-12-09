import {
  ServerMessage,
  ClientMessage,
  Agent,
  ConnectionUpdateMessage,
  AgentState,
} from "../../types";
import { useSimulationStore } from "../../state/simulation";

export class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Set<(message: ServerMessage) => void> = new Set();
  private currentRoomId: string | null = null;
  private currentRoomAgentSubscriptions = new Set<string>();
  private url: string;
  private messageQueue: ServerMessage[] = [];
  private isProcessingQueue = false;
  private processingInterval: number | null = null;
  private readonly PROCESS_INTERVAL = 100; // Process a message every 100ms
  private lastMessageTimes: Map<string, number> = new Map();
  private readonly DEDUPE_INTERVAL = 100; // Deduplicate messages within 100ms
  private isDisconnecting = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private setupWebSocket() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.isDisconnecting = false;
      this.handlers.forEach((handler) =>
        handler({
          type: "CONNECTION_UPDATE",
          connected: true,
          timestamp: Date.now(),
        } as ConnectionUpdateMessage)
      );
    };

    this.ws.onclose = () => {
      // Only broadcast disconnect if it wasn't intentional
      if (!this.isDisconnecting) {
        this.handlers.forEach((handler) =>
          handler({
            type: "CONNECTION_UPDATE",
            connected: false,
            timestamp: Date.now(),
          } as ConnectionUpdateMessage)
        );
      }
      this.ws = null;
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      this.broadcast(message);
    };
  }

  connect() {
    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Only connect if we're not already connected/connecting and not intentionally disconnecting
    if (
      (!this.ws || this.ws.readyState === WebSocket.CLOSED) &&
      !this.isDisconnecting
    ) {
      this.ws = new WebSocket(this.url);
      this.setupWebSocket();
      this.startQueueProcessor();
    }
  }

  async disconnect() {
    this.isDisconnecting = true;
    this.stopQueueProcessor();

    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      // Ensure we wait for the connection to fully close
      await new Promise<void>((resolve) => {
        if (!this.ws) {
          resolve();
          return;
        }

        const onClose = () => {
          this.ws?.removeEventListener("close", onClose);
          resolve();
        };

        this.ws.addEventListener("close", onClose);
        this.ws.close();
      });
    }

    this.ws = null;
    this.currentRoomId = null;
    this.currentRoomAgentSubscriptions.clear();
    this.messageQueue = [];
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribeToRoom(roomId: string) {
    // First unsubscribe from current room if any
    if (this.currentRoomId && this.currentRoomId !== roomId) {
      this.unsubscribeFromCurrentRoom();
    }

    // Set new room and subscribe
    this.currentRoomId = roomId;
    this.send({
      type: "SUBSCRIBE_ROOM",
      roomId,
      timestamp: Date.now(),
    });

    // Clear any existing agent subscriptions
    this.currentRoomAgentSubscriptions.clear();
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
      // First unsubscribe from all agents in the room
      this.currentRoomAgentSubscriptions.forEach((agentId) => {
        this.unsubscribeFromAgent(agentId);
      });

      // Then unsubscribe from the room
      this.send({
        type: "UNSUBSCRIBE_ROOM",
        roomId: this.currentRoomId,
        timestamp: Date.now(),
      });

      this.currentRoomId = null;
      this.currentRoomAgentSubscriptions.clear();
    }
  }

  unsubscribeFromRoom(roomId: string) {
    if (this.currentRoomId === roomId) {
      this.unsubscribeFromCurrentRoom();
    }
  }

  subscribeToAgent(agentId: string, roomId: string) {
    // Only subscribe if we're in the same room
    if (this.currentRoomId === roomId) {
      useSimulationStore.getState().setSelectedAgent(agentId);
      this.currentRoomAgentSubscriptions.add(agentId);
      this.send({
        type: "SUBSCRIBE_AGENT",
        agentId,
        roomId,
        timestamp: Date.now(),
      });
    }
  }

  unsubscribeFromAgent(agentId: string) {
    useSimulationStore.getState().setSelectedAgent(null);
    this.currentRoomAgentSubscriptions.delete(agentId);
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

    // Batch related messages
    const messages = this.messageQueue.reduce((batch, message) => {
      // Skip duplicate state updates that are close together
      if (this.shouldSkipMessage(message)) return batch;

      // Group by type
      if (!batch[message.type]) {
        batch[message.type] = [];
      }
      batch[message.type].push(message);
      return batch;
    }, {} as Record<string, ServerMessage[]>);

    // Clear processed messages
    this.messageQueue = [];

    try {
      // Process batches in priority order
      const processingOrder = ["WORLD_UPDATE", "ROOM_UPDATE", "AGENT_UPDATE"];

      processingOrder.forEach((type) => {
        if (messages[type]?.length) {
          // For each type, send latest state only
          const latestMessage = messages[type][messages[type].length - 1];
          this.handlers.forEach((handler) => handler(latestMessage));
        }
      });
    } catch (error) {
      console.error("Error processing message batch:", error);
    }

    this.isProcessingQueue = false;

    // Process next batch if queue not empty
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
