# Real-Time Collaboration Infrastructure

This document describes the real-time collaboration WebSocket infrastructure for qontinui-web.

## Overview

The collaboration infrastructure provides real-time features for multiple users working on the same project simultaneously:

- **Presence tracking**: See who's online and where they're working
- **Cursor tracking**: Real-time cursor positions on the canvas
- **Resource locking**: Prevent editing conflicts with automatic locks
- **Live updates**: Broadcast changes to all connected users
- **Comments & discussions**: Threaded comments with mentions
- **Activity feed**: Track all project activities in real-time

## Architecture

### Components

1. **Database Models** (`app/models/collaboration.py`)
   - `ProjectLock`: Resource locking for concurrent editing
   - `ProjectComment`: Comments and threaded discussions
   - `ActivityLog`: Activity tracking for real-time updates

2. **WebSocket Manager** (`app/services/websocket_manager.py`)
   - `ConnectionManager`: Manages WebSocket connections per project
   - Connection pooling and presence tracking
   - Automatic heartbeat and cleanup
   - Rate limiting and broadcasting

3. **WebSocket Endpoints** (`app/api/v1/endpoints/collaboration_ws.py`)
   - `/ws/projects/{project_id}/collaboration`: Main collaboration endpoint
   - Message handling and validation
   - Lock management and activity logging

4. **CRUD Operations** (`app/crud/collaboration.py`)
   - Database operations for locks, comments, and activities
   - Query helpers and cleanup functions

5. **Schemas** (`app/schemas/collaboration.py`)
   - Pydantic models for validation
   - WebSocket message schemas

## Database Schema

### project_locks

Manages resource locks to prevent concurrent editing conflicts.

```sql
CREATE TABLE project_locks (
    id UUID PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    resource_type ENUM('workflow', 'state', 'image', 'transition', 'action', 'project'),
    resource_id VARCHAR NOT NULL,
    acquired_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    auto_release BOOLEAN DEFAULT true,
    metadata JSON
);

CREATE INDEX idx_locks_project_resource ON project_locks(project_id, resource_id);
CREATE INDEX idx_locks_expires ON project_locks(expires_at);
```

**Features:**
- Automatic expiration (default: 5 minutes)
- Auto-release on disconnect
- Extendable lock duration
- Metadata for additional context

### project_comments

Stores comments and discussions on project resources.

```sql
CREATE TABLE project_comments (
    id UUID PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id VARCHAR,
    action_id VARCHAR,
    author_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    position JSON,  -- {x: float, y: float}
    mentions JSON,  -- [user_id, ...]
    resolved BOOLEAN DEFAULT false,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    parent_comment_id UUID REFERENCES project_comments(id),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    metadata JSON
);

CREATE INDEX idx_comments_project ON project_comments(project_id);
CREATE INDEX idx_comments_workflow ON project_comments(workflow_id);
CREATE INDEX idx_comments_resolved ON project_comments(resolved);
```

**Features:**
- Canvas positioning for visual comments
- User mentions with notifications
- Threaded discussions (parent_comment_id)
- Resolvable comments
- Workflow and action-specific comments

### activity_logs

Tracks all project activities for real-time updates and audit trails.

```sql
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    action_type ENUM('created', 'modified', 'deleted', 'shared', 'commented', 'locked', 'unlocked', 'viewed', 'exported', 'imported'),
    resource_type ENUM('workflow', 'state', 'image', 'transition', 'action', 'project'),
    resource_id VARCHAR NOT NULL,
    resource_name VARCHAR,
    changes JSON,
    metadata JSON,
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_activities_project_created ON activity_logs(project_id, created_at);
CREATE INDEX idx_activities_resource ON activity_logs(resource_id);
```

**Features:**
- Comprehensive action tracking
- Change details for audit trails
- Filterable by type, user, time
- Automatic cleanup of old activities

## WebSocket API

### Connection

Connect to the collaboration WebSocket:

