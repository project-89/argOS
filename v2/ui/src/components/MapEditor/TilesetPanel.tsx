import { useState } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { TilesetDef } from "../../types/map";
import { nanoid } from "nanoid";

// Available tilesets in the public folder
const AVAILABLE_TILESETS: Omit<TilesetDef, "id">[] = [
  {
    image: "/32x32/1_Terrains_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 736,
  },
  {
    image: "/32x32/2_Fences_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 256,
  },
  {
    image: "/32x32/3_Props_and_Buildings_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 1024,
  },
  {
    image: "/32x32/4_Crops_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 512,
  },
  {
    image: "/32x32/5_Fruit_Trees_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 480,
  },
  {
    image: "/32x32/6_Trees_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 32,
    tileCount: 2048,
  },
  {
    image: "/32x32/7_Pickup_Items_32x32.png",
    tileWidth: 32,
    tileHeight: 32,
    columns: 16,
    tileCount: 128,
  },
];

interface TilesetPanelProps {
  onClose: () => void;
}

export function TilesetPanel({ onClose }: TilesetPanelProps) {
  const { map, setMap, pushHistory } = useMapEditorStore();
  const [customUrl, setCustomUrl] = useState("");
  const [customId, setCustomId] = useState("");
  const [customColumns, setCustomColumns] = useState(32);
  const [customTileCount, setCustomTileCount] = useState(256);
  const [customTileSize, setCustomTileSize] = useState(32);

  if (!map) return null;

  const addTileset = (tileset: Omit<TilesetDef, "id">) => {
    // Generate ID from filename
    const filename = tileset.image.split("/").pop()?.replace(".png", "") || "tileset";
    const id = filename.toLowerCase().replace(/[^a-z0-9]/g, "_");

    // Check if already added
    if (map.tilesets.some((t) => t.image === tileset.image)) {
      alert("This tileset is already added to the map.");
      return;
    }

    pushHistory();

    const newTileset: TilesetDef = {
      id: `${id}_${nanoid(4)}`,
      ...tileset,
    };

    setMap({
      ...map,
      tilesets: [...map.tilesets, newTileset],
    });
  };

  const addCustomTileset = () => {
    if (!customUrl.trim()) {
      alert("Please enter a tileset URL or path.");
      return;
    }

    const id = customId.trim() || `custom_${nanoid(4)}`;

    if (map.tilesets.some((t) => t.id === id)) {
      alert("A tileset with this ID already exists.");
      return;
    }

    pushHistory();

    const newTileset: TilesetDef = {
      id,
      image: customUrl.trim(),
      tileWidth: customTileSize,
      tileHeight: customTileSize,
      columns: customColumns,
      tileCount: customTileCount,
    };

    setMap({
      ...map,
      tilesets: [...map.tilesets, newTileset],
    });

    // Reset form
    setCustomUrl("");
    setCustomId("");
  };

  const removeTileset = (tilesetId: string) => {
    // Don't allow removing if it's the only tileset
    if (map.tilesets.length <= 1) {
      alert("Cannot remove the last tileset.");
      return;
    }

    // Check if tileset is in use by any layer
    const inUse = map.layers.tileLayers.some(layer => layer.tilesetId === tilesetId);

    if (inUse) {
      alert("Cannot remove a tileset that is currently in use by a layer.");
      return;
    }

    pushHistory();

    setMap({
      ...map,
      tilesets: map.tilesets.filter((t) => t.id !== tilesetId),
    });
  };

  // Get which layers use this tileset
  const getLayersUsingTileset = (tilesetId: string) => {
    return map.layers.tileLayers.filter(layer => layer.tilesetId === tilesetId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[600px] max-h-[80vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Manage Tilesets</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {/* Current Tilesets */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Current Tilesets
            </h3>
            <div className="space-y-2">
              {map.tilesets.map((tileset) => {
                const layersUsing = getLayersUsingTileset(tileset.id);
                return (
                  <div
                    key={tileset.id}
                    className="flex items-center gap-3 p-2 bg-gray-700 rounded"
                  >
                    <img
                      src={tileset.image}
                      alt={tileset.id}
                      className="w-12 h-12 object-cover rounded"
                      style={{ imageRendering: "pixelated" }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {tileset.id}
                      </div>
                      <div className="text-xs text-gray-400">
                        {tileset.tileCount} tiles, {tileset.tileWidth}x
                        {tileset.tileHeight}px
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Show which layers use this tileset */}
                      {layersUsing.map(layer => (
                        <span
                          key={layer.id}
                          className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded"
                        >
                          {layer.name}
                        </span>
                      ))}
                      {layersUsing.length === 0 && (
                        <span className="text-xs text-gray-500">Not in use</span>
                      )}
                      <button
                        onClick={() => removeTileset(tileset.id)}
                        disabled={layersUsing.length > 0}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Available Tilesets */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Available Tilesets
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_TILESETS.filter(
                (t) => !map.tilesets.some((mt) => mt.image === t.image)
              ).map((tileset) => {
                const name = tileset.image.split("/").pop()?.replace(".png", "") || "Tileset";
                return (
                  <button
                    key={tileset.image}
                    onClick={() => addTileset(tileset)}
                    className="flex items-center gap-2 p-2 bg-gray-700 rounded hover:bg-gray-600 text-left"
                  >
                    <img
                      src={tileset.image}
                      alt={name}
                      className="w-10 h-10 object-cover rounded"
                      style={{ imageRendering: "pixelated" }}
                    />
                    <div>
                      <div className="text-sm text-white">{name}</div>
                      <div className="text-xs text-gray-400">
                        {tileset.tileCount} tiles
                      </div>
                    </div>
                  </button>
                );
              })}
              {AVAILABLE_TILESETS.every((t) =>
                map.tilesets.some((mt) => mt.image === t.image)
              ) && (
                <div className="col-span-2 text-sm text-gray-500 text-center py-4">
                  All available tilesets have been added.
                </div>
              )}
            </div>
          </div>

          {/* Custom Tileset */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Add Custom Tileset
            </h3>
            <div className="space-y-3 p-3 bg-gray-700 rounded">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Image URL or Path
                </label>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="/path/to/tileset.png or https://..."
                  className="w-full px-3 py-1.5 text-sm bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ID</label>
                  <input
                    type="text"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    placeholder="auto"
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Tile Size
                  </label>
                  <input
                    type="number"
                    value={customTileSize}
                    onChange={(e) => setCustomTileSize(parseInt(e.target.value) || 32)}
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Columns
                  </label>
                  <input
                    type="number"
                    value={customColumns}
                    onChange={(e) => setCustomColumns(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Tile Count
                  </label>
                  <input
                    type="number"
                    value={customTileCount}
                    onChange={(e) => setCustomTileCount(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
              </div>
              <button
                onClick={addCustomTileset}
                className="w-full px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-500"
              >
                Add Custom Tileset
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
