import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import type { ArgosMapV1 } from "../types/map";

// Project metadata stored separately from map data
interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string; // Base64 thumbnail preview
}

interface ProjectStore {
  // Project list
  projects: ProjectMeta[];
  currentProjectId: string | null;

  // Dirty state (unsaved changes)
  isDirty: boolean;
  lastSavedAt: number | null;

  // Autosave settings
  autosaveEnabled: boolean;
  autosaveIntervalMs: number;

  // Actions
  createProject: (name: string, map: ArgosMapV1) => string;
  openProject: (projectId: string) => ArgosMapV1 | null;
  saveProject: (projectId: string, map: ArgosMapV1) => void;
  deleteProject: (projectId: string) => void;
  renameProject: (projectId: string, newName: string) => void;
  duplicateProject: (projectId: string, newName: string) => string | null;

  // Current project
  setCurrentProject: (projectId: string | null) => void;
  markDirty: () => void;
  markClean: () => void;

  // Settings
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveInterval: (intervalMs: number) => void;

  // Import/Export
  exportProject: (projectId: string) => string | null;
  importProject: (jsonString: string) => string | null;
}

// Storage keys
const PROJECT_DATA_PREFIX = "argos_project_";
const getProjectDataKey = (id: string) => `${PROJECT_DATA_PREFIX}${id}`;

// Helper to generate unique IDs
const generateId = () => `project_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const useProjectStore = create<ProjectStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        projects: [],
        currentProjectId: null,
        isDirty: false,
        lastSavedAt: null,
        autosaveEnabled: true,
        autosaveIntervalMs: 30000, // 30 seconds default

        // Create a new project
        createProject: (name: string, map: ArgosMapV1) => {
          const id = generateId();
          const now = Date.now();

          // Create project metadata
          const meta: ProjectMeta = {
            id,
            name,
            createdAt: now,
            updatedAt: now,
          };

          // Store map data separately in localStorage
          try {
            localStorage.setItem(getProjectDataKey(id), JSON.stringify(map));
          } catch (err) {
            console.error("[ProjectStore] Failed to save project data:", err);
            return "";
          }

          // Update state
          set((state) => ({
            projects: [...state.projects, meta],
            currentProjectId: id,
            isDirty: false,
            lastSavedAt: now,
          }));

          console.log(`[ProjectStore] Created project: ${name} (${id})`);
          return id;
        },

        // Open a project - returns map data
        openProject: (projectId: string) => {
          const dataKey = getProjectDataKey(projectId);

          try {
            const data = localStorage.getItem(dataKey);
            if (!data) {
              console.error(`[ProjectStore] Project data not found: ${projectId}`);
              return null;
            }

            const map = JSON.parse(data) as ArgosMapV1;

            set({
              currentProjectId: projectId,
              isDirty: false,
              lastSavedAt: get().projects.find(p => p.id === projectId)?.updatedAt || null,
            });

            console.log(`[ProjectStore] Opened project: ${projectId}`);
            return map;
          } catch (err) {
            console.error(`[ProjectStore] Failed to open project:`, err);
            return null;
          }
        },

        // Save project data
        saveProject: (projectId: string, map: ArgosMapV1) => {
          const now = Date.now();
          const dataKey = getProjectDataKey(projectId);

          try {
            localStorage.setItem(dataKey, JSON.stringify(map));

            // Update metadata
            set((state) => ({
              projects: state.projects.map(p =>
                p.id === projectId
                  ? { ...p, updatedAt: now, name: map.name || p.name }
                  : p
              ),
              isDirty: false,
              lastSavedAt: now,
            }));

            console.log(`[ProjectStore] Saved project: ${projectId}`);
          } catch (err) {
            console.error(`[ProjectStore] Failed to save project:`, err);
            // Check if storage is full
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
              console.warn("[ProjectStore] Storage quota exceeded!");
            }
          }
        },

        // Delete a project
        deleteProject: (projectId: string) => {
          const dataKey = getProjectDataKey(projectId);

          // Remove map data
          localStorage.removeItem(dataKey);

          // Update state
          set((state) => ({
            projects: state.projects.filter(p => p.id !== projectId),
            currentProjectId: state.currentProjectId === projectId ? null : state.currentProjectId,
          }));

          console.log(`[ProjectStore] Deleted project: ${projectId}`);
        },

        // Rename a project
        renameProject: (projectId: string, newName: string) => {
          set((state) => ({
            projects: state.projects.map(p =>
              p.id === projectId ? { ...p, name: newName, updatedAt: Date.now() } : p
            ),
          }));

          // Also update the map name in storage
          const dataKey = getProjectDataKey(projectId);
          try {
            const data = localStorage.getItem(dataKey);
            if (data) {
              const map = JSON.parse(data) as ArgosMapV1;
              map.name = newName;
              localStorage.setItem(dataKey, JSON.stringify(map));
            }
          } catch (err) {
            console.error("[ProjectStore] Failed to update map name:", err);
          }
        },

        // Duplicate a project
        duplicateProject: (projectId: string, newName: string) => {
          const map = get().openProject(projectId);
          if (!map) return null;

          // Create new project with duplicated data
          map.name = newName;
          map.id = generateId();
          return get().createProject(newName, map);
        },

        // Set current project
        setCurrentProject: (projectId: string | null) => {
          set({ currentProjectId: projectId });
        },

        // Mark as dirty (unsaved changes)
        markDirty: () => {
          set({ isDirty: true });
        },

        // Mark as clean (saved)
        markClean: () => {
          set({ isDirty: false, lastSavedAt: Date.now() });
        },

        // Autosave settings
        setAutosaveEnabled: (enabled: boolean) => {
          set({ autosaveEnabled: enabled });
        },

        setAutosaveInterval: (intervalMs: number) => {
          set({ autosaveIntervalMs: Math.max(5000, intervalMs) }); // Min 5 seconds
        },

        // Export project as JSON string
        exportProject: (projectId: string) => {
          const dataKey = getProjectDataKey(projectId);
          return localStorage.getItem(dataKey);
        },

        // Import project from JSON string
        importProject: (jsonString: string) => {
          try {
            const map = JSON.parse(jsonString) as ArgosMapV1;
            if (!map.version || !map.grid || !map.layers) {
              console.error("[ProjectStore] Invalid map format");
              return null;
            }

            const name = map.name || "Imported Map";
            return get().createProject(name, map);
          } catch (err) {
            console.error("[ProjectStore] Failed to import project:", err);
            return null;
          }
        },
      }),
      {
        name: "argos-projects",
        // Only persist metadata and settings, not map data (stored separately)
        partialize: (state) => ({
          projects: state.projects,
          currentProjectId: state.currentProjectId,
          autosaveEnabled: state.autosaveEnabled,
          autosaveIntervalMs: state.autosaveIntervalMs,
        }),
      }
    )
  )
);

// Subscribe to isDirty changes for autosave trigger
// This is used by the autosave hook
export const subscribeToProjectChanges = (
  callback: (isDirty: boolean, currentProjectId: string | null) => void
) => {
  return useProjectStore.subscribe(
    (state) => ({ isDirty: state.isDirty, currentProjectId: state.currentProjectId }),
    (curr) => callback(curr.isDirty, curr.currentProjectId),
    { equalityFn: (a, b) => a.isDirty === b.isDirty && a.currentProjectId === b.currentProjectId }
  );
};
