import { useState, useCallback, useEffect } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import { nanoid } from "nanoid";
import type { PrefabDef, PrefabTile } from "../../types/map";

// Common semantic tags for prefabs
const SEMANTIC_TAGS = [
  "nature",
  "furniture",
  "building",
  "decoration",
  "container",
  "interactive",
  "blocking",
  "resource",
  "light_source",
  "food",
  "tool",
  "weapon",
];

export function PrefabDialog() {
  const {
    showPrefabDialog,
    pendingPrefabTiles,
    addPrefab,
    setShowPrefabDialog,
    setPendingPrefabTiles,
  } = useMapEditorStore();

  const [typeId, setTypeId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [aiHint, setAiHint] = useState("");
  const [semanticTags, setSemanticTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (showPrefabDialog) {
      setTypeId("");
      setDisplayName("");
      setDescription("");
      setAiHint("");
      setSemanticTags([]);
      setCustomTag("");
    }
  }, [showPrefabDialog]);

  const handleCreate = useCallback(() => {
    if (!pendingPrefabTiles || !typeId.trim() || !displayName.trim()) return;

    const { startTileId, width, height, tilesetId, tilesetCols } = pendingPrefabTiles;

    // Build the tiles array from the selection
    const tiles: PrefabTile[] = [];
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const tileId = startTileId + dy * tilesetCols + dx;
        tiles.push({
          tileId,
          offsetX: dx,
          offsetY: dy,
        });
      }
    }

    const prefab: PrefabDef = {
      id: `prefab_${nanoid(6)}`,
      typeId: typeId.trim().toLowerCase().replace(/\s+/g, "_"),
      displayName: displayName.trim(),
      description: description.trim(),
      semanticTags,
      tilesetId,
      tiles,
      size: { width, height },
      aiHint: aiHint.trim() || undefined,
    };

    addPrefab(prefab);
  }, [pendingPrefabTiles, typeId, displayName, description, aiHint, semanticTags, addPrefab]);

  const handleCancel = useCallback(() => {
    setShowPrefabDialog(false);
    setPendingPrefabTiles(null);
  }, [setShowPrefabDialog, setPendingPrefabTiles]);

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

  // Auto-generate typeId from displayName
  useEffect(() => {
    if (displayName && !typeId) {
      setTypeId(displayName.toLowerCase().replace(/\s+/g, "_"));
    }
  }, [displayName, typeId]);

  if (!showPrefabDialog || !pendingPrefabTiles) {
    return null;
  }

  const { width, height } = pendingPrefabTiles;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[500px] max-h-[85vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Create Prefab</h2>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(85vh-120px)]">
          {/* Selection preview */}
          <div className="mb-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
            <div className="flex justify-between">
              <span>Tile Selection:</span>
              <span>{width} × {height} tiles</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              This prefab will be created from your current tile selection
            </div>
          </div>

          {/* Type ID */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Type ID * <span className="text-gray-500">(for ECS/code)</span>
            </label>
            <input
              type="text"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              placeholder="e.g., oak_tree, market_stall..."
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 font-mono"
            />
          </div>

          {/* Display Name */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Display Name *
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Oak Tree, Market Stall..."
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Description <span className="text-gray-500">(for AI understanding)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this object is and what it represents..."
              rows={2}
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 resize-none"
            />
          </div>

          {/* AI Hint */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              AI Hint <span className="text-gray-500">(instruction for AI behavior)</span>
            </label>
            <textarea
              value={aiHint}
              onChange={(e) => setAiHint(e.target.value)}
              placeholder="e.g., 'Characters can sit on this', 'Provides shade', 'Can be harvested for wood'..."
              rows={2}
              className="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 resize-none"
            />
          </div>

          {/* Semantic tags */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">
              Semantic Tags
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
                      ×
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
            onClick={handleCancel}
            className="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!typeId.trim() || !displayName.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
          >
            Create Prefab
          </button>
        </div>
      </div>
    </div>
  );
}
