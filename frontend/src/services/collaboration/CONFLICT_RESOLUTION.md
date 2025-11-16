# Conflict Resolution and Synchronization

Advanced conflict resolution and synchronization system for collaborative editing in qontinui-web.

## Overview

This system provides comprehensive conflict detection, resolution, and synchronization capabilities for collaborative editing of workflows, states, images, and transitions. It implements:

- **Three-way merge algorithm** for intelligent conflict resolution
- **Operational Transformation (OT)** for concurrent edits
- **Optimistic updates** with automatic rollback
- **Offline support** with sync queue
- **Real-time synchronization** via WebSocket
- **Automatic conflict resolution** when possible

## Architecture

### Core Components

1. **ConflictDetector** - Detects conflicts between versions
2. **ConflictResolutionService** - Manages conflict resolution
3. **OperationalTransformService** - Transforms concurrent operations
4. **SyncService** - Handles real-time synchronization
5. **useConflictResolution** - React hook for components

## Usage

### Basic Conflict Resolution

```typescript
import { useConflictResolution } from '@/hooks/useConflictResolution'

function WorkflowEditor({ projectId, workflowId }) {
  const {
    conflicts,
    hasConflicts,
    checkForConflicts,
    resolveConflict,
    autoResolve
  } = useConflictResolution(projectId, 'workflow', workflowId, {
    autoResolve: true,
    enableRealtimeNotifications: true
  })

  const handleSave = async (localChanges) => {
    // Check for conflicts before saving
    const result = await checkForConflicts(localChanges)

    if (result.hasConflicts) {
      // Try auto-resolve
      const autoResult = await autoResolve()

      if (autoResult.requiresManual.length > 0) {
        // Show conflict resolution UI
        setShowConflictModal(true)
      }
    } else {
      // No conflicts, safe to save
      await saveWorkflow(localChanges)
    }
  }

  const handleResolveConflict = async (conflictId, strategy) => {
    await resolveConflict(conflictId, strategy)
    // Conflict resolved, continue with save
  }

  return (
    <div>
      {hasConflicts && (
        <ConflictBanner
          conflicts={conflicts}
          onResolve={handleResolveConflict}
        />
      )}
      {/* Rest of editor */}
    </div>
  )
}
```

### Optimistic Updates

```typescript
import { useOptimisticUpdate } from '@/hooks/useConflictResolution'

function ActionEditor({ workflowId, actionId }) {
  const { applyOptimistic, hasOptimistic, rollback } = useOptimisticUpdate(
    'workflow',
    workflowId
  )

  const updateAction = async (changes) => {
    // Apply optimistically
    applyOptimistic(changes)

    try {
      // Send to server
      await api.updateAction(actionId, changes)
    } catch (error) {
      // Rollback on error
      rollback(`optimistic-${actionId}`)
    }
  }

  return <div>{/* Editor UI */}</div>
}
```

### Real-time Collaboration

```typescript
import { useRealtimeCollaboration } from '@/hooks/useConflictResolution'

function CollaborativeCanvas({ projectId, workflowId }) {
  const {
    isConnected,
    remoteChanges,
    clearRemoteChanges
  } = useRealtimeCollaboration(projectId, 'workflow', workflowId)

  useEffect(() => {
    if (remoteChanges.length > 0) {
      // Apply remote changes to canvas
      remoteChanges.forEach(change => {
        applyChangeToCanvas(change)
      })
      clearRemoteChanges()
    }
  }, [remoteChanges])

  return (
    <div>
      {isConnected && <OnlineIndicator />}
      {/* Canvas */}
    </div>
  )
}
```

### Offline Queue Management

```typescript
import { useOfflineQueue } from '@/hooks/useConflictResolution'

function OfflineIndicator() {
  const { queueState, isProcessing, processQueue, clearQueue } = useOfflineQueue()

  return (
    <div>
      {queueState.pending.length > 0 && (
        <div>
          {queueState.pending.length} changes queued
          <button onClick={processQueue} disabled={isProcessing}>
            {isProcessing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}
    </div>
  )
}
```

## Conflict Types

### ActionModified
Both users modified the same action.

**Resolution Strategies:**
- `KeepLocal` - Use your changes
- `KeepRemote` - Use their changes
- `Merge` - Attempt automatic merge
- `Manual` - Review and choose

### ActionRemoved
One user removed an action while another modified it.

**Resolution Strategies:**
- `KeepLocal` - Restore the action with your changes
- `KeepRemote` - Keep it deleted
- `Manual` - Review the situation

### PropertyChanged
Both users changed the same property.

**Resolution Strategies:**
- `KeepLocal` - Use your value
- `KeepRemote` - Use their value
- `Merge` - Intelligent merge (e.g., numeric values add deltas)

