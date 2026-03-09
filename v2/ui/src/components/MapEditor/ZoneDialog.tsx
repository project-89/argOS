import { useState, useCallback, useEffect } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import { nanoid } from "nanoid";
import type { ZoneDef, RectShape } from "../../types/map";

// Common room types for quick selection
const ROOM_TYPES = [
  "home",
  "office",
  "shop",
  "tavern",
  "bakery",
  "market",
  "garden",
  "street",
  "plaza",
  "warehouse",
  "workshop",
  "temple",
  "library",
  "inn",
];

// Common semantic tags for metadata
const SEMANTIC_TAGS = [
  "house",
  "building",
  "outdoor",
  "indoor",
  "public",
  "private",
  "commercial",
  "residential",
  "sacred",
  "dangerous",
  "safe",
  "water",
  "vegetation",
];

export function ZoneDialog() {
  const {
    showZoneDialog,
    zoneDrawStart,
    zoneDrawEnd,
    addZone,
    cancelZoneDraw,
  } = useMapEditorStore();

  const [zoneName, setZoneName] = useState("");
  const [roomType, setRoomType] = useState("");
  const [customRoomType, setCustomRoomType] = useState("");
  const [description, setDescription] = useState("");
  const [semanticTags, setSemanticTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (showZoneDialog) {
      setZoneName("");
      setRoomType("");
      setCustomRoomType("");
      setDescription("");
      setSemanticTags([]);
      setCustomTag("");
    }
  }, [showZoneDialog]);

  const handleCreate = useCallback(() => {
    if (!zoneDrawStart || !zoneDrawEnd || !zoneName.trim()) return;

    const minX = Math.min(zoneDrawStart.x, zoneDrawEnd.x);
    const minY = Math.min(zoneDrawStart.y, zoneDrawEnd.y);
    const maxX = Math.max(zoneDrawStart.x, zoneDrawEnd.x);
    const maxY = Math.max(zoneDrawStart.y, zoneDrawEnd.y);

    const shape: RectShape = {
      kind: "rect",
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };

    const finalRoomType = roomType === "custom" ? customRoomType.trim() : roomType;

    const zone: ZoneDef = {
      id: `zone_${nanoid(6)}`,
      name: zoneName.trim(),
      roomType: finalRoomType || undefined,
      shape,
      meta: {
        description: description.trim() || undefined,
        semanticTags: semanticTags.length > 0 ? semanticTags : undefined,
      },
    };

    // Clean up undefined values
    if (!zone.meta?.description && !zone.meta?.semanticTags) {
      delete zone.meta;
    }

    addZone(zone);
    cancelZoneDraw();
  }, [zoneDrawStart, zoneDrawEnd, zoneName, roomType, customRoomType, description, semanticTags, addZone, cancelZoneDraw]);

  const toggleTag = useCallback((tag: string) => {
    setSemanticTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const addCustomTag = useCallback(() => {
    if (customTag.trim() && !semanticTags.includes(customTag.trim())) {
      setSemanticTags((prev) => [...prev, customTag.trim()]);
      setCustomTag("");
    }
  }, [customTag, semanticTags]);

  if (!showZoneDialog || !zoneDrawStart || !zoneDrawEnd) {
    return null;
  }

  const minX = Math.min(zoneDrawStart.x, zoneDrawEnd.x);
  const minY = Math.min(zoneDrawStart.y, zoneDrawEnd.y);
  const maxX = Math.max(zoneDrawStart.x, zoneDrawEnd.x);
  const maxY = Math.max(zoneDrawStart.y, zoneDrawEnd.y);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[450px] max-h-[80vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Create Zone</h2>
          <button
            onClick={cancelZoneDraw}
            className="text-gray-400 hover:text-white text-xl"
          >
            x
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)]">
          {/* Zone preview */}
          <div className="mb-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
            <div className="flex justify-between">
              <span>Position:</span>
              <span>({minX}, {minY})</span>
            </div>
            <div className="flex justify-between">
              <span>Size:</span>
              <span>{width} x {height} tiles</span>
            </div>
          </div>

          {/* Zone name */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Zone Name *
            </label>
            <input
              type="text"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="e.g., Tom's Bakery, Town Square..."
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              autoFocus
            />
          </div>

          {/* Room type */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Room Type
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {ROOM_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setRoomType(type)}
                  className={`px-2 py-1 text-xs rounded ${
                    roomType === type
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {type}
                </button>
              ))}
              <button
                onClick={() => setRoomType("custom")}
                className={`px-2 py-1 text-xs rounded ${
                  roomType === "custom"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                custom...
              </button>
            </div>
            {roomType === "custom" && (
              <input
                type="text"
                value={customRoomType}
                onChange={(e) => setCustomRoomType(e.target.value)}
                placeholder="Custom room type..."
                className="w-full px-3 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
            )}
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Description (for AI/ECS)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this area for the simulation... e.g., 'A cozy bakery where fresh bread is made daily'"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 resize-none"
            />
          </div>

          {/* Semantic tags */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Semantic Tags (for ECS perception)
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {SEMANTIC_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2 py-1 text-xs rounded ${
                    semanticTags.includes(tag)
                      ? "bg-green-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomTag()}
                placeholder="Add custom tag..."
                className="flex-1 px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              />
              <button
                onClick={addCustomTag}
                disabled={!customTag.trim()}
                className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {semanticTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {semanticTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-green-600/30 text-green-400 rounded flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => toggleTag(tag)}
                      className="hover:text-white"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={cancelZoneDraw}
            className="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!zoneName.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
          >
            Create Zone
          </button>
        </div>
      </div>
    </div>
  );
}
