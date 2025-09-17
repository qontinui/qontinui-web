"use client"

import type React from "react"
import { createContext, useContext, useState, useCallback, useEffect } from "react"
import { useLocalStorage } from "@/hooks/use-local-storage"

interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  usageCount: number
  usedIn: Array<{ type: "process" | "state"; id: string; name: string }>
}

interface Process {
  id: string
  name: string
  description: string
  actions: Action[]
}

interface Action {
  id: string
  type: "FIND" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH"
  config: Record<string, any>
}

interface State {
  id: string
  name: string
  description: string
  initial?: boolean  // Whether this state is expected to be active at start
  identifyingImages: Array<{ image: string; threshold: number }>
  position: { x: number; y: number }
}

type TransitionType = "OutgoingTransition" | "IncomingTransition"

interface BaseTransition {
  id: string
  type: TransitionType
  processes: string[]  // Process IDs to execute
  timeout: number
  retryCount: number
}

interface OutgoingTransition extends BaseTransition {
  type: "OutgoingTransition"
  fromState: string  // Origin state ID
  toState: string    // Target state ID
  staysVisible: boolean  // Whether origin state remains active
  activateStates: string[]  // Additional states to activate on success
  deactivateStates: string[]  // Additional states to deactivate on success
}

interface IncomingTransition extends BaseTransition {
  type: "IncomingTransition"
  toState: string  // State this transition belongs to
  // IncomingTransitions are always executed after an OutgoingTransition to this state
}

type Transition = OutgoingTransition | IncomingTransition

interface AutomationContextType {
  // Project
  projectName: string
  setProjectName: (name: string) => void

  // Images
  images: ImageAsset[]
  addImages: (newImages: ImageAsset[]) => void
  deleteImage: (imageId: string) => boolean
  updateImageUsage: (imageId: string, usedIn: { type: "process" | "state"; id: string; name: string }) => void
  removeImageUsage: (imageId: string, usageId: string) => void

  // Processes
  processes: Process[]
  addProcess: (process: Process) => void
  updateProcess: (process: Process) => void
  deleteProcess: (processId: string) => void

  // States
  states: State[]
  addState: (state: State) => void
  updateState: (state: State) => void
  deleteState: (stateId: string) => void

  // Transitions
  transitions: Transition[]
  addTransition: (transition: Transition) => void
  updateTransition: (transition: Transition) => void
  deleteTransition: (transitionId: string) => void

  // Auto-save
  lastSaved: string | null
  triggerSave: () => void
  
  // Configuration
  getConfiguration: () => any
  loadConfiguration: (config: any) => void
  clearAllData: () => void
}

