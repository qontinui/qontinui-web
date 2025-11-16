# Collaboration Infrastructure - Quick Start Guide

## What Was Created

This real-time collaboration infrastructure adds WebSocket-based collaborative features to qontinui-web.

### Files Created

1. **`/backend/app/models/collaboration.py`** (173 lines)
   - `ProjectLock`: Resource locking model with auto-expiration
   - `ProjectComment`: Comments with threading and mentions
   - `ActivityLog`: Activity tracking for real-time updates
   - `ResourceType` and `ActionType` enums

2. **`/backend/app/services/websocket_manager.py`** (565 lines)
   - `ConnectionManager`: Manages WebSocket connections
   - Connection pooling per project
   - Presence tracking and cursor positions
   - Automatic heartbeat and cleanup
   - Rate limiting (60 messages/min per user)
   - Broadcasting with selective exclusion

3. **`/backend/app/api/v1/endpoints/collaboration_ws.py`** (843 lines)
   - WebSocket endpoint: `/ws/projects/{project_id}/collaboration`
   - 8 message types (heartbeat, cursor, locks, updates, comments, activities)
   - Authentication and authorization
   - Lock management with auto-release
   - Message validation with Pydantic

4. **`/backend/app/crud/collaboration.py`** (391 lines)
   - CRUD operations for locks, comments, activities
   - Query helpers and filtering
   - Cleanup functions for expired data

5. **`/backend/alembic/versions/create_collaboration_tables.py`** (207 lines)
   - Database migration for 3 new tables
   - Indexes for optimal query performance
   - Foreign key constraints

6. **`/backend/COLLABORATION_INFRASTRUCTURE.md`** (854 lines)
   - Comprehensive documentation
   - API reference for all message types
   - Frontend integration examples
   - Security and performance guidelines

7. **`/backend/COLLABORATION_QUICKSTART.md`** (This file)

### Files Modified

1. **`/backend/app/db/base_class.py`**
   - Added imports for collaboration models (Alembic detection)

2. **`/backend/app/api/v1/api.py`**
   - Added collaboration_ws router to API

## Quick Setup

### 1. Run Database Migration

```bash
cd /home/user/qontinui-web/backend

# Apply the migration
alembic upgrade head
```

This creates three tables:
- `project_locks`
- `project_comments`
- `activity_logs`

### 2. Start Backend Server

```bash
# If not already running
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Test WebSocket Connection

Using JavaScript (browser console or test script):

```javascript
// Get JWT token from your auth system
const token = "your-jwt-token";
const projectId = "123";

// Connect to collaboration WebSocket
const ws = new WebSocket(
  `ws://localhost:8000/api/v1/ws/projects/${projectId}/collaboration?token=${token}`
);

ws.onopen = () => {
  console.log("Connected!");

  // Send heartbeat
  ws.send(JSON.stringify({ type: "heartbeat" }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log("Received:", msg);
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("Disconnected");
};
```

## Key Features

### 1. Real-Time Presence
- See who's online in your project
- Track cursor positions on canvas
- Know what resources users are editing

### 2. Resource Locking
- Automatic locks when editing
- Prevents concurrent edit conflicts
- Auto-release on disconnect
- 5-minute expiration (configurable)

### 3. Live Updates
- Broadcast changes to all users
- Real-time cursor tracking
- Activity feed updates
- Comment notifications

### 4. Comments & Discussions
- Thread comments on workflows/states
- @mention other users
- Canvas positioning for visual feedback
- Resolve/unresolve comments

### 5. Activity Tracking
- Track all project activities
- Filter by user, type, time
- Audit trail for compliance
- Real-time activity feed

## Message Types Reference

### Send (Client → Server)

| Type | Purpose | Data Fields |
|------|---------|-------------|
| `heartbeat` | Keep-alive ping | None |
| `cursor_move` | Update cursor position | `x`, `y`, `workflow_id?` |
| `lock_acquire` | Request resource lock | `resource_type`, `resource_id` |
| `lock_release` | Release resource lock | `resource_id` |
| `resource_update` | Broadcast changes | `resource_type`, `resource_id`, `action`, `changes?` |
| `comment_add` | Add new comment | `content`, `workflow_id?`, `position?`, `mentions?` |
| `activity` | Log activity | `action_type`, `resource_type`, `resource_id` |

### Receive (Server → Client)

| Type | When | Contains |
|------|------|----------|
| `active_users` | On connect | List of online users |
| `presence_update` | User joins/leaves | User info, action |
| `cursor_move` | User moves cursor | User ID, cursor position |
| `lock_acquired` | Lock granted | Resource info, user, expiry |
| `lock_denied` | Lock unavailable | Resource info, reason |
| `lock_released` | Lock freed | Resource info, user |
| `resource_updated` | Resource changed | Resource info, changes, user |
| `comment_added` | New comment | Comment details, author |
| `activity` | Activity logged | Activity type, user, resource |
| `error` | Error occurred | Error message |
| `rate_limit_exceeded` | Too many messages | Warning message |
| `heartbeat_ack` | Heartbeat response | Timestamp |

## Integration Checklist

- [ ] Database migration applied (`alembic upgrade head`)
- [ ] Backend server restarted
- [ ] WebSocket connection tested
- [ ] Frontend hooks implemented (see `COLLABORATION_INFRASTRUCTURE.md`)
- [ ] Presence UI component created
- [ ] Lock indicators added to UI
- [ ] Comment component created
- [ ] Activity feed implemented

## Frontend Integration

### React Hook Example

```typescript
// hooks/useCollaboration.ts
import { useEffect, useRef, useState } from 'react';

export function useCollaboration(projectId: string, token: string) {
  const ws = useRef<WebSocket | null>(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const wsUrl = `ws://localhost:8000/api/v1/ws/projects/${projectId}/collaboration?token=${token}`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => setIsConnected(true);
    ws.current.onclose = () => setIsConnected(false);

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'active_users') {
        setActiveUsers(msg.users);
      } else if (msg.type === 'presence_update') {
        // Update active users list
      }
    };

    // Heartbeat
    const heartbeat = setInterval(() => {
      ws.current?.send(JSON.stringify({ type: 'heartbeat' }));
    }, 30000);

    return () => {
      clearInterval(heartbeat);
      ws.current?.close();
    };
  }, [projectId, token]);

  const sendCursorMove = (x: number, y: number) => {
    ws.current?.send(JSON.stringify({
      type: 'cursor_move',
      data: { x, y }
    }));
  };

  const acquireLock = (resourceType: string, resourceId: string) => {
    ws.current?.send(JSON.stringify({
      type: 'lock_acquire',
      data: { resource_type: resourceType, resource_id: resourceId }
    }));
  };

  return { isConnected, activeUsers, sendCursorMove, acquireLock };
}
```

### Usage in Component

```typescript
// components/WorkflowEditor.tsx
import { useCollaboration } from '@/hooks/useCollaboration';

