import { useEffect, useCallback, useRef, useState } from "react";
import { PixiCanvas } from "./PixiCanvas";
import { TilePalette } from "./TilePalette";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { SelectionPanel } from "./SelectionPanel";
import { ZoneDialog } from "./ZoneDialog";
import { ZonesPanel } from "./ZonesPanel";
import { PrefabDialog } from "./PrefabDialog";
import { PrefabsPanel } from "./PrefabsPanel";
import { GodAIChat } from "./GodAIChat";
import { SimulationControls } from "./SimulationControls";
import { useMapEditorStore } from "../../store/mapEditorStore";
import { useSimulationStore } from "../../store/simulation";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";

export function MapEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const { map, setEntities } = useMapEditorStore();

  // Use the shared SimulationBus connection for the whole app
  const {
    sendGodCommand,
  } = useSimulationBusContext();

  // Get connection status and events from the simulation store
  const { status, events, agents } = useSimulationStore();
  const wsConnected = status === "connected";

  // Handle window resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Leave space for sidebar panels
        setCanvasSize({
          width: Math.max(400, rect.width),
          height: Math.max(300, rect.height),
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Process events from the simulation store
  useEffect(() => {
    if (events.length === 0) return;

    // Get the most recent event
    const latestEvent = events[0];

    switch (latestEvent.type) {
      case "world:state": {
        // Convert agents to EntityState format for rendering
        // The agents array from the store already has the right format
        if (agents && agents.length > 0) {
          const entityStates = agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            // Use grid position if available, otherwise use random position
            x: (agent as any).gridPosition?.x ?? Math.floor(Math.random() * 10),
            y: (agent as any).gridPosition?.y ?? Math.floor(Math.random() * 10),
            direction: "down" as const,
            spriteId: (agent as any).pixiSprite?.atlasId,
            roomName: agent.room || undefined,
          }));
          setEntities(entityStates);
        }
        break;
      }

      case "god:response":
        // Add god message to chat
        if ((window as any).__godAIChat) {
          const data = latestEvent as any;
          const response = data.thinking ||
            (data.actions?.length > 0 ? `Executed ${data.actions.length} action(s)` : "Done.");
          (window as any).__godAIChat.addGodMessage(response);
        }
        break;

      case "god:error":
        if ((window as any).__godAIChat) {
          (window as any).__godAIChat.addGodMessage(`Error: ${(latestEvent as any).error}`);
        }
        break;

      case "agent:action": {
        // Show agent actions in chat
        const data = latestEvent as any;
        if ((window as any).__godAIChat) {
          (window as any).__godAIChat.addSystemMessage(
            `[${data.agentName}] ${data.action}${data.content ? `: ${data.content.slice(0, 50)}` : ""}`
          );
        }
        break;
      }

      case "spirit:message": {
        // Show spirit messages
        const data = latestEvent as any;
        if ((window as any).__godAIChat && data.content) {
          (window as any).__godAIChat.addSystemMessage(
            `[${data.spiritName || "Spirit"}] ${data.content.slice(0, 100)}`
          );
        }
        break;
      }

      case "simulation:error": {
        const data = latestEvent as any;
        if ((window as any).__godAIChat) {
          (window as any).__godAIChat.addGodMessage(`Simulation error: ${data.error}`);
        }
        break;
      }
    }
  }, [events, agents, setEntities]);

  const handleSendGodCommand = useCallback(
    (text: string) => {
      sendGodCommand(text);
    },
    [sendGodCommand]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const store = useMapEditorStore.getState();

      switch (e.key.toLowerCase()) {
        case "s":
          store.setTool("select");
          break;
        case "p":
          store.setTool("paint");
          break;
        case "e":
          store.setTool("erase");
          break;
        case "z":
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) {
              store.redo();
            } else {
              store.undo();
            }
          } else {
            store.setTool("zone");
          }
          break;
        case "y":
          if (e.ctrlKey || e.metaKey) {
            store.redo();
          }
          break;
        case "g":
          store.toggleGrid();
          break;
        case "c":
          store.toggleCollision();
          break;
        case "1":
          store.setLayer("ground");
          break;
        case "2":
          store.setLayer("deco");
          break;
        case "3":
          store.setLayer("collision");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Top Controls */}
      <SimulationControls />

      {/* Editor Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Tile Palette */}
        <div className="w-64 flex-shrink-0 border-r border-gray-700 overflow-y-auto p-2 space-y-2">
          <TilePalette width={248} height={300} />
          <PrefabsPanel />
          <SelectionPanel />
          <ZonesPanel />
          <PropertiesPanel />
        </div>

        {/* Center - Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
        >
          {map ? (
            <PixiCanvas width={canvasSize.width} height={canvasSize.height} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-center">
                <h2 className="text-xl font-medium text-gray-300 mb-4">
                  No Map Loaded
                </h2>
                <p className="text-sm text-gray-500 mb-6">
                  Create a new map or load an existing one to get started.
                </p>
                <button
                  onClick={() => {
                    useMapEditorStore
                      .getState()
                      .createNewMap(32, 32, "New Map");
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
                >
                  Create New Map
                </button>
              </div>
            </div>
          )}

          {/* Keyboard shortcuts help */}
          <div className="absolute bottom-4 left-4 bg-gray-800/80 rounded px-3 py-2 text-xs text-gray-400">
            <div className="font-medium text-gray-300 mb-1">Shortcuts</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span>S - Select</span>
              <span>P - Paint</span>
              <span>E - Erase</span>
              <span>Z - Zone</span>
              <span>G - Toggle Grid</span>
              <span>C - Toggle Collision</span>
              <span>1/2/3 - Layers</span>
              <span>Ctrl+Z - Undo</span>
            </div>
          </div>
        </div>

        {/* Right Panel - Chat */}
        <div className="w-80 flex-shrink-0 border-l border-gray-700 p-2">
          <GodAIChat
            onSendMessage={handleSendGodCommand}
            wsConnected={wsConnected}
          />
        </div>
      </div>

      {/* Zone Dialog Modal */}
      <ZoneDialog />

      {/* Prefab Dialog Modal */}
      <PrefabDialog />
    </div>
  );
}
