/**
 * WebSocket Transport for SimulationBus
 *
 * Bridges the SimulationBus to WebSocket clients, allowing:
 * - Real-time observation of simulation events
 * - Injection of commands/messages into the simulation
 * - Channel-based subscriptions
 *
 * Usage:
 * ```typescript
 * const bus = createSimulationBus();
 * const transport = createWebSocketTransport(server);
 * transport.connect(bus);
 * ```
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type {
  SimulationBus,
  BusTransport,
  SimulationEvent,
  InjectionMessage,
  ChannelType,
} from "./simulation-bus";

// ============================================================================
// Types
// ============================================================================

export interface WebSocketClientMessage {
  type: "subscribe" | "unsubscribe" | "inject" | "ping";
  /** For subscribe/unsubscribe: the channel to (un)subscribe */
  channel?: ChannelType | "*";
  /** For inject: the injection message */
  injection?: InjectionMessage;
}

export interface WebSocketServerMessage {
  type: "event" | "subscribed" | "unsubscribed" | "error" | "pong" | "injected";
  channel?: ChannelType | "*";
  event?: SimulationEvent;
  error?: string;
  timestamp: number;
}

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<ChannelType | "*">;
  unsubscribers: Map<string, () => void>;
}

// ============================================================================
// WebSocket Transport
// ============================================================================

export class WebSocketTransport implements BusTransport {
  private wss: WebSocketServer;
  private bus: SimulationBus | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private connected: boolean = false;

  constructor(server: Server) {
    // Use noServer to prevent conflicts with other WebSocket servers
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer();

    // Handle upgrades for /bus path
    server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
      if (pathname === "/bus") {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      }
    });
  }

  private setupServer(): void {
    console.log("[WebSocketTransport] Setting up server, waiting for connections...");
    this.wss.on("connection", (ws) => {
      console.log("[WebSocketTransport] *** Client connected to /bus ***");

      const clientState: ClientState = {
        ws,
        subscriptions: new Set(),
        unsubscribers: new Map(),
      };
      this.clients.set(ws, clientState);

      ws.on("message", (data) => {
        console.log("[WebSocketTransport] Received message:", data.toString().slice(0, 200));
        try {
          const msg: WebSocketClientMessage = JSON.parse(data.toString());
          console.log("[WebSocketTransport] Parsed message type:", msg.type);
          this.handleClientMessage(clientState, msg);
        } catch (e) {
          console.error("[WebSocketTransport] Parse error:", e);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", () => {
        console.log("[WebSocketTransport] Client disconnected");
        this.cleanupClient(clientState);
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[WebSocketTransport] Client error:", error);
        this.cleanupClient(clientState);
        this.clients.delete(ws);
      });
    });
  }

  private handleClientMessage(client: ClientState, msg: WebSocketClientMessage): void {
    switch (msg.type) {
      case "subscribe":
        this.handleSubscribe(client, msg.channel || "*");
        break;
      case "unsubscribe":
        this.handleUnsubscribe(client, msg.channel || "*");
        break;
      case "inject":
        console.log("[WebSocketTransport] Received inject:", msg.injection?.type);
        if (msg.injection) {
          this.handleInject(client, msg.injection);
        } else {
          this.sendError(client.ws, "Missing injection payload");
        }
        break;
      case "ping":
        this.send(client.ws, { type: "pong", timestamp: Date.now() });
        break;
    }
  }

  private handleSubscribe(client: ClientState, channel: ChannelType | "*"): void {
    if (!this.bus) {
      this.sendError(client.ws, "Bus not connected");
      return;
    }

    if (client.subscriptions.has(channel)) {
      return; // Already subscribed
    }

    // Create subscription
    const callback = (event: SimulationEvent) => {
      console.log(`[WebSocketTransport] Forwarding event: ${event.type} to channel ${channel}`);
      this.send(client.ws, {
        type: "event",
        channel,
        event,
        timestamp: Date.now(),
      });
    };

    let unsubscribe: () => void;
    if (channel === "*") {
      unsubscribe = this.bus.subscribeAll(callback);
    } else {
      unsubscribe = this.bus.subscribe(channel, callback);
    }

    client.subscriptions.add(channel);
    client.unsubscribers.set(channel, unsubscribe);

    this.send(client.ws, {
      type: "subscribed",
      channel,
      timestamp: Date.now(),
    });

    console.log(`[WebSocketTransport] Client subscribed to: ${channel}`);
  }

  private handleUnsubscribe(client: ClientState, channel: ChannelType | "*"): void {
    const unsubscribe = client.unsubscribers.get(channel);
    if (unsubscribe) {
      unsubscribe();
      client.unsubscribers.delete(channel);
      client.subscriptions.delete(channel);

      this.send(client.ws, {
        type: "unsubscribed",
        channel,
        timestamp: Date.now(),
      });

      console.log(`[WebSocketTransport] Client unsubscribed from: ${channel}`);
    }
  }

  private async handleInject(client: ClientState, injection: InjectionMessage): Promise<void> {
    console.log("[WebSocketTransport] handleInject called:", injection.type);
    if (!this.bus) {
      console.log("[WebSocketTransport] Bus not connected!");
      this.sendError(client.ws, "Bus not connected");
      return;
    }

    try {
      console.log("[WebSocketTransport] Calling bus.inject...");
      await this.bus.inject(injection);
      console.log("[WebSocketTransport] Injection complete");
      this.send(client.ws, {
        type: "injected",
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("[WebSocketTransport] Injection failed:", error);
      this.sendError(client.ws, `Injection failed: ${error}`);
    }
  }

  private cleanupClient(client: ClientState): void {
    // Unsubscribe from all channels
    for (const unsubscribe of client.unsubscribers.values()) {
      unsubscribe();
    }
    client.unsubscribers.clear();
    client.subscriptions.clear();
  }

  private send(ws: WebSocket, msg: WebSocketServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: "error",
      error,
      timestamp: Date.now(),
    });
  }

  // -------------------------------------------------------------------------
  // BusTransport Interface
  // -------------------------------------------------------------------------

  connect(bus: SimulationBus): void {
    if (this.connected) {
      console.warn("[WebSocketTransport] Already connected");
      return;
    }

    this.bus = bus;
    this.connected = true;
    console.log("[WebSocketTransport] Connected to SimulationBus");
  }

  disconnect(): void {
    if (!this.connected) return;

    // Clean up all client subscriptions
    for (const client of this.clients.values()) {
      this.cleanupClient(client);
    }

    this.bus = null;
    this.connected = false;
    console.log("[WebSocketTransport] Disconnected from SimulationBus");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast an event to all connected clients subscribed to the appropriate channel.
   * This is useful for pushing events that don't go through the bus.
   */
  broadcastToAll(event: SimulationEvent): void {
    for (const client of this.clients.values()) {
      if (client.subscriptions.has("*")) {
        this.send(client.ws, {
          type: "event",
          channel: "*",
          event,
          timestamp: Date.now(),
        });
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a WebSocket transport attached to an HTTP server.
 * The transport will listen on the /bus path.
 */
export function createWebSocketTransport(server: Server): WebSocketTransport {
  return new WebSocketTransport(server);
}
