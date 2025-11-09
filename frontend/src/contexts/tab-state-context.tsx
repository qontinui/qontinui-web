"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

/**
 * TabStateContext provides persistence for tab-specific UI state
 * This allows users to navigate between tabs without losing their work
 */

interface ImageExtractionState {
  // Don't persist large image data - only metadata
  selectedRegion: {
    x: number
    y: number
    width: number
    height: number
  } | null
  selectedStateId: string
  newStateName: string
}

interface PatternMatchingState {
  // Don't persist large image data - only IDs and settings
  templateSource: 'upload' | 'state' | 'asset'
  selectedStateImageId: string | null
  selectedAssetImageId: string | null
  selectedScreenshotId: string | null
  threshold: number
  findAll: boolean
}

interface ScreenshotAnnotationState {
  selectedScreenshotId: string | null
  selectionMode: 'view' | 'region' | 'location'
  zoomMode: 'fit' | 'original'
}

interface PatternOptimizationState {
  // Don't persist large image data - only metadata
  selectedRegion: any | null
  selectedStateId: string
  newStateName: string
  stepIndex: number
}

interface TabStates {
  imageExtraction?: ImageExtractionState
  patternMatching?: PatternMatchingState
  screenshotAnnotation?: ScreenshotAnnotationState
  patternOptimization?: PatternOptimizationState
}

interface TabStateContextType {
  // Image Extraction
  getImageExtractionState: () => ImageExtractionState
  setImageExtractionState: (state: Partial<ImageExtractionState>) => void
  clearImageExtractionState: () => void

  // Pattern Matching
  getPatternMatchingState: () => PatternMatchingState
  setPatternMatchingState: (state: Partial<PatternMatchingState>) => void
  clearPatternMatchingState: () => void

  // Screenshot Annotation
  getScreenshotAnnotationState: () => ScreenshotAnnotationState
  setScreenshotAnnotationState: (state: Partial<ScreenshotAnnotationState>) => void
  clearScreenshotAnnotationState: () => void

  // Pattern Optimization
  getPatternOptimizationState: () => PatternOptimizationState
  setPatternOptimizationState: (state: Partial<PatternOptimizationState>) => void
  clearPatternOptimizationState: () => void

  // Clear all tab states
  clearAllTabStates: () => void
}

const TabStateContext = createContext<TabStateContextType | undefined>(undefined)

export const useTabState = () => {
  const context = useContext(TabStateContext)
  if (!context) {
    throw new Error("useTabState must be used within a TabStateProvider")
  }
  return context
}

const STORAGE_KEY = 'qontinui-tab-states'

// Default states
const DEFAULT_IMAGE_EXTRACTION_STATE: ImageExtractionState = {
  selectedRegion: null,
  selectedStateId: '',
  newStateName: '',
}

const DEFAULT_PATTERN_MATCHING_STATE: PatternMatchingState = {
  templateSource: 'upload',
  selectedStateImageId: null,
  selectedAssetImageId: null,
  selectedScreenshotId: null,
  threshold: 0.8,
  findAll: true,
}

const DEFAULT_SCREENSHOT_ANNOTATION_STATE: ScreenshotAnnotationState = {
  selectedScreenshotId: null,
  selectionMode: 'view',
  zoomMode: 'fit',
}

const DEFAULT_PATTERN_OPTIMIZATION_STATE: PatternOptimizationState = {
  selectedRegion: null,
  selectedStateId: '',
  newStateName: '',
  stepIndex: 0,
}

interface TabStateProviderProps {
  children: ReactNode
}

