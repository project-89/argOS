import { useState } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import { useProjectStore } from "../../store/projectStore";
import { useAutosave } from "../../hooks/useAutosave";
import { TilesetPanel } from "./TilesetPanel";
import { ProjectManager } from "./ProjectManager";

export function SimulationControls() {
  const { map, setMap, createNewMap } = useMapEditorStore();
  const {
    currentProjectId,
    isDirty,
    createProject,
    openProject,
    importProject,
  } = useProjectStore();

  // Initialize autosave
  const { save: manualSave, autosaveEnabled } = useAutosave();

  const [showNewMapDialog, setShowNewMapDialog] = useState(false);
  const [showTilesetPanel, setShowTilesetPanel] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [newMapName, setNewMapName] = useState("New Map");
  const [newMapWidth, setNewMapWidth] = useState(32);
  const [newMapHeight, setNewMapHeight] = useState(32);

  const handleCreateMap = () => {
    // Create the map in the editor
    createNewMap(newMapWidth, newMapHeight, newMapName);

    // Get the created map and create a project for it
    const newMap = useMapEditorStore.getState().map;
    if (newMap) {
      createProject(newMapName, newMap);
    }

    setShowNewMapDialog(false);
  };

  const handleSaveMap = () => {
    if (!map) return;

    // If we have a current project, save to it
    if (currentProjectId) {
      manualSave();
    } else {
      // No project - create one
      createProject(map.name || "Untitled", map);
    }
  };

  const handleLoadMap = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.argosmap.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        // Import as a new project
        const newProjectId = importProject(text);
        if (newProjectId) {
          const loadedMap = openProject(newProjectId);
          if (loadedMap) {
            setMap(loadedMap);
          }
        } else {
          alert("Failed to import map file");
        }
      } catch (err) {
        console.error("Failed to load map:", err);
        alert("Failed to load map file");
      }
    };
    input.click();
  };

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
      <div className="flex items-center justify-between">
        {/* Left: File Operations */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewMapDialog(true)}
            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-500"
          >
            New Map
          </button>
          <button
            onClick={handleLoadMap}
            className="px-3 py-1.5 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
          >
            Load
          </button>
          <button
            onClick={handleSaveMap}
            disabled={!map}
            className="px-3 py-1.5 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setShowTilesetPanel(true)}
            disabled={!map}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50"
          >
            Tilesets
          </button>
          {map && (
            <>
              <span className="text-sm text-gray-400 ml-2">
                {map.name} ({map.grid.width}x{map.grid.height})
              </span>
              {/* Autosave/Dirty indicator */}
              {currentProjectId && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  isDirty
                    ? "bg-yellow-600/30 text-yellow-400"
                    : autosaveEnabled
                      ? "bg-green-600/30 text-green-400"
                      : "bg-gray-600/30 text-gray-400"
                }`}>
                  {isDirty ? "Unsaved" : autosaveEnabled ? "Saved" : "Manual"}
                </span>
              )}
            </>
          )}
          {/* Projects button */}
          <button
            onClick={() => setShowProjectManager(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 ml-2"
          >
            Projects
          </button>
        </div>

        {/* Right: Engine Controls moved to global header */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Global simulation controls are now in the top header.
          </span>
        </div>
      </div>

      {/* Tileset Panel */}
      {showTilesetPanel && (
        <TilesetPanel onClose={() => setShowTilesetPanel(false)} />
      )}

      {/* Project Manager */}
      {showProjectManager && (
        <ProjectManager onClose={() => setShowProjectManager(false)} />
      )}

      {/* New Map Dialog */}
      {showNewMapDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700">
            <h3 className="text-lg font-medium text-white mb-4">Create New Map</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newMapName}
                  onChange={(e) => setNewMapName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Width (tiles)
                  </label>
                  <input
                    type="number"
                    value={newMapWidth}
                    onChange={(e) => setNewMapWidth(parseInt(e.target.value) || 16)}
                    min={8}
                    max={256}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Height (tiles)
                  </label>
                  <input
                    type="number"
                    value={newMapHeight}
                    onChange={(e) => setNewMapHeight(parseInt(e.target.value) || 16)}
                    min={8}
                    max={256}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowNewMapDialog(false)}
                className="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMap}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-500"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
