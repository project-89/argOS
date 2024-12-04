import { useEffect, useRef, useState } from "react";
import { AnyEventPayload, EventChannel, EventTypes } from "../types/events";

type EventHandler<T extends keyof EventTypes> = (
  event: EventTypes[T]["data"]
) => void;

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<(event: any) => void>>>(new Map());

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3000`);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      const payload: AnyEventPayload = JSON.parse(event.data);
      const channelKey = `${payload.channel.room}${
        "agent" in payload.channel ? `:${payload.channel.agent}` : ""
      }`;

      handlersRef.current.get(channelKey)?.forEach((handler) => {
        handler(payload.data);
      });
    };

    return () => ws.close();
  }, []);

  const subscribe = <T extends keyof EventTypes>(
    channel: EventChannel,
    handler: EventHandler<T>
  ) => {
    if (!wsRef.current || !isConnected) return;

    const channelKey = `${channel.room}${
      channel.agent ? `:${channel.agent}` : ""
    }`;
    if (!handlersRef.current.has(channelKey)) {
      handlersRef.current.set(channelKey, new Set());
      wsRef.current.send(
        JSON.stringify({
          type: channel.agent ? "SUBSCRIBE_AGENT" : "SUBSCRIBE_ROOM",
          roomId: channel.room,
          ...(channel.agent && { agentId: channel.agent }),
        })
      );
    }
    handlersRef.current.get(channelKey)?.add(handler);
  };

  const unsubscribe = <T extends keyof EventTypes>(
    channel: EventChannel,
    handler: EventHandler<T>
  ) => {
    if (!wsRef.current) return;

    const channelKey = `${channel.room}${
      channel.agent ? `:${channel.agent}` : ""
    }`;
    handlersRef.current.get(channelKey)?.delete(handler);

    if (handlersRef.current.get(channelKey)?.size === 0) {
      handlersRef.current.delete(channelKey);
      wsRef.current.send(
        JSON.stringify({
          type: channel.agent ? "UNSUBSCRIBE_AGENT" : "UNSUBSCRIBE_ROOM",
          roomId: channel.room,
          ...(channel.agent && { agentId: channel.agent }),
        })
      );
    }
  };

  return {
    isConnected,
    subscribe,
    unsubscribe,
  };
}
