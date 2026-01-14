/**
 * React hook for connecting to the SimulationBus via WebSocket
 */

import { useEffect, useRef, useCallback } from "react";
import { useSimulationStore } from "../store/simulation";
import type {
  ChannelType,
  InjectionMessage,
  WebSocketClientMessage,
  WebSocketServerMessage,
} from "../types/events";

// Default WebSocket URL
const getWebSocketUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/bus`;
};

export interface UseSimulationBusOptions {
  url?: string;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface SimulationBusActions {
  connect: () => void;
  disconnect: () => void;
  subscribe: (channel: ChannelType | "*") => void;
  unsubscribe: (channel: ChannelType | "*") => void;
  inject: (message: InjectionMessage) => void;
  sendGodCommand: (command: string) => void;
  sendAgentStimulus: (agentName: string, stimulus: string) => void;
  sendRoomBroadcast: (roomName: string, content: string) => void;
  sendSpiritMessage: (spiritName: string, message: string, priority?: "low" | "normal" | "high" | "urgent") => void;
}

export function useSimulationBus(options: UseSimulationBusOptions = {}): SimulationBusActions {
  const {
    url = getWebSocketUrl(),
    autoConnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);
  const shouldReconnectRef = useRef(true);

  // Store refs to avoid dependency cycles
  const optionsRef = useRef({ url, reconnectInterval, maxReconnectAttempts });
  optionsRef.current = { url, reconnectInterval, maxReconnectAttempts };

  // Get store functions directly to avoid dependency issues
  const store = useSimulationStore;

  // Send a message to the WebSocket
  const send = useCallback((message: WebSocketClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[SimulationBus] Sending:", message.type);
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[SimulationBus] Cannot send, WebSocket not open. State:", wsRef.current?.readyState);
    }
  }, []);

  // Handle incoming messages - uses store directly to avoid deps
  const handleMessage = useCallback((data: string) => {
    try {
      const message: WebSocketServerMessage = JSON.parse(data);

      switch (message.type) {
        case "event":
          if (message.event) {
            store.getState().addEvent(message.event);
          }
          break;

        case "subscribed":
          if (message.channel) {
            store.getState().setSubscription(message.channel, true);
          }
          break;

        case "unsubscribed":
          if (message.channel) {
            store.getState().setSubscription(message.channel, false);
          }
          break;

        case "error":
          console.error("[SimulationBus] Error:", message.error);
          break;

        case "pong":
          // Update last ping time in store if needed
          break;

        case "injected":
          console.log("[SimulationBus] Injection confirmed");
          break;
      }
    } catch (error) {
      console.error("[SimulationBus] Failed to parse message:", error);
    }
  }, [store]);

  // Connect to WebSocket - stable function using refs
  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) {
      console.log("[SimulationBus] Already connecting, skipping");
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[SimulationBus] Already connected, skipping");
      return;
    }

    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log("[SimulationBus] Connection in progress, skipping");
      return;
    }

    isConnectingRef.current = true;
    shouldReconnectRef.current = true;
    const { url } = optionsRef.current;

    store.getState().setStatus("connecting");
    console.log("[SimulationBus] Connecting to", url);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[SimulationBus] Connected to", url);
      isConnectingRef.current = false;
      store.getState().setStatus("connected");
      reconnectAttempts.current = 0;

      // Subscribe to all events by default
      if (ws.readyState === WebSocket.OPEN) {
        console.log("[SimulationBus] Sending subscribe request");
        ws.send(JSON.stringify({ type: "subscribe", channel: "*" }));
      }
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = (event) => {
      console.log("[SimulationBus] Disconnected, code:", event.code, "reason:", event.reason);
      isConnectingRef.current = false;
      store.getState().setStatus("disconnected");
      wsRef.current = null;

      const { reconnectInterval, maxReconnectAttempts } = optionsRef.current;

      // Attempt reconnect only if we should
      if (shouldReconnectRef.current && reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(
          `[SimulationBus] Reconnecting in ${reconnectInterval}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`
        );
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = (error) => {
      console.error("[SimulationBus] WebSocket error:", error);
      isConnectingRef.current = false;
      store.getState().setStatus("error", "Connection error");
    };

    wsRef.current = ws;
  }, [store, handleMessage]);

  // Disconnect from WebSocket - stable function
  const disconnect = useCallback(() => {
    console.log("[SimulationBus] Disconnect called");
    shouldReconnectRef.current = false;

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    isConnectingRef.current = false;
    store.getState().setStatus("disconnected");
  }, [store]);

  // Subscribe to a channel
  const subscribe = useCallback(
    (channel: ChannelType | "*") => {
      send({ type: "subscribe", channel });
    },
    [send]
  );

  // Unsubscribe from a channel
  const unsubscribe = useCallback(
    (channel: ChannelType | "*") => {
      send({ type: "unsubscribe", channel });
    },
    [send]
  );

  // Inject a message
  const inject = useCallback(
    (injection: InjectionMessage) => {
      console.log("[SimulationBus] Injecting:", injection.type);
      send({ type: "inject", injection });
    },
    [send]
  );

  // Convenience: Send god command
  const sendGodCommand = useCallback(
    (command: string) => {
      console.log("[SimulationBus] Sending god command:", command.slice(0, 50) + "...");
      inject({ type: "inject:god_command", command });
    },
    [inject]
  );

  // Convenience: Send agent stimulus
  const sendAgentStimulus = useCallback(
    (agentName: string, stimulus: string) => {
      inject({
        type: "inject:agent_stimulus",
        targetAgentName: agentName,
        stimulus,
      });
    },
    [inject]
  );

  // Convenience: Send room broadcast
  const sendRoomBroadcast = useCallback(
    (roomName: string, content: string) => {
      inject({
        type: "inject:room_broadcast",
        roomName,
        content,
      });
    },
    [inject]
  );

  // Convenience: Send spirit message
  const sendSpiritMessage = useCallback(
    (spiritName: string, message: string, priority: "low" | "normal" | "high" | "urgent" = "normal") => {
      console.log("[SimulationBus] Sending message to spirit:", spiritName);
      inject({
        type: "inject:spirit_message",
        targetSpiritName: spiritName,
        message,
        priority,
      });
    },
    [inject]
  );

  // Auto-connect on mount - only depends on autoConnect
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]); // Intentionally only depend on autoConnect to prevent reconnection loops

  return {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    inject,
    sendGodCommand,
    sendAgentStimulus,
    sendRoomBroadcast,
    sendSpiritMessage,
  };
}
