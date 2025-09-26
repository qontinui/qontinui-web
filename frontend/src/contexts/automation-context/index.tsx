"use client"

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { ProcessManager } from "./process-manager"
import { StateManager } from "./state-manager"
import { TransitionManager } from "./transition-manager"
import { ImageManager } from "./image-manager"
import type {
  AutomationContextType,
  Process,
  State,
  Transition,
  ImageAsset,
  ImageUsage,
} from "./types"

// Export types for external use
export type {
  Process,
  Action,
  State,
  StateRegion,
  StateLocation,
  StateString,
  Transition,
  TransitionType,
  BaseTransition,
  OutgoingTransition,
  IncomingTransition,
  ImageAsset,
  ImageUsage,
} from "./types"

const AutomationContext = createContext<AutomationContextType | undefined>(undefined)

export const useAutomation = () => {
  const context = useContext(AutomationContext)
  if (!context) {
    throw new Error("useAutomation must be used within an AutomationProvider")
  }
  return context
}

interface AutomationProviderProps {
  children: ReactNode
}

export function AutomationProvider({ children }: AutomationProviderProps) {
  // State for each entity type - using localStorage for persistence
  const [projectName, setProjectName] = useLocalStorage<string>('qontinui-project-name', 'Untitled Project')
  const [processes, setProcesses] = useLocalStorage<Process[]>('qontinui-processes', [])
  const [states, setStates] = useLocalStorage<State[]>('qontinui-states', [])
  const [transitions, setTransitions] = useLocalStorage<Transition[]>('qontinui-transitions', [])
  const [images, setImages] = useLocalStorage<ImageAsset[]>('qontinui-images', [])
  const [categories, setCategories] = useLocalStorage<string[]>('qontinui-categories', [])
  const [lastSaved, setLastSaved] = useLocalStorage<string | null>('qontinui-lastSaved', null)

  // Process management functions
  const addProcess = useCallback((process: Process) => {
    setProcesses((prev) => ProcessManager.addProcess(prev, process))
  }, [])

  const updateProcess = useCallback((process: Process) => {
    setProcesses((prev) => ProcessManager.updateProcess(prev, process))
  }, [])

  const deleteProcess = useCallback((processId: string) => {
    setProcesses((prev) => ProcessManager.deleteProcess(prev, processId))
    // Clean up transitions that reference this process
    setTransitions((prev) => TransitionManager.removeProcessFromTransitions(prev, processId))
  }, [])

  // State management functions
  const addState = useCallback((state: State) => {
    setStates((prev) => StateManager.addState(prev, state))
  }, [])

  const updateState = useCallback((state: State) => {
    setStates((prev) => StateManager.updateState(prev, state))
  }, [])

  const deleteState = useCallback((stateId: string) => {
    setStates((prev) => StateManager.deleteState(prev, stateId))
    // Clean up transitions that reference this state
    setTransitions((prev) => TransitionManager.removeStateFromTransitions(prev, stateId))
  }, [])

  // Transition management functions
  const addTransition = useCallback((transition: Transition) => {
    setTransitions((prev) => TransitionManager.addTransition(prev, transition))
  }, [])

  const updateTransition = useCallback((transition: Transition) => {
    setTransitions((prev) => TransitionManager.updateTransition(prev, transition))
  }, [])

  const deleteTransition = useCallback((transitionId: string) => {
    setTransitions((prev) => TransitionManager.deleteTransition(prev, transitionId))
  }, [])

  // Image management functions
  const addImage = useCallback((image: ImageAsset) => {
    setImages((prev) => ImageManager.addImage(prev, image))
  }, [])

  const deleteImage = useCallback((imageId: string) => {
    setImages((prev) => ImageManager.deleteImage(prev, imageId))
  }, [])

  const updateImageUsage = useCallback((imageId: string, usage: ImageUsage) => {
    setImages((prev) => ImageManager.updateImageUsage(prev, imageId, usage))
  }, [])

  const removeImageUsage = useCallback((imageId: string, usageId: string) => {
    setImages((prev) => ImageManager.removeImageUsage(prev, imageId, usageId))
  }, [])

  // Category management functions
  const addCategory = useCallback((category: string) => {
    setCategories((prev) => {
      if (!prev.includes(category)) {
        return [...prev, category]
      }
      return prev
    })
  }, [])

  const deleteCategory = useCallback((category: string) => {
    setCategories((prev) => prev.filter(c => c !== category))
  }, [])

  // Auto-save
  const triggerSave = useCallback(() => {
    setLastSaved(new Date().toISOString())
  }, [setLastSaved])

  // Get full configuration for export/save
  const getConfiguration = useCallback(() => {
    return {
      name: projectName,
      images,
      processes,
      states,
      transitions,
      categories,
      metadata: {
        lastSaved: lastSaved,
        version: "1.0.0"
      }
    }
  }, [projectName, images, processes, states, transitions, categories, lastSaved])

  // Load a complete configuration
  const loadConfiguration = useCallback((config: any) => {
    if (config.name) {
      setProjectName(config.name)
    }
    if (config.images) {
      setImages(config.images)
    }
    if (config.processes) {
      setProcesses(config.processes)
    }
    if (config.states) {
      setStates(config.states)
    }
    if (config.transitions) {
      setTransitions(config.transitions)
    }
    if (config.categories) {
      setCategories(config.categories)
    }
    triggerSave()
  }, [setProjectName, setImages, setProcesses, setStates, setTransitions, setCategories, triggerSave])

  // Clear all data for new project
  const clearAllData = useCallback(() => {
    setProjectName('Untitled Project')
    setImages([])
    setProcesses([])
    setStates([])
    setTransitions([])
    setCategories([])
    setLastSaved(null)
  }, [setProjectName, setImages, setProcesses, setStates, setTransitions, setCategories, setLastSaved])

  const contextValue: AutomationContextType = {
    // Project
    projectName,
    setProjectName,

    // Process management
    processes,
    addProcess,
    updateProcess,
    deleteProcess,

    // State management
    states,
    addState,
    updateState,
    deleteState,

    // Transition management
    transitions,
    addTransition,
    updateTransition,
    deleteTransition,

    // Image management
    images,
    addImage,
    deleteImage,
    updateImageUsage,
    removeImageUsage,

    // Category management
    categories,
    addCategory,
    deleteCategory,

    // Auto-save
    lastSaved,
    triggerSave,

    // Configuration
    getConfiguration,
    loadConfiguration,
    clearAllData,
  }

  return (
    <AutomationContext.Provider value={contextValue}>
      {children}
    </AutomationContext.Provider>
  )
}
