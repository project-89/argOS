/**
 * Universal Visualization System
 * Adapts to any simulation type - spatial, text-based, abstract, etc.
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { World, query } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { getString } from '../components/god-components.js';
import chalk from 'chalk';

export interface UniversalEntity {
  id: number;
  name?: string;
  components: string[];
  data: Record<string, any>;
  visualization?: {
    type: 'spatial' | 'node' | 'text' | 'card' | 'abstract';
    position?: { x: number; y: number; z?: number };
    color?: string;
    icon?: string;
    label?: string;
    description?: string;
    connections?: number[]; // Related entities
  };
}

export interface SimulationMetadata {
  type: 'physical' | 'social' | 'narrative' | 'abstract' | 'hybrid';
  theme: string;
  primaryComponents: string[];
  hasPosition: boolean;
  hasDialogue: boolean;
  hasRelationships: boolean;
  timeScale?: string;
}

export class UniversalVisualizer {
  private app = express();
  private server = createServer(this.app);
  private io = new SocketServer(this.server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  private world: World | null = null;
  private simulationType: SimulationMetadata | null = null;
  private narrativeLog: Array<{timestamp: number, text: string, entities: number[]}> = [];
  private customUI: { html: string; css: string; js: string } | null = null;

  constructor(private port: number = 8080) {
    this.setupRoutes();
    this.setupWebSocket();
  }

  public setWorld(world: World) {
    this.world = world;
    this.detectSimulationType();
  }

  private detectSimulationType() {
    if (!this.world) return;

    const components = globalRegistry.listComponents();
    const hasPosition = components.some(c => 
      c.toLowerCase().includes('position') || 
      c.toLowerCase().includes('location')
    );
    const hasDialogue = components.some(c => 
      c.toLowerCase().includes('dialogue') || 
      c.toLowerCase().includes('speech') ||
      c.toLowerCase().includes('conversation')
    );
    const hasRelationships = globalRegistry.listRelationships().length > 0;

    // Determine simulation type
    let type: SimulationMetadata['type'] = 'abstract';
    let theme = 'Unknown Simulation';

    if (hasPosition && !hasDialogue) {
      type = 'physical';
      theme = 'Physical Simulation';
    } else if (hasDialogue && hasRelationships) {
      type = 'social';
      theme = 'Social Simulation';
    } else if (hasDialogue) {
      type = 'narrative';
      theme = 'Narrative Simulation';
    } else if (hasRelationships) {
      type = 'abstract';
      theme = 'Relational System';
    }

    this.simulationType = {
      type,
      theme,
      primaryComponents: components.slice(0, 5),
      hasPosition,
      hasDialogue,
      hasRelationships
    };
  }

  private captureEntities(): UniversalEntity[] {
    if (!this.world) return [];

    const entities: UniversalEntity[] = [];
    const allComponents = new Map<string, any>();
    
    // Get all registered components
    for (const compName of globalRegistry.listComponents()) {
      const compDef = globalRegistry.getComponent(compName);
      if (compDef?.component) {
        allComponents.set(compName, compDef.component);
      }
    }

    // Find all entities
    const seenEntities = new Set<number>();
    
    for (const [, comp] of allComponents) {
      const entitiesWithComp = query(this.world, [comp]);
      
      for (const eid of entitiesWithComp) {
        if (!seenEntities.has(eid)) {
          seenEntities.add(eid);
          
          const entity: UniversalEntity = {
            id: eid,
            components: [],
            data: {}
          };

          // Gather all component data
          for (const [checkCompName, checkComp] of allComponents) {
            const componentData: any = {};
            let hasData = false;

            for (const prop in checkComp) {
              if (Array.isArray(checkComp[prop])) {
                const value = checkComp[prop][eid];
                if (value !== undefined && value !== 0) {
                  hasData = true;
                  componentData[prop] = value;
                  
                  // Try to get string values
                  if (prop.includes('name') || prop.includes('Hash')) {
                    const stringValue = getString(value);
                    if (stringValue) {
                      componentData[`${prop}_string`] = stringValue;
                      if (prop.includes('name')) {
                        entity.name = stringValue;
                      }
                    }
                  }
                }
              }
            }

            if (hasData) {
              entity.components.push(checkCompName);
              entity.data[checkCompName] = componentData;
            }
          }

          // Determine visualization based on components
          entity.visualization = this.determineVisualization(entity);
          entities.push(entity);
        }
      }
    }

    return entities;
  }

  private determineVisualization(entity: UniversalEntity): UniversalEntity['visualization'] {
    const viz: UniversalEntity['visualization'] = {
      type: 'abstract',
      label: entity.name || `Entity ${entity.id}`,
      color: this.getEntityColor(entity),
      icon: this.getEntityIcon(entity)
    };

    // Check for position data
    const positionComp = entity.components.find(c => 
      c.toLowerCase().includes('position') || 
      c.toLowerCase().includes('location')
    );
    
    if (positionComp && entity.data[positionComp]) {
      const pos = entity.data[positionComp];
      if ('x' in pos || 'y' in pos) {
        viz.type = 'spatial';
        viz.position = {
          x: pos.x || 0,
          y: pos.y || 0,
          z: pos.z || 0
        };
      }
    }

    // Check for dialogue/text
    const dialogueComp = entity.components.find(c => 
      c.toLowerCase().includes('dialogue') || 
      c.toLowerCase().includes('speech')
    );
    
    if (dialogueComp) {
      viz.type = 'text';
      const dialogue = entity.data[dialogueComp];
      if (dialogue.text_string) {
        viz.description = dialogue.text_string;
      }
    }

    // Build description from all data
    if (!viz.description) {
      const parts: string[] = [];
      for (const [compName, data] of Object.entries(entity.data)) {
        const values = Object.entries(data)
          .filter(([k]) => !k.includes('Hash'))
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        if (values) {
          parts.push(`${compName}: {${values}}`);
        }
      }
      viz.description = parts.join(' | ');
    }

    return viz;
  }

  private getEntityColor(entity: UniversalEntity): string {
    // Color based on primary component
    if (entity.components.some(c => c.toLowerCase().includes('npc'))) return '#00ff00';
    if (entity.components.some(c => c.toLowerCase().includes('animal'))) return '#ff6600';
    if (entity.components.some(c => c.toLowerCase().includes('player'))) return '#00ffff';
    if (entity.components.some(c => c.toLowerCase().includes('item'))) return '#ffff00';
    if (entity.components.some(c => c.toLowerCase().includes('particle'))) return '#ff00ff';
    
    // Hash-based color for others
    const hash = entity.id * 2654435761;
    return `hsl(${hash % 360}, 70%, 50%)`;
  }

  private getEntityIcon(entity: UniversalEntity): string {
    if (entity.components.some(c => c.toLowerCase().includes('person'))) return '👤';
    if (entity.components.some(c => c.toLowerCase().includes('npc'))) return '🤖';
    if (entity.components.some(c => c.toLowerCase().includes('animal'))) return '🐾';
    if (entity.components.some(c => c.toLowerCase().includes('particle'))) return '✨';
    if (entity.components.some(c => c.toLowerCase().includes('neuron'))) return '🧠';
    if (entity.components.some(c => c.toLowerCase().includes('plant'))) return '🌱';
    if (entity.components.some(c => c.toLowerCase().includes('item'))) return '📦';
    return '●';
  }

  private setupRoutes() {
    this.app.get('/', (_req, res) => {
      res.send(this.getUniversalHTML());
    });

    this.app.get('/api/simulation-info', (_req, res) => {
      res.json({
        metadata: this.simulationType,
        entities: this.captureEntities(),
        systems: this.getSystemsInfo(),
        narrative: this.narrativeLog.slice(-20)
      });
    });
  }

  private getSystemsInfo() {
    return globalRegistry.listSystems().map(name => {
      const system = globalRegistry.getSystem(name);
      return {
        name,
        components: system?.requiredComponents || [],
        isAsync: system?.isAsync || false,
        usesLLM: system?.usesLLM || false,
        hasError: !!system?.lastError
      };
    });
  }

  private setupWebSocket() {
    this.io.on('connection', (socket) => {
      console.log(chalk.cyan('🎨 Universal visualizer connected'));
      
      // Send initial state
      socket.emit('simulation-update', {
        metadata: this.simulationType,
        entities: this.captureEntities(),
        systems: this.getSystemsInfo(),
        customUI: this.customUI
      });
      
      // Send custom UI if it exists
      if (this.customUI) {
        socket.emit('custom-ui-update', this.customUI);
      }

      socket.on('disconnect', () => {
        console.log(chalk.gray('🎨 Visualizer disconnected'));
      });
    });
  }

  public start() {
    this.server.listen(this.port, () => {
      console.log(chalk.green(`
╔════════════════════════════════════════════╗
║       Universal Visualizer Active          ║
║                                            ║
║  Open: http://localhost:${this.port}              ║
║                                            ║
║  Adapts to any simulation type!            ║
╚════════════════════════════════════════════╝
      `));
    });
  }

  public stop() {
    this.server.close();
  }

  public emitUpdate() {
    this.io.emit('simulation-update', {
      metadata: this.simulationType,
      entities: this.captureEntities(),
      systems: this.getSystemsInfo(),
      customUI: this.customUI
    });
  }

  public addNarrative(text: string, entities: number[] = []) {
    const entry = {
      timestamp: Date.now(),
      text,
      entities
    };
    this.narrativeLog.push(entry);
    this.io.emit('narrative-event', entry);
  }

  public setCustomUI(ui: { html: string; css: string; js: string }) {
    this.customUI = ui;
    this.io.emit('custom-ui-update', ui);
  }

  private getUniversalHTML(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Universal Simulation Visualizer</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/vis-network@latest/dist/vis-network.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/vis-network@latest/dist/dist/vis-network.min.css" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; 
            padding: 0; 
            background: #0a0a0a; 
            color: #fff;
            overflow: hidden;
        }
        .header {
            background: #1a1a1a;
            padding: 10px 20px;
            border-bottom: 1px solid #333;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            color: #00ff88;
        }
        .simulation-type {
            font-size: 14px;
            color: #888;
            margin-top: 5px;
        }
        .main-container {
            display: flex;
            height: calc(100vh - 80px);
        }
        .visualization-pane {
            flex: 1;
            position: relative;
            background: #111;
            border-right: 1px solid #333;
        }
        .info-pane {
            width: 400px;
            background: #1a1a1a;
            display: flex;
            flex-direction: column;
        }
        .tabs {
            display: flex;
            background: #222;
            border-bottom: 1px solid #333;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.3s;
        }
        .tab:hover { background: #2a2a2a; }
        .tab.active {
            color: #00ff88;
            border-bottom-color: #00ff88;
        }
        .tab-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }
        
        /* Visualization styles */
        #network-view {
            width: 100%;
            height: 100%;
        }
        .spatial-view {
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
        }
        .spatial-entity {
            position: absolute;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            transition: all 0.3s;
            cursor: pointer;
        }
        .spatial-entity:hover {
            transform: scale(1.2);
            z-index: 100;
        }
        
        /* Text/Narrative view */
        .narrative-view {
            padding: 20px;
            font-family: 'Georgia', serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
        }
        .narrative-entry {
            margin: 20px 0;
            padding: 15px;
            background: rgba(255,255,255,0.05);
            border-left: 3px solid #00ff88;
            border-radius: 3px;
        }
        .narrative-time {
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
        }
        
        /* Entity cards */
        .entity-card {
            background: #222;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            transition: all 0.3s;
        }
        .entity-card:hover {
            background: #2a2a2a;
            border-color: #00ff88;
        }
        .entity-name {
            font-size: 18px;
            color: #00ff88;
            margin-bottom: 5px;
        }
        .entity-components {
            font-size: 12px;
            color: #888;
            margin-bottom: 10px;
        }
        .component-data {
            background: #1a1a1a;
            padding: 8px;
            border-radius: 4px;
            margin: 5px 0;
            font-family: monospace;
            font-size: 12px;
        }
        
        /* Systems panel */
        .system-item {
            background: #222;
            border-left: 3px solid #444;
            padding: 10px;
            margin: 5px 0;
            transition: all 0.3s;
        }
        .system-item.llm { border-left-color: #ff00ff; }
        .system-item.error { border-left-color: #ff4444; }
        .system-item.active { 
            border-left-color: #00ff88;
            background: #1a2a1a;
        }
        
        /* Abstract view */
        .abstract-view {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            padding: 20px;
        }
        
        .connection-count {
            position: absolute;
            top: 5px;
            right: 5px;
            background: #00ff88;
            color: #000;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🌌 Universal Simulation Visualizer</h1>
        <div class="simulation-type" id="sim-type">Detecting simulation type...</div>
    </div>
    
    <div class="main-container">
        <div class="visualization-pane" id="viz-pane">
            <!-- Dynamic visualization based on simulation type -->
        </div>
        
        <div class="info-pane">
            <div class="tabs">
                <div class="tab active" onclick="showTab('entities')">Entities</div>
                <div class="tab" onclick="showTab('systems')">Systems</div>
                <div class="tab" onclick="showTab('narrative')">Narrative</div>
                <div class="tab" onclick="showTab('data')">Raw Data</div>
            </div>
            
            <div class="tab-content" id="tab-entities">
                <!-- Entity list -->
            </div>
            
            <div class="tab-content" id="tab-systems" style="display:none">
                <!-- Systems list -->
            </div>
            
            <div class="tab-content" id="tab-narrative" style="display:none">
                <!-- Narrative log -->
            </div>
            
            <div class="tab-content" id="tab-data" style="display:none">
                <pre id="raw-data" style="color:#0f0;font-size:10px"></pre>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let currentData = null;
        let network = null;
        let visualizationType = 'abstract';
        
        function showTab(tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
            
            event.target.classList.add('active');
            document.getElementById('tab-' + tabName).style.display = 'block';
        }
        
        socket.on('simulation-update', (data) => {
            currentData = data;
            updateVisualization();
            updatePanels();
        });
        
        socket.on('narrative-event', (event) => {
            addNarrativeEntry(event);
        });
        
        function updateVisualization() {
            if (!currentData) return;
            
            const simType = currentData.metadata?.type || 'abstract';
            document.getElementById('sim-type').textContent = 
                currentData.metadata?.theme || 'Unknown Simulation';
            
            const vizPane = document.getElementById('viz-pane');
            
            if (simType === 'physical' && currentData.metadata.hasPosition) {
                renderSpatialView(vizPane, currentData.entities);
            } else if (simType === 'social' || currentData.entities.length < 20) {
                renderNetworkView(vizPane, currentData.entities);
            } else if (simType === 'narrative') {
                renderNarrativeView(vizPane, currentData.entities);
            } else {
                renderAbstractView(vizPane, currentData.entities);
            }
        }
        
        function renderSpatialView(container, entities) {
            container.innerHTML = '<div class="spatial-view" id="spatial-container"></div>';
            const spatial = document.getElementById('spatial-container');
            
            entities.forEach(entity => {
                if (entity.visualization?.position) {
                    const el = document.createElement('div');
                    el.className = 'spatial-entity';
                    el.textContent = entity.visualization.icon || '●';
                    el.style.left = (entity.visualization.position.x + 250) + 'px';
                    el.style.top = (250 - entity.visualization.position.y) + 'px';
                    el.style.color = entity.visualization.color;
                    el.title = entity.visualization.label || entity.id;
                    
                    el.onclick = () => showEntityDetails(entity);
                    spatial.appendChild(el);
                }
            });
        }
        
        function renderNetworkView(container, entities) {
            container.innerHTML = '<div id="network-view"></div>';
            
            const nodes = entities.map(e => ({
                id: e.id,
                label: e.visualization?.label || \`Entity \${e.id}\`,
                color: e.visualization?.color || '#666',
                shape: 'dot',
                size: 20 + (e.components.length * 5),
                title: e.visualization?.description
            }));
            
            const edges = [];
            // TODO: Add edges based on relationships
            
            const data = { nodes, edges };
            const options = {
                nodes: {
                    font: { color: '#fff' }
                },
                edges: {
                    color: '#444'
                },
                physics: {
                    enabled: true,
                    solver: 'forceAtlas2Based'
                }
            };
            
            network = new vis.Network(
                document.getElementById('network-view'),
                data,
                options
            );
            
            network.on('click', (params) => {
                if (params.nodes.length > 0) {
                    const entity = entities.find(e => e.id === params.nodes[0]);
                    if (entity) showEntityDetails(entity);
                }
            });
        }
        
        function renderNarrativeView(container, entities) {
            container.innerHTML = '<div class="narrative-view" id="narrative-container"></div>';
            // Narrative will be populated by events
        }
        
        function renderAbstractView(container, entities) {
            container.innerHTML = '<div class="abstract-view" id="abstract-container"></div>';
            const abstract = document.getElementById('abstract-container');
            
            entities.forEach(entity => {
                const card = document.createElement('div');
                card.className = 'entity-card';
                card.innerHTML = \`
                    <div class="entity-name">\${entity.visualization?.icon} \${entity.name || \`Entity \${entity.id}\`}</div>
                    <div class="entity-components">\${entity.components.join(', ')}</div>
                \`;
                card.onclick = () => showEntityDetails(entity);
                abstract.appendChild(card);
            });
        }
        
        function updatePanels() {
            if (!currentData) return;
            
            // Update entities panel
            const entitiesPanel = document.getElementById('tab-entities');
            entitiesPanel.innerHTML = currentData.entities.map(e => \`
                <div class="entity-card" onclick="showEntityDetails(\${JSON.stringify(e).replace(/"/g, '&quot;')})">
                    <div class="entity-name">\${e.visualization?.icon} \${e.name || \`Entity \${e.id}\`}</div>
                    <div class="entity-components">\${e.components.join(', ')}</div>
                    <div class="component-data">
                        \${Object.entries(e.data).map(([comp, data]) => 
                            \`<div><strong>\${comp}:</strong> \${JSON.stringify(data)}</div>\`
                        ).join('')}
                    </div>
                </div>
            \`).join('');
            
            // Update systems panel
            const systemsPanel = document.getElementById('tab-systems');
            systemsPanel.innerHTML = currentData.systems.map(s => \`
                <div class="system-item \${s.usesLLM ? 'llm' : ''} \${s.hasError ? 'error' : ''}">
                    <strong>\${s.name}</strong>
                    <div style="font-size:12px;color:#888">
                        Components: \${s.components.join(', ') || 'none'}
                        \${s.usesLLM ? ' | 🤖 AI-Powered' : ''}
                        \${s.hasError ? ' | ⚠️ Has Error' : ''}
                    </div>
                </div>
            \`).join('');
            
            // Update raw data
            document.getElementById('raw-data').textContent = 
                JSON.stringify(currentData, null, 2);
        }
        
        function showEntityDetails(entity) {
            console.log('Entity details:', entity);
            // Could show a modal or update a detail panel
        }
        
        function addNarrativeEntry(event) {
            const narrative = document.getElementById('tab-narrative');
            const entry = document.createElement('div');
            entry.className = 'narrative-entry';
            entry.innerHTML = \`
                <div class="narrative-time">\${new Date(event.timestamp).toLocaleTimeString()}</div>
                <div>\${event.text}</div>
            \`;
            narrative.insertBefore(entry, narrative.firstChild);
        }
        
        // Initial render
        updateVisualization();
    </script>
</body>
</html>`;
  }
}

// Global instance
let universalVisualizer: UniversalVisualizer | null = null;

export function startUniversalVisualization(world: World, port: number = 8080): UniversalVisualizer {
  if (!universalVisualizer) {
    universalVisualizer = new UniversalVisualizer(port);
    universalVisualizer.start();
  }
  universalVisualizer.setWorld(world);
  return universalVisualizer;
}

export function getUniversalVisualizer(): UniversalVisualizer | null {
  return universalVisualizer;
}

export function emitNarrative(text: string, entities: number[] = []) {
  if (universalVisualizer) {
    universalVisualizer.addNarrative(text, entities);
  }
}