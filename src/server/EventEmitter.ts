import * as WebSocket from "ws";
import {
  AnyEventPayload,
  EventChannel,
  EventPayload,
  EventTypes,
} from "../types/events";

export class EventEmitter {
  private subscriptions = new Map<WebSocket.WebSocket, Set<string>>();

  private channelToString(channel: EventChannel): string {
    return `${channel.room}${channel.agent ? `:${channel.agent}` : ""}`;
  }

  private matchChannel(
    subscription: string,
    eventChannel: EventChannel
  ): boolean {
    const [subRoom, subAgent] = subscription.split(":");
    return (
      subRoom === eventChannel.room &&
      (!subAgent || subAgent === eventChannel.agent)
    );
  }

  subscribe(ws: WebSocket.WebSocket, channel: EventChannel) {
    if (!this.subscriptions.has(ws)) {
      this.subscriptions.set(ws, new Set());
    }
    this.subscriptions.get(ws)?.add(this.channelToString(channel));
  }

  unsubscribe(ws: WebSocket.WebSocket, channel: EventChannel) {
    this.subscriptions.get(ws)?.delete(this.channelToString(channel));
  }

  removeClient(ws: WebSocket.WebSocket) {
    this.subscriptions.delete(ws);
  }

  getSubscriptions(ws: WebSocket.WebSocket): Set<string> | undefined {
    return this.subscriptions.get(ws);
  }

  emit<T extends keyof EventTypes>(event: EventPayload<T>) {
    const payload = {
      ...event,
      timestamp: Date.now(),
    };

    Array.from(this.subscriptions.entries()).forEach(([ws, subs]) => {
      Array.from(subs).forEach((sub) => {
        if (this.matchChannel(sub, event.channel)) {
          try {
            ws.send(JSON.stringify(payload));
          } catch (error) {
            console.error("Failed to send event:", error);
          }
        }
      });
    });
  }

  unsubscribeFromCurrentRoom(ws: WebSocket.WebSocket) {
    const subscriptions = this.subscriptions.get(ws);
    if (subscriptions) {
      const roomSubs = Array.from(subscriptions).filter((sub) =>
        sub.startsWith("room:")
      );
      roomSubs.forEach((sub) => subscriptions.delete(sub));
    }
  }
}
