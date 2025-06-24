/**
 * Real-Time Visualization Server for God Agent Simulations
 * Provides WebSocket-based visualization of ECS world state and AI consciousness
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { World, query } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import chalk from 'chalk';

export interface EntityVisualization {
  id: number;
  type: string;
  position?: { x: number, y: number };
  components: string[];
  data: Record<string, any>;
  lastThought?: string;
  activity?: 'thinking' | 'moving' | 'talking' | 'idle';
}

export interface SystemVisualization {
  name: string;
  isRunning: boolean;
  lastExecution: number;
  executionTime: number;
  entitiesAffected: number;
  usesLLM: boolean;
}

export interface ThoughtVisualization {
  entityId: number;
  thought: string;
  personality?: string;
  timestamp: number;
  position?: { x: number, y: number };
}

export class VisualizationServer {
  private app = express();
  private server = createServer(this.app);
  private io = new SocketServer(this.server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  private world: World | null = null;
  private connectedClients = 0;
  private lastWorldState: any = null;

  constructor(private port: number = 3001) {
    this.setupRoutes();
    this.setupWebSocket();
  }

  public setWorld(world: World) {
    this.world = world;
  }

  private setupRoutes() {
    // Serve static files
    this.app.use(express.static('public'));
    
    // Main visualization page
    this.app.get('/', (_req, res) => {
      res.send(this.getVisualizationHTML());
    });

    // API endpoints
    this.app.get('/api/world-state', (_req, res) => {
      if (this.world) {
        res.json(this.captureWorldState());
      } else {
        res.json({ error: 'No world loaded' });
      }
    });

    this.app.get('/api/systems', (_req, res) => {
      res.json(this.getSystemsState());
    });
  }

  private setupWebSocket() {
    this.io.on('connection', (socket) => {
      this.connectedClients++;
      console.log(chalk.cyan(`🎨 Visualization client connected (${this.connectedClients} total)`));
      
      // Send initial state
      if (this.world) {
        socket.emit('world-state', this.captureWorldState());
        socket.emit('systems-state', this.getSystemsState());
      }

      socket.on('disconnect', () => {
        this.connectedClients--;
        console.log(chalk.gray(`🎨 Visualization client disconnected (${this.connectedClients} total)`));
      });

      // Handle client requests
      socket.on('request-world-update', () => {
        if (this.world) {
          socket.emit('world-state', this.captureWorldState());
        }
      });
    });
  }

  private captureWorldState(): EntityVisualization[] {
    if (!this.world) return [];

    const entities: EntityVisualization[] = [];
    
    // Get all entities (simplified approach)
    const allEntities = query(this.world, []);
    
    for (const eid of allEntities) {
      const entityViz: EntityVisualization = {
        id: eid,
        type: 'entity',
        components: [],
        data: {}
      };

      // Check each registered component
      for (const compName of globalRegistry.listComponents()) {
        const compDef = globalRegistry.getComponent(compName);
        if (compDef?.component) {
          // Check if entity has this component (simplified)
          try {
            const hasComponent = compDef.component.x?.[eid] !== undefined || 
                               compDef.component.value?.[eid] !== undefined ||
                               compDef.component.personality?.[eid] !== undefined;
            
            if (hasComponent) {
              entityViz.components.push(compName);
              
              // Extract component data
              const componentData: any = {};
              const comp = compDef.component;
              
              // Common patterns in our components
              if (comp.x !== undefined) componentData.x = comp.x[eid];
              if (comp.y !== undefined) componentData.y = comp.y[eid];
              if (comp.value !== undefined) componentData.value = comp.value[eid];
              if (comp.personality !== undefined) componentData.personality = comp.personality[eid];
              if (comp.lastThought !== undefined) componentData.lastThought = comp.lastThought[eid];
              if (comp.text !== undefined) componentData.text = comp.text[eid];
              
              entityViz.data[compName] = componentData;
              
              // Set position if this is a Position component
              if (compName.toLowerCase().includes('position') && comp.x !== undefined) {
                entityViz.position = { x: comp.x[eid] || 0, y: comp.y[eid] || 0 };
              }
              
              // Set type based on components
              if (compName.toLowerCase().includes('npc') || compName.toLowerCase().includes('mind')) {
                entityViz.type = 'npc';
              } else if (compName.toLowerCase().includes('animal')) {
                entityViz.type = 'animal';
              }
            }
          } catch (error) {
            // Component not present on this entity
          }
        }
      }

      // Only include entities that have components
      if (entityViz.components.length > 0) {
        entities.push(entityViz);
      }
    }

    return entities;
  }

  private getSystemsState(): SystemVisualization[] {
    const systems: SystemVisualization[] = [];
    
    for (const systemName of globalRegistry.listSystems()) {
      const systemDef = globalRegistry.getSystem(systemName);
      if (systemDef) {
        systems.push({
          name: systemName,
          isRunning: false, // Would need runtime tracking
          lastExecution: systemDef.timestamp || 0,
          executionTime: 0, // Would need performance tracking
          entitiesAffected: 0, // Would need tracking
          usesLLM: systemDef.usesLLM || false
        });
      }
    }
    
    return systems;
  }

  // Public methods for emitting events
  public emitThought(thought: ThoughtVisualization) {
    this.io.emit('ai-thought', thought);
  }

  public emitSystemExecution(systemName: string, duration: number, entitiesAffected: number) {
    this.io.emit('system-execution', {
      systemName,
      duration,
      entitiesAffected,
      timestamp: Date.now()
    });
  }

  public emitWorldUpdate() {
    if (this.world && this.connectedClients > 0) {
      const newState = this.captureWorldState();
      
      // Only emit if state has changed
      if (JSON.stringify(newState) !== JSON.stringify(this.lastWorldState)) {
        this.io.emit('world-update', newState);
        this.lastWorldState = newState;
      }
    }
  }

  private getVisualizationHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>God Agent Simulation Visualizer</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { 
            font-family: monospace; 
            background: #0a0a0a; 
            color: #00ff00; 
            margin: 0; 
            padding: 20px; 
        }
        .container { display: flex; gap: 20px; }
        .panel { 
            background: #1a1a1a; 
            border: 1px solid #333; 
            padding: 15px; 
            border-radius: 5px; 
        }
        .world-view { 
            width: 600px; 
            height: 400px; 
            border: 2px solid #444; 
            position: relative; 
            background: #111; 
        }
        .entity { 
            position: absolute; 
            width: 20px; 
            height: 20px; 
            border-radius: 50%; 
            transition: all 0.3s ease;
        }
        .entity.npc { background: #00ff00; }
        .entity.animal { background: #ff6600; }
        .entity.object { background: #666; }
        .thought-bubble {
            position: absolute;
            background: rgba(255,255,255,0.9);
            color: black;
            padding: 5px;
            border-radius: 10px;
            font-size: 12px;
            max-width: 150px;
            pointer-events: none;
            z-index: 100;
        }
        .systems-list { width: 300px; }
        .system { 
            padding: 5px; 
            margin: 2px 0; 
            background: #222; 
            border-left: 3px solid #444; 
        }
        .system.llm { border-left-color: #ff00ff; }
        .system.active { border-left-color: #00ff00; }
        .log { height: 200px; overflow-y: auto; font-size: 12px; }
        .thought-log { 
            background: #002200; 
            padding: 5px; 
            margin: 2px 0; 
            border-left: 3px solid #00ff00; 
        }
    </style>
</head>
<body>
    <h1>🧠 God Agent Simulation Visualizer</h1>
    <p>Real-time visualization of ECS world with AI consciousness</p>
    
    <div class="container">
        <div class="panel">
            <h3>🌍 World View</h3>
            <div class="world-view" id="worldView"></div>
            <p>Entities: <span id="entityCount">0</span></p>
        </div>
        
        <div class="panel systems-list">
            <h3>⚙️ Systems</h3>
            <div id="systemsList"></div>
        </div>
        
        <div class="panel">
            <h3>💭 AI Thoughts</h3>
            <div class="log" id="thoughtLog"></div>
        </div>
    </div>

    <script>
        const socket = io();
        const worldView = document.getElementById('worldView');
        const entityCount = document.getElementById('entityCount');
        const systemsList = document.getElementById('systemsList');
        const thoughtLog = document.getElementById('thoughtLog');
        
        let entities = [];
        let thoughts = [];

        socket.on('world-state', (worldState) => {
            entities = worldState;
            renderEntities();
        });

        socket.on('world-update', (worldState) => {
            entities = worldState;
            renderEntities();
        });

        socket.on('systems-state', (systems) => {
            renderSystems(systems);
        });

        socket.on('ai-thought', (thought) => {
            thoughts.unshift(thought);
            if (thoughts.length > 50) thoughts.pop();
            renderThoughts();
            showThoughtBubble(thought);
        });

        socket.on('system-execution', (execution) => {
            console.log('System executed:', execution);
        });

        function renderEntities() {
            worldView.innerHTML = '';
            entityCount.textContent = entities.length;
            
            entities.forEach(entity => {
                const div = document.createElement('div');
                div.className = 'entity ' + entity.type;
                div.id = 'entity-' + entity.id;
                
                if (entity.position) {
                    // Scale position to fit in view
                    const x = (entity.position.x % 580) + 10;
                    const y = (entity.position.y % 380) + 10;
                    div.style.left = x + 'px';
                    div.style.top = y + 'px';
                }
                
                div.title = 'Entity ' + entity.id + ': ' + entity.components.join(', ');
                worldView.appendChild(div);
            });
        }

        function renderSystems(systems) {
            systemsList.innerHTML = '';
            systems.forEach(system => {
                const div = document.createElement('div');
                div.className = 'system' + (system.usesLLM ? ' llm' : '');
                div.innerHTML = \`
                    <strong>\${system.name}</strong>
                    \${system.usesLLM ? '🤖' : '⚙️'}
                \`;
                systemsList.appendChild(div);
            });
        }

        function renderThoughts() {
            thoughtLog.innerHTML = '';
            thoughts.slice(0, 20).forEach(thought => {
                const div = document.createElement('div');
                div.className = 'thought-log';
                div.innerHTML = \`
                    <strong>Entity \${thought.entityId}:</strong><br>
                    \${thought.thought}<br>
                    <small>\${new Date(thought.timestamp).toLocaleTimeString()}</small>
                \`;
                thoughtLog.appendChild(div);
            });
        }

        function showThoughtBubble(thought) {
            const entityEl = document.getElementById('entity-' + thought.entityId);
            if (entityEl) {
                const bubble = document.createElement('div');
                bubble.className = 'thought-bubble';
                bubble.textContent = thought.thought.substring(0, 100);
                bubble.style.left = (parseInt(entityEl.style.left) + 25) + 'px';
                bubble.style.top = (parseInt(entityEl.style.top) - 30) + 'px';
                
                worldView.appendChild(bubble);
                
                setTimeout(() => {
                    if (bubble.parentNode) {
                        bubble.parentNode.removeChild(bubble);
                    }
                }, 3000);
            }
        }

        // Request updates periodically
        setInterval(() => {
            socket.emit('request-world-update');
        }, 1000);
    </script>
</body>
</html>`;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(chalk.cyan(`🎨 Visualization server running on http://localhost:${this.port}`));
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log(chalk.gray('🎨 Visualization server stopped'));
        resolve();
      });
    });
  }
}

// Global instance for easy access
let visualizationServer: VisualizationServer | null = null;

export function startVisualizationServer(world: World, port: number = 3001): VisualizationServer {
  if (!visualizationServer) {
    visualizationServer = new VisualizationServer(port);
    visualizationServer.setWorld(world);
    visualizationServer.start();
  }
  return visualizationServer;
}

export function getVisualizationServer(): VisualizationServer | null {
  return visualizationServer;
}