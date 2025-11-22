# Conflict Resolution

Complete guide to handling edit conflicts, merge strategies, and collaborative editing best practices.

## Overview

When multiple users collaborate on projects simultaneously, conflicts can occur. Qontinui provides several mechanisms to prevent, detect, and resolve conflicts effectively.

## How Conflicts Occur

### Common Conflict Scenarios

1. **Simultaneous Edits**
   - User A and User B edit the same workflow simultaneously
   - Both try to save their changes
   - Last save would overwrite the first

2. **Network Issues**
   - User edits while offline
   - Changes queue locally
   - On reconnection, changes conflict with server state

3. **Lock Expiration**
   - User A acquires lock
   - Lock expires while editing
   - User B acquires lock and makes changes
   - User A tries to save

4. **Branch Merging**
   - Different versions of workflow exist
   - Attempting to merge incompatible changes

## Conflict Prevention

### 1. Resource Locking (Default)

```typescript
// Acquire lock before editing
const editWithLock = async (resourceId: string) => {
  try {
    // Acquire exclusive lock
    const lock = await acquireLock(projectId, 'workflow', resourceId);

    // Edit resource
    const result = await editResource(resourceId);

    return result;
  } finally {
    // Always release lock
    if (lock) {
      await releaseLock(lock.id);
    }
  }
};
```

### 2. Optimistic Locking

```typescript
// Use version numbers for conflict detection
interface VersionedResource {
  id: string;
  version: number;
  data: any;
}

const saveWithVersion = async (resource: VersionedResource) => {
  const response = await fetch(`/api/v1/resources/${resource.id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'If-Match': `"${resource.version}"` // ETag
    },
    body: JSON.stringify(resource.data)
  });

  if (response.status === 412) {
    // Precondition failed - version mismatch
    throw new ConflictError('Resource was modified by another user');
  }

  return await response.json();
};
```

### 3. Auto-Save with Throttling

```typescript
import { useDebounce } from '@/hooks/use-debounce';

export function AutoSaveWorkflow({ workflow }: { workflow: Workflow }) {
  const [localWorkflow, setLocalWorkflow] = useState(workflow);
  const debouncedWorkflow = useDebounce(localWorkflow, 2000);

  useEffect(() => {
    // Auto-save after 2 seconds of inactivity
    if (debouncedWorkflow !== workflow) {
      saveWorkflow(debouncedWorkflow)
        .catch(error => {
          if (error instanceof ConflictError) {
            handleConflict(error);
          }
        });
    }
  }, [debouncedWorkflow]);

  return (
    <WorkflowEditor
      value={localWorkflow}
      onChange={setLocalWorkflow}
    />
  );
}
```

## Conflict Detection

### Detecting Conflicts

```typescript
class ConflictDetector {
  /**
   * Check if resource has been modified since last fetch
   */
  static async checkForConflicts(
    resourceId: string,
    localVersion: number
  ): Promise<boolean> {
    const response = await fetch(`/api/v1/resources/${resourceId}/version`);
    const { version: serverVersion } = await response.json();

    return serverVersion !== localVersion;
  }

  /**
   * Get conflicting changes
   */
  static async getConflictingChanges(
    resourceId: string,
    localData: any,
    localVersion: number
  ): Promise<ConflictInfo> {
    const response = await fetch(`/api/v1/resources/${resourceId}/conflicts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        local_data: localData,
        local_version: localVersion
      })
    });

    return await response.json();
  }
}

interface ConflictInfo {
  has_conflict: boolean;
  server_version: number;
  local_version: number;
  conflicting_fields: string[];
  server_data: any;
  local_data: any;
  merge_suggestions?: any;
}
```

## Resolution Strategies

### 1. Last-Write-Wins (Simple)

```typescript
// Simplest but can lose data
const saveLastWriteWins = async (resource: any) => {
  // No conflict checking - last save wins
  return await fetch(`/api/v1/resources/${resource.id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resource)
  });
};
```

**Pros:** Simple, no user intervention needed
**Cons:** Can lose data, not suitable for collaborative editing

### 2. First-Write-Wins (Safe)

```typescript
// Reject later saves if resource was modified
const saveFirstWriteWins = async (resource: VersionedResource) => {
  try {
    return await saveWithVersion(resource);
  } catch (error) {
    if (error instanceof ConflictError) {
      // Notify user and reload latest version
      toast.error('Resource was modified by another user. Please refresh.');
      throw error;
    }
    throw error;
  }
};
```

**Pros:** Prevents data loss, safe
**Cons:** Frustrating for second user, may lose their work

### 3. Three-Way Merge (Advanced)

```typescript
/**
 * Perform three-way merge
 *
 * @param base - Common ancestor version
 * @param local - User's local changes
 * @param remote - Server's current version
 */
