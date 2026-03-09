import { useState } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { ZoneDef, MarkerDef } from "../../types/map";
import { nanoid } from "nanoid";

export function PropertiesPanel() {
  const {
    map,
    selectedZone,
    selectedMarker,
    setSelectedZone,
    setSelectedMarker,
    addZone,
    updateZone,
    removeZone,
    addMarker,
    updateMarker,
    removeMarker,
  } = useMapEditorStore();

  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneType, setNewZoneType] = useState("default");

  const zone = map?.zones.find((z) => z.id === selectedZone);
  const marker = map?.markers?.find((m) => m.id === selectedMarker);

  const handleAddZone = () => {
    if (!newZoneName.trim()) return;

    const newZone: ZoneDef = {
      id: `zone_${nanoid(8)}`,
      name: newZoneName.trim(),
      roomType: newZoneType,
      shape: {
        kind: "rect",
        x: 5,
        y: 5,
        w: 5,
        h: 5,
      },
    };

    addZone(newZone);
    setSelectedZone(newZone.id);
    setNewZoneName("");
  };

  const handleAddSpawn = () => {
    const newSpawn: MarkerDef = {
      kind: "spawn",
      id: `spawn_${nanoid(8)}`,
      x: 5,
      y: 5,
      spawnType: "agent",
      name: "New Agent",
    };

    addMarker(newSpawn);
    setSelectedMarker(newSpawn.id);
  };

  const handleAddPortal = () => {
    const newPortal: MarkerDef = {
      kind: "portal",
      id: `portal_${nanoid(8)}`,
      x: 5,
      y: 5,
      to: { x: 10, y: 10 },
      bidirectional: true,
    };

    addMarker(newPortal);
    setSelectedMarker(newPortal.id);
  };

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="p-3 border-b border-gray-700">
        <h3 className="text-sm font-medium text-gray-300">Properties</h3>
      </div>

      <div className="p-3 space-y-4">
        {/* Zone Section */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">
            Zones
          </h4>

          {/* Zone List */}
          <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
            {map?.zones.map((z) => (
              <button
                key={z.id}
                onClick={() => setSelectedZone(z.id)}
                className={`w-full text-left px-2 py-1 rounded text-sm ${
                  selectedZone === z.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {z.name} ({z.roomType || "default"})
              </button>
            ))}
          </div>

          {/* Add Zone */}
          <div className="flex gap-1">
            <input
              type="text"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              placeholder="Zone name..."
              className="flex-1 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
            />
            <select
              value={newZoneType}
              onChange={(e) => setNewZoneType(e.target.value)}
              className="px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value="default">Default</option>
              <option value="bakery">Bakery</option>
              <option value="tavern">Tavern</option>
              <option value="office">Office</option>
              <option value="home">Home</option>
              <option value="market">Market</option>
            </select>
            <button
              onClick={handleAddZone}
              className="px-2 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-500"
            >
              +
            </button>
          </div>

          {/* Selected Zone Properties */}
          {zone && (
            <div className="mt-2 p-2 bg-gray-700 rounded space-y-2">
              <div>
                <label className="text-xs text-gray-400">Name</label>
                <input
                  type="text"
                  value={zone.name}
                  onChange={(e) =>
                    updateZone(zone.id, { name: e.target.value })
                  }
                  className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                />
              </div>
              <div className="grid grid-cols-4 gap-1">
                <div>
                  <label className="text-xs text-gray-400">X</label>
                  <input
                    type="number"
                    value={zone.shape.kind === "rect" ? zone.shape.x : 0}
                    onChange={(e) =>
                      zone.shape.kind === "rect" &&
                      updateZone(zone.id, {
                        shape: { ...zone.shape, x: parseInt(e.target.value) || 0 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Y</label>
                  <input
                    type="number"
                    value={zone.shape.kind === "rect" ? zone.shape.y : 0}
                    onChange={(e) =>
                      zone.shape.kind === "rect" &&
                      updateZone(zone.id, {
                        shape: { ...zone.shape, y: parseInt(e.target.value) || 0 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">W</label>
                  <input
                    type="number"
                    value={zone.shape.kind === "rect" ? zone.shape.w : 0}
                    onChange={(e) =>
                      zone.shape.kind === "rect" &&
                      updateZone(zone.id, {
                        shape: { ...zone.shape, w: parseInt(e.target.value) || 1 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">H</label>
                  <input
                    type="number"
                    value={zone.shape.kind === "rect" ? zone.shape.h : 0}
                    onChange={(e) =>
                      zone.shape.kind === "rect" &&
                      updateZone(zone.id, {
                        shape: { ...zone.shape, h: parseInt(e.target.value) || 1 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  removeZone(zone.id);
                  setSelectedZone(null);
                }}
                className="w-full px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
              >
                Delete Zone
              </button>
            </div>
          )}
        </div>

        {/* Markers Section */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">
            Markers
          </h4>

          {/* Marker List */}
          <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
            {map?.markers?.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMarker(m.id)}
                className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2 ${
                  selectedMarker === m.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                <span>
                  {m.kind === "spawn" ? "★" : m.kind === "portal" ? "◇" : "📝"}
                </span>
                {m.kind === "spawn" ? m.name : m.kind}
              </button>
            ))}
          </div>

          {/* Add Marker Buttons */}
          <div className="flex gap-1">
            <button
              onClick={handleAddSpawn}
              className="flex-1 px-2 py-1 text-xs bg-cyan-600 text-white rounded hover:bg-cyan-500"
            >
              + Spawn
            </button>
            <button
              onClick={handleAddPortal}
              className="flex-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-500"
            >
              + Portal
            </button>
          </div>

          {/* Selected Marker Properties */}
          {marker && marker.kind === "spawn" && (
            <div className="mt-2 p-2 bg-gray-700 rounded space-y-2">
              <div>
                <label className="text-xs text-gray-400">Name</label>
                <input
                  type="text"
                  value={marker.name}
                  onChange={(e) =>
                    updateMarker(marker.id, { name: e.target.value })
                  }
                  className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Type</label>
                <select
                  value={marker.spawnType}
                  onChange={(e) =>
                    updateMarker(marker.id, {
                      spawnType: e.target.value as "agent" | "object",
                    })
                  }
                  className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white"
                >
                  <option value="agent">Agent</option>
                  <option value="object">Object</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">
                  {marker.spawnType === "object" ? "Prefab typeId" : "Agent typeId (optional)"}
                </label>
                <input
                  type="text"
                  value={marker.typeId || ""}
                  onChange={(e) =>
                    updateMarker(marker.id, {
                      typeId: e.target.value || undefined,
                    })
                  }
                  placeholder={marker.spawnType === "object" ? "e.g. workstation, laptop, tree" : "e.g. npc"}
                  className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
                />
              </div>
              {marker.spawnType === "object" && (
                <div>
                  <label className="text-xs text-gray-400">Prefab description (seed)</label>
                  <textarea
                    value={String(marker.meta?.description || "")}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        meta: { ...(marker.meta || {}), description: e.target.value },
                      })
                    }
                    placeholder="Describe what this prefab is and what it’s for (used to auto-generate a schema type if missing)."
                    rows={3}
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
                  />
                </div>
              )}
              {marker.spawnType === "object" && (
                <div>
                  <label className="text-xs text-gray-400">Prefab trait hints (comma-separated)</label>
                  <input
                    type="text"
                    value={String((marker.meta as any)?.traitHints || "")}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        meta: { ...(marker.meta || {}), traitHints: e.target.value },
                      })
                    }
                    placeholder="e.g. container, openable, flammable"
                    className="w-full px-2 py-1 text-sm bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs text-gray-400">X</label>
                  <input
                    type="number"
                    value={marker.x}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        x: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Y</label>
                  <input
                    type="number"
                    value={marker.y}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        y: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  removeMarker(marker.id);
                  setSelectedMarker(null);
                }}
                className="w-full px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
              >
                Delete Marker
              </button>
            </div>
          )}

          {marker && marker.kind === "portal" && (
            <div className="mt-2 p-2 bg-gray-700 rounded space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400">From X</label>
                  <input
                    type="number"
                    value={marker.x}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        x: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">From Y</label>
                  <input
                    type="number"
                    value={marker.y}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        y: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">To X</label>
                  <input
                    type="number"
                    value={marker.to.x}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        to: { ...marker.to, x: parseInt(e.target.value) || 0 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">To Y</label>
                  <input
                    type="number"
                    value={marker.to.y}
                    onChange={(e) =>
                      updateMarker(marker.id, {
                        to: { ...marker.to, y: parseInt(e.target.value) || 0 },
                      })
                    }
                    className="w-full px-1 py-0.5 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={marker.bidirectional ?? false}
                  onChange={(e) =>
                    updateMarker(marker.id, { bidirectional: e.target.checked })
                  }
                  className="rounded border-gray-600 bg-gray-600"
                />
                Bidirectional
              </label>
              <button
                onClick={() => {
                  removeMarker(marker.id);
                  setSelectedMarker(null);
                }}
                className="w-full px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
              >
                Delete Portal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
