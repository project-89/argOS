import { useState, useCallback } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { EditorTool } from "../../types/map";

const tools: { id: EditorTool; icon: string; label: string }[] = [
  { id: "select", icon: "⬚", label: "Select" },
  { id: "paint", icon: "🖌", label: "Paint" },
  { id: "erase", icon: "🗑", label: "Erase" },
  { id: "zone", icon: "▭", label: "Zone" },
];

export function Toolbar() {
  const {
    map,
    tool,
    layer,
    showCollision,
    showZones,
    showGrid,
    zoom,
    isEditing,
    setTool,
    setLayer,
    toggleCollision,
    toggleZones,
    toggleGrid,
    setZoom,
    setEditing,
    undo,
    redo,
    addLayer,
    removeLayer,
    moveLayerUp,
    moveLayerDown,
    toggleLayerVisibility,
  } = useMapEditorStore();

  const [showLayerMenu, setShowLayerMenu] = useState<string | null>(null);
  const [showAddLayer, setShowAddLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");

  const handleAddLayer = useCallback(() => {
    if (!newLayerName.trim() || !map) return;
    // Default to first tileset
    addLayer(newLayerName.trim(), map.tilesets[0]?.id || "terrain");
    setNewLayerName("");
    setShowAddLayer(false);
  }, [newLayerName, map, addLayer]);

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
      <div className="flex items-center gap-6">
        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              isEditing
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            Edit
          </button>
          <button
            onClick={() => setEditing(false)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              !isEditing
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            View
          </button>
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Tools */}
        <div className="flex items-center gap-1">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              disabled={!isEditing}
              title={t.label}
              className={`w-8 h-8 flex items-center justify-center rounded text-lg transition-colors ${
                tool === t.id
                  ? "bg-blue-600 text-white"
                  : isEditing
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-800 text-gray-500 cursor-not-allowed"
              }`}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Layers - Dropdown */}
        <div className="flex items-center gap-2 relative">
          <span className="text-xs text-gray-400">Layer:</span>

          {/* Layer dropdown */}
          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            disabled={!isEditing}
            className="bg-gray-700 text-gray-200 text-xs px-2 py-1.5 rounded border border-gray-600 min-w-[120px] disabled:opacity-50"
          >
            {map?.layers.tileLayers.map((tileLayer) => (
              <option key={tileLayer.id} value={tileLayer.id}>
                {tileLayer.name} {!tileLayer.visible ? "(hidden)" : ""}
              </option>
            ))}
            <option value="collision">Collision</option>
          </select>

          {/* Layer management dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowLayerMenu(showLayerMenu ? null : "menu")}
              disabled={!isEditing}
              className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm disabled:opacity-50"
              title="Layer Options"
            >
              ⚙
            </button>

            {showLayerMenu === "menu" && map && (
              <div className="absolute top-full right-0 mt-1 bg-gray-700 rounded shadow-lg py-1 z-50 min-w-[160px]">
                {/* Current layer info */}
                {layer !== "collision" && (() => {
                  const currentLayer = map.layers.tileLayers.find(l => l.id === layer);
                  const currentIndex = map.layers.tileLayers.findIndex(l => l.id === layer);
                  if (!currentLayer) return null;
                  return (
                    <>
                      <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-600">
                        {currentLayer.name}
                      </div>
                      <button
                        onClick={() => {
                          toggleLayerVisibility(layer);
                          setShowLayerMenu(null);
                        }}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-gray-600"
                      >
                        {currentLayer.visible ? "👁 Hide Layer" : "👁 Show Layer"}
                      </button>
                      <button
                        onClick={() => {
                          moveLayerUp(layer);
                          setShowLayerMenu(null);
                        }}
                        disabled={currentIndex === 0}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-gray-600 disabled:opacity-50"
                      >
                        ↑ Move Up
                      </button>
                      <button
                        onClick={() => {
                          moveLayerDown(layer);
                          setShowLayerMenu(null);
                        }}
                        disabled={currentIndex === map.layers.tileLayers.length - 1}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-gray-600 disabled:opacity-50"
                      >
                        ↓ Move Down
                      </button>
                      <div className="border-t border-gray-600 my-1" />
                      <button
                        onClick={() => {
                          removeLayer(layer);
                          setShowLayerMenu(null);
                        }}
                        disabled={map.layers.tileLayers.length <= 1}
                        className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-gray-600 disabled:opacity-50"
                      >
                        🗑 Delete Layer
                      </button>
                    </>
                  );
                })()}
                {layer === "collision" && (
                  <div className="px-3 py-2 text-xs text-gray-400">
                    Collision layer cannot be modified
                  </div>
                )}
                <div className="border-t border-gray-600 my-1" />
                <button
                  onClick={() => {
                    setShowLayerMenu(null);
                    setShowAddLayer(true);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left text-green-400 hover:bg-gray-600"
                >
                  + Add New Layer
                </button>
              </div>
            )}
          </div>

          {/* Add layer modal */}
          {showAddLayer && (
            <div className="absolute top-full left-0 mt-1 bg-gray-700 rounded shadow-lg p-2 z-50 min-w-[180px]">
              <div className="text-xs text-gray-400 mb-2">New Layer</div>
              <input
                type="text"
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddLayer()}
                placeholder="Layer name..."
                className="w-full bg-gray-800 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 mb-2"
                autoFocus
              />
              <div className="flex gap-1">
                <button
                  onClick={handleAddLayer}
                  disabled={!newLayerName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setShowAddLayer(false);
                    setNewLayerName("");
                  }}
                  className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* View Options */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={toggleGrid}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            Grid
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showZones}
              onChange={toggleZones}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            Zones
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showCollision}
              onChange={toggleCollision}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            Collision
          </label>
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Zoom */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(zoom - 0.25)}
            className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
          >
            -
          </button>
          <span className="text-sm text-gray-300 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(zoom + 0.25)}
            className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
          >
            +
          </button>
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!isEditing}
            title="Undo"
            className="px-2 py-1 rounded text-sm bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={!isEditing}
            title="Redo"
            className="px-2 py-1 rounded text-sm bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↪
          </button>
        </div>
      </div>
    </div>
  );
}
