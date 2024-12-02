import express from "express";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { createWorld } from "bitecs";
import { ThinkingSystem } from "../systems/ThinkingSystem";
import { RoomSystem } from "../systems/RoomSystem";
import { ActionSystem } from "../systems/ActionSystem";
import { StimulusCleanupSystem } from "../systems/StimulusCleanupSystem";
import { actions } from "../actions";
import { Agent, Memory, Action, Perception } from "../components/agent/Agent";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from the client directory in development
if (process.env.NODE_ENV === "development") {
  app.use(express.static(path.join(__dirname, "../../src/client")));
} else {
  app.use(express.static(path.join(__dirname, "../../dist")));
}

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
});

interface SimulationEvent {
  type: "LOG" | "AGENT_STATE" | "SYSTEM_STATE" | "AGENT_ACTION" | "ERROR";
  category?: string;
  data: any;
  timestamp: number;
}

export class SimulationServer {
  private runtime: SimulationRuntime;
  private clients: Set<WebSocket> = new Set();
  private isRunning: boolean = false;

  constructor() {
    const world = createWorld();
    this.runtime = new SimulationRuntime(world, {
      updateInterval: 3000,
      systems: [
        RoomSystem,
        ThinkingSystem,
        ActionSystem,
        StimulusCleanupSystem,
      ],
      actions,
    });

    this.setupWebSocket();
    this.setupRuntimeEvents();
  }

  private setupRuntimeEvents() {
    this.runtime.on("log", (level, message) => {
      // Try to extract clean message from JSON if needed
      let cleanMessage = message;
      try {
        const parsed = JSON.parse(message);
        if (parsed.message) {
          cleanMessage = parsed.message;
        }
      } catch (e) {
        // Not JSON, use as is
      }

      this.broadcast({
        type: "LOG",
        category: level,
        data: { message: cleanMessage },
        timestamp: Date.now(),
      });
    });

    this.runtime.on("agentAction", (agentId, action) => {
      const agent = this.runtime.getAgentById(agentId);
      this.broadcast({
        type: "AGENT_ACTION",
        data: {
          agentId,
          agentName: agent?.name,
        },
        timestamp: Date.now(),
      });
    });

    this.runtime.on("agentThought", (agentId, thought) => {
      const agent = this.runtime.getAgentById(agentId);
      this.broadcast({
        type: "AGENT_STATE",
        data: {
          agentId,
          agentName: agent?.name,
        },
        timestamp: Date.now(),
      });
    });

    this.runtime.on("stateUpdate", (state) => {
      const agents = state.agents.map((agent: any) => ({
        ...agent,
        active: Agent.active[agent.eid],
        lastThought: Memory.lastThought[agent.eid],
        experiences: Memory.experiences[agent.eid],
        pendingAction: Action.pendingAction[agent.eid],
        currentStimuli: Perception.currentStimuli[agent.eid],
      }));

      this.broadcast({
        type: "SYSTEM_STATE",
        data: { ...state, agents },
        timestamp: Date.now(),
      });
    });

    this.runtime.on("error", (error) => {
      this.broadcast({
        type: "ERROR",
        data: { message: error.message },
        timestamp: Date.now(),
      });
    });
  }

  private setupWebSocket() {
    wss.on("connection", (ws) => {
      this.clients.add(ws);

      ws.on("message", async (message) => {
        const command = JSON.parse(message.toString());
        switch (command.type) {
          case "START":
            await this.runtime.start();
            this.isRunning = true;
            break;
          case "PAUSE":
            this.runtime.stop();
            this.isRunning = false;
            break;
          case "STOP":
            this.runtime.stop();
            this.isRunning = false;
            this.broadcast({
              type: "SYSTEM_STATE",
              data: { isRunning: false, agents: [] },
              timestamp: Date.now(),
            });
            // Create new runtime instance
            const world = createWorld();
            this.runtime = new SimulationRuntime(world, {
              updateInterval: 3000,
              systems: [
                RoomSystem,
                ThinkingSystem,
                ActionSystem,
                StimulusCleanupSystem,
              ],
              actions,
            });
            this.setupRuntimeEvents();
            break;
          case "RESET":
            await this.loadScenario(async (runtime) => {
              const world = createWorld();
              this.runtime = new SimulationRuntime(world, {
                updateInterval: 3000,
                systems: [
                  RoomSystem,
                  ThinkingSystem,
                  ActionSystem,
                  StimulusCleanupSystem,
                ],
                actions,
              });
              this.setupRuntimeEvents();
            });
            break;
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });
    });
  }

  private broadcast(event: SimulationEvent) {
    const message = JSON.stringify(event);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async loadScenario(setupFn: (runtime: SimulationRuntime) => Promise<void>) {
    this.runtime.stop();
    try {
      await setupFn(this.runtime);
    } catch (error) {
      this.runtime.emit("error", error);
    }
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
const simServer = new SimulationServer();

// Load the basic conversation scenario
import { setupBasicConversation } from "../examples/basic-conversation";
simServer.loadScenario(setupBasicConversation);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
