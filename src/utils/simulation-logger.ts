import fs from "fs/promises";
import path from "path";
import { RoomEvent, AgentEvent, AgentState, RoomState } from "../types";

interface SimulationLog {
  id: string;
  timestamp: number;
  metadata: {
    duration: number;
    eventCount: number;
    agents: Array<{
      id: string;
      name: string;
      role: string;
      currentRoom?: string;
    }>;
    rooms: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  };
  rooms: Record<
    string,
    {
      events: Array<{
        type: string;
        content: any;
        timestamp: number;
        agentId?: string;
        category?: string;
      }>;
      agents: Record<string, AgentState>;
    }
  >;
}

export class SimulationLogger {
  private currentLog: SimulationLog;
  private logDir: string;

  constructor() {
    // Store in repo root under devLogs
    this.logDir = path.join(process.cwd(), "devLogs", "simulations");
    this.currentLog = this.createNewLog();
  }

  async logRoomEvent(event: RoomEvent) {
    const roomId = event.roomId;

    // Initialize room if needed
    if (!this.currentLog.rooms[roomId]) {
      this.currentLog.rooms[roomId] = {
        events: [],
        agents: {},
      };
    }

    // Add event
    this.currentLog.rooms[roomId].events.push({
      type: event.type,
      content: event.content,
      timestamp: event.timestamp,
      agentId: event.agentId,
    });

    // Update metadata
    this.currentLog.metadata.eventCount++;
    this.currentLog.metadata.duration = Date.now() - this.currentLog.timestamp;

    await this.checkFlush();
  }

  async logAgentEvent(event: AgentEvent, roomId: string) {
    if (roomId) {
      await this.logRoomEvent({
        ...event,
        roomId,
        type: event.type,
        content: event.content,
      });

      // Update agent state in room
      if (
        event.type === "state" &&
        typeof event.content === "object" &&
        "agent" in event.content &&
        event.content.agent
      ) {
        this.currentLog.rooms[roomId].agents[event.agentId] =
          event.content.agent;
      }
    }

    await this.checkFlush();
  }

  async updateRoomState(roomId: string, state: RoomState) {
    // Update room metadata
    const roomMeta = this.currentLog.metadata.rooms.find(
      (r) => r.id === roomId
    );
    if (roomMeta) {
      roomMeta.name = state.name;
      roomMeta.description = state.description;
    } else {
      this.currentLog.metadata.rooms.push({
        id: roomId,
        name: state.name,
        description: state.description,
      });
    }
  }

  private async checkFlush() {
    // Write to file every 100 total events
    if (this.currentLog.metadata.eventCount % 100 === 0) {
      await this.flush();
    }
  }

  private createNewLog(): SimulationLog {
    return {
      id: `sim_${Date.now()}`,
      timestamp: Date.now(),
      metadata: {
        duration: 0,
        eventCount: 0,
        agents: [],
        rooms: [],
      },
      rooms: {},
    };
  }

  async flush() {
    const fileName = `${this.currentLog.id}.json`;
    const filePath = path.join(this.logDir, fileName);

    await fs.mkdir(this.logDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.currentLog, null, 2));

    // Also generate an index.html that lists all simulation logs
    await this.generateIndex();
  }

  private async generateIndex() {
    const files = await fs.readdir(this.logDir);
    const logs = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const content = await fs.readFile(path.join(this.logDir, f), "utf-8");
          return JSON.parse(content);
        })
    );

    // Copy template.html to each simulation directory
    for (const log of logs) {
      const simDir = path.join(this.logDir, "sims", log.id);
      await fs.mkdir(simDir, { recursive: true });

      // Copy template
      const templatePath = path.join(this.logDir, "sims", "template.html");
      const templateContent = await fs.readFile(templatePath, "utf-8");
      await fs.writeFile(path.join(simDir, "index.html"), templateContent);

      // Write data file
      await fs.writeFile(
        path.join(simDir, "data.json"),
        JSON.stringify(log, null, 2)
      );
    }

    // Generate main index.html
    const mainHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Oneirocom Simulation Logs</title>
    <link href="terminal.css" rel="stylesheet">
    <script src="https://unpkg.com/vue@3"></script>
  </head>
  <body>
    <div id="app">
      <div class="terminal-container">
        <div class="terminal-header">
          <h1>ONEIROCOM SIMULATION LOGS</h1>
          <div class="terminal-status">
            <span>STATUS: ONLINE</span>
            <span class="timestamp">{{ currentTime }}</span>
          </div>
        </div>

        <div class="simulation-grid">
          <div v-for="log in logs" :key="log.id" class="simulation-card">
            <div class="card-header">
              <h2>{{ formatDate(log.timestamp) }}</h2>
              <span class="sim-id">SIM_ID: {{ log.id }}</span>
            </div>
            
            <div class="terminal-stats">
              <span>
                <span class="stat-label">EVENTS:</span> 
                {{ log.metadata.eventCount }}
              </span>
              <span>
                <span class="stat-label">DURATION:</span> 
                {{ (log.metadata.duration / 1000).toFixed(2) }}s
              </span>
              <span>
                <span class="stat-label">AGENTS:</span> 
                {{ log.metadata.agents.length }}
              </span>
              <span>
                <span class="stat-label">ROOMS:</span> 
                {{ log.metadata.rooms.length }}
              </span>
            </div>

            <div class="terminal-links">
              <a :href="'sims/' + log.id + '/index.html'" class="terminal-link">VIEW DETAILS</a>
              <a :href="'sims/' + log.id + '/data.json'" class="terminal-link">RAW DATA</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      Vue.createApp({
        data() {
          return {
            logs: ${JSON.stringify(logs)},
            currentTime: new Date().toLocaleTimeString()
          }
        },
        methods: {
          formatDate(timestamp) {
            return new Date(timestamp).toLocaleString();
          },
          updateTime() {
            this.currentTime = new Date().toLocaleTimeString();
          }
        },
        mounted() {
          setInterval(this.updateTime, 1000);
        }
      }).mount('#app');
    </script>
  </body>
</html>`;

    await fs.writeFile(path.join(this.logDir, "index.html"), mainHtml);
  }
}
