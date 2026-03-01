/**
 * Shared types for StateDiscoveryTab sub-components
 */

import type { StateImage, DiscoveredState } from "@/types/stateDiscovery";

/** Region coordinates used for analysis region selection */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Image dimensions */
export interface Dimensions {
  width: number;
  height: number;
}

/** Props for the header bar */
export interface HeaderBarProps {
  onSaveStructure: () => void;
  analysisResult: unknown;
  filteredStateImagesCount: number;
  isFilterActive: boolean;
}

/** Props for the left panel */
export interface LeftPanelProps {
  // Screenshots
  screenshots: File[];
  selectedScreenshotIndex: number;
  onSelectScreenshot: (index: number) => void;
  onScreenshotUpload: (files: File[]) => void;
  // Similarity threshold
  similarityThreshold: number;
  onSimilarityThresholdChange: (value: number) => void;
  // Region selection
  showRegionSelector: boolean;
  onToggleRegionSelector: () => void;
  selectedRegion: Region | null;
  onClearRegion: () => void;
  // Analysis
  onStartAnalysis: () => void;
  uploadId: string | null | undefined;
  isAnalyzing: boolean;
  analysisProgress: number;
  analysisResult: unknown;
  // Filter data
  filteredStates: DiscoveredState[];
  filteredStateImages: StateImage[];
  allStatesCount: number | undefined;
  allStateImagesCount: number | undefined;
  // State selection
  selectedState: DiscoveredState | null;
  onSelectState: (state: DiscoveredState) => void;
  // Pixel filters
  stateImages: StateImage[];
  maxDarkPixelPercentage: number;
  onMaxDarkPixelPercentageChange: (value: number) => void;
  maxLightPixelPercentage: number;
  onMaxLightPixelPercentageChange: (value: number) => void;
  onResetFilters: () => void;
  isFilterActive: boolean;
}

/** Props for the center panel */
export interface CenterPanelProps {
  // View mode
  viewMode: "all" | "selected" | "state";
  onViewModeChange: (mode: "all" | "selected" | "state") => void;
  // Canvas zoom
  canvasScale: number;
  onCanvasScaleChange: React.Dispatch<React.SetStateAction<number>>;
  canvasImageSize: Dimensions;
  onCanvasImageSizeChange: (size: Dimensions) => void;
  // Selection
  selectedStateImages: Set<string>;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  // Region selector
  showRegionSelector: boolean;
  selectedScreenshotUrl: string;
  screenshotDimensions: Dimensions;
  selectedRegion: Region | null;
  onRegionSelect: (region: Region | null) => void;
  // Canvas
  screenshots: File[];
  selectedScreenshotIndex: number;
  stateImages: StateImage[];
  selectedStateImage: StateImage | null;
  highlightedStateImages: string[];
  maxDarkPixelPercentage: number;
  maxLightPixelPercentage: number;
  onSelectStateImage: (stateImage: StateImage) => void;
  onMultiSelectStateImage: (stateImageId: string, ctrlKey: boolean) => void;
}

/** Props for the right panel */
export interface RightPanelProps {
  rightPanelTab: "stateimage" | "state";
  onRightPanelTabChange: (tab: "stateimage" | "state") => void;
  // State image details
  selectedStateImage: StateImage | null;
  screenshots: File[];
  filteredStates: DiscoveredState[];
  onDeleteStateImage: () => void;
  // State details
  selectedState: DiscoveredState | null;
  filteredStateImages: StateImage[];
  selectedScreenshotIndex: number;
  onSelectScreenshot: (index: number) => void;
  onHighlightStateImages: (ids: string[]) => void;
}
