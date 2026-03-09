import { useState, useCallback } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import { nanoid } from "nanoid";
import type { SpawnMarker } from "../../types/map";

export function SelectionPanel() {
  const {
    map,
    selectedMapPosition,
    tool,
    addMarker,
    setSelectedMapPosition,
  } = useMapEditorStore();

  const [spawnName, setSpawnName] = useState("");
  const [spawnType, setSpawnType] = useState<"agent" | "object">("agent");
  const [showAddSpawn, setShowAddSpawn] = useState(false);

  // Get info about what's at the selected position
  const getTileInfo = useCallback(() => {
    if (!map || !selectedMapPosition) return null;

    const { x, y } = selectedMapPosition;
    const idx = y * map.grid.width + x;

    const tiles: { layer: string; tileId: number }[] = [];
    for (const layer of map.layers.tileLayers) {
      const tileId = layer.tiles[idx];
      if (tileId > 0) {
        tiles.push({ layer: layer.name, tileId });
      }
    }

    const isBlocked = map.layers.collision.blocked[idx];

    // Find zones at this position
    const zones = map.zones.filter((zone) => {
      if (zone.shape.kind === "rect") {
        const { x: zx, y: zy, w, h } = zone.shape;
        return x >= zx && x < zx + w && y >= zy && y < zy + h;
      }
      return false;
    });

    // Find markers at this position
    const markers = (map.markers || []).filter(
      (m) => m.x === x && m.y === y
    );

    return { tiles, isBlocked, zones, markers };
  }, [map, selectedMapPosition]);

  const info = getTileInfo();

  const handleAddSpawn = useCallback(() => {
    if (!selectedMapPosition || !spawnName.trim()) return;

    const marker: SpawnMarker = {
      kind: "spawn",
      id: `spawn_${nanoid(6)}`,
      x: selectedMapPosition.x,
      y: selectedMapPosition.y,
      spawnType,
      name: spawnName.trim(),
    };

    addMarker(marker);
    setSpawnName("");
    setShowAddSpawn(false);
  }, [selectedMapPosition, spawnName, spawnType, addMarker]);

  if (tool !== "select" && tool !== "spawn" && tool !== "portal") {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="p-2 border-b border-gray-700">
        <h3 className="text-sm font-medium text-gray-300">Selection</h3>
      </div>

      <div className="p-3">
        {selectedMapPosition ? (
          <>
            {/* Position info */}
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Position</div>
              <div className="text-sm text-white">
                ({selectedMapPosition.x}, {selectedMapPosition.y})
              </div>
            </div>

            {/* Tile info */}
            {info && info.tiles.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-gray-400 mb-1">Tiles</div>
                <div className="space-y-1">
                  {info.tiles.map((t, i) => (
                    <div key={i} className="text-xs text-gray-300">
                      {t.layer}: #{t.tileId}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collision info */}
            {info && (
              <div className="mb-3">
                <div className="text-xs text-gray-400 mb-1">Collision</div>
                <div className={`text-xs ${info.isBlocked ? "text-red-400" : "text-green-400"}`}>
                  {info.isBlocked ? "Blocked" : "Walkable"}
                </div>
              </div>
            )}

            {/* Zones */}
            {info && info.zones.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-gray-400 mb-1">Zones</div>
                <div className="space-y-1">
                  {info.zones.map((z) => (
                    <div key={z.id} className="text-xs text-gray-300">
                      {z.name} {z.roomType && `(${z.roomType})`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Markers */}
            {info && info.markers.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-gray-400 mb-1">Markers</div>
                <div className="space-y-1">
                  {info.markers.map((m) => (
                    <div key={m.id} className="text-xs text-gray-300">
                      {m.kind === "spawn" && `Spawn: ${m.name}`}
                      {m.kind === "portal" && `Portal to (${m.to.x}, ${m.to.y})`}
                      {m.kind === "label" && `Label: ${m.text}`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add spawn button */}
            <div className="border-t border-gray-700 pt-3 mt-3">
              {!showAddSpawn ? (
                <button
                  onClick={() => setShowAddSpawn(true)}
                  className="w-full px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
                >
                  + Add Spawn Point
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={spawnName}
                    onChange={(e) => setSpawnName(e.target.value)}
                    placeholder="Spawn name..."
                    className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
                    autoFocus
                  />
                  <select
                    value={spawnType}
                    onChange={(e) => setSpawnType(e.target.value as "agent" | "object")}
                    className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
                  >
                    <option value="agent">Agent (NPC)</option>
                    <option value="object">Object</option>
                  </select>
                  <div className="flex gap-1">
                    <button
                      onClick={handleAddSpawn}
                      disabled={!spawnName.trim()}
                      className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowAddSpawn(false);
                        setSpawnName("");
                      }}
                      className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Clear selection */}
            <button
              onClick={() => setSelectedMapPosition(null)}
              className="w-full mt-2 px-3 py-1 text-xs text-gray-400 hover:text-gray-300"
            >
              Clear Selection
            </button>
          </>
        ) : (
          <div className="text-xs text-gray-500 text-center py-4">
            Click on the map to select a tile
          </div>
        )}
      </div>
    </div>
  );
}