### ConnectionChanged
Both users modified connections differently.

**Resolution Strategies:**
- `KeepLocal` - Use your connections
- `KeepRemote` - Use their connections
- `Manual` - Review and choose

### StructureChanged
Significant structural changes to the workflow.

**Resolution Strategies:**
- Usually requires `Manual` resolution

## Operational Transformation

The system uses Operational Transformation to handle concurrent edits:

### Operation Types

```typescript
// Insert - Add action/node
{
  type: 'insert',
  path: ['actions'],
  value: newAction,
  position: 5
}

// Delete - Remove action/node
{
  type: 'delete',
  path: ['actions'],
  position: 3
}

// Update - Modify properties
{
  type: 'update',
  path: ['actions', '123', 'name'],
  value: 'New Name',
  oldValue: 'Old Name'
}

// Move - Change position
{
  type: 'move',
  path: ['actions'],
  position: 2,
  newPosition: 5
}

// Connect - Add connection
{
  type: 'connect',
  sourceId: 'action-1',
  targetId: 'action-2',
  value: { type: 'success' }
}

// Disconnect - Remove connection
{
  type: 'disconnect',
  sourceId: 'action-1',
  targetId: 'action-2'
}
```

### Transform Example

```typescript
import { operationalTransformService } from '@/services/collaboration'

// Two users make concurrent edits
const op1 = {
  type: 'update',
  path: ['actions', '123', 'name'],
  value: 'User 1 Name'
}

const op2 = {
  type: 'update',
  path: ['actions', '456', 'name'],
  value: 'User 2 Name'
}

// Transform them against each other
const [op1Prime, op2Prime] = operationalTransformService.transform(op1, op2)

// Apply both operations
const result1 = operationalTransformService.apply(document, op1Prime)
const result2 = operationalTransformService.apply(result1, op2Prime)
```

## Three-Way Merge

The system performs intelligent three-way merges:

```typescript
import { conflictResolutionService } from '@/services/collaboration'

const detector = conflictResolutionService.getDetector()

const mergeResult = detector.threeWayMerge(
  localVersion,   // Your changes
  remoteVersion,  // Their changes
  baseVersion     // Common ancestor
)

if (mergeResult.success) {
  // Merge successful, use mergedVersion
  await saveWorkflow(mergeResult.mergedVersion)
} else {
  // Conflicts require manual resolution
  setConflicts(mergeResult.conflicts)
}
```

## Sync Service Configuration

```typescript
import { SyncService } from '@/services/collaboration'

const syncService = new SyncService({
  wsUrl: 'ws://localhost:8000/ws',
  syncInterval: 5000,        // Poll every 5 seconds
  maxRetries: 3,             // Retry failed syncs 3 times
  retryDelay: 1000,          // Wait 1 second between retries
  enableOptimisticUpdates: true,
  enableOfflineQueue: true,
  maxQueueSize: 100          // Max 100 operations in queue
})

// Connect to real-time updates
syncService.connectWebSocket(projectId)

// Listen for conflicts
syncService.onConflictDetected((conflict) => {
  console.log('Conflict detected:', conflict)
  // Show notification to user
})
```

## Advanced Features

### Custom Conflict Detection

```typescript
import { ConflictDetector } from '@/services/collaboration'

const detector = new ConflictDetector({
  detectPropertyChanges: true,
  detectStructuralChanges: true,
  minimumSeverity: 'medium',
  customRules: [
    // Custom rule for workflow name conflicts
    (local, remote, base) => {
      if (local.name !== remote.name && local.name !== base.name && remote.name !== base.name) {
        return {
          id: 'custom-name-conflict',
          type: 'PropertyChanged',
          resourceType: 'workflow',
          path: ['name'],
          localVersion: local.name,
          serverVersion: remote.name,
          baseVersion: base.name,
          severity: 'high',
          autoResolvable: false
        }
      }
      return null
    }
  ]
})
```

### Manual Conflict Resolution UI

```typescript
function ConflictResolutionModal({ conflict, onResolve }) {
  const [strategy, setStrategy] = useState<ResolutionStrategy>('Manual')
  const [preview, setPreview] = useState(null)

  const handlePreview = async (strat: ResolutionStrategy) => {
    const details = await conflictResolutionService.getConflictDetails(conflict.id)
    setPreview(details.strategyPreviews[strat])
    setStrategy(strat)
  }

  const handleResolve = async () => {
    await onResolve(conflict.id, strategy, preview)
  }

  return (
    <Modal>
      <h2>Conflict Detected</h2>
      <p>{conflict.description}</p>

      <div className="conflict-sides">
        <div>
          <h3>Your Version</h3>
          <pre>{JSON.stringify(conflict.localVersion, null, 2)}</pre>
        </div>
        <div>
          <h3>Their Version</h3>
          <pre>{JSON.stringify(conflict.serverVersion, null, 2)}</pre>
        </div>
      </div>

      <div className="strategies">
        <button onClick={() => handlePreview('KeepLocal')}>
          Use My Version
        </button>
        <button onClick={() => handlePreview('KeepRemote')}>
          Use Their Version
        </button>
        {conflict.autoResolvable && (
          <button onClick={() => handlePreview('Merge')}>
            Auto Merge
          </button>
        )}
      </div>

      {preview && (
        <div>
          <h3>Preview</h3>
          <pre>{JSON.stringify(preview, null, 2)}</pre>
        </div>
      )}

      <button onClick={handleResolve}>Resolve</button>
    </Modal>
  )
}
```

