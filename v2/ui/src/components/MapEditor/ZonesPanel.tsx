import { useState, useCallback } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { ZoneDef } from "../../types/map";

// Room type colors for visual indicator
const ROOM_COLORS: Record<string, string> = {
  bakery: "bg-orange-500",
  tavern: "bg-amber-700",
  office: "bg-blue-500",
  home: "bg-green-500",
  market: "bg-yellow-500",
  shop: "bg-purple-500",
  garden: "bg-emerald-500",
  street: "bg-gray-500",
  plaza: "bg-slate-500",
  warehouse: "bg-stone-500",
  workshop: "bg-red-500",
  temple: "bg-violet-500",
  library: "bg-indigo-500",
  inn: "bg-amber-500",
  default: "bg-gray-400",
};

export function ZonesPanel() {
  const {
    map,
    selectedZone,
    setSelectedZone,
    updateZone,
    removeZone,
    setTool,
  } = useMapEditorStore();

  const [editingZone, setEditingZone] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    roomType: string;
    description: string;
  }>({ name: "", roomType: "", description: "" });

  const zones = map?.zones || [];

  const handleStartEdit = useCallback((zone: ZoneDef) => {
    setEditingZone(zone.id);
    setEditForm({
      name: zone.name,
      roomType: zone.roomType || "",
      description: zone.meta?.description || "",
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingZone || !editForm.name.trim()) return;

    updateZone(editingZone, {
      name: editForm.name.trim(),
      roomType: editForm.roomType || undefined,
      meta: {
        description: editForm.description.trim() || undefined,
      },
    });
    setEditingZone(null);
  }, [editingZone, editForm, updateZone]);

  const handleCancelEdit = useCallback(() => {
    setEditingZone(null);
  }, []);

  const handleDelete = useCallback((zoneId: string) => {
    if (confirm("Delete this zone?")) {
      removeZone(zoneId);
    }
  }, [removeZone]);

  const handleSelect = useCallback((zoneId: string) => {
    setSelectedZone(selectedZone === zoneId ? null : zoneId);
  }, [selectedZone, setSelectedZone]);

  const getZoneSize = (zone: ZoneDef) => {
    if (zone.shape.kind === "rect") {
      return `${zone.shape.w}x${zone.shape.h}`;
    }
    return "polygon";
  };

  const getZonePosition = (zone: ZoneDef) => {
    if (zone.shape.kind === "rect") {
      return `(${zone.shape.x}, ${zone.shape.y})`;
    }
    return "";
  };

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b border-gray-700">
        <h3 className="text-sm font-medium text-gray-300">Zones</h3>
        <button
          onClick={() => setTool("zone")}
          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
        >
          + Draw Zone
        </button>
      </div>

      <div className="max-h-[300px] overflow-y-auto">
        {zones.length === 0 ? (
          <div className="p-4 text-xs text-gray-500 text-center">
            No zones defined.<br />
            Use the zone tool (Z) to draw rooms.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className={`p-2 ${
                  selectedZone === zone.id ? "bg-gray-700" : "hover:bg-gray-750"
                }`}
              >
                {editingZone === zone.id ? (
                  // Edit form
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) =>
                        setEditForm({ ...editForm, name: e.target.value })
                      }
                      placeholder="Zone name"
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
                      autoFocus
                    />
                    <select
                      value={editForm.roomType}
                      onChange={(e) =>
                        setEditForm({ ...editForm, roomType: e.target.value })
                      }
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
                    >
                      <option value="">No room type</option>
                      <option value="home">home</option>
                      <option value="office">office</option>
                      <option value="shop">shop</option>
                      <option value="tavern">tavern</option>
                      <option value="bakery">bakery</option>
                      <option value="market">market</option>
                      <option value="garden">garden</option>
                      <option value="street">street</option>
                      <option value="plaza">plaza</option>
                      <option value="warehouse">warehouse</option>
                      <option value="workshop">workshop</option>
                      <option value="temple">temple</option>
                      <option value="library">library</option>
                      <option value="inn">inn</option>
                    </select>
                    <textarea
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm({ ...editForm, description: e.target.value })
                      }
                      placeholder="Description..."
                      rows={2}
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 resize-none"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editForm.name.trim()}
                        className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // Zone display
                  <div
                    className="cursor-pointer"
                    onClick={() => handleSelect(zone.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {/* Color indicator */}
                      <div
                        className={`w-3 h-3 rounded ${
                          ROOM_COLORS[zone.roomType || "default"] ||
                          ROOM_COLORS.default
                        }`}
                      />
                      <span className="text-sm text-white font-medium flex-1 truncate">
                        {zone.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {getZoneSize(zone)}
                      </span>
                    </div>

                    {zone.roomType && (
                      <div className="text-xs text-gray-400 mb-1">
                        Type: {zone.roomType}
                      </div>
                    )}

                    {zone.meta?.description && (
                      <div className="text-xs text-gray-500 truncate mb-1">
                        {zone.meta.description}
                      </div>
                    )}

                    {zone.meta?.semanticTags && zone.meta.semanticTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {zone.meta.semanticTags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-xs bg-gray-700 text-gray-400 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500">
                        {getZonePosition(zone)}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(zone);
                          }}
                          className="px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(zone.id);
                          }}
                          className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-gray-600 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {zones.length > 0 && (
        <div className="p-2 border-t border-gray-700 text-xs text-gray-500 text-center">
          {zones.length} zone{zones.length !== 1 ? "s" : ""} • Click to select
        </div>
      )}
    </div>
  );
}
