/**
 * Realtime Collaboration Hook
 *
 * React hook for managing WebSocket-based real-time collaboration.
 * Handles WebSocket connections and real-time change synchronization.
 */

import { useState, useCallback, useEffect } from 'react'
import { ResourceType, UseRealtimeCollaborationReturn } from './types'
import { syncService } from '../../services/collaboration/sync-service'

/**
 * Hook for real-time collaboration
 *
 * @param projectId - The project ID
 * @param resourceType - Type of resource (e.g., 'diagram', 'document')
 * @param resourceId - Unique identifier for the resource
 * @returns Real-time collaboration state and methods
 */
export function useRealtimeCollaboration(
  projectId: string,
  resourceType: ResourceType,
  resourceId: string
): UseRealtimeCollaborationReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [remoteChanges, setRemoteChanges] = useState<any[]>([])

  useEffect(() => {
    // Connect to WebSocket
    syncService.connectWebSocket(projectId)
    setIsConnected(true)

    // Listen for remote changes
    const handleRemoteChange = (event: CustomEvent) => {
      if (
        event.detail.resourceType === resourceType &&
        event.detail.resourceId === resourceId
      ) {
        setRemoteChanges(prev => [...prev, event.detail.change])
      }
    }

    window.addEventListener('remote-change', handleRemoteChange as EventListener)

    return () => {
      syncService.disconnectWebSocket()
      setIsConnected(false)
      window.removeEventListener('remote-change', handleRemoteChange as EventListener)
    }
  }, [projectId, resourceType, resourceId])

  const clearRemoteChanges = useCallback(() => {
    setRemoteChanges([])
  }, [])

  return {
    isConnected,
    remoteChanges,
    clearRemoteChanges
  }
}
