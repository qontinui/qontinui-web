# Conflict Resolution - Quick Start Guide

## 1. Basic Setup (5 minutes)

### Import in your component
```typescript
import { useConflictResolution } from '@/hooks/useConflictResolution'
```

### Use in component
```typescript
function WorkflowEditor({ projectId, workflowId }) {
  const {
    conflicts,
    hasConflicts,
    checkForConflicts,
    resolveConflict
  } = useConflictResolution(projectId, 'workflow', workflowId)

  const handleSave = async (changes) => {
    const result = await checkForConflicts(changes)
    if (!result.hasConflicts) {
      await saveToServer(changes)
    }
  }

  return <div>{/* Your UI */}</div>
}
```

## 2. Common Use Cases

### ✅ Auto-resolve conflicts
```typescript
const {
  conflicts,
  autoResolve
} = useConflictResolution(projectId, 'workflow', workflowId, {
  autoResolve: true  // Automatically resolve when safe
})
```

### ✅ Optimistic updates
```typescript
import { useOptimisticUpdate } from '@/hooks/useConflictResolution'

const { applyOptimistic, rollback } = useOptimisticUpdate('workflow', workflowId)

const updateAction = async (changes) => {
  applyOptimistic(changes)  // Immediate UI update
  try {
    await api.save(changes)
  } catch {
    rollback(changes.id)  // Revert on error
  }
}
```

### ✅ Offline support
```typescript
import { useOfflineQueue } from '@/hooks/useConflictResolution'

const { queueState, processQueue } = useOfflineQueue()

// Shows: "5 changes queued - Sync now?"
{queueState.pending.length > 0 && (
  <button onClick={processQueue}>
    Sync {queueState.pending.length} changes
  </button>
)}
```

### ✅ Real-time collaboration
```typescript
import { useRealtimeCollaboration } from '@/hooks/useConflictResolution'

const {
  isConnected,
  remoteChanges
} = useRealtimeCollaboration(projectId, 'workflow', workflowId)

useEffect(() => {
  remoteChanges.forEach(applyChangeToUI)
}, [remoteChanges])
```

## 3. Resolution Strategies

### Manual Conflict Resolution UI
```typescript
function ConflictModal({ conflict, onResolve }) {
  return (
    <div>
      <h3>Conflict: {conflict.type}</h3>

      <div>
        <strong>Your version:</strong>
        <pre>{JSON.stringify(conflict.localVersion, null, 2)}</pre>
      </div>

      <div>
        <strong>Their version:</strong>
        <pre>{JSON.stringify(conflict.serverVersion, null, 2)}</pre>
      </div>

      <button onClick={() => onResolve(conflict.id, 'KeepLocal')}>
        Use Mine
      </button>
      <button onClick={() => onResolve(conflict.id, 'KeepRemote')}>
        Use Theirs
      </button>
      {conflict.autoResolvable && (
        <button onClick={() => onResolve(conflict.id, 'Merge')}>
          Auto Merge
        </button>
      )}
    </div>
  )
}
```

## 4. Best Practices

### ✅ DO: Check before save
```typescript
const result = await checkForConflicts(changes)
if (result.canSave) {
  await save(changes)
}
```

### ❌ DON'T: Save without checking
```typescript
await save(changes)  // May overwrite others' work!
```

### ✅ DO: Show conflict indicators
```typescript
{hasConflicts && (
  <Alert severity="warning">
    {conflicts.length} conflicts need resolution
  </Alert>
)}
```

### ✅ DO: Handle offline gracefully
```typescript
if (!navigator.onLine) {
  queueOfflineChange(change)
  toast.success('Saved locally, will sync when online')
}
```

## 5. Configuration

### Enable all features
```typescript
useConflictResolution(projectId, resourceType, resourceId, {
  autoCheck: true,                    // Auto-check for conflicts
  autoResolve: true,                  // Auto-resolve when safe
  pollingInterval: 5000,              // Check every 5 seconds
  enableRealtimeNotifications: true   // WebSocket updates
})
```

## 6. Common Patterns

### Pattern: Save with conflict handling
```typescript
const handleSave = async (changes) => {
  setIsSaving(true)

  try {
    // 1. Check for conflicts
    const check = await checkForConflicts(changes)

    if (check.hasConflicts) {
      // 2. Try auto-resolve
      const autoResult = await autoResolve()

      if (autoResult.requiresManual.length > 0) {
        // 3. Show manual resolution UI
        setConflicts(autoResult.requiresManual)
        setShowConflictModal(true)
        return
      }
    }

    // 4. Save to server
    await api.save(changes)
    toast.success('Saved successfully')

  } catch (error) {
    toast.error('Failed to save')
  } finally {
    setIsSaving(false)
  }
}
```

### Pattern: Real-time updates
```typescript
useEffect(() => {
  syncService.connectWebSocket(projectId)

  syncService.onConflictDetected((conflict) => {
    toast.warning(`Conflict detected: ${conflict.type}`)
    setConflicts(prev => [...prev, conflict])
  })

  return () => syncService.disconnectWebSocket()
}, [projectId])
```

### Pattern: Optimistic workflow edit
```typescript
const updateWorkflowName = async (newName: string) => {
  const change = {
    id: `change-${Date.now()}`,
    type: 'update',
    resourceType: 'workflow',
    resourceId: workflowId,
    path: ['name'],
    value: newName,
    oldValue: workflow.name,
    timestamp: new Date(),
    userId: currentUser.id
  }

  // Apply immediately
  setWorkflow(prev => ({ ...prev, name: newName }))
  applyOptimistic(change)

  try {
    await api.updateWorkflow(workflowId, { name: newName })
  } catch (error) {
    // Rollback on error
    setWorkflow(prev => ({ ...prev, name: change.oldValue }))
    rollback(change.id)
    toast.error('Failed to update name')
  }
}
```

## 7. Troubleshooting

### Issue: Conflicts not detected
**Solution:** Enable auto-check or manually call `checkForConflicts`

### Issue: Optimistic update not rolling back
**Solution:** Ensure error handling calls `rollback(changeId)`

### Issue: Offline queue not processing
**Solution:** Check network connectivity and call `processQueue()`

### Issue: WebSocket not connecting
**Solution:** Verify WebSocket URL and authentication

## 8. Next Steps

1. Read full documentation: `CONFLICT_RESOLUTION.md`
2. See examples: `conflict-resolution.example.ts`
3. Run tests: `npm test conflict-resolution.test.ts`
4. Integrate into your components

## 9. Quick Reference

| Hook | Purpose |
|------|---------|
| `useConflictResolution` | Main hook for conflict handling |
| `useSyncState` | Track sync status |
| `useOptimisticUpdate` | Optimistic UI updates |
| `useOfflineQueue` | Offline queue management |
| `useRealtimeCollaboration` | Real-time updates |

| Service | Purpose |
|---------|---------|
| `conflictResolutionService` | Detect and resolve conflicts |
| `operationalTransformService` | Transform concurrent operations |
| `syncService` | Sync changes with server |

| Strategy | When to Use |
|----------|-------------|
| `KeepLocal` | Trust local changes |
| `KeepRemote` | Trust server changes |
| `Merge` | Auto-merge when safe |
| `Manual` | User decides |

## Support

For detailed information, see:
- Full documentation: `/frontend/src/services/collaboration/CONFLICT_RESOLUTION.md`
- Examples: `/frontend/src/services/collaboration/conflict-resolution.example.ts`
- Tests: `/frontend/src/services/collaboration/conflict-resolution.test.ts`
