/**
 * Extraction Annotation Store
 *
 * Zustand store for managing annotation state during extraction result editing.
 * Supports:
 * - Element annotation CRUD
 * - Multi-selection management
 * - Undo/Redo history
 * - Tool selection (select, draw, delete)
 * - Session-based LocalStorage persistence
 * - Backend sync for multi-device support
 * - Auto-save with debounce
 * - Copy/paste clipboard
 * - Snap-to-grid
 * - Review workflow
 * - Version history
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  saveAnnotations,
  loadAnnotations,
  generateScreenshotId,
} from "@/services/annotation-persistence";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReviewStatus = "pending" | "approved" | "rejected" | "needs_revision";

export interface AnnotatedElement {
  id: string;
  bbox: BoundingBox;
  label: string;
  elementType: string;
  description?: string;
  reasoning?: string;
  text?: string;
  confidence: number;
  isGroundTruth: boolean;
  isAutoDetected: boolean;
  detectionTechnique?: string;
  isClickable?: boolean;
  // Review workflow
  reviewStatus?: ReviewStatus;
  reviewComment?: string;
  reviewedBy?: string;
  reviewedAt?: number;
}

export type AnnotationTool = "select" | "draw" | "delete" | "pan";

interface HistoryEntry {
  elements: AnnotatedElement[];
  selectedElementIds: string[];
  timestamp: number;
  description?: string;
}

interface VersionEntry {
  id: string;
  elements: AnnotatedElement[];
  timestamp: number;
  savedBy?: string;
  comment?: string;
}

interface ClipboardEntry {
  elements: AnnotatedElement[];
  sourceScreenshotId?: string;
}

interface ConflictInfo {
  hasConflict: boolean;
  localVersion?: number;
  remoteVersion?: number;
  remoteElements?: AnnotatedElement[];
  detectedAt?: number;
}

export interface CollaboratorInfo {
  id: string;
  name: string;
  email: string;
  color: string;
  cursor: { x: number; y: number; viewport_id?: string } | null;
  selection: string[];
  connected_at: string;
}

interface GridSettings {
  enabled: boolean;
  size: number;
  showGuides: boolean;
  snapThreshold: number;
}

interface AutoSaveSettings {
  enabled: boolean;
  debounceMs: number;
}

interface ExtractionAnnotationState {
  // Session tracking
  extractionId: string | null;
  screenshotId: string | null;
  sourceUrl: string | null;

  // Elements
  elements: AnnotatedElement[];

  // Multi-selection
  selectedElementIds: string[];
  hoveredElementId: string | null;

  // Tool
  activeTool: AnnotationTool;

  // View options
  showLabels: boolean;
  showConfidence: boolean;
  showOnlyGroundTruth: boolean;
  showReviewStatus: boolean;

  // History for undo/redo
  history: HistoryEntry[];
  historyIndex: number;

  // Version history
  versions: VersionEntry[];
  currentVersionId: string | null;

  // Drawing state
  isDrawing: boolean;
  drawStart: { x: number; y: number } | null;

  // Selection box for multi-select
  selectionBox: BoundingBox | null;
  isSelectingBox: boolean;

  // Screenshot
  screenshotUrl: string | null;
  screenshotWidth: number;
  screenshotHeight: number;

  // Zoom/pan
  zoom: number;
  pan: { x: number; y: number };

  // Sync state
  isSaving: boolean;
  isLoading: boolean;
  lastSavedAt: number | null;
  lastSyncedAt: number | null;
  hasUnsavedChanges: boolean;

  // Auto-save
  autoSave: AutoSaveSettings;
  autoSaveTimerId: ReturnType<typeof setTimeout> | null;

  // Clipboard
  clipboard: ClipboardEntry | null;

  // Grid/snap settings
  grid: GridSettings;

  // Conflict detection
  conflict: ConflictInfo;

  // Collaboration state
  collaborators: CollaboratorInfo[];
  isCollaborating: boolean;

  // Actions - Session
  setSession: (extractionId: string, screenshotId?: string, sourceUrl?: string) => void;

  // Actions - Elements
  setElements: (elements: AnnotatedElement[], description?: string) => void;
  addElement: (element: Omit<AnnotatedElement, "id">) => string;
  addElements: (elements: Omit<AnnotatedElement, "id">[]) => string[];
  updateElement: (id: string, updates: Partial<AnnotatedElement>) => void;
  updateElements: (ids: string[], updates: Partial<AnnotatedElement>) => void;
  deleteElement: (id: string) => void;
  deleteElements: (ids: string[]) => void;
  moveElements: (ids: string[], deltaX: number, deltaY: number) => void;
  resizeElement: (id: string, newBbox: BoundingBox) => void;

  // Actions - Selection
  selectElement: (id: string | null, addToSelection?: boolean) => void;
  selectElements: (ids: string[]) => void;
  selectAll: () => void;
  deselectAll: () => void;
  invertSelection: () => void;
  setHoveredElement: (id: string | null) => void;

  // Actions - Selection box
  startSelectionBox: (start: { x: number; y: number }) => void;
  updateSelectionBox: (current: { x: number; y: number }) => void;
  endSelectionBox: () => void;

  // Actions - Clipboard
  copySelected: () => void;
  cutSelected: () => void;
  paste: (offset?: { x: number; y: number }) => void;

  // Actions - Tools & View
  setActiveTool: (tool: AnnotationTool) => void;
  setShowLabels: (show: boolean) => void;
  setShowConfidence: (show: boolean) => void;
  setShowOnlyGroundTruth: (show: boolean) => void;
  setShowReviewStatus: (show: boolean) => void;
  setScreenshot: (url: string | null, width: number, height: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setDrawing: (isDrawing: boolean, start: { x: number; y: number } | null) => void;

  // Actions - Grid
  setGridEnabled: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  setShowGuides: (show: boolean) => void;
  snapToGrid: (value: number) => number;
  snapBboxToGrid: (bbox: BoundingBox) => BoundingBox;

  // Actions - Auto-save
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveDebounce: (ms: number) => void;
  triggerAutoSave: () => void;
  cancelAutoSave: () => void;

  // Actions - Review workflow
  setReviewStatus: (ids: string[], status: ReviewStatus, comment?: string) => void;
  bulkApprove: () => void;
  bulkReject: (comment?: string) => void;

  // Actions - Version history
  saveVersion: (comment?: string) => void;
  loadVersion: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;

  // Actions - Conflict resolution
  checkForConflicts: () => Promise<boolean>;
  resolveConflict: (resolution: "keep_local" | "keep_remote" | "merge") => void;

  // Actions - Collaboration
  setCollaborators: (collaborators: CollaboratorInfo[]) => void;
  addCollaborator: (collaborator: CollaboratorInfo) => void;
  removeCollaborator: (userId: string) => void;
  updateCollaboratorCursor: (userId: string, cursor: { x: number; y: number; viewport_id?: string } | null) => void;
  updateCollaboratorSelection: (userId: string, selection: string[]) => void;
  setIsCollaborating: (isCollaborating: boolean) => void;
  applyRemoteElementUpdate: (elementId: string, changes: Partial<AnnotatedElement>) => void;
  applyRemoteElementAdd: (element: AnnotatedElement) => void;
  applyRemoteElementDelete: (elementIds: string[]) => void;
  applyRemoteElementMove: (elementIds: string[], deltaX: number, deltaY: number) => void;
  applyRemoteElementResize: (elementId: string, bbox: BoundingBox) => void;

  // Actions - History
  undo: () => void;
  redo: () => void;
  reset: () => void;

  // Backend sync
  saveToBackend: () => Promise<{ success: boolean; error?: string }>;
  loadFromBackend: (extractionId: string) => Promise<{ success: boolean; error?: string }>;

  // Helpers
  canUndo: () => boolean;
  canRedo: () => boolean;
  getSelectedElements: () => AnnotatedElement[];
  getVisibleElements: () => AnnotatedElement[];
  hasSelection: () => boolean;
  getElementsInBox: (box: BoundingBox) => AnnotatedElement[];
}

const MAX_HISTORY = 50;
const MAX_VERSIONS = 20;
const DEFAULT_AUTO_SAVE_DEBOUNCE = 2000;
const DEFAULT_GRID_SIZE = 10;
const DEFAULT_SNAP_THRESHOLD = 5;

function generateId(): string {
  return `elem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateVersionId(): string {
  return `ver_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function saveToHistory(
  state: Pick<ExtractionAnnotationState, "elements" | "selectedElementIds" | "history" | "historyIndex">,
  description?: string
): Pick<ExtractionAnnotationState, "history" | "historyIndex" | "hasUnsavedChanges"> {
  const entry: HistoryEntry = {
    elements: JSON.parse(JSON.stringify(state.elements)),
    selectedElementIds: [...state.selectedElementIds],
    timestamp: Date.now(),
    description,
  };

  // Remove any redo history
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(entry);

  // Limit history size
  if (newHistory.length > MAX_HISTORY) {
    newHistory.shift();
  }

  return {
    history: newHistory,
    historyIndex: newHistory.length - 1,
    hasUnsavedChanges: true,
  };
}

function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function normalizeBox(start: { x: number; y: number }, end: { x: number; y: number }): BoundingBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export const useExtractionAnnotationStore = create<ExtractionAnnotationState>()(
  persist(
    (set, get) => ({
      // Initial state
      extractionId: null,
      screenshotId: null,
      sourceUrl: null,
      elements: [],
      selectedElementIds: [],
      hoveredElementId: null,
      activeTool: "select",
      showLabels: true,
      showConfidence: false,
      showOnlyGroundTruth: false,
      showReviewStatus: false,
      history: [],
      historyIndex: -1,
      versions: [],
      currentVersionId: null,
      isDrawing: false,
      drawStart: null,
      selectionBox: null,
      isSelectingBox: false,
      screenshotUrl: null,
      screenshotWidth: 0,
      screenshotHeight: 0,
      zoom: 1,
      pan: { x: 0, y: 0 },
      isSaving: false,
      isLoading: false,
      lastSavedAt: null,
      lastSyncedAt: null,
      hasUnsavedChanges: false,
      autoSave: {
        enabled: true,
        debounceMs: DEFAULT_AUTO_SAVE_DEBOUNCE,
      },
      autoSaveTimerId: null,
      clipboard: null,
      grid: {
        enabled: false,
        size: DEFAULT_GRID_SIZE,
        showGuides: true,
        snapThreshold: DEFAULT_SNAP_THRESHOLD,
      },
      conflict: {
        hasConflict: false,
      },
      collaborators: [],
      isCollaborating: false,

      // Set current session
      setSession: (extractionId, screenshotId, sourceUrl) => {
        const state = get();
        const newScreenshotId = screenshotId || generateScreenshotId(extractionId, 0);

        // If switching to a different session, reset state
        if (state.extractionId !== extractionId) {
          set({
            extractionId,
            screenshotId: newScreenshotId,
            sourceUrl: sourceUrl || null,
            elements: [],
            selectedElementIds: [],
            hoveredElementId: null,
            history: [],
            historyIndex: -1,
            versions: [],
            currentVersionId: null,
            hasUnsavedChanges: false,
            conflict: { hasConflict: false },
          });
        } else {
          set({
            extractionId,
            screenshotId: newScreenshotId,
            sourceUrl: sourceUrl || state.sourceUrl,
          });
        }
      },

      // Element actions
      setElements: (elements, description) => {
        const state = get();
        set({
          elements,
          ...saveToHistory({ ...state, elements, selectedElementIds: state.selectedElementIds }, description || "Set elements"),
        });
        get().triggerAutoSave();
      },

      addElement: (elementData) => {
        const state = get();
        const id = generateId();
        const bbox = state.grid.enabled ? state.snapBboxToGrid(elementData.bbox) : elementData.bbox;
        const element: AnnotatedElement = {
          ...elementData,
          bbox,
          id,
          reviewStatus: "pending",
        };

        const newElements = [...state.elements, element];
        set({
          elements: newElements,
          selectedElementIds: [id],
          ...saveToHistory({ ...state, elements: newElements, selectedElementIds: [id] }, "Add element"),
        });
        get().triggerAutoSave();
        return id;
      },

      addElements: (elementsData) => {
        const state = get();
        const ids: string[] = [];
        const newElements = [...state.elements];

        for (const elementData of elementsData) {
          const id = generateId();
          ids.push(id);
          const bbox = state.grid.enabled ? state.snapBboxToGrid(elementData.bbox) : elementData.bbox;
          newElements.push({
            ...elementData,
            bbox,
            id,
            reviewStatus: "pending",
          });
        }

        set({
          elements: newElements,
          selectedElementIds: ids,
          ...saveToHistory({ ...state, elements: newElements, selectedElementIds: ids }, `Add ${ids.length} elements`),
        });
        get().triggerAutoSave();
        return ids;
      },

      updateElement: (id, updates) => {
        const state = get();
        const newElements = state.elements.map((el) =>
          el.id === id ? { ...el, ...updates } : el
        );
        set({
          elements: newElements,
          ...saveToHistory({ ...state, elements: newElements }, "Update element"),
        });
        get().triggerAutoSave();
      },

      updateElements: (ids, updates) => {
        const state = get();
        const idSet = new Set(ids);
        const newElements = state.elements.map((el) =>
          idSet.has(el.id) ? { ...el, ...updates } : el
        );
        set({
          elements: newElements,
          ...saveToHistory({ ...state, elements: newElements }, `Update ${ids.length} elements`),
        });
        get().triggerAutoSave();
      },

      deleteElement: (id) => {
        const state = get();
        const newElements = state.elements.filter((el) => el.id !== id);
        const newSelectedIds = state.selectedElementIds.filter((eid) => eid !== id);
        set({
          elements: newElements,
          selectedElementIds: newSelectedIds,
          ...saveToHistory({
            ...state,
            elements: newElements,
            selectedElementIds: newSelectedIds,
          }, "Delete element"),
        });
        get().triggerAutoSave();
      },

      deleteElements: (ids) => {
        const state = get();
        const idSet = new Set(ids);
        const newElements = state.elements.filter((el) => !idSet.has(el.id));
        const newSelectedIds = state.selectedElementIds.filter((eid) => !idSet.has(eid));
        set({
          elements: newElements,
          selectedElementIds: newSelectedIds,
          ...saveToHistory({
            ...state,
            elements: newElements,
            selectedElementIds: newSelectedIds,
          }, `Delete ${ids.length} elements`),
        });
        get().triggerAutoSave();
      },

      moveElements: (ids, deltaX, deltaY) => {
        const state = get();
        const idSet = new Set(ids);
        const newElements = state.elements.map((el) => {
          if (!idSet.has(el.id)) return el;
          let newBbox = {
            ...el.bbox,
            x: el.bbox.x + deltaX,
            y: el.bbox.y + deltaY,
          };
          if (state.grid.enabled) {
            newBbox = state.snapBboxToGrid(newBbox);
          }
          return { ...el, bbox: newBbox };
        });
        set({
          elements: newElements,
          ...saveToHistory({ ...state, elements: newElements }, "Move elements"),
        });
        get().triggerAutoSave();
      },

      resizeElement: (id, newBbox) => {
        const state = get();
        const bbox = state.grid.enabled ? state.snapBboxToGrid(newBbox) : newBbox;
        const newElements = state.elements.map((el) =>
          el.id === id ? { ...el, bbox } : el
        );
        set({
          elements: newElements,
          ...saveToHistory({ ...state, elements: newElements }, "Resize element"),
        });
        get().triggerAutoSave();
      },

      // Selection actions
      selectElement: (id, addToSelection = false) => {
        const state = get();
        if (id === null) {
          set({ selectedElementIds: [] });
        } else if (addToSelection) {
          const newIds = state.selectedElementIds.includes(id)
            ? state.selectedElementIds.filter((eid) => eid !== id)
            : [...state.selectedElementIds, id];
          set({ selectedElementIds: newIds });
        } else {
          set({ selectedElementIds: [id] });
        }
      },

      selectElements: (ids) => {
        set({ selectedElementIds: ids });
      },

      selectAll: () => {
        const state = get();
        set({ selectedElementIds: state.elements.map((el) => el.id) });
      },

      deselectAll: () => {
        set({ selectedElementIds: [] });
      },

      invertSelection: () => {
        const state = get();
        const selectedSet = new Set(state.selectedElementIds);
        const newSelected = state.elements
          .filter((el) => !selectedSet.has(el.id))
          .map((el) => el.id);
        set({ selectedElementIds: newSelected });
      },

      setHoveredElement: (id) => {
        set({ hoveredElementId: id });
      },

      // Selection box
      startSelectionBox: (start) => {
        set({
          isSelectingBox: true,
          selectionBox: { x: start.x, y: start.y, width: 0, height: 0 },
        });
      },

      updateSelectionBox: (current) => {
        const state = get();
        if (!state.isSelectingBox || !state.selectionBox) return;

        const box = normalizeBox(
          { x: state.selectionBox.x, y: state.selectionBox.y },
          current
        );
        set({ selectionBox: box });
      },

      endSelectionBox: () => {
        const state = get();
        if (state.selectionBox && state.selectionBox.width > 5 && state.selectionBox.height > 5) {
          const elementsInBox = state.getElementsInBox(state.selectionBox);
          set({ selectedElementIds: elementsInBox.map((el) => el.id) });
        }
        set({ isSelectingBox: false, selectionBox: null });
      },

      // Clipboard
      copySelected: () => {
        const state = get();
        const selectedElements = state.elements.filter((el) =>
          state.selectedElementIds.includes(el.id)
        );
        if (selectedElements.length > 0) {
          set({
            clipboard: {
              elements: JSON.parse(JSON.stringify(selectedElements)),
              sourceScreenshotId: state.screenshotId || undefined,
            },
          });
        }
      },

      cutSelected: () => {
        const state = get();
        state.copySelected();
        state.deleteElements(state.selectedElementIds);
      },

      paste: (offset = { x: 20, y: 20 }) => {
        const state = get();
        if (!state.clipboard || state.clipboard.elements.length === 0) return;

        const newElements: Omit<AnnotatedElement, "id">[] = state.clipboard.elements.map((el) => ({
          ...el,
          bbox: {
            ...el.bbox,
            x: el.bbox.x + offset.x,
            y: el.bbox.y + offset.y,
          },
          reviewStatus: "pending" as ReviewStatus,
        }));

        state.addElements(newElements);
      },

      // Tools & View
      setActiveTool: (tool) => {
        set({ activeTool: tool, selectedElementIds: [] });
      },

      setShowLabels: (show) => {
        set({ showLabels: show });
      },

      setShowConfidence: (show) => {
        set({ showConfidence: show });
      },

      setShowOnlyGroundTruth: (show) => {
        set({ showOnlyGroundTruth: show });
      },

      setShowReviewStatus: (show) => {
        set({ showReviewStatus: show });
      },

      setScreenshot: (url, width, height) => {
        set({
          screenshotUrl: url,
          screenshotWidth: width,
          screenshotHeight: height,
          zoom: 1,
          pan: { x: 0, y: 0 },
        });
      },

      setZoom: (zoom) => {
        set({ zoom: Math.max(0.1, Math.min(5, zoom)) });
      },

      setPan: (pan) => {
        set({ pan });
      },

      setDrawing: (isDrawing, start) => {
        set({ isDrawing, drawStart: start });
      },

      // Grid
      setGridEnabled: (enabled) => {
        set((state) => ({ grid: { ...state.grid, enabled } }));
      },

      setGridSize: (size) => {
        set((state) => ({ grid: { ...state.grid, size: Math.max(5, size) } }));
      },

      setShowGuides: (show) => {
        set((state) => ({ grid: { ...state.grid, showGuides: show } }));
      },

      snapToGrid: (value) => {
        const state = get();
        if (!state.grid.enabled) return value;
        return Math.round(value / state.grid.size) * state.grid.size;
      },

      snapBboxToGrid: (bbox) => {
        const state = get();
        if (!state.grid.enabled) return bbox;
        return {
          x: state.snapToGrid(bbox.x),
          y: state.snapToGrid(bbox.y),
          width: Math.max(state.grid.size, state.snapToGrid(bbox.width)),
          height: Math.max(state.grid.size, state.snapToGrid(bbox.height)),
        };
      },

      // Auto-save
      setAutoSaveEnabled: (enabled) => {
        set((state) => ({ autoSave: { ...state.autoSave, enabled } }));
      },

      setAutoSaveDebounce: (ms) => {
        set((state) => ({ autoSave: { ...state.autoSave, debounceMs: Math.max(500, ms) } }));
      },

      triggerAutoSave: () => {
        const state = get();
        if (!state.autoSave.enabled || !state.extractionId) return;

        // Cancel any pending auto-save
        if (state.autoSaveTimerId) {
          clearTimeout(state.autoSaveTimerId);
        }

        // Schedule new auto-save
        const timerId = setTimeout(() => {
          const currentState = get();
          if (currentState.hasUnsavedChanges && currentState.extractionId) {
            currentState.saveToBackend();
          }
        }, state.autoSave.debounceMs);

        set({ autoSaveTimerId: timerId });
      },

      cancelAutoSave: () => {
        const state = get();
        if (state.autoSaveTimerId) {
          clearTimeout(state.autoSaveTimerId);
          set({ autoSaveTimerId: null });
        }
      },

      // Review workflow
      setReviewStatus: (ids, status, comment) => {
        const state = get();
        const idSet = new Set(ids);
        const newElements = state.elements.map((el) =>
          idSet.has(el.id)
            ? {
                ...el,
                reviewStatus: status,
                reviewComment: comment,
                reviewedAt: Date.now(),
              }
            : el
        );
        set({
          elements: newElements,
          ...saveToHistory({ ...state, elements: newElements }, `Set review status: ${status}`),
        });
        get().triggerAutoSave();
      },

      bulkApprove: () => {
        const state = get();
        state.setReviewStatus(state.selectedElementIds, "approved");
      },

      bulkReject: (comment) => {
        const state = get();
        state.setReviewStatus(state.selectedElementIds, "rejected", comment);
      },

      // Version history
      saveVersion: (comment) => {
        const state = get();
        const version: VersionEntry = {
          id: generateVersionId(),
          elements: JSON.parse(JSON.stringify(state.elements)),
          timestamp: Date.now(),
          comment,
        };

        let newVersions = [...state.versions, version];
        if (newVersions.length > MAX_VERSIONS) {
          newVersions = newVersions.slice(-MAX_VERSIONS);
        }

        set({ versions: newVersions, currentVersionId: version.id });
      },

      loadVersion: (versionId) => {
        const state = get();
        const version = state.versions.find((v) => v.id === versionId);
        if (!version) return;

        set({
          elements: JSON.parse(JSON.stringify(version.elements)),
          currentVersionId: versionId,
          selectedElementIds: [],
          ...saveToHistory({ ...state, elements: version.elements, selectedElementIds: [] }, `Load version from ${new Date(version.timestamp).toLocaleString()}`),
        });
      },

      deleteVersion: (versionId) => {
        const state = get();
        set({
          versions: state.versions.filter((v) => v.id !== versionId),
          currentVersionId: state.currentVersionId === versionId ? null : state.currentVersionId,
        });
      },

      // Conflict resolution
      checkForConflicts: async () => {
        const state = get();
        if (!state.extractionId) return false;

        try {
          const result = await loadAnnotations(state.extractionId);
          if (result.success && result.annotations && result.annotations.length > 0) {
            const remoteAnnotation = result.annotations[0]!;

            // Simple conflict detection: compare element counts and last saved times
            const hasConflict =
              state.hasUnsavedChanges &&
              state.lastSyncedAt !== null &&
              remoteAnnotation.elements.length !== state.elements.length;

            if (hasConflict) {
              set({
                conflict: {
                  hasConflict: true,
                  remoteElements: remoteAnnotation.elements,
                  detectedAt: Date.now(),
                },
              });
            }
            return hasConflict;
          }
        } catch {
          // Ignore errors during conflict check
        }
        return false;
      },

      resolveConflict: (resolution) => {
        const state = get();
        if (!state.conflict.hasConflict) return;

        switch (resolution) {
          case "keep_local":
            // Just clear conflict, keep local changes
            set({ conflict: { hasConflict: false } });
            get().saveToBackend();
            break;
          case "keep_remote":
            if (state.conflict.remoteElements) {
              set({
                elements: state.conflict.remoteElements,
                conflict: { hasConflict: false },
                hasUnsavedChanges: false,
              });
            }
            break;
          case "merge":
            if (state.conflict.remoteElements) {
              // Simple merge: combine elements, remove duplicates by ID
              const localIds = new Set(state.elements.map((el) => el.id));
              const mergedElements = [
                ...state.elements,
                ...state.conflict.remoteElements.filter((el) => !localIds.has(el.id)),
              ];
              set({
                elements: mergedElements,
                conflict: { hasConflict: false },
                hasUnsavedChanges: true,
              });
              get().saveToBackend();
            }
            break;
        }
      },

      // Collaboration actions
      setCollaborators: (collaborators) => {
        set({ collaborators });
      },

      addCollaborator: (collaborator) => {
        set((state) => {
          // Avoid duplicates
          if (state.collaborators.some((c) => c.id === collaborator.id)) {
            return state;
          }
          return { collaborators: [...state.collaborators, collaborator] };
        });
      },

      removeCollaborator: (userId) => {
        set((state) => ({
          collaborators: state.collaborators.filter((c) => c.id !== userId),
        }));
      },

      updateCollaboratorCursor: (userId, cursor) => {
        set((state) => ({
          collaborators: state.collaborators.map((c) =>
            c.id === userId ? { ...c, cursor } : c
          ),
        }));
      },

      updateCollaboratorSelection: (userId, selection) => {
        set((state) => ({
          collaborators: state.collaborators.map((c) =>
            c.id === userId ? { ...c, selection } : c
          ),
        }));
      },

      setIsCollaborating: (isCollaborating) => {
        set({ isCollaborating });
        if (!isCollaborating) {
          // Clear collaborators when stopping collaboration
          set({ collaborators: [] });
        }
      },

      applyRemoteElementUpdate: (elementId, changes) => {
        // Apply update from remote collaborator without triggering auto-save
        set((state) => ({
          elements: state.elements.map((el) =>
            el.id === elementId ? { ...el, ...changes } : el
          ),
        }));
      },

      applyRemoteElementAdd: (element) => {
        // Apply add from remote collaborator without triggering auto-save
        set((state) => {
          // Check if element already exists
          if (state.elements.some((el) => el.id === element.id)) {
            return state;
          }
          return { elements: [...state.elements, element] };
        });
      },

      applyRemoteElementDelete: (elementIds) => {
        // Apply delete from remote collaborator without triggering auto-save
        const idSet = new Set(elementIds);
        set((state) => ({
          elements: state.elements.filter((el) => !idSet.has(el.id)),
          selectedElementIds: state.selectedElementIds.filter((id) => !idSet.has(id)),
        }));
      },

      applyRemoteElementMove: (elementIds, deltaX, deltaY) => {
        // Apply move from remote collaborator without triggering auto-save
        const idSet = new Set(elementIds);
        set((state) => ({
          elements: state.elements.map((el) =>
            idSet.has(el.id)
              ? {
                  ...el,
                  bbox: {
                    ...el.bbox,
                    x: el.bbox.x + deltaX,
                    y: el.bbox.y + deltaY,
                  },
                }
              : el
          ),
        }));
      },

      applyRemoteElementResize: (elementId, bbox) => {
        // Apply resize from remote collaborator without triggering auto-save
        set((state) => ({
          elements: state.elements.map((el) =>
            el.id === elementId ? { ...el, bbox } : el
          ),
        }));
      },

      // History
      undo: () => {
        const state = get();
        if (state.historyIndex <= 0) return;

        const prevEntry = state.history[state.historyIndex - 1];
        if (!prevEntry) return;

        set({
          elements: JSON.parse(JSON.stringify(prevEntry.elements)),
          selectedElementIds: prevEntry.selectedElementIds,
          historyIndex: state.historyIndex - 1,
          hasUnsavedChanges: true,
        });
        get().triggerAutoSave();
      },

      redo: () => {
        const state = get();
        if (state.historyIndex >= state.history.length - 1) return;

        const nextEntry = state.history[state.historyIndex + 1];
        if (!nextEntry) return;

        set({
          elements: JSON.parse(JSON.stringify(nextEntry.elements)),
          selectedElementIds: nextEntry.selectedElementIds,
          historyIndex: state.historyIndex + 1,
          hasUnsavedChanges: true,
        });
        get().triggerAutoSave();
      },

      reset: () => {
        const state = get();
        state.cancelAutoSave();
        set({
          extractionId: null,
          screenshotId: null,
          sourceUrl: null,
          elements: [],
          selectedElementIds: [],
          hoveredElementId: null,
          activeTool: "select",
          history: [],
          historyIndex: -1,
          versions: [],
          currentVersionId: null,
          isDrawing: false,
          drawStart: null,
          selectionBox: null,
          isSelectingBox: false,
          screenshotUrl: null,
          screenshotWidth: 0,
          screenshotHeight: 0,
          zoom: 1,
          pan: { x: 0, y: 0 },
          hasUnsavedChanges: false,
          lastSavedAt: null,
          lastSyncedAt: null,
          clipboard: null,
          conflict: { hasConflict: false },
          collaborators: [],
          isCollaborating: false,
        });
      },

      // Backend sync
      saveToBackend: async () => {
        const state = get();

        if (!state.extractionId) {
          return { success: false, error: "No extraction session set" };
        }

        // Cancel any pending auto-save since we're saving now
        state.cancelAutoSave();

        set({ isSaving: true });

        try {
          const result = await saveAnnotations(
            state.extractionId,
            state.screenshotId || generateScreenshotId(state.extractionId, 0),
            state.elements,
            {
              sourceUrl: state.sourceUrl || undefined,
              viewportWidth: state.screenshotWidth || 1920,
              viewportHeight: state.screenshotHeight || 1080,
            }
          );

          if (result.success) {
            const now = Date.now();
            set({
              isSaving: false,
              hasUnsavedChanges: false,
              lastSavedAt: now,
              lastSyncedAt: now,
            });
          } else {
            set({ isSaving: false });
          }

          return result;
        } catch (error) {
          set({ isSaving: false });
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },

      loadFromBackend: async (extractionId: string) => {
        set({ isLoading: true, extractionId });

        try {
          const result = await loadAnnotations(extractionId);

          if (result.success && result.annotations && result.annotations.length > 0) {
            const firstAnnotation = result.annotations[0]!;

            set({
              isLoading: false,
              extractionId,
              screenshotId: firstAnnotation.screenshotId,
              sourceUrl: firstAnnotation.sourceUrl,
              elements: firstAnnotation.elements,
              screenshotWidth: firstAnnotation.viewportWidth,
              screenshotHeight: firstAnnotation.viewportHeight,
              hasUnsavedChanges: false,
              lastSyncedAt: Date.now(),
              history: [],
              historyIndex: -1,
              selectedElementIds: [],
            });

            return { success: true };
          } else if (result.success) {
            set({
              isLoading: false,
              extractionId,
              elements: [],
              hasUnsavedChanges: false,
              lastSyncedAt: Date.now(),
            });
            return { success: true };
          } else {
            set({ isLoading: false });
            return result;
          }
        } catch (error) {
          set({ isLoading: false });
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },

      // Helpers
      canUndo: () => {
        const state = get();
        return state.historyIndex > 0;
      },

      canRedo: () => {
        const state = get();
        return state.historyIndex < state.history.length - 1;
      },

      getSelectedElements: () => {
        const state = get();
        return state.elements.filter((el) => state.selectedElementIds.includes(el.id));
      },

      getVisibleElements: () => {
        const state = get();
        if (state.showOnlyGroundTruth) {
          return state.elements.filter((el) => el.isGroundTruth);
        }
        return state.elements;
      },

      hasSelection: () => {
        const state = get();
        return state.selectedElementIds.length > 0;
      },

      getElementsInBox: (box: BoundingBox) => {
        const state = get();
        return state.elements.filter((el) => boxesIntersect(el.bbox, box));
      },
    }),
    {
      name: "extraction-annotations",
      storage: createJSONStorage(() => localStorage),
      // Only persist elements and session info, not UI state
      partialize: (state) => ({
        extractionId: state.extractionId,
        screenshotId: state.screenshotId,
        sourceUrl: state.sourceUrl,
        elements: state.elements,
        screenshotUrl: state.screenshotUrl,
        screenshotWidth: state.screenshotWidth,
        screenshotHeight: state.screenshotHeight,
        lastSavedAt: state.lastSavedAt,
        versions: state.versions,
        autoSave: state.autoSave,
        grid: state.grid,
      }),
    }
  )
);

// Legacy compatibility - map single selection to multi-selection
// This helps components that still use selectedElementId
Object.defineProperty(useExtractionAnnotationStore.getState(), 'selectedElementId', {
  get() {
    const ids = useExtractionAnnotationStore.getState().selectedElementIds;
    return ids.length > 0 ? ids[0] : null;
  },
});