export function WorkflowEditor({ projectId }: { projectId: string }) {
  const token = useAuthToken(); // Your auth hook
  const { isConnected, activeUsers, sendCursorMove } = useCollaboration(projectId, token);

  const handleMouseMove = (e: React.MouseEvent) => {
    sendCursorMove(e.clientX, e.clientY);
  };

  return (
    <div onMouseMove={handleMouseMove}>
      <div className="presence-bar">
        {activeUsers.map(user => (
          <UserAvatar key={user.user_id} user={user} />
        ))}
      </div>
      {/* Your workflow canvas */}
    </div>
  );
}
```

## Security Considerations

1. **Authentication**: JWT token required for WebSocket connection
2. **Authorization**: Project access verified before allowing connection
3. **Rate Limiting**: 60 messages per minute per user
4. **Message Validation**: All messages validated with Pydantic schemas
5. **Auto-cleanup**: Stale connections automatically removed

## Performance Tips

1. **Throttle cursor updates**: Don't send every mouse movement
   ```typescript
   const throttledCursorMove = throttle(sendCursorMove, 100); // 100ms
   ```

2. **Batch updates**: Group multiple changes when possible

3. **Monitor connection count**: Track active connections per project

4. **Clean up old data**: Run periodic cleanup of old activities
   ```python
   await cleanup_old_activities(db, days=90)
   ```

## Troubleshooting

### WebSocket won't connect
- Verify JWT token is valid and not expired
- Check user has access to the project
- Ensure WebSocket support in your infrastructure (reverse proxy, load balancer)

### Locks not releasing
- Locks auto-release after 5 minutes
- Locks auto-release on disconnect
- Check database for orphaned locks:
  ```sql
  SELECT * FROM project_locks WHERE expires_at < NOW();
  ```

### Too many "rate limit exceeded" messages
- Throttle cursor movement updates
- Reduce heartbeat frequency (30s is recommended)
- Check for message loops in client code

### Presence not updating
- Verify heartbeat is being sent regularly
- Check network connectivity
- Look for WebSocket disconnections in logs

## Next Steps

1. **Implement REST endpoints** for comments and locks (optional)
2. **Add notifications** for @mentions in comments
3. **Create UI components** for presence, comments, activity
4. **Add conflict resolution** for simultaneous edits
5. **Implement typing indicators** for comments
6. **Add read receipts** for comments
7. **Create admin dashboard** for monitoring connections

## Support

For detailed documentation, see:
- `/backend/COLLABORATION_INFRASTRUCTURE.md` - Full API reference
- `/backend/app/api/v1/endpoints/collaboration_ws.py` - WebSocket implementation
- `/backend/app/services/websocket_manager.py` - Connection manager
- `/backend/app/models/collaboration.py` - Database models

## Example: Complete Feature Implementation

Here's a complete example of implementing a collaborative cursor feature:

### Backend (Already Done)
The WebSocket endpoint handles cursor movements automatically.

### Frontend

```typescript
// components/CollaborativeCursors.tsx
import { useCollaboration } from '@/hooks/useCollaboration';

export function CollaborativeCursors({ projectId }: { projectId: string }) {
  const { activeUsers, sendCursorMove } = useCollaboration(projectId);

  return (
    <>
      {activeUsers.map(user => (
        user.cursor_position && (
          <div
            key={user.user_id}
            className="absolute pointer-events-none"
            style={{
              left: user.cursor_position.x,
              top: user.cursor_position.y,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="w-4 h-4 bg-blue-500 rounded-full" />
            <div className="text-xs bg-blue-500 text-white px-2 py-1 rounded mt-1">
              {user.username}
            </div>
          </div>
        )
      ))}
    </>
  );
}
```

That's it! The infrastructure handles the rest (broadcasting, presence tracking, cleanup).

## Resources

- **WebSocket Protocol**: [RFC 6455](https://tools.ietf.org/html/rfc6455)
- **FastAPI WebSockets**: [FastAPI Docs](https://fastapi.tiangolo.com/advanced/websockets/)
- **Operational Transformation**: For future conflict resolution
- **CRDT**: Alternative approach for real-time collaboration
