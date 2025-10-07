"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { ProcessManager } from "./process-manager"
import { StateManager } from "./state-manager"
import { TransitionManager } from "./transition-manager"
import { ImageManager } from "./image-manager"
import { ActionHistoryManager } from "./action-history-manager"
import { ScreenshotManager } from "./screenshot-manager"
import { screenshotDB } from "@/lib/screenshot-db"
import { projectDB } from "@/lib/project-db"
import { DEFAULT_PROJECT_SETTINGS } from "@/types/project-settings"
import type {
  AutomationContextType,
  Process,
  State,
  Transition,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
} from "./types"
import type { ProjectSettings } from "@/types/project-settings"

// Export types for external use
export type {
  Process,
  Action,
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  SearchRegion,
  Position,
  PositionName,
  Transition,
  TransitionType,
  BaseTransition,
  OutgoingTransition,
  IncomingTransition,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
} from "./types"

// Export utility classes
export { StateIdManager } from "./state-id-manager"
export { TransitionReferenceUpdater } from "./transition-reference-updater"
export { StateUpdateCoordinator } from "./state-update-coordinator"

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
  // Clean up old settings on mount
  useEffect(() => {
    const oldSettings = localStorage.getItem('qontinui-settings')
    if (oldSettings) {
      console.log('Removing old settings, applying new defaults')
      localStorage.removeItem('qontinui-settings')
    }
  }, [])

  // State for project metadata - using localStorage for persistence
  const [projectName, setProjectName] = useLocalStorage<string>('qontinui-project-name', 'Untitled Project')
  const [categories, setCategories] = useLocalStorage<string[]>('qontinui-categories', [])
  const [lastSaved, setLastSaved] = useLocalStorage<string | null>('qontinui-lastSaved', null)

  // Settings are now per-project using the project name in the key
  const settingsKey = `qontinui-settings-v2-${projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}`

  // Force correct defaults - hardcoded to ensure they're applied
  const CORRECT_DEFAULTS: ProjectSettings = {
    mouse: {
      click_hold_duration: 100,
      click_release_delay: 50,
      click_safety_release: true,
      double_click_interval: 300,
      drag_start_delay: 100,
      drag_end_delay: 100,
      drag_default_duration: 500,
      move_default_duration: 500,
      safety_release_delay: 50,
    },
    keyboard: {
      key_hold_duration: 50,
      key_release_delay: 50,
      typing_interval: 50,
      hotkey_hold_duration: 100,
      hotkey_press_interval: 50,
    },
    find: {
      default_timeout: 30000,
      default_retry_count: 0,
      search_interval: 500,
    },
    wait: {
      pause_before_action: 0,
      pause_after_action: 0,
    },
    execution: {
      default_timeout: 10000,
      default_retry_count: 0,
      action_delay: 100,
      failure_strategy: 'continue',
    },
    recognition: {
      default_threshold: 0.70,
      multi_scale_search: false,
      color_space: 'rgb',
      edge_detection: false,
      ocr_enabled: false,
    },
  }

  const [settings, setSettings] = useLocalStorage<ProjectSettings>(settingsKey, CORRECT_DEFAULTS)


  // All project data now uses IndexedDB for persistence and project isolation
  const [processes, setProcesses] = useState<Process[]>([])
  const [states, setStates] = useState<State[]>([])
  const [transitions, setTransitions] = useState<Transition[]>([])
  const [images, setImages] = useState<ImageAsset[]>([])
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])

  // Load all data from IndexedDB on mount and when project changes
  useEffect(() => {
    const loadProjectData = async () => {
      console.log(`Loading data for project: ${projectName}`)

      // One-time migration: rename "bdo-mask" to "bdo" (only if not already migrated)
      const migrationKey = 'qontinui-migration-bdo-mask-to-bdo-done'
      if (projectName === 'bdo' && !localStorage.getItem(migrationKey)) {
        try {
          const oldData = await projectDB.getStatesByProject('bdo-mask')
          if (oldData.length > 0) {
            console.log('Migrating data from "bdo-mask" to "bdo"...')
            await projectDB.renameProject('bdo-mask', 'bdo')
            localStorage.setItem(migrationKey, 'true')
            console.log('Migration complete!')
          }
        } catch (error) {
          console.error('Migration failed:', error)
        }
      }

      // Migrate data from localStorage to IndexedDB if needed
      try {
        // Migrate processes
        const localStorageProcesses = window.localStorage.getItem('qontinui-processes')
        if (localStorageProcesses) {
          const parsed = JSON.parse(localStorageProcesses) as Process[]
          if (parsed.length > 0) {
            console.log(`Migrating ${parsed.length} processes from localStorage to IndexedDB...`)
            for (const process of parsed) {
              try {
                await projectDB.updateProcess({ ...process, projectName })
              } catch (error) {
                console.error(`Failed to migrate process ${process.id}:`, error)
              }
            }
            window.localStorage.removeItem('qontinui-processes')
          }
        }

        // Migrate states
        const localStorageStates = window.localStorage.getItem('qontinui-states')
        if (localStorageStates) {
          const parsed = JSON.parse(localStorageStates) as State[]
          if (parsed.length > 0) {
            console.log(`Migrating ${parsed.length} states from localStorage to IndexedDB...`)
            for (const state of parsed) {
              try {
                await projectDB.updateState({ ...state, projectName })
              } catch (error) {
                console.error(`Failed to migrate state ${state.id}:`, error)
              }
            }
            window.localStorage.removeItem('qontinui-states')
          }
        }

        // Migrate transitions
        const localStorageTransitions = window.localStorage.getItem('qontinui-transitions')
        if (localStorageTransitions) {
          const parsed = JSON.parse(localStorageTransitions) as Transition[]
          if (parsed.length > 0) {
            console.log(`Migrating ${parsed.length} transitions from localStorage to IndexedDB...`)
            for (const transition of parsed) {
              try {
                await projectDB.updateTransition({ ...transition, projectName })
              } catch (error) {
                console.error(`Failed to migrate transition ${transition.id}:`, error)
              }
            }
            window.localStorage.removeItem('qontinui-transitions')
          }
        }

        // Migrate images
        const localStorageImages = window.localStorage.getItem('qontinui-images')
        if (localStorageImages) {
          const parsed = JSON.parse(localStorageImages) as ImageAsset[]
          if (parsed.length > 0) {
            console.log(`Migrating ${parsed.length} images from localStorage to IndexedDB...`)
            for (const image of parsed) {
              try {
                await projectDB.updateImage({ ...image, projectName })
              } catch (error) {
                console.error(`Failed to migrate image ${image.id}:`, error)
              }
            }
            window.localStorage.removeItem('qontinui-images')
          }
        }

        // Migrate screenshots
        const localStorageScreenshots = window.localStorage.getItem('qontinui-screenshots')
        if (localStorageScreenshots) {
          const parsed = JSON.parse(localStorageScreenshots) as Screenshot[]
          if (parsed.length > 0) {
            console.log(`Migrating ${parsed.length} screenshots from localStorage to IndexedDB...`)
            for (const screenshot of parsed) {
              try {
                await screenshotDB.update({ ...screenshot, projectName }) // Use update instead of add to handle duplicates
              } catch (error) {
                console.error(`Failed to migrate screenshot ${screenshot.id}:`, error)
              }
            }
            window.localStorage.removeItem('qontinui-screenshots')
          }
        }

        console.log('Migration complete')
      } catch (error) {
        console.error('Error during data migration:', error)
      }

      // Load all data from IndexedDB for current project
      const [
        loadedProcesses,
        loadedStates,
        loadedTransitions,
        loadedImages,
        loadedScreenshots
      ] = await Promise.all([
        projectDB.getProcessesByProject(projectName),
        projectDB.getStatesByProject(projectName),
        projectDB.getTransitionsByProject(projectName),
        projectDB.getImagesByProject(projectName),
        screenshotDB.getByProject(projectName),
      ])

      setProcesses(loadedProcesses)
      setStates(loadedStates)
      setTransitions(loadedTransitions)
      setImages(loadedImages)
      setScreenshots(loadedScreenshots)

      console.log(`Loaded project data - Processes: ${loadedProcesses.length}, States: ${loadedStates.length}, Transitions: ${loadedTransitions.length}, Images: ${loadedImages.length}, Screenshots: ${loadedScreenshots.length}`)
    }

    loadProjectData()
  }, [projectName])

  // Process management functions
  const addProcess = useCallback(async (process: Process) => {
    const processWithProject = { ...process, projectName }
    try {
      await projectDB.addProcess(processWithProject)
    } catch (error: any) {
      // If key already exists, update instead
      if (error.name === 'ConstraintError') {
        await projectDB.updateProcess(processWithProject)
      } else {
        throw error
      }
    }
    setProcesses((prev) => ProcessManager.addProcess(prev, processWithProject))
  }, [projectName])

  const updateProcess = useCallback(async (process: Process) => {
    await projectDB.updateProcess(process)
    setProcesses((prev) => ProcessManager.updateProcess(prev, process))
  }, [])

  const deleteProcess = useCallback(async (processId: string) => {
    await projectDB.deleteProcess(processId)
    setProcesses((prev) => ProcessManager.deleteProcess(prev, processId))
    // Clean up transitions that reference this process
    setTransitions((prev) => TransitionManager.removeProcessFromTransitions(prev, processId))
  }, [])

  // State management functions
  const addState = useCallback(async (state: State) => {
    const stateWithProject = { ...state, projectName }
    try {
      await projectDB.addState(stateWithProject)
    } catch (error: any) {
      // If key already exists, update instead
      if (error.name === 'ConstraintError') {
        await projectDB.updateState(stateWithProject)
      } else {
        throw error
      }
    }
    setStates((prev) => StateManager.addState(prev, stateWithProject))
  }, [projectName])

  const updateState = useCallback(async (state: State) => {
    await projectDB.updateState(state)
    setStates((prev) => StateManager.updateState(prev, state))
  }, [])

  const updateStateWithIdChange = useCallback(async (oldId: string, newState: State) => {
    await projectDB.updateStateWithIdChange(oldId, newState)
    setStates((prev) => StateManager.updateStateWithIdChange(prev, oldId, newState))
  }, [])

  const deleteState = useCallback(async (stateId: string) => {
    await projectDB.deleteState(stateId)
    setStates((prev) => StateManager.deleteState(prev, stateId))
    // Clean up transitions that reference this state
    setTransitions((prev) => TransitionManager.removeStateFromTransitions(prev, stateId))
  }, [])

  // Transition management functions
  const addTransition = useCallback(async (transition: Transition) => {
    const transitionWithProject = { ...transition, projectName }
    try {
      await projectDB.addTransition(transitionWithProject)
    } catch (error: any) {
      // If key already exists, update instead
      if (error.name === 'ConstraintError') {
        await projectDB.updateTransition(transitionWithProject)
      } else {
        throw error
      }
    }
    setTransitions((prev) => TransitionManager.addTransition(prev, transitionWithProject))
  }, [projectName])

  const updateTransition = useCallback(async (transition: Transition) => {
    await projectDB.updateTransition(transition)
    setTransitions((prev) => TransitionManager.updateTransition(prev, transition))
  }, [])

  const deleteTransition = useCallback(async (transitionId: string) => {
    await projectDB.deleteTransition(transitionId)
    setTransitions((prev) => TransitionManager.deleteTransition(prev, transitionId))
  }, [])

  // Image management functions
  const addImage = useCallback(async (image: ImageAsset) => {
    const imageWithProject = { ...image, projectName }
    try {
      await projectDB.addImage(imageWithProject)
    } catch (error: any) {
      // If key already exists, update instead
      if (error.name === 'ConstraintError') {
        await projectDB.updateImage(imageWithProject)
      } else {
        throw error
      }
    }
    setImages((prev) => ImageManager.addImage(prev, imageWithProject))
  }, [projectName])

  const deleteImage = useCallback(async (imageId: string) => {
    await projectDB.deleteImage(imageId)
    setImages((prev) => ImageManager.deleteImage(prev, imageId))
  }, [])

  const updateImageUsage = useCallback(async (imageId: string, usage: ImageUsage) => {
    const updatedImages = ImageManager.updateImageUsage(images, imageId, usage)
    const updatedImage = updatedImages.find(img => img.id === imageId)
    if (updatedImage) {
      await projectDB.updateImage(updatedImage)
    }
    setImages(updatedImages)
  }, [images])

  const removeImageUsage = useCallback(async (imageId: string, usageId: string) => {
    const updatedImages = ImageManager.removeImageUsage(images, imageId, usageId)
    const updatedImage = updatedImages.find(img => img.id === imageId)
    if (updatedImage) {
      await projectDB.updateImage(updatedImage)
    }
    setImages(updatedImages)
  }, [images])

  const updateImage = useCallback(async (image: ImageAsset) => {
    await projectDB.updateImage(image)
    setImages((prev) => prev.map(img => img.id === image.id ? image : img))
  }, [])

  // Get detailed usage information for an image
  const getImageUsage = useCallback((imageId: string) => {
    const image = images.find(img => img.id === imageId)
    if (!image) {
      return { states: [], processes: [] }
    }

    // Find states that use this image (check both legacy image field and patterns)
    const usedInStates = states
      .filter(state =>
        state.stateImages?.some(si =>
          si.image === image.url ||
          si.patterns?.some(p => p.image === image.url)
        )
      )
      .map(state => ({
        id: state.id,
        name: state.name || state.id
      }))

    // Find processes that use this image in actions
    const usedInProcesses: Array<{ id: string; name: string; actionCount: number }> = []

    processes.forEach(process => {
      const actionsWithImage = process.actions.filter(action => {
        // Check if action uses this image directly
        if (action.config.image === imageId) return true
        // Check DRAG actions (to field)
        if (action.type === "DRAG" && action.config.to === imageId) return true
        // Check VANISH actions
        if (action.type === "VANISH" && action.config.image === imageId) return true
        return false
      })

      if (actionsWithImage.length > 0) {
        usedInProcesses.push({
          id: process.id,
          name: process.name || process.id,
          actionCount: actionsWithImage.length
        })
      }
    })

    return {
      states: usedInStates,
      processes: usedInProcesses
    }
  }, [images, states, processes])

  // Remove image from all states
  const removeImageFromStates = useCallback(async (imageUrl: string) => {
    const affectedStates = states.filter(state =>
      state.stateImages?.some(si => si.image === imageUrl)
    )

    for (const state of affectedStates) {
      const updatedState = {
        ...state,
        stateImages: state.stateImages.filter(si => si.image !== imageUrl)
      }
      await projectDB.updateState(updatedState)
      setStates(prev => prev.map(s => s.id === state.id ? updatedState : s))
    }

    return affectedStates.length
  }, [states])

  // Mark image as removed in processes
  const markImageAsRemovedInProcesses = useCallback(async (imageId: string, imageName: string) => {
    const affectedProcesses: Process[] = []

    for (const process of processes) {
      let hasChanges = false
      const updatedActions = process.actions.map(action => {
        // Check if action uses this image
        if (action.config.image === imageId) {
          hasChanges = true
          return {
            ...action,
            config: {
              ...action.config,
              image: null,
              removedImage: imageName // Store the original image name
            }
          }
        }
        // Check DRAG actions (to field)
        if (action.type === "DRAG" && action.config.to === imageId) {
          hasChanges = true
          return {
            ...action,
            config: {
              ...action.config,
              to: null,
              removedImageTo: imageName
            }
          }
        }
        // Check VANISH actions
        if (action.type === "VANISH" && action.config.image === imageId) {
          hasChanges = true
          return {
            ...action,
            config: {
              ...action.config,
              image: null,
              removedImage: imageName
            }
          }
        }
        return action
      })

      if (hasChanges) {
        const updatedProcess = {
          ...process,
          actions: updatedActions
        }
        await projectDB.updateProcess(updatedProcess)
        setProcesses(prev => prev.map(p => p.id === process.id ? updatedProcess : p))
        affectedProcesses.push(updatedProcess)
      }
    }

    return affectedProcesses.length
  }, [processes])

  // Screenshot management functions (using IndexedDB)
  const addScreenshot = useCallback(async (screenshot: Screenshot) => {
    const screenshotWithProject = { ...screenshot, projectName }
    await screenshotDB.add(screenshotWithProject)
    setScreenshots((prev) => ScreenshotManager.addScreenshot(prev, screenshotWithProject))
  }, [projectName])

  const updateScreenshot = useCallback(async (screenshot: Screenshot) => {
    await screenshotDB.update(screenshot)
    setScreenshots((prev) => ScreenshotManager.updateScreenshot(prev, screenshot))
  }, [])

  const deleteScreenshot = useCallback(async (screenshotId: string) => {
    await screenshotDB.delete(screenshotId)
    setScreenshots((prev) => ScreenshotManager.deleteScreenshot(prev, screenshotId))
  }, [])

  // Auto-save
  const triggerSave = useCallback(() => {
    setLastSaved(new Date().toISOString())
  }, [setLastSaved])

  // ActionHistory management functions
  const updateStateImageActionHistory = useCallback(
    (stateId: string, imageId: string, actionHistory: ActionHistory) => {
      setStates((prev) => prev.map(state => {
        if (state.id === stateId) {
          return ActionHistoryManager.updateStateImageActionHistory(state, imageId, actionHistory)
        }
        return state
      }))
      triggerSave()
    },
    [triggerSave]
  )

  const updateStateLocationActionHistory = useCallback(
    (stateId: string, locationId: string, actionHistory: ActionHistory) => {
      setStates((prev) => prev.map(state => {
        if (state.id === stateId) {
          return ActionHistoryManager.updateStateLocationActionHistory(state, locationId, actionHistory)
        }
        return state
      }))
      triggerSave()
    },
    [triggerSave]
  )

  const updateStateRegionActionHistory = useCallback(
    (stateId: string, regionId: string, actionHistory: ActionHistory) => {
      setStates((prev) => prev.map(state => {
        if (state.id === stateId) {
          return ActionHistoryManager.updateStateRegionActionHistory(state, regionId, actionHistory)
        }
        return state
      }))
      triggerSave()
    },
    [triggerSave]
  )

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

  // Settings management functions
  const updateSettings = useCallback((newSettings: ProjectSettings) => {
    setSettings(newSettings)
    triggerSave()
  }, [setSettings, triggerSave])

  // Get full configuration for export/save
  const getConfiguration = useCallback(() => {
    return {
      name: projectName,
      images,
      screenshots,
      processes,
      states,
      transitions,
      categories,
      settings,
      metadata: {
        lastSaved: lastSaved,
        version: "1.0.0"
      }
    }
  }, [projectName, images, processes, states, transitions, categories, settings, lastSaved])

  // Load a complete configuration
  const loadConfiguration = useCallback(async (config: any) => {
    const newProjectName = config.name || 'Untitled Project'

    // Clear existing data for the old project from IndexedDB
    await projectDB.clearProjectData(projectName)

    const currentScreenshots = await screenshotDB.getByProject(projectName)
    for (const screenshot of currentScreenshots) {
      await screenshotDB.delete(screenshot.id)
    }

    if (config.name) {
      setProjectName(config.name)
    }

    // Load processes to IndexedDB
    if (config.processes && Array.isArray(config.processes)) {
      const processesWithProject = config.processes.map((p: Process) => ({
        ...p,
        projectName: newProjectName
      }))
      for (const process of processesWithProject) {
        await projectDB.updateProcess(process) // Use update (put) instead of add to handle duplicates
      }
      setProcesses(processesWithProject)
    }

    // Load states to IndexedDB
    if (config.states && Array.isArray(config.states)) {
      const statesWithProject = config.states.map((s: State) => ({
        ...s,
        projectName: newProjectName
      }))
      for (const state of statesWithProject) {
        await projectDB.updateState(state) // Use update (put) instead of add to handle duplicates
      }
      setStates(statesWithProject)
    }

    // Load transitions to IndexedDB
    if (config.transitions && Array.isArray(config.transitions)) {
      const transitionsWithProject = config.transitions.map((t: Transition) => ({
        ...t,
        projectName: newProjectName
      }))
      for (const transition of transitionsWithProject) {
        await projectDB.updateTransition(transition) // Use update (put) instead of add to handle duplicates
      }
      setTransitions(transitionsWithProject)
    }

    // Load images to IndexedDB
    if (config.images && Array.isArray(config.images)) {
      const imagesWithProject = config.images.map((img: ImageAsset) => ({
        ...img,
        projectName: newProjectName
      }))
      for (const image of imagesWithProject) {
        await projectDB.updateImage(image) // Use update (put) instead of add to handle duplicates
      }
      setImages(imagesWithProject)
    }

    // Load screenshots to IndexedDB
    if (config.screenshots && Array.isArray(config.screenshots)) {
      const screenshotsWithProject = config.screenshots.map((s: Screenshot) => ({
        ...s,
        projectName: newProjectName
      }))
      for (const screenshot of screenshotsWithProject) {
        await screenshotDB.update(screenshot) // Use update (put) instead of add to handle duplicates
      }
      setScreenshots(screenshotsWithProject)
    }

    if (config.categories && Array.isArray(config.categories)) {
      setCategories(config.categories)
    }

    // Don't load settings from config - they should be local defaults
    // Settings are now per-project in localStorage, not saved in config

    triggerSave()
  }, [projectName, setProjectName, setCategories, triggerSave])

  // Clear all data for new project
  const clearAllData = useCallback(async () => {
    // Clear all data from IndexedDB for current project
    await projectDB.clearProjectData(projectName)

    const currentScreenshots = await screenshotDB.getByProject(projectName)
    for (const screenshot of currentScreenshots) {
      await screenshotDB.delete(screenshot.id)
    }

    setProjectName('Untitled Project')
    setImages([])
    setScreenshots([])
    setProcesses([])
    setStates([])
    setTransitions([])
    setCategories([])
    setLastSaved(null)
  }, [projectName, setProjectName, setCategories, setLastSaved])

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
    updateStateWithIdChange,
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
    updateImage,
    updateImageUsage,
    removeImageUsage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,

    // Screenshot management
    screenshots,
    addScreenshot,
    updateScreenshot,
    deleteScreenshot,

    // ActionHistory management
    updateStateImageActionHistory,
    updateStateLocationActionHistory,
    updateStateRegionActionHistory,

    // Category management
    categories,
    addCategory,
    deleteCategory,

    // Settings management
    settings,
    updateSettings,

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
