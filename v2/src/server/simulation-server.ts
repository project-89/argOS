import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { GodAgentState } from "../god/god-agent";
import { query, getRelationTargets, entityExists } from "bitecs";
import { AllComponents, Name, Description, Agent, Mind, Room, Position, StimulusSource, Visual, Connection, GridPosition, Sprite, WorldMap } from "../ecs/components";
import { PixiSprite, AnimatedSprite } from "../rendering/components";
import { getCharacterRig, listCharacterRigs } from "../rendering/character-rig";
import { SpriteRegistry } from "../rendering/sprite-registry";
import { renderAsciiWorld } from "../world/ascii-world";
import { AllRelations, OccupiesRoom } from "../ecs/relations";
import { getAgentKnowledge, getKnowledgeSummary } from "../cognition/knowledge-graph";
import { getAgentMemory } from "../cognition/agent-mind";
import { listSystems } from "../ecs/dynamic-systems";
import { godThink } from "../god/god-agent";
import { saveWorld, getWorldSaves } from "../persistence/world-persistence";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SimulationState {
  world: World;
  registry: SystemRegistry;
  tick: number;
  events: Array<{ type: string; data: any; timestamp: number }>;
  logs: string[];
}

export interface ClientMessage {
  type: "subscribe" | "command" | "pause" | "resume" | "getState" | "godCommand" | "save" | "listSaves" | "reset";
  payload?: any;
}

export interface ServerMessage {
  type: "state" | "event" | "log" | "error" | "agentAction" | "systemUpdate" | "godResponse" | "saveComplete" | "savesList";
  payload: any;
  timestamp: number;
}

