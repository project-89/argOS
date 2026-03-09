import { useState, useCallback } from "react";
import { useMapEditorStore } from "../../store/mapEditorStore";
import type { PrefabDef } from "../../types/map";

export function PrefabsPanel() {
  const {
    map,
    selectedPrefab,
    setSelectedPrefab,
    setTool,
    updatePrefab,
    removePrefab,
  } = useMapEditorStore();

  const [editingPrefab, setEditingPrefab] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    displayName: string;
    description: string;
    aiHint: string;
  }>({ displayName: "", description: "", aiHint: "" });

  const prefabs = map?.prefabs || [];

  const handleStartEdit = useCallback((prefab: PrefabDef) => {
    setEditingPrefab(prefab.id);
    setEditForm({
      displayName: prefab.displayName,
      description: prefab.description,
      aiHint: prefab.aiHint || "",
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingPrefab || !editForm.displayName.trim()) return;

    updatePrefab(editingPrefab, {
      displayName: editForm.displayName.trim(),
      description: editForm.description.trim(),
      aiHint: editForm.aiHint.trim() || undefined,
    });
    setEditingPrefab(null);
  }, [editingPrefab, editForm, updatePrefab]);

  const handleCancelEdit = useCallback(() => {
    setEditingPrefab(null);
  }, []);

  const handleDelete = useCallback((prefabId: string) => {
    if (confirm("Delete this prefab? Existing placed instances will remain on the map.")) {
      removePrefab(prefabId);
    }
  }, [removePrefab]);

  const handleSelectForStamping = useCallback((prefabId: string) => {
    if (selectedPrefab === prefabId) {
      // Deselect
      setSelectedPrefab(null);
    } else {
      setSelectedPrefab(prefabId);
      setTool("paint"); // Switch to paint tool for stamping
    }
  }, [selectedPrefab, setSelectedPrefab, setTool]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b border-gray-700">
        <h3 className="text-sm font-medium text-gray-300">Prefabs</h3>
        <span className="text-xs text-gray-500">
          {prefabs.length} defined
        </span>
      </div>

      <div className="max-h-[250px] overflow-y-auto">
        {prefabs.length === 0 ? (
          <div className="p-4 text-xs text-gray-500 text-center">
            No prefabs defined yet.<br />
            Select tiles in the palette and click<br />
            "Create Prefab" to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {prefabs.map((prefab) => (
              <div
                key={prefab.id}
                className={`p-2 ${
                  selectedPrefab === prefab.id ? "bg-blue-900/30 border-l-2 border-blue-500" : "hover:bg-gray-750"
                }`}
              >
                {editingPrefab === prefab.id ? (
                  // Edit form
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editForm.displayName}
                      onChange={(e) =>
                        setEditForm({ ...editForm, displayName: e.target.value })
                      }
                      placeholder="Display name"
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
                      autoFocus
                    />
                    <textarea
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm({ ...editForm, description: e.target.value })
                      }
                      placeholder="Description..."
                      rows={2}
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 resize-none"
                    />
                    <textarea
                      value={editForm.aiHint}
                      onChange={(e) =>
                        setEditForm({ ...editForm, aiHint: e.target.value })
                      }
                      placeholder="AI hint..."
                      rows={2}
                      className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 resize-none"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editForm.displayName.trim()}
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
                  // Prefab display
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {/* Stamp button */}
                      <button
                        onClick={() => handleSelectForStamping(prefab.id)}
                        className={`w-6 h-6 flex items-center justify-center rounded text-sm ${
                          selectedPrefab === prefab.id
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                        }`}
                        title={selectedPrefab === prefab.id ? "Deselect" : "Select for stamping"}
                      >
                        🖌
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium truncate">
                          {prefab.displayName}
                        </div>
                        <div className="text-xs text-gray-500 font-mono truncate">
                          {prefab.typeId}
                        </div>
                      </div>

                      <span className="text-xs text-gray-500">
                        {prefab.size.width}×{prefab.size.height}
                      </span>
                    </div>

                    {prefab.description && (
                      <div className="text-xs text-gray-400 truncate mb-1 ml-8">
                        {prefab.description}
                      </div>
                    )}

                    {prefab.semanticTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1 ml-8">
                        {prefab.semanticTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-xs bg-gray-700 text-gray-400 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                        {prefab.semanticTags.length > 3 && (
                          <span className="text-xs text-gray-500">
                            +{prefab.semanticTags.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-1 mt-2">
                      <button
                        onClick={() => handleStartEdit(prefab)}
                        className="px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(prefab.id)}
                        className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-gray-600 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedPrefab && (
        <div className="p-2 border-t border-gray-700 bg-blue-900/20">
          <div className="text-xs text-blue-300 text-center">
            Click on map to stamp prefab
          </div>
        </div>
      )}
    </div>
  );
}
