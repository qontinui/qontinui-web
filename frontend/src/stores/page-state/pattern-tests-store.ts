/**
 * Pattern Tests Page State Store
 *
 * Zustand store for Pattern Matching Test page with IndexedDB persistence.
 * Persists screenshots, template images, matching parameters, and results.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { pageStateDB, makePageKey } from "./page-state-db";
import type {
  PatternTestsPageState,
  PersistedScreenshot,
  MatchResult,
  TemplateSource,
} from "./types";
import type { Region } from "@/types/pattern-optimization";

// ===== Internal Types =====

interface PatternTestsStoreState {
  // Hydration state
  isHydrated: boolean;
  isHydrating: boolean;
  hydrationError: string | null;

  // Project context
  projectName: string | null;
  userId: string | null;

  // Screenshot state
  selectedScreenshot: (PersistedScreenshot & { url?: string }) | null;
  screenshotDimensions: { width: number; height: number } | null;

  // Template state
  templateImage: { blobId: string; url?: string } | null;
  templateSource: TemplateSource;
  selectedStateImageId: string;
  selectedAssetImageId: string;

  // Matching parameters
  similarity: number;
  findAll: boolean;
  searchRegion: Region | null;

  // Results
  matches: MatchResult[];
  searchTime: number;
  selectedMatchId: string | null;

  // Visualization toggles
  showMatches: boolean;
  showScores: boolean;
  showHeatmap: boolean;
  highlightBest: boolean;

  // Canvas state
  zoom: number;
  panOffset: { x: number; y: number };

  // Actions
  hydrate: (projectName: string, userId: string) => Promise<void>;
  persist: () => Promise<void>;
  cleanup: () => void;

  // Screenshot actions
  setSelectedScreenshot: (screenshot: {
    id: string;
    name: string;
    file: File;
  } | null) => Promise<void>;
  setScreenshotDimensions: (dimensions: { width: number; height: number } | null) => void;

  // Template actions
  setTemplateImage: (file: File | null) => Promise<void>;
  setTemplateFromUrl: (url: string) => Promise<void>;
  setTemplateSource: (source: TemplateSource) => void;
  setSelectedStateImageId: (id: string) => void;
  setSelectedAssetImageId: (id: string) => void;

  // Parameter actions
  setSimilarity: (similarity: number) => void;
  setFindAll: (findAll: boolean) => void;
  setSearchRegion: (region: Region | null) => void;

  // Results actions
  setMatches: (matches: MatchResult[]) => void;
  setSearchTime: (time: number) => void;
  setSelectedMatchId: (id: string | null) => void;
  clearResults: () => void;

  // Visualization actions
  setShowMatches: (show: boolean) => void;
  setShowScores: (show: boolean) => void;
  setShowHeatmap: (show: boolean) => void;
  setHighlightBest: (highlight: boolean) => void;

  // Canvas actions
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  resetView: () => void;
}

// ===== Helper Functions =====

function getDefaultState(): Omit<PatternTestsStoreState,
  | "hydrate"
  | "persist"
  | "cleanup"
  | "setSelectedScreenshot"
  | "setScreenshotDimensions"
  | "setTemplateImage"
  | "setTemplateFromUrl"
  | "setTemplateSource"
  | "setSelectedStateImageId"
  | "setSelectedAssetImageId"
  | "setSimilarity"
  | "setFindAll"
  | "setSearchRegion"
  | "setMatches"
  | "setSearchTime"
  | "setSelectedMatchId"
  | "clearResults"
  | "setShowMatches"
  | "setShowScores"
  | "setShowHeatmap"
  | "setHighlightBest"
  | "setZoom"
  | "setPanOffset"
  | "resetView"
> {
  return {
    isHydrated: false,
    isHydrating: false,
    hydrationError: null,
    projectName: null,
    userId: null,
    selectedScreenshot: null,
    screenshotDimensions: null,
    templateImage: null,
    templateSource: "upload",
    selectedStateImageId: "",
    selectedAssetImageId: "",
    similarity: 0.8,
    findAll: true,
    searchRegion: null,
    matches: [],
    searchTime: 0,
    selectedMatchId: null,
    showMatches: true,
    showScores: true,
    showHeatmap: false,
    highlightBest: true,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
  };
}

// Track created object URLs for cleanup
const objectUrls = new Set<string>();

function createObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function revokeAllObjectUrls(): void {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

// ===== Store =====

export const usePatternTestsStore = create<PatternTestsStoreState>()(
  devtools(
    immer((set, get) => ({
      ...getDefaultState(),

      hydrate: async (projectName: string, userId: string) => {
        const state = get();
        if (state.isHydrating) return;

        set((draft) => {
          draft.isHydrating = true;
          draft.hydrationError = null;
          draft.projectName = projectName;
          draft.userId = userId;
        });

        try {
          const savedState = await pageStateDB.getPageState(projectName, "pattern-tests", userId);

          if (savedState?.state) {
            const pageState = savedState.state as unknown as PatternTestsPageState;

            // Load screenshot blob
            let screenshotWithUrl: (PersistedScreenshot & { url?: string }) | null = null;
            if (pageState.selectedScreenshot) {
              const pageBlob = await pageStateDB.getBlob(pageState.selectedScreenshot.blobId);
              if (pageBlob) {
                screenshotWithUrl = {
                  ...pageState.selectedScreenshot,
                  url: createObjectUrl(pageBlob.data),
                };
              }
            }

            // Load template blob
            let templateWithUrl: { blobId: string; url?: string } | null = null;
            if (pageState.templateImage) {
              const pageBlob = await pageStateDB.getBlob(pageState.templateImage.blobId);
              if (pageBlob) {
                templateWithUrl = {
                  blobId: pageState.templateImage.blobId,
                  url: createObjectUrl(pageBlob.data),
                };
              }
            }

            // Load match thumbnails
            const matchesWithUrls: MatchResult[] = [];
            for (const match of pageState.matches || []) {
              if (match.thumbnailBlobId) {
                const pageBlob = await pageStateDB.getBlob(match.thumbnailBlobId);
                if (pageBlob) {
                  matchesWithUrls.push({
                    ...match,
                    thumbnailUrl: createObjectUrl(pageBlob.data),
                  });
                } else {
                  matchesWithUrls.push(match);
                }
              } else {
                matchesWithUrls.push(match);
              }
            }

            set((draft) => {
              draft.selectedScreenshot = screenshotWithUrl;
              draft.screenshotDimensions = pageState.screenshotDimensions;
              draft.templateImage = templateWithUrl;
              draft.templateSource = pageState.templateSource;
              draft.selectedStateImageId = pageState.selectedStateImageId;
              draft.selectedAssetImageId = pageState.selectedAssetImageId;
              draft.similarity = pageState.similarity;
              draft.findAll = pageState.findAll;
              draft.searchRegion = pageState.searchRegion;
              draft.matches = matchesWithUrls;
              draft.searchTime = pageState.searchTime;
              draft.selectedMatchId = pageState.selectedMatchId;
              draft.showMatches = pageState.showMatches;
              draft.showScores = pageState.showScores;
              draft.showHeatmap = pageState.showHeatmap;
              draft.highlightBest = pageState.highlightBest;
              draft.zoom = pageState.zoom;
              draft.panOffset = pageState.panOffset;
              draft.isHydrated = true;
              draft.isHydrating = false;
            });
          } else {
            set((draft) => {
              draft.isHydrated = true;
              draft.isHydrating = false;
            });
          }
        } catch (error) {
          console.error("[PatternTestsStore] Hydration failed:", error);
          set((draft) => {
            draft.hydrationError = error instanceof Error ? error.message : "Unknown error";
            draft.isHydrated = true;
            draft.isHydrating = false;
          });
        }
      },

      persist: async () => {
        const state = get();
        if (!state.projectName || !state.userId) return;

        try {
          const pageKey = makePageKey(state.projectName, "pattern-tests", state.userId);
          const blobRefs: string[] = [];

          // Prepare state for persistence (without runtime URLs)
          const persistState: PatternTestsPageState = {
            selectedScreenshot: state.selectedScreenshot
              ? {
                  id: state.selectedScreenshot.id,
                  name: state.selectedScreenshot.name,
                  blobId: state.selectedScreenshot.blobId,
                  region: state.selectedScreenshot.region,
                }
              : null,
            screenshotDimensions: state.screenshotDimensions,
            templateImage: state.templateImage
              ? { blobId: state.templateImage.blobId }
              : null,
            templateSource: state.templateSource,
            selectedStateImageId: state.selectedStateImageId,
            selectedAssetImageId: state.selectedAssetImageId,
            similarity: state.similarity,
            findAll: state.findAll,
            searchRegion: state.searchRegion,
            matches: state.matches.map((m) => ({
              id: m.id,
              x: m.x,
              y: m.y,
              width: m.width,
              height: m.height,
              score: m.score,
              thumbnailBlobId: m.thumbnailBlobId,
            })),
            searchTime: state.searchTime,
            selectedMatchId: state.selectedMatchId,
            showMatches: state.showMatches,
            showScores: state.showScores,
            showHeatmap: state.showHeatmap,
            highlightBest: state.highlightBest,
            zoom: state.zoom,
            panOffset: state.panOffset,
          };

          // Collect blob refs
          if (state.selectedScreenshot?.blobId) {
            blobRefs.push(state.selectedScreenshot.blobId);
          }
          if (state.templateImage?.blobId) {
            blobRefs.push(state.templateImage.blobId);
          }
          for (const match of state.matches) {
            if (match.thumbnailBlobId) {
              blobRefs.push(match.thumbnailBlobId);
            }
          }

          await pageStateDB.savePageState({
            key: pageKey,
            projectName: state.projectName,
            pageId: "pattern-tests",
            userId: state.userId,
            state: persistState as unknown as Record<string, unknown>,
            blobRefs,
            updatedAt: Date.now(),
          });
        } catch (error) {
          console.error("[PatternTestsStore] Persist failed:", error);
        }
      },

      cleanup: () => {
        revokeAllObjectUrls();
        set(getDefaultState());
      },

      setSelectedScreenshot: async (screenshot) => {
        const state = get();
        if (!state.projectName || !state.userId) return;

        if (screenshot) {
          const pageKey = makePageKey(state.projectName, "pattern-tests", state.userId);
          const blobId = await pageStateDB.saveBlob(
            pageKey,
            "selectedScreenshot",
            screenshot.file
          );

          const url = createObjectUrl(screenshot.file);
          set((draft) => {
            draft.selectedScreenshot = {
              id: screenshot.id,
              name: screenshot.name,
              blobId,
              url,
            };
            // Clear matches when screenshot changes
            draft.matches = [];
            draft.searchTime = 0;
            draft.selectedMatchId = null;
          });
        } else {
          set((draft) => {
            draft.selectedScreenshot = null;
            draft.screenshotDimensions = null;
            draft.matches = [];
            draft.searchTime = 0;
            draft.selectedMatchId = null;
          });
        }
      },

      setScreenshotDimensions: (dimensions) => {
        set((draft) => {
          draft.screenshotDimensions = dimensions;
        });
      },

      setTemplateImage: async (file) => {
        const state = get();
        if (!state.projectName || !state.userId) return;

        if (file) {
          const pageKey = makePageKey(state.projectName, "pattern-tests", state.userId);
          const blobId = await pageStateDB.saveBlob(
            pageKey,
            "templateImage",
            file
          );

          const url = createObjectUrl(file);
          set((draft) => {
            draft.templateImage = { blobId, url };
            draft.templateSource = "upload";
          });
        } else {
          set((draft) => {
            draft.templateImage = null;
          });
        }
      },

      setTemplateFromUrl: async (url) => {
        const state = get();
        if (!state.projectName || !state.userId) return;

        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const file = new File([blob], "template.png", { type: blob.type });

          const pageKey = makePageKey(state.projectName, "pattern-tests", state.userId);
          const blobId = await pageStateDB.saveBlob(
            pageKey,
            "templateImage",
            file
          );

          const objectUrl = createObjectUrl(blob);
          set((draft) => {
            draft.templateImage = { blobId, url: objectUrl };
          });
        } catch (error) {
          console.error("[PatternTestsStore] Failed to load template from URL:", error);
        }
      },

      setTemplateSource: (source) => {
        set((draft) => {
          draft.templateSource = source;
        });
      },

      setSelectedStateImageId: (id) => {
        set((draft) => {
          draft.selectedStateImageId = id;
        });
      },

      setSelectedAssetImageId: (id) => {
        set((draft) => {
          draft.selectedAssetImageId = id;
        });
      },

      setSimilarity: (similarity) => {
        set((draft) => {
          draft.similarity = similarity;
        });
      },

      setFindAll: (findAll) => {
        set((draft) => {
          draft.findAll = findAll;
        });
      },

      setSearchRegion: (region) => {
        set((draft) => {
          draft.searchRegion = region;
        });
      },

      setMatches: (matches) => {
        set((draft) => {
          draft.matches = matches;
        });
      },

      setSearchTime: (time) => {
        set((draft) => {
          draft.searchTime = time;
        });
      },

      setSelectedMatchId: (id) => {
        set((draft) => {
          draft.selectedMatchId = id;
        });
      },

      clearResults: () => {
        set((draft) => {
          draft.matches = [];
          draft.searchTime = 0;
          draft.selectedMatchId = null;
        });
      },

      setShowMatches: (show) => {
        set((draft) => {
          draft.showMatches = show;
        });
      },

      setShowScores: (show) => {
        set((draft) => {
          draft.showScores = show;
        });
      },

      setShowHeatmap: (show) => {
        set((draft) => {
          draft.showHeatmap = show;
        });
      },

      setHighlightBest: (highlight) => {
        set((draft) => {
          draft.highlightBest = highlight;
        });
      },

      setZoom: (zoom) => {
        set((draft) => {
          draft.zoom = zoom;
        });
      },

      setPanOffset: (offset) => {
        set((draft) => {
          draft.panOffset = offset;
        });
      },

      resetView: () => {
        set((draft) => {
          draft.zoom = 1;
          draft.panOffset = { x: 0, y: 0 };
        });
      },
    })),
    { name: "pattern-tests-store" }
  )
);

// ===== Selectors =====

export const selectIsHydrated = (state: PatternTestsStoreState) => state.isHydrated;
export const selectIsHydrating = (state: PatternTestsStoreState) => state.isHydrating;
export const selectSelectedScreenshot = (state: PatternTestsStoreState) => state.selectedScreenshot;
export const selectTemplateImage = (state: PatternTestsStoreState) => state.templateImage;
export const selectMatches = (state: PatternTestsStoreState) => state.matches;
export const selectSimilarity = (state: PatternTestsStoreState) => state.similarity;
