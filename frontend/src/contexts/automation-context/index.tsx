"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react"
import { useLocalStorage } from "@/hooks/use-local-storage"
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
  State,
  Transition,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
  Schedule,
  ExecutionRecord,
  SchedulerStatistics,
} from "./types"
import type { ProjectSettings } from "@/types/project-settings"
import type { Workflow } from "@/lib/action-schema/action-types"

// Export types for external use
export type {
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
  Schedule,
  ExecutionRecord,
  TriggerType,
  CheckMode,
  ScheduleType,
  StateCheckResult,
  SchedulerStatistics,
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
  // Track if we're in the middle of renaming to prevent premature reload
  const isRenamingRef = useRef(false)

  // Clean up old settings and categories on mount
  useEffect(() => {
    const oldSettings = localStorage.getItem('qontinui-settings')
    if (oldSettings) {
      console.log('Removing old settings, applying new defaults')
      localStorage.removeItem('qontinui-settings')
    }

    // Remove old global categories key - categories are now per-project
    const oldCategories = localStorage.getItem('qontinui-categories')
    if (oldCategories) {
      console.log('Removing old global categories - categories are now per-project')
      localStorage.removeItem('qontinui-categories')
    }
  }, [])

  // State for project metadata - using localStorage for persistence
  const [projectName, setProjectName] = useLocalStorage<string>('qontinui-project-name', 'Untitled Project')
  const [lastSaved, setLastSaved] = useLocalStorage<string | null>('qontinui-lastSaved', null)

  // Categories are now stored per-project in the database, not in global localStorage
  const [categories, setCategories] = useState<string[]>([])

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
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [states, setStates] = useState<State[]>([])
  const [transitions, setTransitions] = useState<Transition[]>([])
  const [images, setImages] = useState<ImageAsset[]>([])
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [executionRecords, setExecutionRecords] = useState<ExecutionRecord[]>([])

  // Load all data from IndexedDB on mount and when project changes
  useEffect(() => {
    const loadProjectData = async () => {
      // Skip loading if we're in the middle of a rename operation
      if (isRenamingRef.current) {
        console.log(`Skipping reload during rename operation for project: ${projectName}`)
        isRenamingRef.current = false // Reset the flag
        return
      }

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
        loadedWorkflows,
        loadedStates,
        loadedTransitions,
        loadedImages,
        loadedScreenshots
      ] = await Promise.all([
        projectDB.getWorkflowsByProject(projectName),
        projectDB.getStatesByProject(projectName),
        projectDB.getTransitionsByProject(projectName),
        projectDB.getImagesByProject(projectName),
        screenshotDB.getByProject(projectName),
      ])

      setWorkflows(loadedWorkflows)
      setStates(loadedStates)
      setTransitions(loadedTransitions)
      setImages(loadedImages)
      setScreenshots(loadedScreenshots)

      // Extract unique categories from loaded workflows, always including Main and Transitions
      const workflowCategories = loadedWorkflows
        .map(w => w.category)
        .filter((cat): cat is string => cat != null && cat !== '')

      const uniqueCategories = Array.from(
        new Set(['Main', 'Transitions', ...workflowCategories])
      )
      setCategories(uniqueCategories)

      console.log(`Loaded project data - Workflows: ${loadedWorkflows.length}, States: ${loadedStates.length}, Transitions: ${loadedTransitions.length}, Images: ${loadedImages.length}, Screenshots: ${loadedScreenshots.length}, Categories: ${uniqueCategories.length}`)
    }

    loadProjectData()
  }, [projectName])

  // Workflow management functions
  const addWorkflow = useCallback(async (workflow: Workflow) => {
    const workflowWithProject = { ...workflow, projectName } as Workflow & { projectName: string }
    try {
      await projectDB.addWorkflow(workflowWithProject)
    } catch (error: any) {
      // If key already exists, update instead
      if (error.name === 'ConstraintError') {
        await projectDB.updateWorkflow(workflowWithProject)
      } else {
        throw error
      }
    }
    setWorkflows((prev) => [...prev, workflow])
  }, [projectName])

  const updateWorkflow = useCallback(async (workflow: Workflow) => {
    const workflowWithProject = { ...workflow, projectName } as Workflow & { projectName: string }
    await projectDB.updateWorkflow(workflowWithProject)
    setWorkflows((prev) => prev.map(w => w.id === workflow.id ? workflow : w))
  }, [projectName])

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    await projectDB.deleteWorkflow(workflowId)
    setWorkflows((prev) => prev.filter(w => w.id !== workflowId))
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

    // Find workflows that use this image in actions
    const usedInProcesses: Array<{ id: string; name: string; actionCount: number }> = []

    workflows.forEach(workflow => {
      const actionsWithImage = workflow.actions.filter(action => {
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
          id: workflow.id,
          name: workflow.name || workflow.id,
          actionCount: actionsWithImage.length
        })
      }
    })

    return {
      states: usedInStates,
      processes: usedInProcesses
    }
  }, [images, states, workflows])

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

  // Mark image as removed in workflows
  const markImageAsRemovedInProcesses = useCallback(async (imageId: string, imageName: string) => {
    const affectedWorkflows: Workflow[] = []

    for (const workflow of workflows) {
      let hasChanges = false
      const updatedActions = workflow.actions.map(action => {
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
        const updatedWorkflow = {
          ...workflow,
          actions: updatedActions
        }
        const workflowWithProject = { ...updatedWorkflow, projectName } as Workflow & { projectName: string }
        await projectDB.updateWorkflow(workflowWithProject)
        setWorkflows(prev => prev.map(w => w.id === workflow.id ? updatedWorkflow : w))
        affectedWorkflows.push(updatedWorkflow)
      }
    }

    return affectedWorkflows.length
  }, [workflows, projectName])

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
    // Protect Main and Transitions categories from deletion
    if (category === 'Main' || category === 'Transitions') {
      console.warn(`Cannot delete protected category: ${category}`)
      return
    }
    setCategories((prev) => prev.filter(c => c !== category))
  }, [])

  // Scheduler management functions
  const addSchedule = useCallback((schedule: Schedule) => {
    const scheduleWithProject = { ...schedule, projectName }
    setSchedules((prev) => [...prev, scheduleWithProject])
    triggerSave()
  }, [projectName, triggerSave])

  const updateSchedule = useCallback((schedule: Schedule) => {
    setSchedules((prev) => prev.map(s => s.id === schedule.id ? schedule : s))
    triggerSave()
  }, [triggerSave])

  const deleteSchedule = useCallback((scheduleId: string) => {
    setSchedules((prev) => prev.filter(s => s.id !== scheduleId))
    // Also remove associated execution records
    setExecutionRecords((prev) => prev.filter(r => r.scheduleId !== scheduleId))
    triggerSave()
  }, [triggerSave])

  const getSchedulerStatistics = useCallback((): SchedulerStatistics => {
    const totalSchedules = schedules.length
    const activeSchedules = schedules.filter(s => s.enabled).length
    const totalExecutions = executionRecords.length
    const successfulExecutions = executionRecords.filter(r => r.success).length
    const failedExecutions = executionRecords.filter(r => !r.success).length
    const averageIterationCount = executionRecords.length > 0
      ? executionRecords.reduce((sum, r) => sum + r.iterationCount, 0) / executionRecords.length
      : 0

    return {
      totalSchedules,
      activeSchedules,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageIterationCount,
    }
  }, [schedules, executionRecords])

  const getScheduleExecutions = useCallback((scheduleId: string): ExecutionRecord[] => {
    return executionRecords.filter(r => r.scheduleId === scheduleId)
  }, [executionRecords])

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
      workflows,
      states,
      transitions,
      categories,
      settings,
      schedules,
      executionRecords,
      metadata: {
        lastSaved: lastSaved,
        version: "1.0.0"
      }
    }
  }, [projectName, images, workflows, states, transitions, categories, settings, schedules, executionRecords, lastSaved])

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

    // Load workflows to IndexedDB
    if (config.workflows && Array.isArray(config.workflows)) {
      const workflowsWithProject = config.workflows.map((w: Workflow) => ({
        ...w,
        projectName: newProjectName
      })) as Array<Workflow & { projectName: string }>
      for (const workflow of workflowsWithProject) {
        await projectDB.updateWorkflow(workflow) // Use update (put) instead of add to handle duplicates
      }
      setWorkflows(config.workflows)
    } else {
      // If no workflows in config, explicitly set to empty array
      setWorkflows([])
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
    } else {
      // If no states in config, explicitly set to empty array
      setStates([])
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
    } else {
      // If no transitions in config, explicitly set to empty array
      setTransitions([])
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
    } else {
      // If no images in config, explicitly set to empty array
      setImages([])
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
    } else {
      // If no screenshots in config, explicitly set to empty array
      setScreenshots([])
    }

    if (config.categories && Array.isArray(config.categories)) {
      // Always include Main and Transitions, even if not in the saved config
      const uniqueCategories = Array.from(
        new Set(['Main', 'Transitions', ...config.categories])
      )
      setCategories(uniqueCategories)
    } else {
      // If no categories in config, set defaults
      setCategories(['Main', 'Transitions'])
    }

    // Load schedules
    if (config.schedules && Array.isArray(config.schedules)) {
      const schedulesWithProject = config.schedules.map((s: Schedule) => ({
        ...s,
        projectName: newProjectName,
        // Convert date strings back to Date objects if needed
        createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
        lastExecutedAt: s.lastExecutedAt ? new Date(s.lastExecutedAt) : undefined,
      }))
      setSchedules(schedulesWithProject)
    }

    // Load execution records
    if (config.executionRecords && Array.isArray(config.executionRecords)) {
      const recordsWithDates = config.executionRecords.map((r: ExecutionRecord) => ({
        ...r,
        startTime: new Date(r.startTime),
        endTime: r.endTime ? new Date(r.endTime) : undefined,
      }))
      setExecutionRecords(recordsWithDates)
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
    setWorkflows([])
    setStates([])
    setTransitions([])
    setCategories(['Main', 'Transitions'])
    setSchedules([])
    setExecutionRecords([])
    setLastSaved(null)
  }, [projectName, setProjectName, setCategories, setLastSaved])

  // Rename project - updates both localStorage and IndexedDB
  const renameProject = useCallback(async (newName: string) => {
    const trimmedName = newName.trim()
    if (!trimmedName || trimmedName === projectName) {
      return
    }

    console.log(`Renaming project from "${projectName}" to "${trimmedName}"`)

    // Rename all data in IndexedDB first
    await projectDB.renameProject(projectName, trimmedName)
    await screenshotDB.renameProject(projectName, trimmedName)

    // Update in-memory state with new project names (without triggering reload)
    setWorkflows(prev => prev.map(w => ({ ...w, projectName: trimmedName })))
    setStates(prev => prev.map(s => ({ ...s, projectName: trimmedName })))
    setTransitions(prev => prev.map(t => ({ ...t, projectName: trimmedName })))
    setImages(prev => prev.map(i => ({ ...i, projectName: trimmedName })))
    setScreenshots(prev => prev.map(s => ({ ...s, projectName: trimmedName })))

    // Set flag to prevent useEffect from reloading when projectName changes
    isRenamingRef.current = true

    // Update the project name in localStorage (this will trigger useEffect, but we'll skip the reload)
    setProjectName(trimmedName)

    console.log(`Project renamed successfully to "${trimmedName}"`)

    // Trigger save
    triggerSave()
  }, [projectName, setProjectName, triggerSave])

  const contextValue: AutomationContextType = useMemo(() => ({
    // Project
    projectName,
    setProjectName,
    renameProject,

    // Workflow management (unified - replaces both processes and workflows)
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,

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

    // Scheduler management
    schedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    getSchedulerStatistics,

    // Execution history
    executionRecords,
    getScheduleExecutions,

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
  }), [
    projectName,
    setProjectName,
    renameProject,
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    states,
    addState,
    updateState,
    updateStateWithIdChange,
    deleteState,
    transitions,
    addTransition,
    updateTransition,
    deleteTransition,
    images,
    addImage,
    deleteImage,
    updateImage,
    updateImageUsage,
    removeImageUsage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    screenshots,
    addScreenshot,
    updateScreenshot,
    deleteScreenshot,
    updateStateImageActionHistory,
    updateStateLocationActionHistory,
    updateStateRegionActionHistory,
    categories,
    addCategory,
    deleteCategory,
    schedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    getSchedulerStatistics,
    executionRecords,
    getScheduleExecutions,
    settings,
    updateSettings,
    lastSaved,
    triggerSave,
    getConfiguration,
    loadConfiguration,
    clearAllData,
  ])

  return (
    <AutomationContext.Provider value={contextValue}>
      {children}
    </AutomationContext.Provider>
  )
}
