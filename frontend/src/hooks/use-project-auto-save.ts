/**
 * useProjectAutoSave Hook
 *
 * Single Responsibility: Handle automatic saving of project configuration.
 * This hook extracts the auto-save logic from the automation-builder component.
 *
 * Responsibilities:
 * - Trigger local storage saves periodically
 * - Sync configuration to backend periodically
 * - Track save status
 */

import { useEffect, useCallback, useRef } from 'react'
import { useAutomation } from '@/contexts/automation-context'
import { projectService } from '@/services/service-factory'
import { projectLogger } from '@/lib/project-logger'

interface UseProjectAutoSaveOptions {
  /** Project ID for backend sync (null if no backend project) */
  projectId: string | null
  /** Interval for local saves in ms (default: 2000) */
  localSaveInterval?: number
  /** Interval for backend saves in ms (default: 10000) */
  backendSaveInterval?: number
  /** Whether auto-save is enabled */
  enabled?: boolean
}

interface UseProjectAutoSaveResult {
  /** Manually trigger a save to backend */
  saveToBackend: () => Promise<void>
  /** Whether a save is in progress */
  isSaving: boolean
}

export function useProjectAutoSave({
  projectId,
  localSaveInterval = 2000,
  backendSaveInterval = 10000,
  enabled = true,
}: UseProjectAutoSaveOptions): UseProjectAutoSaveResult {
  const {
    triggerSave,
    getConfiguration,
    workflows,
    states,
    transitions,
    images,
  } = useAutomation()

  const isSavingRef = useRef(false)

  // Save to backend
  const saveToBackend = useCallback(async () => {
    if (!projectId || isSavingRef.current) {
      return
    }

    isSavingRef.current = true

    try {
      const config = getConfiguration()
      projectLogger.debug('AutoSave', 'Saving to backend', {
        projectId,
        workflowCount: config.workflows?.length ?? 0,
      })

      await projectService.updateProject(projectId, {
        configuration: config,
      })

      projectLogger.debug('AutoSave', 'Backend save complete', { projectId })
    } catch (error) {
      projectLogger.error('AutoSave', 'Backend save failed', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      isSavingRef.current = false
    }
  }, [projectId, getConfiguration])

  // Auto-save to localStorage
  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(() => {
      triggerSave()
    }, localSaveInterval)

    return () => clearInterval(interval)
  }, [triggerSave, localSaveInterval, enabled])

  // Auto-save to backend
  useEffect(() => {
    if (!enabled || !projectId) return

    const interval = setInterval(() => {
      saveToBackend()
    }, backendSaveInterval)

    return () => clearInterval(interval)
  }, [projectId, saveToBackend, backendSaveInterval, enabled, workflows, states, transitions, images])

  return {
    saveToBackend,
    isSaving: isSavingRef.current,
  }
}
