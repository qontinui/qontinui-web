/**
 * useProjectNameEditor Hook
 *
 * Single Responsibility: Handle inline editing of project name.
 * This hook extracts the name editing logic from the automation-builder component.
 *
 * Responsibilities:
 * - Manage editing state (isEditing, editedName)
 * - Handle save/cancel operations
 * - Sync name changes to context and backend
 */

import React, { useState, useCallback, useRef } from 'react'
import { useAutomation } from '@/contexts/automation-context'
import { useUpdateProject } from '@/hooks/use-projects'
import { toast } from 'sonner'
import { projectLogger } from '@/lib/project-logger'

interface UseProjectNameEditorOptions {
  /** Backend project ID (null if no backend project) */
  projectId: string | null
}

interface UseProjectNameEditorResult {
  /** Whether currently in edit mode */
  isEditing: boolean
  /** Current edited name value */
  editedName: string
  /** Ref for the input element (for focus management) */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Start editing the name */
  startEditing: () => void
  /** Cancel editing and revert changes */
  cancelEditing: () => void
  /** Save the edited name */
  saveName: () => Promise<void>
  /** Handle input change */
  setEditedName: (name: string) => void
  /** Handle keyboard events (Enter to save, Escape to cancel) */
  handleKeyDown: (e: React.KeyboardEvent) => void
}

export function useProjectNameEditor({
  projectId,
}: UseProjectNameEditorOptions): UseProjectNameEditorResult {
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { projectName, renameProject } = useAutomation()
  const updateProject = useUpdateProject()

  const startEditing = useCallback(() => {
    projectLogger.debug('NameEditor', 'Start editing', { currentName: projectName })
    setEditedName(projectName || '')
    setIsEditing(true)
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [projectName])

  const cancelEditing = useCallback(() => {
    projectLogger.debug('NameEditor', 'Cancel editing')
    setIsEditing(false)
    setEditedName('')
  }, [])

  const saveName = useCallback(async () => {
    const trimmedName = editedName.trim()

    if (!trimmedName) {
      toast.error('Project name cannot be empty')
      return
    }

    if (trimmedName === projectName) {
      setIsEditing(false)
      return
    }

    projectLogger.info('NameEditor', 'Saving name', {
      oldName: projectName,
      newName: trimmedName,
      projectId,
    })

    try {
      // Update in context (localStorage + IndexedDB)
      await renameProject(trimmedName)

      // Update on backend if we have a project ID
      if (projectId) {
        await updateProject.mutateAsync({
          id: projectId,
          data: { name: trimmedName },
        })
        projectLogger.info('NameEditor', 'Backend update complete', { projectId })
      }

      toast.success('Project renamed')
      setIsEditing(false)
    } catch (error) {
      projectLogger.error('NameEditor', 'Failed to rename', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      toast.error('Failed to rename project')
    }
  }, [editedName, projectName, renameProject, projectId, updateProject])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        saveName()
      } else if (e.key === 'Escape') {
        cancelEditing()
      }
    },
    [saveName, cancelEditing]
  )

  return {
    isEditing,
    editedName,
    inputRef,
    startEditing,
    cancelEditing,
    saveName,
    setEditedName,
    handleKeyDown,
  }
}