function threeWayMerge<T>(base: T, local: T, remote: T): MergeResult<T> {
  const conflicts: Conflict[] = [];
  const merged: any = { ...base };

  // Get all unique keys
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote)
  ]);

  for (const key of allKeys) {
    const baseValue = base[key];
    const localValue = local[key];
    const remoteValue = remote[key];

    // No changes
    if (deepEqual(localValue, remoteValue)) {
      merged[key] = localValue;
      continue;
    }

    // Only local changed
    if (deepEqual(baseValue, remoteValue)) {
      merged[key] = localValue;
      continue;
    }

    // Only remote changed
    if (deepEqual(baseValue, localValue)) {
      merged[key] = remoteValue;
      continue;
    }

    // Both changed - conflict!
    conflicts.push({
      field: key,
      base: baseValue,
      local: localValue,
      remote: remoteValue
    });

    // Default to remote for now
    merged[key] = remoteValue;
  }

  return {
    merged,
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}

interface MergeResult<T> {
  merged: T;
  conflicts: Conflict[];
  hasConflicts: boolean;
}

interface Conflict {
  field: string;
  base: any;
  local: any;
  remote: any;
}
```

### 4. Manual Resolution (User Choice)

```typescript
export function ConflictResolutionDialog({
  conflict,
  onResolve
}: {
  conflict: ConflictInfo;
  onResolve: (resolved: any) => void;
}) {
  const [resolution, setResolution] = useState<'local' | 'remote' | 'manual'>('manual');
  const [manualData, setManualData] = useState(conflict.local_data);

  const handleResolve = () => {
    let resolvedData;

    switch (resolution) {
      case 'local':
        resolvedData = conflict.local_data;
        break;
      case 'remote':
        resolvedData = conflict.server_data;
        break;
      case 'manual':
        resolvedData = manualData;
        break;
    }

    onResolve(resolvedData);
  };

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve Conflict</DialogTitle>
          <DialogDescription>
            This resource was modified by another user while you were editing.
            Choose how to resolve the conflict.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={resolution} onValueChange={setResolution}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="local" id="local" />
              <Label htmlFor="local">
                Keep my changes
                <div className="text-sm text-muted-foreground">
                  Overwrite server version with your local changes
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <RadioGroupItem value="remote" id="remote" />
              <Label htmlFor="remote">
                Use server version
                <div className="text-sm text-muted-foreground">
                  Discard your changes and use the latest server version
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="manual" />
              <Label htmlFor="manual">
                Merge manually
                <div className="text-sm text-muted-foreground">
                  Manually combine changes from both versions
                </div>
              </Label>
            </div>
          </RadioGroup>

          {resolution === 'manual' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2">Your Changes</h4>
                <DiffViewer
                  oldValue={conflict.server_data}
                  newValue={conflict.local_data}
                />
              </div>
              <div>
                <h4 className="font-medium mb-2">Merged Result</h4>
                <CodeEditor
                  value={manualData}
                  onChange={setManualData}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve(null)}>
            Cancel
          </Button>
          <Button onClick={handleResolve}>
            Resolve Conflict
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

## Merge Conflicts

### Automatic Field-Level Merging

```typescript
/**
 * Auto-merge non-conflicting fields
 */
function autoMerge(base: any, local: any, remote: any): {
  merged: any;
  conflicts: string[];
} {
  const merged: any = {};
  const conflicts: string[] = [];

  const allKeys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(local || {}),
    ...Object.keys(remote || {})
  ]);

  for (const key of allKeys) {
    const baseVal = base?.[key];
    const localVal = local?.[key];
    const remoteVal = remote?.[key];

    // Array handling
    if (Array.isArray(baseVal) || Array.isArray(localVal) || Array.isArray(remoteVal)) {
      const arrayMerge = mergeArrays(baseVal || [], localVal || [], remoteVal || []);
      if (arrayMerge.hasConflict) {
        conflicts.push(key);
        merged[key] = arrayMerge.result; // Use heuristic merge
      } else {
        merged[key] = arrayMerge.result;
      }
      continue;
    }

    // Object handling
    if (isObject(localVal) || isObject(remoteVal)) {
      const objectMerge = autoMerge(baseVal || {}, localVal || {}, remoteVal || {});
      if (objectMerge.conflicts.length > 0) {
        conflicts.push(key);
      }
      merged[key] = objectMerge.merged;
      continue;
    }

    // Primitive handling
    if (localVal === remoteVal) {
      merged[key] = localVal;
    } else if (baseVal === remoteVal) {
      merged[key] = localVal; // Only local changed
    } else if (baseVal === localVal) {
      merged[key] = remoteVal; // Only remote changed
    } else {
      // Both changed differently - conflict
      conflicts.push(key);
      merged[key] = remoteVal; // Default to remote
    }
  }

  return { merged, conflicts };
}
```

## Best Practices

### 1. Communicate Before Editing

```typescript
// Announce editing intention
const announceEditing = (resourceId: string) => {
  ws.send({
    type: 'presence:update',
    status: 'editing',
    resource_id: resourceId
  });
};

// Show warning if someone else is viewing
export function EditWarning({ resourceId }: { resourceId: string }) {
  const { activeUsers } = usePresence(projectId);
  const viewingUsers = activeUsers.filter(
    u => u.current_resource?.id === resourceId && u.id !== currentUser.id
  );

  if (viewingUsers.length === 0) return null;

  return (
    <Alert variant="warning">
      <AlertDescription>
        {viewingUsers.map(u => u.username).join(', ')} {viewingUsers.length === 1 ? 'is' : 'are'} currently viewing this resource.
        Consider coordinating before making changes.
      </AlertDescription>
    </Alert>
  );
}
```

### 2. Frequent Saves

```typescript
// Save frequently to reduce conflict window
const AUTOSAVE_INTERVAL = 30000; // 30 seconds

useEffect(() => {
  const interval = setInterval(() => {
    if (hasUnsavedChanges) {
      saveChanges().catch(handleSaveError);
    }
  }, AUTOSAVE_INTERVAL);

  return () => clearInterval(interval);
}, [hasUnsavedChanges]);
```

### 3. Use Version Control Features

```typescript
// Create savepoint before major changes
const createSavepoint = async (workflowId: string, description: string) => {
  return await workflowVersionControl.createVersion({
    workflow_id: workflowId,
    description,
    tag: `savepoint-${Date.now()}`
  });
};

// Rollback if needed
const rollbackToSavepoint = async (workflowId: string, versionId: string) => {
  return await workflowVersionControl.rollback(workflowId, versionId);
};
```

### 4. Conflict Prevention Checklist

- ✓ Enable resource locking for critical resources
- ✓ Use presence indicators to see who's editing
- ✓ Communicate with team before major changes
- ✓ Save frequently to minimize conflict window
- ✓ Use version control for rollback capability
- ✓ Test conflict resolution in development
- ✓ Train team on conflict resolution procedures

## Related Documentation

- [Real-Time Sync](./real-time-sync.md) - Locking and presence
- [Developer Guide](./developer-guide.md) - Implementing conflict resolution
- [API Reference](./api-reference.md) - Conflict resolution APIs

---

**Last Updated:** 2025-01-14
