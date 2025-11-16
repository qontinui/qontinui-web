# Real-Time Synchronization

Complete guide to real-time collaboration features including live updates, presence indicators, and conflict prevention.

## Overview

Qontinui's real-time synchronization enables multiple users to collaborate simultaneously on automation projects with live updates, presence awareness, and automatic conflict prevention through resource locking.

## Table of Contents

- [How It Works](#how-it-works)
- [Presence Indicators](#presence-indicators)
- [Resource Locking](#resource-locking)
- [WebSocket Connection](#websocket-connection)
- [Live Updates](#live-updates)
- [Conflict Prevention](#conflict-prevention)
- [Offline Support](#offline-support)
- [Best Practices](#best-practices)

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────┐
│         Client A (User 1)               │
│  ┌──────────────────────────────────┐   │
│  │  React UI                        │   │
│  │  - Workflow Canvas               │   │
│  │  - Presence Indicators           │   │
│  │  - Lock UI                       │   │
│  └──────────────────────────────────┘   │
│           ↕ WebSocket                   │
└─────────────────────────────────────────┘
                 ↕
┌─────────────────────────────────────────┐
│      WebSocket Server (Backend)         │
│  ┌──────────────────────────────────┐   │
│  │  Connection Manager              │   │
│  │  - User presence tracking        │   │
│  │  - Event broadcasting            │   │
│  │  - Lock management               │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
                 ↕
┌─────────────────────────────────────────┐
│         Client B (User 2)               │
│  ┌──────────────────────────────────┐   │
│  │  React UI                        │   │
│  │  - Workflow Canvas               │   │
│  │  - Presence Indicators           │   │
│  │  - Lock UI                       │   │
│  └──────────────────────────────────┘   │
│           ↕ WebSocket                   │
└─────────────────────────────────────────┘
```

### Event Flow

1. **User Action**: User A edits a workflow
2. **Acquire Lock**: Client requests lock on resource
3. **Lock Granted**: Server grants lock and broadcasts to others
4. **Update UI**: All clients show User A is editing
5. **Edit Complete**: User A saves changes
6. **Release Lock**: Lock is released
7. **Broadcast Changes**: Changes sent to all collaborators
8. **Update All Clients**: All clients receive and apply updates

## Presence Indicators

### Viewing Active Users

Real-time presence shows who's currently viewing or editing the project.

```typescript
// Subscribe to presence updates
import { usePresence } from '@/hooks/use-presence';

export function ProjectPresence({ projectId }: { projectId: number }) {
  const { activeUsers, myStatus } = usePresence(projectId);

  return (
    <div className="flex items-center gap-2">
      {activeUsers.map(user => (
        <div
          key={user.id}
          className="relative"
          title={`${user.username} - ${user.status}`}
        >
          <Avatar user={user} />
          <StatusIndicator status={user.status} />
        </div>
      ))}
      <span className="text-sm text-muted-foreground">
        {activeUsers.length} active
      </span>
    </div>
  );
}
```

### User Status Types

```typescript
type UserStatus =
  | 'viewing'    // Viewing the project
  | 'editing'    // Actively editing
  | 'idle'       // Inactive for > 5 minutes
  | 'offline';   // Disconnected

interface PresenceUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string;
  status: UserStatus;
  current_resource?: {
    type: 'workflow' | 'state' | 'image' | 'transition';
    id: string;
    name: string;
  };
  last_active: string;
}
```

### Presence Hook Implementation

```typescript
// Custom hook for presence management
export function usePresence(projectId: number) {
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [myStatus, setMyStatus] = useState<UserStatus>('viewing');
  const ws = useWebSocket();

  useEffect(() => {
    // Join presence channel
    ws.send({
      type: 'presence:join',
      project_id: projectId
    });

    // Listen for presence updates
    const handlePresence = (event: any) => {
      if (event.type === 'presence:update') {
        setActiveUsers(event.users);
      }
    };

    ws.on('message', handlePresence);

    // Update my status periodically
    const interval = setInterval(() => {
      ws.send({
        type: 'presence:update',
        project_id: projectId,
        status: myStatus
      });
    }, 30000); // Every 30 seconds

    return () => {
      ws.off('message', handlePresence);
      clearInterval(interval);
      ws.send({
        type: 'presence:leave',
        project_id: projectId
      });
    };
  }, [projectId, myStatus]);

  return { activeUsers, myStatus, setMyStatus };
}
```

## Resource Locking

### Lock Mechanism

Prevents concurrent edits by allowing only one user to edit a resource at a time.

```typescript
// Acquire lock on a resource
const acquireLock = async (
  projectId: number,
  resourceType: 'workflow' | 'state' | 'image' | 'transition',
  resourceId: string
) => {
  const response = await fetch('/api/v1/locks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id: projectId,
      resource_type: resourceType,
      resource_id: resourceId,
      duration: 300 // 5 minutes in seconds
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to acquire lock');
  }

  return await response.json();
};
```

### Lock Types

**Exclusive Lock**
- Only one user can hold the lock
- Others must wait until lock is released
- Default lock type

**Optimistic Lock**
- Multiple users can edit
- Conflicts detected on save
- Users resolve conflicts manually

### Lock Management

```typescript
// Lock state interface
interface ResourceLock {
  id: string;
  project_id: number;
  user_id: string;
  resource_type: string;
  resource_id: string;
  acquired_at: string;
  expires_at: string;
  auto_release: boolean;
  user: {
    username: string;
    full_name: string;
    avatar_url?: string;
  };
}

// Check if resource is locked
const checkLock = async (
  projectId: number,
  resourceType: string,
  resourceId: string
): Promise<ResourceLock | null> => {
  const response = await fetch(
    `/api/v1/locks?project_id=${projectId}&resource_type=${resourceType}&resource_id=${resourceId}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );

  const locks = await response.json();
  return locks.length > 0 ? locks[0] : null;
};

// Release lock
const releaseLock = async (lockId: string) => {
  await fetch(`/api/v1/locks/${lockId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
};

// Extend lock duration
const extendLock = async (lockId: string, additionalMinutes: number = 5) => {
  const response = await fetch(`/api/v1/locks/${lockId}/extend`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      additional_minutes: additionalMinutes
    })
  });

  return await response.json();
};
```

### Lock UI Component

```typescript
export function ResourceLockIndicator({
  projectId,
  resourceType,
  resourceId,
  onLockAcquired,
  onLockReleased
}: {
  projectId: number;
  resourceType: string;
  resourceId: string;
  onLockAcquired: () => void;
  onLockReleased: () => void;
}) {
  const [lock, setLock] = useState<ResourceLock | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check for existing lock
    checkLock(projectId, resourceType, resourceId).then(setLock);

    // Subscribe to lock updates via WebSocket
    const handleLockUpdate = (event: any) => {
      if (
        event.type === 'lock:acquired' &&
        event.resource_id === resourceId
      ) {
        setLock(event.lock);
      } else if (
        event.type === 'lock:released' &&
        event.resource_id === resourceId
      ) {
        setLock(null);
      }
    };

    ws.on('message', handleLockUpdate);
    return () => ws.off('message', handleLockUpdate);
  }, [projectId, resourceType, resourceId]);

  const handleAcquireLock = async () => {
    setLoading(true);
    try {
      const newLock = await acquireLock(projectId, resourceType, resourceId);
      setLock(newLock);
      onLockAcquired();
      toast.success('Lock acquired');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReleaseLock = async () => {
    if (!lock) return;
    setLoading(true);
    try {
      await releaseLock(lock.id);
      setLock(null);
      onLockReleased();
      toast.success('Lock released');
    } catch (error) {
      toast.error('Failed to release lock');
    } finally {
      setLoading(false);
    }
  };

  if (!lock) {
    return (
      <Button onClick={handleAcquireLock} disabled={loading}>
        Start Editing
      </Button>
    );
  }

  const isMyLock = lock.user_id === currentUser.id;

  if (isMyLock) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="success">You're editing</Badge>
        <Button onClick={handleReleaseLock} disabled={loading}>
          Done Editing
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-orange-600">
      <Lock className="w-4 h-4" />
      <span>
        {lock.user.full_name || lock.user.username} is editing
      </span>
      <span className="text-xs text-muted-foreground">
        Lock expires in {getTimeUntil(lock.expires_at)}
      </span>
    </div>
  );
}
```

## WebSocket Connection

### Connection Setup

```typescript
import { ExecutionWebSocket } from '@/services/execution-websocket';

// Create WebSocket connection for project collaboration
export function createCollaborationWebSocket(
  projectId: number,
  accessToken: string
) {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';

  const ws = new ExecutionWebSocket(
    {
      url: `${wsUrl}/ws/projects/${projectId}`,
      authToken: accessToken,
      autoReconnect: true,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000, // 30 seconds
    },
    {
      onConnect: () => {
        console.log('Connected to collaboration server');
      },
      onDisconnect: (reason) => {
        console.log('Disconnected:', reason);
      },
      onMessage: (event) => {
        handleCollaborationEvent(event);
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
      },
      onStateChange: (state) => {
        console.log('Connection state:', state);
      }
    }
  );

  return ws;
}
```

### Event Types

```typescript
// Collaboration event types
type CollaborationEvent =
  | PresenceEvent
  | LockEvent
  | UpdateEvent
  | CommentEvent;

interface PresenceEvent {
  type: 'presence:join' | 'presence:leave' | 'presence:update';
  user: PresenceUser;
  project_id: number;
}

interface LockEvent {
  type: 'lock:acquired' | 'lock:released' | 'lock:expired';
  lock: ResourceLock;
  project_id: number;
  resource_type: string;
  resource_id: string;
}

interface UpdateEvent {
  type: 'resource:created' | 'resource:updated' | 'resource:deleted';
  project_id: number;
  resource_type: string;
  resource_id: string;
  changes: any;
  user: {
    id: string;
    username: string;
  };
}

interface CommentEvent {
  type: 'comment:created' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: ProjectComment;
  project_id: number;
}
```

### Handling Events

```typescript
function handleCollaborationEvent(event: CollaborationEvent) {
  switch (event.type) {
    case 'presence:join':
    case 'presence:leave':
    case 'presence:update':
      updatePresenceUI(event);
      break;

    case 'lock:acquired':
    case 'lock:released':
    case 'lock:expired':
      updateLockUI(event);
      break;

    case 'resource:created':
    case 'resource:updated':
    case 'resource:deleted':
      updateResourceUI(event);
      break;

    case 'comment:created':
    case 'comment:updated':
    case 'comment:deleted':
    case 'comment:resolved':
      updateCommentsUI(event);
      break;

    default:
      console.warn('Unknown event type:', event);
  }
}
```

## Live Updates

### Broadcasting Changes

```typescript
// Broadcast resource update to all collaborators
const broadcastUpdate = async (
  projectId: number,
  resourceType: string,
  resourceId: string,
  changes: any
) => {
  ws.send({
    type: 'resource:updated',
    project_id: projectId,
    resource_type: resourceType,
    resource_id: resourceId,
    changes
  });
};

// Example: Broadcasting workflow update
const saveWorkflow = async (workflow: Workflow) => {
  // Save to backend
  await workflowService.update(workflow.id, workflow);

  // Broadcast to collaborators
  await broadcastUpdate(
    workflow.project_id,
    'workflow',
    workflow.id,
    {
      name: workflow.name,
      description: workflow.description,
      actions: workflow.actions
    }
  );
};
```

### Receiving Updates

```typescript
// Listen for resource updates
useEffect(() => {
  const handleUpdate = (event: UpdateEvent) => {
    if (event.resource_type === 'workflow') {
      // Merge changes into local state
      setWorkflows(prev =>
        prev.map(w =>
          w.id === event.resource_id
            ? { ...w, ...event.changes }
            : w
        )
      );

      // Show notification
      toast.info(
        `${event.user.username} updated ${event.changes.name || 'workflow'}`
      );
    }
  };

  ws.on('message', handleUpdate);
  return () => ws.off('message', handleUpdate);
}, []);
```

## Conflict Prevention

### Strategies

**1. Optimistic Locking**
```typescript
// Track version for optimistic locking
interface VersionedResource {
  id: string;
  version: number;
  data: any;
}

const updateWithVersion = async (resource: VersionedResource) => {
  const response = await fetch(`/api/v1/resources/${resource.id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'If-Match': `${resource.version}` // Version check
    },
    body: JSON.stringify(resource.data)
  });

  if (response.status === 412) {
    // Precondition failed - resource was modified
    throw new Error('Resource was modified by another user');
  }

  return await response.json();
};
```

**2. Pessimistic Locking (Default)**
```typescript
// Acquire lock before editing
const editResource = async (resourceId: string) => {
  // Acquire lock
  const lock = await acquireLock(projectId, 'workflow', resourceId);

  try {
    // Edit resource
    const updated = await updateResource(resourceId, changes);
    return updated;
  } finally {
    // Always release lock
    await releaseLock(lock.id);
  }
};
```

**3. Last-Write-Wins**
```typescript
// Simple but may lose data
const simpleUpdate = async (resourceId: string, data: any) => {
  // No conflict checking - last update wins
  return await fetch(`/api/v1/resources/${resourceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });
};
```

### Handling Lock Conflicts

```typescript
// Attempt to acquire lock with retry
const acquireLockWithRetry = async (
  projectId: number,
  resourceType: string,
  resourceId: string,
  maxRetries: number = 3
): Promise<ResourceLock> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await acquireLock(projectId, resourceType, resourceId);
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // Check who has the lock
      const existingLock = await checkLock(projectId, resourceType, resourceId);

      if (existingLock) {
        // Show notification to user
        const willExpireIn = getTimeUntil(existingLock.expires_at);
        const shouldWait = await confirm(
          `${existingLock.user.username} is currently editing this resource. ` +
          `Lock will expire in ${willExpireIn}. Wait and retry?`
        );

        if (!shouldWait) throw new Error('Lock acquisition cancelled');

        // Wait until lock expires
        await sleep(getMillisecondsUntil(existingLock.expires_at));
      }
    }
  }

  throw new Error('Failed to acquire lock after retries');
};
```

## Offline Support

### Detecting Offline State

```typescript
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
```

### Offline Queue

```typescript
// Queue changes while offline
class OfflineQueue {
  private queue: Array<{
    id: string;
    timestamp: number;
    action: () => Promise<any>;
  }> = [];

  add(action: () => Promise<any>) {
    this.queue.push({
      id: generateId(),
      timestamp: Date.now(),
      action
    });

    // Persist to localStorage
    this.save();
  }

  async flush() {
    while (this.queue.length > 0) {
      const item = this.queue[0];
      try {
        await item.action();
        this.queue.shift();
        this.save();
      } catch (error) {
        console.error('Failed to flush offline action:', error);
        throw error;
      }
    }
  }

  private save() {
    localStorage.setItem('offline_queue', JSON.stringify(this.queue));
  }

  private load() {
    const saved = localStorage.getItem('offline_queue');
    if (saved) {
      this.queue = JSON.parse(saved);
    }
  }
}
```

### Offline UI Component

```typescript
export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const [queueSize, setQueueSize] = useState(0);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-orange-500 text-white p-4 rounded-lg shadow-lg">
      <div className="flex items-center gap-2">
        <WifiOff className="w-5 h-5" />
        <div>
          <div className="font-semibold">You're offline</div>
          <div className="text-sm">
            Changes will sync when you're back online
            {queueSize > 0 && ` (${queueSize} pending)`}
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Best Practices

### Connection Management

1. **Always Use Auto-Reconnect**
   ```typescript
   const ws = new ExecutionWebSocket({
     url: wsUrl,
     autoReconnect: true,
     maxReconnectAttempts: 10
   });
   ```

2. **Handle Connection State**
   ```typescript
   ws.updateHandlers({
     onStateChange: (state) => {
       if (state === 'connected') {
         // Refresh data
         refetchData();
       } else if (state === 'failed') {
         // Show error to user
         showConnectionError();
       }
     }
   });
   ```

3. **Implement Heartbeat**
   - Keep connection alive
   - Detect dead connections
   - Auto-reconnect when needed

### Lock Management

1. **Always Release Locks**
   ```typescript
   try {
     const lock = await acquireLock(...);
     // ... edit resource ...
   } finally {
     await releaseLock(lock.id);
   }
   ```

2. **Set Appropriate Timeouts**
   - Short edits: 2-3 minutes
   - Complex edits: 5-10 minutes
   - Review sessions: 15-30 minutes

3. **Extend Locks When Needed**
   ```typescript
   // Extend lock before it expires
   setInterval(async () => {
     if (stillEditing && lock) {
       await extendLock(lock.id, 5);
     }
   }, 240000); // Every 4 minutes for 5-minute lock
   ```

### Performance

1. **Throttle Updates**
   ```typescript
   const throttledBroadcast = throttle(broadcastUpdate, 1000);
   ```

2. **Batch Changes**
   ```typescript
   // Instead of sending individual updates
   const changes = [];
   // ... collect changes ...
   broadcastUpdate(projectId, 'workflow', workflowId, {
     bulk: true,
     changes
   });
   ```

3. **Optimize Payload Size**
   ```typescript
   // Send only changed fields
   const delta = getDiff(oldValue, newValue);
   broadcastUpdate(projectId, resourceType, resourceId, delta);
   ```

## Related Documentation

- [Conflict Resolution](./conflict-resolution.md) - Handle edit conflicts
- [Activity Tracking](./activity-tracking.md) - Monitor real-time activity
- [Developer Guide](./developer-guide.md) - WebSocket implementation
- [API Reference](./api-reference.md) - WebSocket API documentation

## Troubleshooting

See the [Troubleshooting Guide](./troubleshooting.md#real-time-sync) for common real-time sync issues.

---

**Last Updated:** 2025-01-14
