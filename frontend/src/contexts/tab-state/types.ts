/**
 * Tab State Types
 *
 * Single Responsibility: Define all type interfaces for tab state management.
 * These types are shared across the tab state system.
 */

/** Region selection for image operations */
export interface RegionSelection {
  x: number
  y: number
  width: number
  height: number
}

/** State persisted for the Image Extraction tab */
export interface ImageExtractionState {
  selectedRegion: RegionSelection | null
  selectedStateId: string
  newStateName: string
}

/** State persisted for the Pattern Matching tab */
export interface PatternMatchingState {
  templateSource: 'upload' | 'state' | 'asset'
  selectedStateImageId: string | null
  selectedAssetImageId: string | null
  selectedScreenshotId: string | null
  threshold: number
  findAll: boolean
}

/** State persisted for the Screenshot Annotation tab */
export interface ScreenshotAnnotationState {
  selectedScreenshotId: string | null
  selectionMode: 'view' | 'region' | 'location'
  zoomMode: 'fit' | 'original'
}

/** State persisted for the Pattern Optimization tab */
export interface PatternOptimizationState {
  selectedRegion: RegionSelection | null
  selectedStateId: string
  newStateName: string
  stepIndex: number
}

/** Combined tab states stored in localStorage */
export interface TabStates {
  imageExtraction?: ImageExtractionState
  patternMatching?: PatternMatchingState
  screenshotAnnotation?: ScreenshotAnnotationState
  patternOptimization?: PatternOptimizationState
}

/** Default values for each tab state */
export const DEFAULT_IMAGE_EXTRACTION_STATE: ImageExtractionState = {
  selectedRegion: null,
  selectedStateId: '',
  newStateName: '',
}

export const DEFAULT_PATTERN_MATCHING_STATE: PatternMatchingState = {
  templateSource: 'upload',
  selectedStateImageId: null,
  selectedAssetImageId: null,
  selectedScreenshotId: null,
  threshold: 0.8,
  findAll: true,
}

export const DEFAULT_SCREENSHOT_ANNOTATION_STATE: ScreenshotAnnotationState = {
  selectedScreenshotId: null,
  selectionMode: 'view',
  zoomMode: 'fit',
}

export const DEFAULT_PATTERN_OPTIMIZATION_STATE: PatternOptimizationState = {
  selectedRegion: null,
  selectedStateId: '',
  newStateName: '',
  stepIndex: 0,
}