export function TabStateProvider({ children }: TabStateProviderProps) {
  const [tabStates, setTabStates] = useState<TabStates>({})

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setTabStates(parsed)
      }
    } catch (error) {
      console.error('Failed to load tab states from localStorage:', error)
    }
  }, [])

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabStates))
    } catch (error) {
      console.error('Failed to save tab states to localStorage:', error)
    }
  }, [tabStates])

  // Image Extraction
  const getImageExtractionState = useCallback((): ImageExtractionState => {
    return tabStates.imageExtraction || DEFAULT_IMAGE_EXTRACTION_STATE
  }, [tabStates])

  const setImageExtractionState = useCallback((state: Partial<ImageExtractionState>) => {
    setTabStates(prev => ({
      ...prev,
      imageExtraction: {
        ...DEFAULT_IMAGE_EXTRACTION_STATE,
        ...prev.imageExtraction,
        ...state,
      }
    }))
  }, [])

  const clearImageExtractionState = useCallback(() => {
    setTabStates(prev => ({
      ...prev,
      imageExtraction: DEFAULT_IMAGE_EXTRACTION_STATE,
    }))
  }, [])

  // Pattern Matching
  const getPatternMatchingState = useCallback((): PatternMatchingState => {
    return tabStates.patternMatching || DEFAULT_PATTERN_MATCHING_STATE
  }, [tabStates])

  const setPatternMatchingState = useCallback((state: Partial<PatternMatchingState>) => {
    setTabStates(prev => ({
      ...prev,
      patternMatching: {
        ...DEFAULT_PATTERN_MATCHING_STATE,
        ...prev.patternMatching,
        ...state,
      }
    }))
  }, [])

  const clearPatternMatchingState = useCallback(() => {
    setTabStates(prev => ({
      ...prev,
      patternMatching: DEFAULT_PATTERN_MATCHING_STATE,
    }))
  }, [])

  // Screenshot Annotation
  const getScreenshotAnnotationState = useCallback((): ScreenshotAnnotationState => {
    return tabStates.screenshotAnnotation || DEFAULT_SCREENSHOT_ANNOTATION_STATE
  }, [tabStates])

  const setScreenshotAnnotationState = useCallback((state: Partial<ScreenshotAnnotationState>) => {
    setTabStates(prev => ({
      ...prev,
      screenshotAnnotation: {
        ...DEFAULT_SCREENSHOT_ANNOTATION_STATE,
        ...prev.screenshotAnnotation,
        ...state,
      }
    }))
  }, [])

  const clearScreenshotAnnotationState = useCallback(() => {
    setTabStates(prev => ({
      ...prev,
      screenshotAnnotation: DEFAULT_SCREENSHOT_ANNOTATION_STATE,
    }))
  }, [])

  // Pattern Optimization
  const getPatternOptimizationState = useCallback((): PatternOptimizationState => {
    return tabStates.patternOptimization || DEFAULT_PATTERN_OPTIMIZATION_STATE
  }, [tabStates])

  const setPatternOptimizationState = useCallback((state: Partial<PatternOptimizationState>) => {
    setTabStates(prev => ({
      ...prev,
      patternOptimization: {
        ...DEFAULT_PATTERN_OPTIMIZATION_STATE,
        ...prev.patternOptimization,
        ...state,
      }
    }))
  }, [])

  const clearPatternOptimizationState = useCallback(() => {
    setTabStates(prev => ({
      ...prev,
      patternOptimization: DEFAULT_PATTERN_OPTIMIZATION_STATE,
    }))
  }, [])

  // Clear all
  const clearAllTabStates = useCallback(() => {
    setTabStates({})
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const contextValue: TabStateContextType = {
    getImageExtractionState,
    setImageExtractionState,
    clearImageExtractionState,
    getPatternMatchingState,
    setPatternMatchingState,
    clearPatternMatchingState,
    getScreenshotAnnotationState,
    setScreenshotAnnotationState,
    clearScreenshotAnnotationState,
    getPatternOptimizationState,
    setPatternOptimizationState,
    clearPatternOptimizationState,
    clearAllTabStates,
  }

  return (
    <TabStateContext.Provider value={contextValue}>
      {children}
    </TabStateContext.Provider>
  )
}
