import { useEffect, useRef, useCallback } from "react";
import { useMapEditorStore } from "../store/mapEditorStore";
import { useProjectStore } from "../store/projectStore";

/**
 * Hook that provides autosave functionality for map projects.
 *
 * Features:
 * - Debounced autosave (waits for activity to stop)
 * - Configurable interval
 * - Manual save trigger
 * - Dirty state tracking
 */
export function useAutosave() {
  const map = useMapEditorStore((state) => state.map);
  const historyIndex = useMapEditorStore((state) => state.historyIndex);

  const {
    currentProjectId,
    isDirty,
    autosaveEnabled,
    autosaveIntervalMs,
    saveProject,
    markDirty,
    markClean,
  } = useProjectStore();

  // Track the last saved history index to detect changes
  const lastSavedHistoryRef = useRef<number>(-1);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manual save function
  const save = useCallback(() => {
    if (!map || !currentProjectId) return;

    saveProject(currentProjectId, map);
    lastSavedHistoryRef.current = historyIndex;
    markClean();
    console.log("[Autosave] Manual save completed");
  }, [map, currentProjectId, historyIndex, saveProject, markClean]);

  // Detect changes by monitoring history index
  useEffect(() => {
    if (!currentProjectId || !map) return;

    // If history index changed since last save, mark as dirty
    if (historyIndex !== lastSavedHistoryRef.current && lastSavedHistoryRef.current !== -1) {
      if (!isDirty) {
        markDirty();
        console.log("[Autosave] Changes detected, marking dirty");
      }
    }
  }, [historyIndex, currentProjectId, map, isDirty, markDirty]);

  // Autosave effect - debounced and periodic
  useEffect(() => {
    if (!autosaveEnabled || !currentProjectId || !map || !isDirty) {
      return;
    }

    // Clear any existing timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce: Wait for user to stop making changes before saving
    debounceTimerRef.current = setTimeout(() => {
      console.log("[Autosave] Debounce complete, saving...");
      saveProject(currentProjectId, map);
      lastSavedHistoryRef.current = historyIndex;
      markClean();
    }, 2000); // 2 second debounce

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [autosaveEnabled, currentProjectId, map, isDirty, historyIndex, saveProject, autosaveIntervalMs, markClean]);

  // Periodic backup save (in case debounce never triggers)
  useEffect(() => {
    if (!autosaveEnabled || !currentProjectId) {
      return;
    }

    autosaveTimerRef.current = setInterval(() => {
      const state = useProjectStore.getState();
      const mapState = useMapEditorStore.getState();

      if (state.isDirty && mapState.map) {
        console.log("[Autosave] Periodic save...");
        state.saveProject(currentProjectId, mapState.map);
        lastSavedHistoryRef.current = mapState.historyIndex;
        state.markClean();
      }
    }, autosaveIntervalMs);

    return () => {
      if (autosaveTimerRef.current) {
        clearInterval(autosaveTimerRef.current);
      }
    };
  }, [autosaveEnabled, currentProjectId, autosaveIntervalMs]);

  // Save before unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && currentProjectId && map) {
        // Try to save
        saveProject(currentProjectId, map);

        // Show browser warning
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, currentProjectId, map, saveProject]);

  // Initialize lastSavedHistoryRef when project is loaded
  useEffect(() => {
    if (currentProjectId && !isDirty) {
      lastSavedHistoryRef.current = historyIndex;
    }
  }, [currentProjectId, isDirty, historyIndex]);

  return {
    isDirty,
    save,
    autosaveEnabled,
  };
}
