import { useState, useCallback } from "react";
import { useProjectStore } from "../../store/projectStore";
import { useMapEditorStore } from "../../store/mapEditorStore";

interface ProjectManagerProps {
  onClose: () => void;
}

export function ProjectManager({ onClose }: ProjectManagerProps) {
  const {
    projects,
    currentProjectId,
    isDirty,
    autosaveEnabled,
    autosaveIntervalMs,
    openProject,
    deleteProject,
    renameProject,
    duplicateProject,
    setAutosaveEnabled,
    setAutosaveInterval,
    saveProject,
    exportProject,
    importProject,
  } = useProjectStore();

  const { map, setMap } = useMapEditorStore();

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Sort projects by last updated (newest first)
  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleOpenProject = useCallback((projectId: string) => {
    // Warn if current project has unsaved changes
    if (isDirty && currentProjectId) {
      if (!confirm("You have unsaved changes. Open a different project anyway?")) {
        return;
      }
    }

    const loadedMap = openProject(projectId);
    if (loadedMap) {
      setMap(loadedMap);
      onClose();
    }
  }, [isDirty, currentProjectId, openProject, setMap, onClose]);

  const handleStartRename = useCallback((projectId: string, currentName: string) => {
    setEditingProjectId(projectId);
    setEditName(currentName);
  }, []);

  const handleSaveRename = useCallback(() => {
    if (!editingProjectId || !editName.trim()) return;
    renameProject(editingProjectId, editName.trim());
    setEditingProjectId(null);
  }, [editingProjectId, editName, renameProject]);

  const handleCancelRename = useCallback(() => {
    setEditingProjectId(null);
    setEditName("");
  }, []);

  const handleDeleteProject = useCallback((projectId: string) => {
    deleteProject(projectId);
    setConfirmDelete(null);

    // If we deleted the current project, clear the map
    if (projectId === currentProjectId) {
      setMap(null as any);
    }
  }, [deleteProject, currentProjectId, setMap]);

  const handleDuplicateProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const newName = `${project.name} (Copy)`;
    duplicateProject(projectId, newName);
  }, [projects, duplicateProject]);

  const handleExportProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const json = exportProject(projectId);
    if (!json) return;

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.argosmap.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projects, exportProject]);

  const handleImportProject = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.argosmap.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const newProjectId = importProject(text);
        if (newProjectId) {
          // Automatically open the imported project
          const loadedMap = openProject(newProjectId);
          if (loadedMap) {
            setMap(loadedMap);
            onClose();
          }
        } else {
          alert("Failed to import project. Invalid file format.");
        }
      } catch (err) {
        console.error("Failed to import:", err);
        alert("Failed to read file.");
      }
    };
    input.click();
  }, [importProject, openProject, setMap, onClose]);

  const handleSaveCurrentProject = useCallback(() => {
    if (map && currentProjectId) {
      saveProject(currentProjectId, map);
    }
  }, [map, currentProjectId, saveProject]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[500px] max-h-[80vh] border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Project Manager</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        {/* Current Project Status */}
        {currentProjectId && map && (
          <div className="px-4 py-3 bg-gray-750 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400">Current Project</div>
                <div className="text-white font-medium">{map.name}</div>
              </div>
              <div className="flex items-center gap-2">
                {isDirty && (
                  <span className="text-xs px-2 py-0.5 bg-yellow-600/30 text-yellow-400 rounded">
                    Unsaved
                  </span>
                )}
                <button
                  onClick={handleSaveCurrentProject}
                  disabled={!isDirty}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
                >
                  Save Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Autosave Settings */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autosaveEnabled}
                onChange={(e) => setAutosaveEnabled(e.target.checked)}
                className="w-4 h-4 rounded bg-gray-700 border-gray-600"
              />
              <span className="text-sm text-gray-300">Autosave</span>
            </label>
            {autosaveEnabled && (
              <select
                value={autosaveIntervalMs}
                onChange={(e) => setAutosaveInterval(parseInt(e.target.value))}
                className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300"
              >
                <option value={10000}>Every 10s</option>
                <option value={30000}>Every 30s</option>
                <option value={60000}>Every 1m</option>
                <option value={120000}>Every 2m</option>
              </select>
            )}
          </div>
          <button
            onClick={handleImportProject}
            className="px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
          >
            Import Project
          </button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto p-4">
          {sortedProjects.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No projects yet.<br />
              Create a new map to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedProjects.map((project) => (
                <div
                  key={project.id}
                  className={`p-3 rounded-lg border ${
                    project.id === currentProjectId
                      ? "bg-blue-900/30 border-blue-600"
                      : "bg-gray-750 border-gray-600 hover:border-gray-500"
                  }`}
                >
                  {editingProjectId === project.id ? (
                    // Edit mode
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRename();
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveRename}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelRename}
                        className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : confirmDelete === project.id ? (
                    // Delete confirmation
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-red-400">Delete "{project.name}"?</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 text-xs bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Normal view
                    <div className="flex items-center justify-between">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => handleOpenProject(project.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{project.name}</span>
                          {project.id === currentProjectId && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-600 text-white rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Updated {formatRelativeTime(project.updatedAt)} • Created {formatDate(project.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenProject(project.id)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                          title="Open"
                        >
                          📂
                        </button>
                        <button
                          onClick={() => handleStartRename(project.id, project.name)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                          title="Rename"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDuplicateProject(project.id)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                          title="Duplicate"
                        >
                          📋
                        </button>
                        <button
                          onClick={() => handleExportProject(project.id)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded"
                          title="Export"
                        >
                          💾
                        </button>
                        <button
                          onClick={() => setConfirmDelete(project.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with storage info */}
        <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 text-center">
          {sortedProjects.length} project{sortedProjects.length !== 1 ? "s" : ""} stored locally
        </div>
      </div>
    </div>
  );
}
