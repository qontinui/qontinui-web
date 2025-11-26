"use client"

/**
 * Tab State Context
 *
 * Single Responsibility: Provide React context for tab state management.
 * Delegates storage to storage.ts and uses types from types.ts.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import {
  TabStates,
  ImageExtractionState,
  PatternMatchingState,
  ScreenshotAnnotationState,
  PatternOptimizationState,
  DEFAULT_IMAGE_EXTRACTION_STATE,
  DEFAULT_PATTERN_MATCHING_STATE,
  DEFAULT_SCREENSHOT_ANNOTATION_STATE,
  DEFAULT_PATTERN_OPTIMIZATION_STATE,
} from './types'
import { loadTabStates, saveTabStates, clearTabStates } from './storage'

/** Context value interface */
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

const TabStateContext = createContext<TabStateContextType | null>(null)

/**
 * Check if TabStateProvider is available in the component tree
 */
export function useTabStateContext(): TabStateContextType | null {
  return useContext(TabStateContext)
}

/**
 * Hook to access tab state - throws if provider is missing
 * Use this when the provider MUST be present
 */
export function useTabState(): TabStateContextType {
  const context = useContext(TabStateContext)
  if (!context) {
    throw new Error(
      "useTabState must be used within a TabStateProvider. " +
      "Ensure your component is wrapped with <TabStateProvider> or use useTabStateSafe() for optional access."
    )
  }
  return context
}

/**
 * Safe hook that returns defaults when provider is missing
 * Use this for components that can work without persisted state
 */
export function useTabStateSafe(): TabStateContextType {
  const context = useContext(TabStateContext)

  if (context) {
    return context
  }

  // Return no-op functions that use defaults
  return {
    getImageExtractionState: () => DEFAULT_IMAGE_EXTRACTION_STATE,
    setImageExtractionState: () => {},
    clearImageExtractionState: () => {},
    getPatternMatchingState: () => DEFAULT_PATTERN_MATCHING_STATE,
    setPatternMatchingState: () => {},
    clearPatternMatchingState: () => {},
    getScreenshotAnnotationState: () => DEFAULT_SCREENSHOT_ANNOTATION_STATE,
    setScreenshotAnnotationState: () => {},
    clearScreenshotAnnotationState: () => {},
    getPatternOptimizationState: () => DEFAULT_PATTERN_OPTIMIZATION_STATE,
    setPatternOptimizationState: () => {},
    clearPatternOptimizationState: () => {},
    clearAllTabStates: () => {},
  }
}

/**
 * Hook for Image Extraction state only
 * Returns safe defaults if provider is missing
 */
export function useImageExtractionState() {
  const context = useTabStateSafe()
  return {
    state: context.getImageExtractionState(),
    setState: context.setImageExtractionState,
    clearState: context.clearImageExtractionState,
  }
}

/**
 * Hook for Pattern Matching state only
 * Returns safe defaults if provider is missing
 */
export function usePatternMatchingState() {
  const context = useTabStateSafe()
  return {
    state: context.getPatternMatchingState(),
    setState: context.setPatternMatchingState,
    clearState: context.clearPatternMatchingState,
  }
}

/**
 * Hook for Screenshot Annotation state only
 * Returns safe defaults if provider is missing
 */
export function useScreenshotAnnotationState() {
  const context = useTabStateSafe()
  return {
    state: context.getScreenshotAnnotationState(),
    setState: context.setScreenshotAnnotationState,
    clearState: context.clearScreenshotAnnotationState,
  }
}

/**
 * Hook for Pattern Optimization state only
 * Returns safe defaults if provider is missing
 */
export function usePatternOptimizationState() {
  const context = useTabStateSafe()
  return {
    state: context.getPatternOptimizationState(),
    setState: context.setPatternOptimizationState,
    clearState: context.clearPatternOptimizationState,
  }
}

interface TabStateProviderProps {
  children: ReactNode
}

/**
 * Provider component for tab state management
 */
export function TabStateProvider({ children }: TabStateProviderProps) {
  const [tabStates, setTabStates] = useState<TabStates>({})
  const [isInitialized, setIsInitialized] = useState(false)

  // Load state from localStorage on mount
  useEffect(() => {
    const stored = loadTabStates()
    setTabStates(stored)
    setIsInitialized(true)
  }, [])

  // Save state to localStorage whenever it changes (after initial load)
  useEffect(() => {
    if (isInitialized) {
      saveTabStates(tabStates)
    }
  }, [tabStates, isInitialized])

  // Image Extraction
  const getImageExtractionState = useCallback((): ImageExtractionState => {
    return tabStates.imageExtraction ?? DEFAULT_IMAGE_EXTRACTION_STATE
  }, [tabStates.imageExtraction])

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
    return tabStates.patternMatching ?? DEFAULT_PATTERN_MATCHING_STATE
  }, [tabStates.patternMatching])

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
    return tabStates.screenshotAnnotation ?? DEFAULT_SCREENSHOT_ANNOTATION_STATE
  }, [tabStates.screenshotAnnotation])

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
    return tabStates.patternOptimization ?? DEFAULT_PATTERN_OPTIMIZATION_STATE
  }, [tabStates.patternOptimization])

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
    clearTabStates()
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
