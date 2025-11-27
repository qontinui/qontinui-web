/**
 * Optimistic Update Hook
 *
 * React hook for managing optimistic UI updates.
 * Applies changes immediately to the UI before server confirmation,
 * with rollback capability if the update fails.
 */

import { useState, useCallback, useEffect } from 'react'
import { ResourceType, UseOptimisticUpdateReturn } from './types'
import { syncService } from '../../services/collaboration/sync-service'

/**
 * Hook for optimistic updates
 *
 * @param resourceType - Type of resource (e.g., 'diagram', 'document')
 * @param resourceId - Unique identifier for the resource
 * @returns Optimistic update state and methods
 */
export function useOptimisticUpdate(
  resourceType: ResourceType,
  resourceId: string
): UseOptimisticUpdateReturn {
  const [optimisticState, setOptimisticState] = useState<any>(null)
  const [hasOptimistic, setHasOptimistic] = useState(false)

  const applyOptimistic = useCallback(
    (change: any) => {
      setOptimisticState(change)
      setHasOptimistic(true)

      syncService.applyOptimisticUpdate({
        id: `optimistic-${Date.now()}`,
        type: 'update',
        resourceType,
        resourceId,
        path: [],
        value: change,
        timestamp: new Date(),
        userId: 'current-user',
        optimistic: true
      })
    },
    [resourceType, resourceId]
  )

  const rollback = useCallback((changeId: string) => {
    syncService.rollbackOptimisticUpdate(changeId)
    setOptimisticState(null)
    setHasOptimistic(false)
  }, [])

  // Listen for rollback events
  useEffect(() => {
    const handleRollback = (event: CustomEvent) => {
      if (event.detail.changeId.startsWith('optimistic-')) {
        setOptimisticState(null)
        setHasOptimistic(false)
      }
    }

    window.addEventListener('optimistic-rollback', handleRollback as EventListener)

    return () => {
      window.removeEventListener('optimistic-rollback', handleRollback as EventListener)
    }
  }, [])

  return {
    optimisticState,
    hasOptimistic,
    applyOptimistic,
    rollback
  }
}