const AutomationContext = createContext<AutomationContextType | undefined>(undefined)

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const [projectName, setProjectName] = useLocalStorage<string>('qontinui-project-name', 'Untitled Project')
  const [images, setImages] = useLocalStorage<ImageAsset[]>('qontinui-images', [])
  const [processes, setProcesses] = useLocalStorage<Process[]>('qontinui-processes', [])
  const [states, setStates] = useLocalStorage<State[]>('qontinui-states', [])
  const [transitions, setTransitions] = useLocalStorage<Transition[]>('qontinui-transitions', [])
  const [lastSaved, setLastSaved] = useLocalStorage<string | null>('qontinui-lastSaved', null)

  // Image management
  const addImages = useCallback((newImages: ImageAsset[]) => {
    setImages((prev) => [...prev, ...newImages])
  }, [])

  const deleteImage = useCallback(
    (imageId: string): boolean => {
      const image = images.find((img) => img.id === imageId)
      if (image && image.usageCount > 0) {
        return false // Cannot delete image in use
      }
      setImages((prev) => prev.filter((img) => img.id !== imageId))
      return true
    },
    [images],
  )

  const updateImageUsage = useCallback(
    (imageId: string, usedIn: { type: "process" | "state"; id: string; name: string }) => {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id === imageId) {
            const existingUsage = img.usedIn.find((u) => u.id === usedIn.id && u.type === usedIn.type)
            if (!existingUsage) {
              return {
                ...img,
                usageCount: img.usageCount + 1,
                usedIn: [...img.usedIn, usedIn],
              }
            }
          }
          return img
        }),
      )
    },
    [],
  )

  const removeImageUsage = useCallback((imageId: string, usageId: string) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id === imageId) {
          const updatedUsedIn = img.usedIn.filter((u) => u.id !== usageId)
          return {
            ...img,
            usageCount: Math.max(0, img.usageCount - 1),
            usedIn: updatedUsedIn,
          }
        }
        return img
      }),
    )
  }, [])

  // Process management
  const addProcess = useCallback((process: Process) => {
    setProcesses((prev) => [...prev, process])
  }, [])

  const updateProcess = useCallback((process: Process) => {
    setProcesses((prev) => prev.map((p) => (p.id === process.id ? process : p)))
  }, [])

  const deleteProcess = useCallback((processId: string) => {
    setProcesses((prev) => prev.filter((p) => p.id !== processId))
    // Remove from transitions
    setTransitions((prev) =>
      prev.map((t) => ({
        ...t,
        processes: t.processes.filter((pid) => pid !== processId),
      })),
    )
  }, [])

  // State management
  const addState = useCallback((state: State) => {
    setStates((prev) => [...prev, state])
  }, [])

  const updateState = useCallback((state: State) => {
    setStates((prev) => prev.map((s) => (s.id === state.id ? state : s)))
  }, [])

  const deleteState = useCallback((stateId: string) => {
    setStates((prev) => prev.filter((s) => s.id !== stateId))
    // Remove transitions that reference this state
    setTransitions((prev) => prev.filter((t) => {
      if (t.type === "OutgoingTransition") {
        return t.fromState !== stateId && t.toState !== stateId && 
               !t.activateStates.includes(stateId) && !t.deactivateStates.includes(stateId)
      } else {
        return t.toState !== stateId
      }
    }))
  }, [])

  // Transition management
  const addTransition = useCallback((transition: Transition) => {
    setTransitions((prev) => [...prev, transition])
  }, [])

  const updateTransition = useCallback((transition: Transition) => {
    setTransitions((prev) => prev.map((t) => (t.id === transition.id ? transition : t)))
  }, [])

  const deleteTransition = useCallback((transitionId: string) => {
    setTransitions((prev) => prev.filter((t) => t.id !== transitionId))
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
      metadata: {
        lastSaved: lastSaved,
        version: "1.0.0"
      }
    }
  }, [projectName, images, processes, states, transitions, lastSaved])

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
    setLastSaved(new Date().toISOString())
  }, [setProjectName, setImages, setProcesses, setStates, setTransitions, setLastSaved])

  // Clear all data for new project
  const clearAllData = useCallback(() => {
    setProjectName('Untitled Project')
    setImages([])
    setProcesses([])
    setStates([])
    setTransitions([])
    setLastSaved(null)
  }, [setProjectName, setImages, setProcesses, setStates, setTransitions, setLastSaved])

  const value: AutomationContextType = {
    projectName,
    setProjectName,
    images,
    addImages,
    deleteImage,
    updateImageUsage,
    removeImageUsage,
    processes,
    addProcess,
    updateProcess,
    deleteProcess,
    states,
    addState,
    updateState,
    deleteState,
    transitions,
    addTransition,
    updateTransition,
    deleteTransition,
    lastSaved,
    triggerSave,
    getConfiguration,
    loadConfiguration,
    clearAllData,
  }

  return <AutomationContext.Provider value={value}>{children}</AutomationContext.Provider>
}

export function useAutomation() {
  const context = useContext(AutomationContext)
  if (context === undefined) {
    throw new Error("useAutomation must be used within an AutomationProvider")
  }
  return context
}
