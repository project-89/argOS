/**
 * Tests for SimulationBus
 */

import {
  createSimulationBus,
  SimulationBus,
  type SimulationEvent,
  type AgentEvent,
  type GodEvent,
} from "../bus/simulation-bus";

describe("SimulationBus", () => {
  let bus: SimulationBus;

  beforeEach(() => {
    bus = createSimulationBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  describe("Basic Event Emission", () => {
    it("should emit and receive events", (done) => {
      bus.subscribeAll((event) => {
        expect(event.type).toBe("agent:action");
        done();
      });

      bus.emit({
        type: "agent:action",
        timestamp: Date.now(),
        agentId: 1,
        agentName: "TestAgent",
        action: "move",
      } as SimulationEvent);
    });

    it("should emit god events to god channel", (done) => {
      bus.subscribe("god", (event) => {
        expect(event.type).toBe("god:command");
        done();
      });

      bus.emitGod({
        type: "god:command",
        command: "Create a village",
        status: "started",
      });
    });

    it("should emit agent events to agents channel", (done) => {
      bus.subscribe("agents", (event) => {
        expect(event.type).toBe("agent:think");
        done();
      });

      bus.emitAgent({
        type: "agent:think",
        agentId: 1,
        agentName: "Alice",
        thought: "I should go to the bakery",
        thoughtType: "planning",
      });
    });
  });

  describe("Channel Subscriptions", () => {
    it("should subscribe to specific agent by name", (done) => {
      const unsubscribe = bus.subscribeAgent("Alice", (event) => {
        expect(event.agentName).toBe("Alice");
        unsubscribe();
        done();
      });

      // This should NOT trigger the callback (different agent)
      bus.emit({
        type: "agent:action",
        timestamp: Date.now(),
        agentId: 2,
        agentName: "Bob",
        action: "speak",
      } as SimulationEvent);

      // This SHOULD trigger the callback
      bus.emit({
        type: "agent:action",
        timestamp: Date.now(),
        agentId: 1,
        agentName: "Alice",
        action: "move",
      } as SimulationEvent);
    });

    it("should subscribe to specific room by name", (done) => {
      const unsubscribe = bus.subscribeRoom("Tavern", (event) => {
        expect(event.type).toBe("room:activity");
        unsubscribe();
        done();
      });

      bus.emitRoom({
        type: "room:activity",
        roomId: 1,
        roomName: "Tavern",
        activityType: "speech",
        actor: "Bob",
        content: "Anyone want a drink?",
      });
    });
  });

  describe("Event Buffering", () => {
    it("should buffer events when enabled", () => {
      bus.setBuffering(true, 10);

      for (let i = 0; i < 5; i++) {
        bus.emitAgent({
          type: "agent:action",
          agentId: i,
          agentName: `Agent${i}`,
          action: "move",
        });
      }

      const buffer = bus.getBuffer();
      expect(buffer.length).toBe(5);
    });

    it("should limit buffer size", () => {
      bus.setBuffering(true, 3);

      for (let i = 0; i < 10; i++) {
        bus.emitAgent({
          type: "agent:action",
          agentId: i,
          agentName: `Agent${i}`,
          action: "move",
        });
      }

      const buffer = bus.getBuffer();
      expect(buffer.length).toBe(3);
    });

    it("should clear buffer", () => {
      bus.setBuffering(true);

      bus.emitAgent({
        type: "agent:action",
        agentId: 1,
        agentName: "Test",
        action: "move",
      });

      expect(bus.getBuffer().length).toBe(1);

      bus.clearBuffer();
      expect(bus.getBuffer().length).toBe(0);
    });
  });

  describe("Injection Handlers", () => {
    it("should register and call injection handlers", async () => {
      let handlerCalled = false;

      bus.registerInjectionHandler("inject:god_command", async (msg) => {
        handlerCalled = true;
        expect(msg.type).toBe("inject:god_command");
      });

      await bus.inject({
        type: "inject:god_command",
        command: "Test command",
      });

      expect(handlerCalled).toBe(true);
    });

    it("should log warning on missing handler", async () => {
      const originalWarn = console.warn;
      let warnMessage = "";
      console.warn = (msg: string) => {
        warnMessage = msg;
      };

      await bus.inject({
        type: "inject:spirit_message",
        message: "Hello",
      });

      expect(warnMessage).toContain("No handler for injection type");

      console.warn = originalWarn;
    });
  });

  describe("Unsubscribe", () => {
    it("should unsubscribe correctly", () => {
      let callCount = 0;

      const unsubscribe = bus.subscribe("god", () => {
        callCount++;
      });

      bus.emitGod({
        type: "god:command",
        command: "First",
        status: "started",
      });

      expect(callCount).toBe(1);

      unsubscribe();

      bus.emitGod({
        type: "god:command",
        command: "Second",
        status: "started",
      });

      expect(callCount).toBe(1); // Should not increase
    });
  });

  describe("Wildcard Subscription", () => {
    it("should receive all events with wildcard", () => {
      const events: SimulationEvent[] = [];

      bus.subscribeAll((event) => {
        events.push(event);
      });

      bus.emitGod({
        type: "god:command",
        command: "Test",
        status: "started",
      });

      bus.emitAgent({
        type: "agent:action",
        agentId: 1,
        agentName: "Test",
        action: "move",
      });

      bus.emitWorld({
        type: "world:state",
        tick: 1,
        agentCount: 5,
        roomCount: 3,
        systemCount: 10,
      });

      expect(events.length).toBe(3);
    });
  });
});
