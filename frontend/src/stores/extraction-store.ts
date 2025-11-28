/**
 * Zustand store for web extraction state management.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type {
  BoundingBox,
  ExtractedElement,
  ExtractedState,
  ExtractedTransition,
  ExtractionConfig,
  ExtractionSession,
  ExtractionStats,
  ScreenshotData,
} from "@/components/web-extraction/types";

// Store state
interface ExtractionState {
  // Session
  currentSession: ExtractionSession | null;
  status: "idle" | "configuring" | "running" | "complete" | "error";
  config: ExtractionConfig;
  errorMessage: string | null;

  // Results
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

// Store actions
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

  // Results from WebSocket
  addState: (state: ExtractedState, thumbnail: string) => void;
  addElement: (element: ExtractedElement) => void;
  addTransition: (transition: ExtractedTransition) => void;
  updateStats: (stats: Partial<ExtractionStats>) => void;
  addScreenshot: (id: string, thumbnail: string) => void;

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

// Default config
const defaultConfig: ExtractionConfig = {
  urls: [],
  viewports: [[1920, 1080]],
  captureHoverStates: true,
  captureFocusStates: true,
  maxDepth: 5,
  maxPages: 100,
  authCookies: {},
};

// Default stats
const defaultStats: ExtractionStats = {
  pagesVisited: 0,
  statesFound: 0,
  elementsFound: 0,
  transitionsFound: 0,
};

// Initial state
const initialState: ExtractionState = {
  currentSession: null,
  status: "idle",
  config: defaultConfig,
  errorMessage: null,
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

// Create store
export const useExtractionStore = create<ExtractionState & ExtractionActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // Session management
      setSession: (session) =>
        set((state) => {
          state.currentSession = session;
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

      // Configuration
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

      // Results from WebSocket
      addState: (newState, thumbnail) =>
        set((state) => {
          // Check if state already exists
          const existingIndex = state.states.findIndex(
            (s) => s.id === newState.id
          );
          if (existingIndex >= 0) {
            state.states[existingIndex] = newState;
          } else {
            state.states.push(newState);
          }

          // Add screenshot if provided
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

      // Editing
      updateStateBoundary: (stateId, bbox) =>
        set((state) => {
          const stateObj = state.states.find((s) => s.id === stateId);
          if (stateObj) {
            stateObj.bbox = bbox;
          }
        }),

      updateStateName: (stateId, name) =>
        set((state) => {
          const stateObj = state.states.find((s) => s.id === stateId);
          if (stateObj) {
            stateObj.name = name;
          }
        }),

      updateElementType: (elementId, elementType) =>
        set((state) => {
          const element = state.elements.find((e) => e.id === elementId);
          if (element) {
            element.elementType = elementType as any;
          }
        }),

      deleteState: (stateId) =>
        set((state) => {
          state.states = state.states.filter((s) => s.id !== stateId);
          if (state.selectedStateId === stateId) {
            state.selectedStateId = null;
          }
        }),

      deleteElement: (elementId) =>
        set((state) => {
          state.elements = state.elements.filter((e) => e.id !== elementId);
          // Also remove from any state's elementIds
          for (const stateObj of state.states) {
            stateObj.elementIds = stateObj.elementIds.filter(
              (id) => id !== elementId
            );
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

      // UI actions
      selectState: (stateId) =>
        set((state) => {
          state.selectedStateId = stateId;
          // If selecting a state, show its screenshot
          if (stateId) {
            const selectedState = state.states.find((s) => s.id === stateId);
            if (selectedState) {
              state.previewScreenshotId = selectedState.screenshotId;
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

// Selector hooks for common access patterns
export const useExtractionStatus = () =>
  useExtractionStore((state) => state.status);
export const useExtractionConfig = () =>
  useExtractionStore((state) => state.config);
export const useExtractionStats = () =>
  useExtractionStore((state) => state.stats);
export const useSelectedState = () => {
  const selectedId = useExtractionStore((state) => state.selectedStateId);
  const states = useExtractionStore((state) => state.states);
  return states.find((s) => s.id === selectedId) ?? null;
};
export const useSelectedElement = () => {
  const selectedId = useExtractionStore((state) => state.selectedElementId);
  const elements = useExtractionStore((state) => state.elements);
  return elements.find((e) => e.id === selectedId) ?? null;
};