export function createSimulationServer(port: number = 3000) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  let simulationState: SimulationState | null = null;
  let godAgent: GodAgentState | null = null;
  let isPaused = false;
  const clients = new Set<WebSocket>();

  app.use(express.static(path.join(__dirname, "../../public")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../../public/index.html"));
  });

  wss.on("connection", (ws) => {
    console.log("[Server] Client connected");
    clients.add(ws);

    if (simulationState) {
      ws.send(JSON.stringify({
        type: "state",
        payload: getFullState(),
        timestamp: Date.now(),
      }));
    }

    ws.on("message", (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        console.error("[Server] Invalid message:", e);
      }
    });

    ws.on("close", () => {
      console.log("[Server] Client disconnected");
      clients.delete(ws);
    });
  });

  function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case "getState":
        ws.send(JSON.stringify({
          type: "state",
          payload: getFullState(),
          timestamp: Date.now(),
        }));
        break;
      case "pause":
        isPaused = true;
        broadcast({ type: "systemUpdate", payload: { isPaused: true }, timestamp: Date.now() });
        break;
      case "resume":
        isPaused = false;
        broadcast({ type: "systemUpdate", payload: { isPaused: false }, timestamp: Date.now() });
        break;
      case "godCommand":
        if (godAgent && msg.payload?.command) {
          handleGodCommand(ws, msg.payload.command);
        }
        break;
      case "save":
        handleSave(ws, msg.payload?.name);
        break;
      case "listSaves":
        handleListSaves(ws);
        break;
      case "reset":
        handleReset(ws);
        break;
    }
  }

  let resetCallback: (() => void) | null = null;

  function handleReset(ws: WebSocket) {
    if (resetCallback) {
      resetCallback();
      broadcast({
        type: "systemUpdate",
        payload: { reset: true },
        timestamp: Date.now(),
      });
    }
  }

  async function handleGodCommand(ws: WebSocket, command: string) {
    if (!godAgent || !simulationState) {
      ws.send(JSON.stringify({
        type: "error",
        payload: "No simulation running",
        timestamp: Date.now(),
      }));
      return;
    }

    broadcast({
      type: "log",
      payload: `[God Command] ${command}`,
      timestamp: Date.now(),
    });

    try {
      const { thinking, actions } = await godThink(godAgent, command);
      broadcast({
        type: "godResponse",
        payload: { command, thinking, results: actions, worldState: getFullState() },
        timestamp: Date.now(),
      });
    } catch (error) {
      broadcast({
        type: "error",
        payload: `God command failed: ${error}`,
        timestamp: Date.now(),
      });
    }
  }

  async function handleSave(ws: WebSocket, name?: string) {
    if (!simulationState || !godAgent) {
      ws.send(JSON.stringify({
        type: "error",
        payload: "No simulation to save",
        timestamp: Date.now(),
      }));
      return;
    }

    const saveName = name || `save_${Date.now()}`;
    const filePath = `./saves/${saveName}.json`;

    try {
      await saveWorld(
        simulationState.world,
        simulationState.registry,
        filePath
      );
      ws.send(JSON.stringify({
        type: "saveComplete",
        payload: { path: filePath, name: saveName },
        timestamp: Date.now(),
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        payload: `Save failed: ${error}`,
        timestamp: Date.now(),
      }));
    }
  }

  async function handleListSaves(ws: WebSocket) {
    try {
      const saves = await getWorldSaves();
      ws.send(JSON.stringify({
        type: "savesList",
        payload: saves,
        timestamp: Date.now(),
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        payload: `List saves failed: ${error}`,
        timestamp: Date.now(),
      }));
    }
  }

  function getFullState() {
    if (!simulationState) return null;

    const { world, registry, tick } = simulationState;
    
    const entities: any[] = [];
    const agents = Array.from(query(world, [Agent]));
    const rooms = Array.from(query(world, [Room]));

    function getVisual(eid: number) {
      if (Visual.shape[eid] || Visual.color[eid]) {
        return {
          shape: Visual.shape[eid] || "circle",
          color: Visual.color[eid] || "#6366f1",
          size: Visual.size[eid] || 20,
          label: Visual.label[eid] || "",
          opacity: Visual.opacity[eid] ?? 1,
          glow: Visual.glow[eid] || false,
          pulseRate: Visual.pulseRate[eid] || 0,
        };
      }
      return null;
    }

    for (const eid of rooms) {
      entities.push({
        id: eid,
        type: "room",
        name: Name.value[eid],
        description: Description.value[eid],
        capacity: Room.capacity[eid],
        ambience: Room.ambience[eid],
        position: Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid],
        } : null,
        visual: getVisual(eid),
      });
    }

    const stimulusSources = Array.from(query(world, [StimulusSource]));
    for (const eid of stimulusSources) {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      entities.push({
        id: eid,
        type: "stimulus_source",
        name: Name.value[eid],
        description: Description.value[eid],
        stimulusType: StimulusSource.stimulusType[eid],
        template: StimulusSource.template[eid],
        interval: StimulusSource.interval[eid],
        room: roomEid ? Name.value[roomEid] : null,
        position: Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid],
        } : null,
        visual: getVisual(eid),
      });
    }

    for (const eid of agents) {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      const memory = getAgentMemory(world, eid);
      const knowledge = getAgentKnowledge(world, eid);

      entities.push({
        id: eid,
        type: "agent",
        name: Name.value[eid],
        description: Description.value[eid],
        role: Agent.role[eid],
        active: Agent.active[eid],
        mind: {
          mode: Mind.mode[eid],
          arousal: Mind.arousal[eid],
          focus: Mind.focus[eid],
        },
        room: roomEid ? Name.value[roomEid] : null,
        position: Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid],
        } : null,
        gridPosition: GridPosition.x[eid] !== undefined ? {
          x: GridPosition.x[eid],
          y: GridPosition.y[eid],
        } : null,
        pixiSprite: PixiSprite.atlasId[eid] ? {
          atlasId: PixiSprite.atlasId[eid],
          frameId: PixiSprite.frameId[eid],
        } : null,
        animatedSprite: AnimatedSprite.atlasId[eid] ? {
          atlasId: AnimatedSprite.atlasId[eid],
          animationId: AnimatedSprite.animationId[eid],
          playing: AnimatedSprite.playing[eid],
          frameIndex: AnimatedSprite.frameIndex[eid],
        } : null,
        characterRig: getCharacterRig(eid) ? (() => {
          const rig = getCharacterRig(eid)!;
          const animation = rig.currentAction ? SpriteRegistry.getAnimation(
            rig.actionAtlases.get(rig.currentAction) || rig.baseAtlas,
            `${rig.actionMappings.get(rig.currentAction)?.animation || 'idle'}_${rig.currentDirection}`
          ) : null;
          return {
            baseAtlas: rig.baseAtlas,
            currentAction: rig.currentAction,
            currentDirection: rig.currentDirection,
            currentAnimation: animation ? {
              frames: animation.frames,
              frameRate: animation.frameRate,
              loop: animation.loop,
            } : null,
          };
        })() : null,
        visual: getVisual(eid),
        recentThoughts: memory.thoughts.slice(-3).map(t => t.content),
        recentActions: memory.recentActions.slice(-3),
        knowledge: {
          memories: knowledge.memories.length,
          beliefs: knowledge.beliefs.length,
          impressions: knowledge.impressions.size,
        },
      });
    }

    const mechanicalEntities = Array.from(query(world, [Mind])).filter(
      eid => !agents.includes(eid) && !rooms.includes(eid) && !stimulusSources.includes(eid)
    );
    for (const eid of mechanicalEntities) {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      entities.push({
        id: eid,
        type: "entity",
        name: Name.value[eid],
        description: Description.value[eid],
        mind: {
          mode: Mind.mode[eid],
          arousal: Mind.arousal[eid],
          focus: Mind.focus[eid],
        },
        room: roomEid ? Name.value[roomEid] : null,
        position: Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid],
        } : null,
        visual: getVisual(eid),
      });
    }

    const includedEids = new Set([...agents, ...rooms, ...stimulusSources, ...mechanicalEntities]);
    const allNamedEntities = Object.keys(Name.value)
      .map(Number)
      .filter(eid => Name.value[eid] && !includedEids.has(eid) && entityExists(world, eid));
    
    for (const eid of allNamedEntities) {
      const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
      const roomEid = roomTargets[0];
      entities.push({
        id: eid,
        type: "object",
        name: Name.value[eid],
        description: Description.value[eid],
        room: roomEid ? Name.value[roomEid] : null,
        position: Position.x[eid] !== undefined ? {
          x: Position.x[eid],
          y: Position.y[eid],
        } : null,
        gridPosition: GridPosition.x[eid] !== undefined ? {
          x: GridPosition.x[eid],
          y: GridPosition.y[eid],
        } : null,
        sprite: Sprite.char[eid] ? {
          char: Sprite.char[eid],
          color: Sprite.color[eid],
        } : null,
        pixiSprite: PixiSprite.atlasId[eid] ? {
          atlasId: PixiSprite.atlasId[eid],
          frameId: PixiSprite.frameId[eid],
        } : null,
        animatedSprite: AnimatedSprite.atlasId[eid] ? {
          atlasId: AnimatedSprite.atlasId[eid],
          animationId: AnimatedSprite.animationId[eid],
          playing: AnimatedSprite.playing[eid],
          frameIndex: AnimatedSprite.frameIndex[eid],
        } : null,
        characterRig: getCharacterRig(eid) ? (() => {
          const rig = getCharacterRig(eid)!;
          const animation = rig.currentAction ? SpriteRegistry.getAnimation(
            rig.actionAtlases.get(rig.currentAction) || rig.baseAtlas,
            `${rig.actionMappings.get(rig.currentAction)?.animation || 'idle'}_${rig.currentDirection}`
          ) : null;
          return {
            baseAtlas: rig.baseAtlas,
            currentAction: rig.currentAction,
            currentDirection: rig.currentDirection,
            currentAnimation: animation ? {
              frames: animation.frames,
              frameRate: animation.frameRate,
              loop: animation.loop,
            } : null,
          };
        })() : null,
        visual: getVisual(eid),
      });
    }

    const systems = listSystems(registry).map(s => ({
      name: s.name,
      description: s.description,
      pseudocode: s.pseudocode,
      code: s.code,
      frequency: s.frequency,
      active: s.active,
      lastRun: s.lastRun,
    }));

    const asciiWorld = renderAsciiWorld(world);

    const atlases: Record<string, any> = {};
    for (const atlas of SpriteRegistry.listAtlases()) {
      // Convert absolute file system path to web-accessible URL
      // e.g., "/Users/.../public/32x32/foo.png" -> "/32x32/foo.png"
      let webPath = atlas.imagePath;
      const publicIndex = webPath.indexOf('/public/');
      if (publicIndex !== -1) {
        webPath = webPath.slice(publicIndex + '/public'.length);
      }

      atlases[atlas.id] = {
        imagePath: webPath,
        tileWidth: atlas.tileWidth,
        tileHeight: atlas.tileHeight,
        frames: Object.fromEntries(atlas.frames),
        animations: Object.fromEntries(atlas.animations),
      };
    }

    return {
      tick,
      isPaused,
      entities,
      systems,
      recentEvents: simulationState.events.slice(-20),
      recentLogs: simulationState.logs.slice(-20),
      asciiWorld,
      atlases,
      characterRigs: listCharacterRigs(),
    };
  }

  function broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  function setSimulationState(state: SimulationState) {
    simulationState = state;
  }

  function setGodAgent(god: GodAgentState) {
    godAgent = god;
  }

  function pushEvent(type: string, data: any) {
    if (!simulationState) return;
    const event = { type, data, timestamp: Date.now() };
    simulationState.events.push(event);
    if (simulationState.events.length > 100) {
      simulationState.events.shift();
    }
    broadcast({ type: "event", payload: event, timestamp: Date.now() });
  }

  function pushLog(message: string) {
    if (!simulationState) return;
    simulationState.logs.push(message);
    if (simulationState.logs.length > 100) {
      simulationState.logs.shift();
    }
    broadcast({ type: "log", payload: message, timestamp: Date.now() });
  }

  function pushAgentAction(agentName: string, action: any, thought?: string) {
    broadcast({
      type: "agentAction",
      payload: { agent: agentName, action, thought },
      timestamp: Date.now(),
    });
  }

  function updateState() {
    if (!simulationState) return;
    broadcast({
      type: "state",
      payload: getFullState(),
      timestamp: Date.now(),
    });
  }

  function start() {
    server.listen(port, () => {
      console.log(`\n🌐 Simulation UI: http://localhost:${port}`);
    });
  }

  return {
    start,
    setSimulationState,
    setGodAgent,
    pushEvent,
    pushLog,
    pushAgentAction,
    updateState,
    isPaused: () => isPaused,
    onReset: (cb: () => void) => { resetCallback = cb; },
  };
}