```javascript
const ws = new WebSocket(
  `ws://localhost:8000/api/v1/ws/projects/${projectId}/collaboration?token=${jwtToken}`
);
```

### Authentication

- Use JWT access token as query parameter: `?token=<jwt_token>`
- Token is validated on connection
- User must have access to the project

### Message Types

#### Client → Server Messages

**1. Heartbeat** (Keep connection alive)
```json
{
  "type": "heartbeat"
}
```

**2. Cursor Movement**
```json
{
  "type": "cursor_move",
  "data": {
    "x": 100.5,
    "y": 200.3,
    "workflow_id": "workflow_123"
  }
}
```

**3. Acquire Resource Lock**
```json
{
  "type": "lock_acquire",
  "data": {
    "resource_type": "workflow",
    "resource_id": "workflow_123"
  }
}
```

**4. Release Resource Lock**
```json
{
  "type": "lock_release",
  "data": {
    "resource_id": "workflow_123"
  }
}
```

**5. Resource Update**
```json
{
  "type": "resource_update",
  "data": {
    "resource_type": "workflow",
    "resource_id": "workflow_123",
    "action": "modified",
    "resource_name": "Login Flow",
    "changes": {
      "name": "Updated Login Flow"
    }
  }
}
```

**6. Add Comment**
```json
{
  "type": "comment_add",
  "data": {
    "content": "Great work on this workflow!",
    "workflow_id": "workflow_123",
    "position": {"x": 150, "y": 200},
    "mentions": ["user-uuid-1", "user-uuid-2"]
  }
}
```

**7. Log Activity**
```json
{
  "type": "activity",
  "data": {
    "action_type": "created",
    "resource_type": "state",
    "resource_id": "state_456",
    "resource_name": "LoginState"
  }
}
```

#### Server → Client Messages

**1. Active Users List** (on connect)
```json
{
  "type": "active_users",
  "users": [
    {
      "user_id": "uuid",
      "username": "john_doe",
      "full_name": "John Doe",
      "avatar_url": "https://...",
      "connected_at": "2025-11-14T10:30:00.000Z",
      "cursor_position": {"x": 100, "y": 200},
      "active_locks": ["workflow_123"]
    }
  ],
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**2. Presence Update**
```json
{
  "type": "presence_update",
  "action": "joined",  // or "left", "active"
  "user": {
    "user_id": "uuid",
    "username": "jane_smith",
    "full_name": "Jane Smith",
    "avatar_url": "https://...",
    "connected_at": "2025-11-14T10:30:00.000Z"
  },
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**3. Cursor Movement**
```json
{
  "type": "cursor_move",
  "user_id": "uuid",
  "username": "john_doe",
  "cursor": {
    "x": 150.5,
    "y": 250.3,
    "workflow_id": "workflow_123"
  },
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**4. Lock Acquired**
```json
{
  "type": "lock_acquired",
  "resource_type": "workflow",
  "resource_id": "workflow_123",
  "user_id": "uuid",
  "username": "john_doe",
  "expires_at": "2025-11-14T10:35:00.000Z",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**5. Lock Released**
```json
{
  "type": "lock_released",
  "resource_id": "workflow_123",
  "user_id": "uuid",
  "username": "john_doe",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**6. Lock Denied**
```json
{
  "type": "lock_denied",
  "resource_type": "workflow",
  "resource_id": "workflow_123",
  "message": "Resource is locked by another user"
}
```

**7. Resource Updated**
```json
{
  "type": "resource_updated",
  "resource_type": "workflow",
  "resource_id": "workflow_123",
  "action": "modified",
  "changes": {"name": "Updated Name"},
  "user_id": "uuid",
  "username": "john_doe",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**8. Comment Added**
```json
{
  "type": "comment_added",
  "comment_id": "uuid",
  "workflow_id": "workflow_123",
  "author_id": "uuid",
  "author_username": "jane_smith",
  "author_avatar": "https://...",
  "content": "Great work!",
  "position": {"x": 100, "y": 200},
  "mentions": ["user-uuid-1"],
  "created_at": "2025-11-14T10:30:00.000Z",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**9. Activity**
```json
{
  "type": "activity",
  "action_type": "created",
  "resource_type": "state",
  "resource_id": "state_456",
  "resource_name": "LoginState",
  "user_id": "uuid",
  "username": "john_doe",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

**10. Error**
```json
{
  "type": "error",
  "message": "Error description"
}
```

**11. Rate Limit Exceeded**
```json
{
  "type": "rate_limit_exceeded",
  "message": "Too many messages. Please slow down."
}
```

**12. Heartbeat Acknowledgment**
```json
{
  "type": "heartbeat_ack",
  "timestamp": "2025-11-14T10:30:00.000Z"
}
```

## Features

### 1. Connection Management

- **Automatic heartbeat**: Ping/pong every 120 seconds
- **Stale connection cleanup**: Removes inactive connections after 90 seconds
- **Graceful disconnect**: Auto-releases locks on disconnect
- **Connection pooling**: Manages multiple connections per project

### 2. Rate Limiting

- **60 messages per minute** per user
- Automatic rate limit enforcement
- Clear error messages when exceeded

### 3. Resource Locking

- **Automatic expiration**: Locks expire after 5 minutes
- **Auto-release**: Locks released on disconnect
- **Lock extension**: Locks can be extended
- **Conflict prevention**: One lock per resource

### 4. Broadcasting

- **Selective broadcast**: Exclude sender from broadcasts
- **Failed connection cleanup**: Removes dead connections
- **Project-scoped**: Messages only sent to project members

### 5. Presence Tracking

- **Online users**: Real-time list of active users
- **Cursor positions**: Track cursor movement
- **Active locks**: See what resources users are editing
- **Join/leave notifications**: Real-time presence updates

## Frontend Integration

### React/TypeScript Example

```typescript
import { useEffect, useRef, useState } from 'react';

interface ActiveUser {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  cursor_position?: { x: number; y: number };
  active_locks: string[];
}

export function useCollaboration(projectId: string, token: string) {
  const ws = useRef<WebSocket | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to WebSocket
    ws.current = new WebSocket(
      `ws://localhost:8000/api/v1/ws/projects/${projectId}/collaboration?token=${token}`
    );

    ws.current.onopen = () => {
      console.log('Connected to collaboration WebSocket');
      setIsConnected(true);

      // Start heartbeat
      const heartbeat = setInterval(() => {
        ws.current?.send(JSON.stringify({ type: 'heartbeat' }));
      }, 30000); // Every 30 seconds

      return () => clearInterval(heartbeat);
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'active_users':
          setActiveUsers(message.users);
          break;

        case 'presence_update':
          if (message.action === 'joined') {
            setActiveUsers(prev => [...prev, message.user]);
          } else if (message.action === 'left') {
            setActiveUsers(prev =>
              prev.filter(u => u.user_id !== message.user_id)
            );
          }
          break;

        case 'cursor_move':
          setActiveUsers(prev =>
            prev.map(u =>
              u.user_id === message.user_id
                ? { ...u, cursor_position: message.cursor }
                : u
            )
          );
          break;

        case 'lock_acquired':
          console.log('Lock acquired:', message);
          break;

        case 'resource_updated':
          console.log('Resource updated:', message);
          // Trigger UI update
          break;

        case 'comment_added':
          console.log('New comment:', message);
          // Add comment to UI
          break;

        case 'error':
          console.error('WebSocket error:', message.message);
          break;
      }
    };

    ws.current.onclose = () => {
      console.log('Disconnected from collaboration WebSocket');
      setIsConnected(false);
    };

    return () => {
      ws.current?.close();
    };
  }, [projectId, token]);

  const sendCursorMove = (x: number, y: number, workflowId?: string) => {
    ws.current?.send(JSON.stringify({
      type: 'cursor_move',
      data: { x, y, workflow_id: workflowId }
    }));
  };

  const acquireLock = (resourceType: string, resourceId: string) => {
    ws.current?.send(JSON.stringify({
      type: 'lock_acquire',
      data: { resource_type: resourceType, resource_id: resourceId }
    }));
  };

  const releaseLock = (resourceId: string) => {
    ws.current?.send(JSON.stringify({
      type: 'lock_release',
      data: { resource_id: resourceId }
    }));
  };

  const addComment = (content: string, workflowId?: string, position?: { x: number, y: number }) => {
    ws.current?.send(JSON.stringify({
      type: 'comment_add',
      data: { content, workflow_id: workflowId, position }
    }));
  };

  return {
    isConnected,
    activeUsers,
    sendCursorMove,
    acquireLock,
    releaseLock,
    addComment
  };
}
```

## Database Migration

Run the Alembic migration to create the tables:

```bash
# Generate migration (if needed)
alembic revision -m "Create collaboration tables"

# Apply migration
alembic upgrade head
```

Or use the provided migration file:
```bash
alembic upgrade collaboration_001
```

## API Endpoints (REST)

In addition to WebSockets, you can use REST endpoints for collaboration features:

### Comments

```
GET    /api/v1/projects/{project_id}/comments
POST   /api/v1/projects/{project_id}/comments
GET    /api/v1/projects/{project_id}/comments/{comment_id}
PUT    /api/v1/projects/{project_id}/comments/{comment_id}
DELETE /api/v1/projects/{project_id}/comments/{comment_id}
POST   /api/v1/projects/{project_id}/comments/{comment_id}/resolve
```

### Locks

```
GET    /api/v1/projects/{project_id}/locks
POST   /api/v1/projects/{project_id}/locks
DELETE /api/v1/projects/{project_id}/locks/{lock_id}
POST   /api/v1/projects/{project_id}/locks/{lock_id}/extend
```

### Activities

```
GET    /api/v1/projects/{project_id}/activities
GET    /api/v1/projects/{project_id}/activities/stats
```

## Performance Considerations

1. **Connection Limits**: Monitor active connections per project
2. **Rate Limiting**: 60 messages per minute per user
3. **Lock Expiration**: Clean up expired locks every 30 seconds
4. **Activity Retention**: Consider archiving old activities after 90 days
5. **Broadcasting**: Use selective broadcasting to reduce network traffic

## Security

1. **Authentication**: JWT token required for WebSocket connection
2. **Authorization**: Project access verified on connection
3. **Rate Limiting**: Prevents abuse and DoS attacks
4. **Message Validation**: All messages validated with Pydantic
5. **Automatic Cleanup**: Stale connections removed automatically

## Monitoring

Log events to monitor:
- `websocket_connected`: User connected
- `websocket_disconnected`: User disconnected
- `lock_acquired`: Lock acquired
- `lock_released`: Lock released
- `collaboration_ws_rate_limit`: Rate limit hit
- `cleanup_stale_connections`: Cleanup performed

## Troubleshooting

### Connection Issues

- Verify JWT token is valid
- Check project access permissions
- Ensure WebSocket support in infrastructure

### Lock Issues

- Locks expire after 5 minutes
- Locks auto-release on disconnect
- Check for expired locks in database

### Performance Issues

- Monitor connection count per project
- Check rate limit violations
- Review cleanup task performance

## Future Enhancements

1. **Conflict Resolution**: Operational transformation for real-time editing
2. **Offline Support**: Queue messages when disconnected
3. **Video/Voice**: WebRTC integration for audio/video calls
4. **Screen Sharing**: Share workflow canvas in real-time
5. **Typing Indicators**: Show when users are typing comments
6. **Read Receipts**: Track comment read status
7. **Notifications**: Push notifications for mentions and updates
8. **Presence Timeouts**: Auto-away status after inactivity
9. **Custom Events**: Allow custom WebSocket message types
10. **Analytics**: Track collaboration metrics and engagement