## Best Practices

### 1. Always Check Before Save

```typescript
const handleSave = async (changes) => {
  const result = await checkForConflicts(changes)

  if (result.hasConflicts && !result.canSave) {
    // Must resolve conflicts first
    return
  }

  await save(changes)
}
```

### 2. Use Optimistic Updates for Better UX

```typescript
// Apply change immediately in UI
applyOptimistic(change)

// Send to server asynchronously
saveToServer(change).catch(() => {
  // Rollback on error
  rollback(change.id)
})
```

### 3. Handle Offline Gracefully

```typescript
// Queue changes when offline
if (!navigator.onLine) {
  queueOfflineChange(change)
  showNotification('Change saved locally, will sync when online')
  return
}

// Normal save when online
await saveToServer(change)
```

### 4. Provide Visual Feedback

```typescript
function CollaborationIndicators() {
  const { hasConflicts, conflicts } = useConflictResolution(...)
  const { isConnected } = useRealtimeCollaboration(...)
  const { queueState } = useOfflineQueue()

  return (
    <div className="indicators">
      {!isConnected && <OfflineIcon />}
      {hasConflicts && <ConflictIcon count={conflicts.length} />}
      {queueState.pending.length > 0 && (
        <QueueIcon count={queueState.pending.length} />
      )}
    </div>
  )
}
```

### 5. Auto-Resolve When Safe

```typescript
useConflictResolution(projectId, resourceType, resourceId, {
  autoResolve: true,  // Enable auto-resolution
  autoCheck: true,    // Automatically check for conflicts
  enableRealtimeNotifications: true  // Get real-time conflict alerts
})
```

## Troubleshooting

### Conflicts Not Detected

- Ensure `autoCheck` is enabled or manually call `checkForConflicts`
- Verify WebSocket connection is established
- Check that base version is being tracked correctly

### Optimistic Updates Not Rolling Back

- Verify error handling is catching failures
- Check that rollback is being called with correct ID
- Ensure event listeners are properly set up

### Offline Queue Not Processing

- Check network connectivity
- Verify sync interval is set correctly
- Look for errors in queue processing
- Check that queue isn't full (maxQueueSize)

### Merge Conflicts

- Review the three-way merge algorithm
- Consider if custom conflict detection rules are needed
- Check if conflict severity is set appropriately
- Verify that auto-resolvable flag is correct

## API Reference

See the TypeScript definitions in:
- `/frontend/src/types/collaboration/conflict-types.ts`
- `/frontend/src/services/collaboration/conflict-resolution-service.ts`
- `/frontend/src/services/collaboration/sync-service.ts`
- `/frontend/src/services/collaboration/operational-transform-service.ts`

## Testing

```typescript
import { conflictResolutionService } from '@/services/collaboration'

describe('Conflict Resolution', () => {
  it('detects property conflicts', async () => {
    const detector = conflictResolutionService.getDetector()

    const conflicts = detector.detectConflicts(
      { name: 'Local' },
      { name: 'Remote' },
      { name: 'Base' }
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('PropertyChanged')
  })

  it('auto-resolves numeric conflicts', async () => {
    const detector = conflictResolutionService.getDetector()

    const conflict = {
      type: 'PropertyChanged',
      localVersion: 15,   // base + 5
      serverVersion: 12,  // base + 2
      baseVersion: 10
    }

    const resolved = detector.resolveConflict(conflict, 'Merge')
    expect(resolved).toBe(17) // base + 5 + 2
  })
})
```

## Performance Considerations

- Conflict detection is O(n) where n is the size of the document
- Operational transformation is O(1) per operation pair
- Offline queue is processed in priority order
- WebSocket messages are handled asynchronously
- Consider debouncing frequent updates to reduce conflict checks

## Security

- All conflict resolution happens client-side
- Server validates final merged versions
- User permissions are checked before applying changes
- WebSocket connections use authentication tokens
- Offline queue is stored in localStorage (consider encryption for sensitive data)
