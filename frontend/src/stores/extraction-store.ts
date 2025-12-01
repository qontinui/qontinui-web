/**
 * Zustand store for web extraction state management.
 *
 * Uses a unified StateStructure model that can contain:
 * - Single-app extractions (one connected state tree)
 * - Multi-app environments (multiple disjoint state trees)
 *
 * Origin tracking enables partial replacement when re-extracting specific sources.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type {
  BoundingBox,
  CorrelatedState,
  ExtractedElement,
  ExtractedState,
  ExtractedTransition,
  ExtractionConfig,
  ExtractionMode,
  ExtractionSession,
  ExtractionStats,
  FrameworkType,
  InferredTransition,
  ScreenshotData,
  StateStructure,
  VerifiedTransition,
} from "@/components/web-extraction/types";

// =============================================================================
// Store State
// =============================================================================

interface ExtractionState {
  // Session
  currentSession: ExtractionSession | null;
  status: "idle" | "configuring" | "running" | "complete" | "error";
  config: ExtractionConfig;
  errorMessage: string | null;

  // Extraction mode and framework
  mode: ExtractionMode;
  framework: FrameworkType | null;

  // State structure (unified model - may contain disjoint state trees)
  stateStructure: StateStructure | null;

  // UI state for source filtering (selected source for filtering states)
  selectedSourceId: string | null;

  // Active states (can span multiple disjoint trees)
  activeStateIds: Set<string>;

  // Legacy results (for backward compatibility during migration)
  elements: ExtractedElement[];
  states: ExtractedState[];
  transitions: ExtractedTransition[];
  screenshots: Map<string, ScreenshotData>;

  // UI state
  selectedStateId: string | null;
  selectedElementId: string | null;
  previewScreenshotId: string | null;
  showElementLabels: boolean;
  showStateBoundaries: boolean;

  // Statistics
  stats: ExtractionStats;
}

// =============================================================================
// Store Actions
// =============================================================================

interface ExtractionActions {
  // Session management
  setSession: (session: ExtractionSession | null) => void;
  setStatus: (status: ExtractionState["status"]) => void;
  setError: (message: string | null) => void;
  resetExtraction: () => void;

  // Configuration
  setConfig: (config: Partial<ExtractionConfig>) => void;
  addUrl: (url: string) => void;
  removeUrl: (index: number) => void;
  setViewports: (viewports: [number, number][]) => void;
  setMode: (mode: ExtractionMode) => void;
  setProjectPath: (path: string | null) => void;

  // Results from WebSocket (legacy format)
  addState: (state: ExtractedState, thumbnail: string) => void;
  addElement: (element: ExtractedElement) => void;
  addTransition: (transition: ExtractedTransition) => void;
  updateStats: (stats: Partial<ExtractionStats>) => void;
  addScreenshot: (id: string, thumbnail: string) => void;

  // State structure management (unified model)
  setStateStructure: (structure: StateStructure) => void;
  replaceSource: (
    sourceId: string,
    newStates: CorrelatedState[],
    newTransitions: (InferredTransition | VerifiedTransition)[],
    newElements: ExtractedElement[]
  ) => void;
  removeSource: (sourceId: string) => void;
  setSelectedSource: (sourceId: string | null) => void;

  // Active state management (can span multiple disjoint trees)
  activateState: (stateId: string) => void;
  deactivateState: (stateId: string) => void;
  setActiveStates: (stateIds: Set<string>) => void;
  clearActiveStates: () => void;
  clearActiveStatesForSource: (sourceId: string) => void;

  // Add correlated state (new format)
  addCorrelatedState: (
    state: CorrelatedState,
    sourceId?: string,
    thumbnail?: string
  ) => void;
  addInferredTransition: (
    transition: InferredTransition,
    sourceId?: string
  ) => void;
  addVerifiedTransition: (
    transition: VerifiedTransition,
    sourceId?: string
  ) => void;

  // Editing
  updateStateBoundary: (stateId: string, bbox: BoundingBox) => void;
  updateStateName: (stateId: string, name: string) => void;
  updateElementType: (elementId: string, elementType: string) => void;
  deleteState: (stateId: string) => void;
  deleteElement: (elementId: string) => void;
  mergeStates: (stateIds: string[], newName: string) => void;

  // UI actions
  selectState: (stateId: string | null) => void;
  selectElement: (elementId: string | null) => void;
  setPreviewScreenshot: (screenshotId: string | null) => void;
  toggleElementLabels: () => void;
  toggleStateBoundaries: () => void;
}

// =============================================================================
// Defaults
// =============================================================================

const defaultConfig: ExtractionConfig = {
  urls: [],
  viewports: [[1920, 1080]],
  captureHoverStates: true,
  captureFocusStates: true,
  captureScrollStates: true,
  maxDepth: 5,
  maxPages: 100,
  authCookies: {},
  mode: "black_box",
};

const defaultStats: ExtractionStats = {
  pagesVisited: 0,
  statesFound: 0,
  elementsFound: 0,
  transitionsFound: 0,
};

const initialState: ExtractionState = {
  currentSession: null,
  status: "idle",
  config: defaultConfig,
  errorMessage: null,
  mode: "black_box",
  framework: null,
  stateStructure: null,
  selectedSourceId: null,
  activeStateIds: new Set(),
  elements: [],
  states: [],
  transitions: [],
  screenshots: new Map(),
  selectedStateId: null,
  selectedElementId: null,
  previewScreenshotId: null,
  showElementLabels: true,
  showStateBoundaries: true,
  stats: defaultStats,
};

// =============================================================================
// Store Implementation
// =============================================================================

export const useExtractionStore = create<ExtractionState & ExtractionActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // =========================================================================
      // Session Management
      // =========================================================================

      setSession: (session) =>
        set((state) => {
          state.currentSession = session;
          if (session?.mode) {
            state.mode = session.mode;
          }
          if (session?.framework) {
            state.framework = session.framework;
          }
          // Handle both old naming and new unified model
          if (session?.applicationState) {
            state.stateStructure = session.applicationState;
          }
          if (session?.compositeState) {
            state.stateStructure = session.compositeState;
          }
        }),

      setStatus: (status) =>
        set((state) => {
          state.status = status;
        }),

      setError: (message) =>
        set((state) => {
          state.errorMessage = message;
          if (message) {
            state.status = "error";
          }
        }),

      resetExtraction: () =>
        set((state) => {
          Object.assign(state, initialState);
        }),

      // =========================================================================
      // Configuration
      // =========================================================================

      setConfig: (config) =>
        set((state) => {
          Object.assign(state.config, config);
        }),

      addUrl: (url) =>
        set((state) => {
          if (!state.config.urls.includes(url)) {
            state.config.urls.push(url);
          }
        }),

      removeUrl: (index) =>
        set((state) => {
          state.config.urls.splice(index, 1);
        }),

      setViewports: (viewports) =>
        set((state) => {
          state.config.viewports = viewports;
        }),

      setMode: (mode) =>
        set((state) => {
          state.mode = mode;
          state.config.mode = mode;
        }),

      setProjectPath: (path) =>
        set((state) => {
          state.config.projectPath = path ?? undefined;
          // Auto-switch to white_box mode if project path is set
          if (path) {
            state.mode = "white_box";
            state.config.mode = "white_box";
          }
        }),

      // =========================================================================
      // Legacy Results (backward compatibility)
      // =========================================================================

      addState: (newState, thumbnail) =>
        set((state) => {
          const existingIndex = state.states.findIndex(
            (s) => s.id === newState.id
          );
          if (existingIndex >= 0) {
            state.states[existingIndex] = newState;
          } else {
            state.states.push(newState);
          }

          if (thumbnail && newState.screenshotId) {
            state.screenshots.set(newState.screenshotId, {
              id: newState.screenshotId,
              thumbnail,
            });
          }

          state.stats.statesFound = state.states.length;
        }),

      addElement: (element) =>
        set((state) => {
          const existingIndex = state.elements.findIndex(
            (e) => e.id === element.id
          );
          if (existingIndex >= 0) {
            state.elements[existingIndex] = element;
          } else {
            state.elements.push(element);
          }
          state.stats.elementsFound = state.elements.length;
        }),

      addTransition: (transition) =>
        set((state) => {
          const existingIndex = state.transitions.findIndex(
            (t) => t.id === transition.id
          );
          if (existingIndex >= 0) {
            state.transitions[existingIndex] = transition;
          } else {
            state.transitions.push(transition);
          }
          state.stats.transitionsFound = state.transitions.length;
        }),

      updateStats: (stats) =>
        set((state) => {
          Object.assign(state.stats, stats);
        }),

      addScreenshot: (id, thumbnail) =>
        set((state) => {
          state.screenshots.set(id, { id, thumbnail });
        }),

      // =========================================================================
      // State Structure Management (Unified Model)
      // =========================================================================

      setStateStructure: (structure) =>
        set((state) => {
          state.stateStructure = structure;
          // Update stats from structure
          state.stats = {
            pagesVisited: state.stats.pagesVisited,
            statesFound: structure.states.length,
            elementsFound: structure.elements.length,
            transitionsFound: structure.transitions.length,
          };
          // Update active states from structure
          state.activeStateIds = new Set(structure.activeStateIds);
        }),

      replaceSource: (sourceId, newStates, newTransitions, newElements) =>
        set((state) => {
          if (!state.stateStructure) return;

          // Remove states from this source
          const stateIdsToRemove = new Set(
            Object.entries(state.stateStructure.stateOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );
          const transitionIdsToRemove = new Set(
            Object.entries(state.stateStructure.transitionOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );
          const elementIdsToRemove = new Set(
            Object.entries(state.stateStructure.elementOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );

          // Filter out old items
          state.stateStructure.states = state.stateStructure.states.filter(
            (s) => !stateIdsToRemove.has(s.id)
          );
          state.stateStructure.transitions =
            state.stateStructure.transitions.filter(
              (t) => !transitionIdsToRemove.has(t.id)
            );
          state.stateStructure.elements = state.stateStructure.elements.filter(
            (e) => !elementIdsToRemove.has(e.id)
          );

          // Clean up origin maps
          for (const id of stateIdsToRemove) {
            delete state.stateStructure.stateOrigins[id];
            state.activeStateIds.delete(id);
          }
          for (const id of transitionIdsToRemove) {
            delete state.stateStructure.transitionOrigins[id];
          }
          for (const id of elementIdsToRemove) {
            delete state.stateStructure.elementOrigins[id];
          }

          // Add new items with origin tracking
          for (const s of newStates) {
            state.stateStructure.states.push(s);
            state.stateStructure.stateOrigins[s.id] = sourceId;
            if (s.screenshot) {
              state.stateStructure.screenshots[s.screenshot.id] = s.screenshot;
            }
          }
          for (const t of newTransitions) {
            state.stateStructure.transitions.push(t);
            state.stateStructure.transitionOrigins[t.id] = sourceId;
          }
          for (const e of newElements) {
            state.stateStructure.elements.push(e);
            state.stateStructure.elementOrigins[e.id] = sourceId;
          }

          // Update stats
          state.stats = {
            pagesVisited: state.stats.pagesVisited,
            statesFound: state.stateStructure.states.length,
            elementsFound: state.stateStructure.elements.length,
            transitionsFound: state.stateStructure.transitions.length,
          };
        }),

      removeSource: (sourceId) =>
        set((state) => {
          if (!state.stateStructure) return;

          // Get IDs to remove
          const stateIdsToRemove = new Set(
            Object.entries(state.stateStructure.stateOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );
          const transitionIdsToRemove = new Set(
            Object.entries(state.stateStructure.transitionOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );
          const elementIdsToRemove = new Set(
            Object.entries(state.stateStructure.elementOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );

          // Filter out items
          state.stateStructure.states = state.stateStructure.states.filter(
            (s) => !stateIdsToRemove.has(s.id)
          );
          state.stateStructure.transitions =
            state.stateStructure.transitions.filter(
              (t) => !transitionIdsToRemove.has(t.id)
            );
          state.stateStructure.elements = state.stateStructure.elements.filter(
            (e) => !elementIdsToRemove.has(e.id)
          );

          // Clean up origin maps
          for (const id of stateIdsToRemove) {
            delete state.stateStructure.stateOrigins[id];
            state.activeStateIds.delete(id);
          }
          for (const id of transitionIdsToRemove) {
            delete state.stateStructure.transitionOrigins[id];
          }
          for (const id of elementIdsToRemove) {
            delete state.stateStructure.elementOrigins[id];
          }

          // Update selected source if removed
          if (state.selectedSourceId === sourceId) {
            state.selectedSourceId = null;
          }

          // Update stats
          state.stats = {
            pagesVisited: state.stats.pagesVisited,
            statesFound: state.stateStructure.states.length,
            elementsFound: state.stateStructure.elements.length,
            transitionsFound: state.stateStructure.transitions.length,
          };
        }),

      setSelectedSource: (sourceId) =>
        set((state) => {
          state.selectedSourceId = sourceId;
        }),

      // =========================================================================
      // Active State Management (can span multiple disjoint trees)
      // =========================================================================

      activateState: (stateId) =>
        set((state) => {
          state.activeStateIds.add(stateId);
          // Also update structure if present
          if (state.stateStructure) {
            state.stateStructure.activeStateIds = Array.from(
              state.activeStateIds
            );
          }
        }),

      deactivateState: (stateId) =>
        set((state) => {
          state.activeStateIds.delete(stateId);
          // Also update structure if present
          if (state.stateStructure) {
            state.stateStructure.activeStateIds = Array.from(
              state.activeStateIds
            );
          }
        }),

      setActiveStates: (stateIds) =>
        set((state) => {
          state.activeStateIds = new Set(stateIds);
          // Also update structure if present
          if (state.stateStructure) {
            state.stateStructure.activeStateIds = Array.from(
              state.activeStateIds
            );
          }
        }),

      clearActiveStates: () =>
        set((state) => {
          state.activeStateIds.clear();
          if (state.stateStructure) {
            state.stateStructure.activeStateIds = [];
          }
        }),

      clearActiveStatesForSource: (sourceId) =>
        set((state) => {
          if (!state.stateStructure) return;

          // Get state IDs from this source
          const sourceStateIds = new Set(
            Object.entries(state.stateStructure.stateOrigins)
              .filter(([_, src]) => src === sourceId)
              .map(([id]) => id)
          );

          // Remove from active states
          for (const id of sourceStateIds) {
            state.activeStateIds.delete(id);
          }

          if (state.stateStructure) {
            state.stateStructure.activeStateIds = Array.from(
              state.activeStateIds
            );
          }
        }),

      // =========================================================================
      // Add Correlated State
      // =========================================================================

      addCorrelatedState: (correlatedState, sourceId, thumbnail) =>
        set((state) => {
          if (state.stateStructure) {
            const existingIndex = state.stateStructure.states.findIndex(
              (s) => s.id === correlatedState.id
            );
            if (existingIndex >= 0) {
              state.stateStructure.states[existingIndex] = correlatedState;
            } else {
              state.stateStructure.states.push(correlatedState);
            }

            // Track origin if source_id provided
            if (sourceId) {
              state.stateStructure.stateOrigins[correlatedState.id] = sourceId;
            }

            // Add screenshot to structure
            if (correlatedState.screenshot) {
              state.stateStructure.screenshots[correlatedState.screenshot.id] =
                correlatedState.screenshot;
            }

            state.stats.statesFound = state.stateStructure.states.length;
          }

          // Also add to legacy states for UI compatibility
          const legacyState: ExtractedState = {
            id: correlatedState.id,
            name: correlatedState.name,
            bbox: correlatedState.boundingBox ?? {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            },
            stateType: correlatedState.stateType,
            elementIds: correlatedState.elements ?? [],
            screenshotId: correlatedState.screenshot?.id ?? "",
            detectionMethod: "correlated",
            confidence: correlatedState.confidence,
            semanticRole: null,
            ariaLabel: null,
            sourceUrl: correlatedState.route ?? "",
          };

          const existingLegacyIndex = state.states.findIndex(
            (s) => s.id === correlatedState.id
          );
          if (existingLegacyIndex >= 0) {
            state.states[existingLegacyIndex] = legacyState;
          } else {
            state.states.push(legacyState);
          }

          if (thumbnail && correlatedState.screenshot?.id) {
            state.screenshots.set(correlatedState.screenshot.id, {
              id: correlatedState.screenshot.id,
              thumbnail,
            });
          }
        }),

      addInferredTransition: (transition, sourceId) =>
        set((state) => {
          if (state.stateStructure) {
            const existingIndex = state.stateStructure.transitions.findIndex(
              (t) => t.id === transition.id
            );
            if (existingIndex >= 0) {
              state.stateStructure.transitions[existingIndex] = transition;
            } else {
              state.stateStructure.transitions.push(transition);
            }

            // Track origin if source_id provided
            if (sourceId) {
              state.stateStructure.transitionOrigins[transition.id] = sourceId;
            }

            state.stats.transitionsFound =
              state.stateStructure.transitions.length;
          }
        }),

      addVerifiedTransition: (transition, sourceId) =>
        set((state) => {
          if (state.stateStructure) {
            const existingIndex = state.stateStructure.transitions.findIndex(
              (t) => t.id === transition.id
            );
            if (existingIndex >= 0) {
              state.stateStructure.transitions[existingIndex] = transition;
            } else {
              state.stateStructure.transitions.push(transition);
            }

            // Track origin if source_id provided
            if (sourceId) {
              state.stateStructure.transitionOrigins[transition.id] = sourceId;
            }

            state.stats.transitionsFound =
              state.stateStructure.transitions.length;
          }
        }),

      // =========================================================================
      // Editing
      // =========================================================================

      updateStateBoundary: (stateId, bbox) =>
        set((state) => {
          // Update in legacy states
          const legacyState = state.states.find((s) => s.id === stateId);
          if (legacyState) {
            legacyState.bbox = bbox;
          }
          // Update in state structure
          if (state.stateStructure) {
            const structState = state.stateStructure.states.find(
              (s) => s.id === stateId
            );
            if (structState) {
              structState.boundingBox = bbox;
            }
          }
        }),

      updateStateName: (stateId, name) =>
        set((state) => {
          // Update in legacy states
          const legacyState = state.states.find((s) => s.id === stateId);
          if (legacyState) {
            legacyState.name = name;
          }
          // Update in state structure
          if (state.stateStructure) {
            const structState = state.stateStructure.states.find(
              (s) => s.id === stateId
            );
            if (structState) {
              structState.name = name;
            }
          }
        }),

      updateElementType: (elementId, elementType) =>
        set((state) => {
          // Update in legacy elements
          const element = state.elements.find((e) => e.id === elementId);
          if (element) {
            element.elementType = elementType as any;
          }
          // Update in state structure
          if (state.stateStructure) {
            const structElement = state.stateStructure.elements.find(
              (e) => e.id === elementId
            );
            if (structElement) {
              structElement.elementType = elementType as any;
            }
          }
        }),

      deleteState: (stateId) =>
        set((state) => {
          // Delete from legacy states
          state.states = state.states.filter((s) => s.id !== stateId);
          // Delete from state structure
          if (state.stateStructure) {
            state.stateStructure.states = state.stateStructure.states.filter(
              (s) => s.id !== stateId
            );
            // Clean up origin tracking
            delete state.stateStructure.stateOrigins[stateId];
          }
          // Clean up active states
          state.activeStateIds.delete(stateId);
          if (state.selectedStateId === stateId) {
            state.selectedStateId = null;
          }
        }),

      deleteElement: (elementId) =>
        set((state) => {
          // Delete from legacy elements
          state.elements = state.elements.filter((e) => e.id !== elementId);
          for (const stateObj of state.states) {
            stateObj.elementIds = stateObj.elementIds.filter(
              (id) => id !== elementId
            );
          }
          // Delete from state structure
          if (state.stateStructure) {
            state.stateStructure.elements =
              state.stateStructure.elements.filter((e) => e.id !== elementId);
            // Clean up origin tracking
            delete state.stateStructure.elementOrigins[elementId];
            for (const structState of state.stateStructure.states) {
              if (structState.elements) {
                structState.elements = structState.elements.filter(
                  (id) => id !== elementId
                );
              }
            }
          }
          if (state.selectedElementId === elementId) {
            state.selectedElementId = null;
          }
        }),

      mergeStates: (stateIds, newName) =>
        set((state) => {
          if (stateIds.length < 2) return;

          const statesToMerge = state.states.filter((s) =>
            stateIds.includes(s.id)
          );
          if (statesToMerge.length < 2) return;

          // Calculate merged bounding box
          const minX = Math.min(...statesToMerge.map((s) => s.bbox.x));
          const minY = Math.min(...statesToMerge.map((s) => s.bbox.y));
          const maxX = Math.max(
            ...statesToMerge.map((s) => s.bbox.x + s.bbox.width)
          );
          const maxY = Math.max(
            ...statesToMerge.map((s) => s.bbox.y + s.bbox.height)
          );

          // Combine element IDs
          const combinedElementIds = [
            ...new Set(statesToMerge.flatMap((s) => s.elementIds)),
          ];

          // Create merged state
          const mergedState: ExtractedState = {
            ...statesToMerge[0],
            id: `merged_${Date.now()}`,
            name: newName,
            bbox: {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            },
            elementIds: combinedElementIds,
          };

          // Remove old states and add merged
          state.states = state.states.filter((s) => !stateIds.includes(s.id));
          state.states.push(mergedState);
        }),

      // =========================================================================
      // UI Actions
      // =========================================================================

      selectState: (stateId) =>
        set((state) => {
          state.selectedStateId = stateId;
          if (stateId) {
            // Check legacy states first
            const selectedState = state.states.find((s) => s.id === stateId);
            if (selectedState) {
              state.previewScreenshotId = selectedState.screenshotId;
            }
            // Also check state structure
            if (state.stateStructure) {
              const structState = state.stateStructure.states.find(
                (s) => s.id === stateId
              );
              if (structState?.screenshot?.id) {
                state.previewScreenshotId = structState.screenshot.id;
              }
            }
          }
        }),

      selectElement: (elementId) =>
        set((state) => {
          state.selectedElementId = elementId;
        }),

      setPreviewScreenshot: (screenshotId) =>
        set((state) => {
          state.previewScreenshotId = screenshotId;
        }),

      toggleElementLabels: () =>
        set((state) => {
          state.showElementLabels = !state.showElementLabels;
        }),

      toggleStateBoundaries: () =>
        set((state) => {
          state.showStateBoundaries = !state.showStateBoundaries;
        }),
    })),
    { name: "extraction-store" }
  )
);

// =============================================================================
// Selector Hooks
// =============================================================================

export const useExtractionStatus = () =>
  useExtractionStore((state) => state.status);

export const useExtractionConfig = () =>
  useExtractionStore((state) => state.config);

export const useExtractionStats = () =>
  useExtractionStore((state) => state.stats);

export const useExtractionMode = () =>
  useExtractionStore((state) => state.mode);

export const useStateStructure = () =>
  useExtractionStore((state) => state.stateStructure);

export const useSelectedSourceId = () =>
  useExtractionStore((state) => state.selectedSourceId);

// Get all unique sources in the state structure
export const useSources = () => {
  const stateStructure = useExtractionStore((state) => state.stateStructure);
  if (!stateStructure) return [];
  return [...new Set(Object.values(stateStructure.stateOrigins))];
};

export const useSelectedState = () => {
  const selectedId = useExtractionStore((state) => state.selectedStateId);
  const states = useExtractionStore((state) => state.states);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  // Check legacy states first
  const legacyState = states.find((s) => s.id === selectedId);
  if (legacyState) return legacyState;

  // Check state structure
  if (stateStructure) {
    const structState = stateStructure.states.find((s) => s.id === selectedId);
    if (structState) {
      // Convert to ExtractedState format for UI compatibility
      return {
        id: structState.id,
        name: structState.name,
        bbox: structState.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
        stateType: structState.stateType,
        elementIds: structState.elements ?? [],
        screenshotId: structState.screenshot?.id ?? "",
        detectionMethod: "correlated",
        confidence: structState.confidence,
        semanticRole: null,
        ariaLabel: null,
        sourceUrl: structState.route ?? "",
      } as ExtractedState;
    }
  }

  return null;
};

export const useSelectedElement = () => {
  const selectedId = useExtractionStore((state) => state.selectedElementId);
  const elements = useExtractionStore((state) => state.elements);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  // Check legacy elements first
  const element = elements.find((e) => e.id === selectedId);
  if (element) return element;

  // Check state structure
  if (stateStructure) {
    return stateStructure.elements.find((e) => e.id === selectedId) ?? null;
  }

  return null;
};

// Get all states (merged from legacy and state structure)
export const useAllStates = () => {
  const states = useExtractionStore((state) => state.states);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  if (stateStructure && stateStructure.states.length > 0) {
    // Convert structure states to ExtractedState format
    return stateStructure.states.map((s) => ({
      id: s.id,
      name: s.name,
      bbox: s.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
      stateType: s.stateType,
      elementIds: s.elements ?? [],
      screenshotId: s.screenshot?.id ?? "",
      detectionMethod: "correlated",
      confidence: s.confidence,
      semanticRole: null,
      ariaLabel: null,
      sourceUrl: s.route ?? "",
    })) as ExtractedState[];
  }

  return states;
};

// Get all elements (merged from legacy and state structure)
export const useAllElements = () => {
  const elements = useExtractionStore((state) => state.elements);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  if (stateStructure && stateStructure.elements.length > 0) {
    return stateStructure.elements;
  }

  return elements;
};

// =============================================================================
// Active State Selectors
// =============================================================================

// Get all active state IDs
export const useActiveStateIds = () =>
  useExtractionStore((state) => state.activeStateIds);

// Check if a specific state is active
export const useIsStateActive = (stateId: string) => {
  const activeStateIds = useExtractionStore((state) => state.activeStateIds);
  return activeStateIds.has(stateId);
};

// Get active states for a specific source
export const useActiveStatesForSource = (sourceId: string) => {
  const activeStateIds = useExtractionStore((state) => state.activeStateIds);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  if (!stateStructure) return [];

  // Get state IDs from this source
  const sourceStateIds = new Set(
    Object.entries(stateStructure.stateOrigins)
      .filter(([_, src]) => src === sourceId)
      .map(([id]) => id)
  );

  // Get active states that belong to this source
  return stateStructure.states.filter(
    (s) => sourceStateIds.has(s.id) && activeStateIds.has(s.id)
  );
};

// Get all active states with their source info
export const useAllActiveStates = () => {
  const activeStateIds = useExtractionStore((state) => state.activeStateIds);
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  if (!stateStructure) return [];

  const results: Array<{
    sourceId: string | undefined;
    stateId: string;
    state: CorrelatedState;
  }> = [];

  for (const stateId of activeStateIds) {
    const state = stateStructure.states.find((s) => s.id === stateId);
    if (state) {
      const sourceId = stateStructure.stateOrigins[stateId];
      results.push({ sourceId, stateId, state });
    }
  }

  return results;
};

// Get states by source (for filtering UI)
export const useStatesBySource = (sourceId: string | null) => {
  const stateStructure = useExtractionStore((state) => state.stateStructure);

  if (!stateStructure) return [];

  // If no source filter, return all states
  if (!sourceId) return stateStructure.states;

  // Get state IDs from this source
  const sourceStateIds = new Set(
    Object.entries(stateStructure.stateOrigins)
      .filter(([_, src]) => src === sourceId)
      .map(([id]) => id)
  );

  return stateStructure.states.filter((s) => sourceStateIds.has(s.id));
};
