# Developer Guide

Complete guide for developers implementing and extending Qontinui's collaboration features.

## Setup

### Local Development Environment

```bash
# Clone repository
git clone https://github.com/your-org/qontinui-web.git
cd qontinui-web

# Install backend dependencies
cd backend
pip install -r requirements.txt

# Setup database
createdb qontinui_dev
alembic upgrade head

# Run backend
uvicorn app.main:app --reload

# Install frontend dependencies (in new terminal)
cd ../frontend
npm install

# Run frontend
npm run dev
```

### Database Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "Add collaboration models"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

## Database Schema

### Organization Tables

**organizations**
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

**team_members**
```sql
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR NOT NULL,
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);
```

**project_access_control**
```sql
CREATE TABLE project_access_control (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  permission_level VARCHAR NOT NULL,
  expires_at TIMESTAMP,
  CHECK (
    (user_id IS NOT NULL AND organization_id IS NULL) OR
    (user_id IS NULL AND organization_id IS NOT NULL)
  )
);
```

## Backend Architecture

### Service Layer

```python
# app/services/collaboration_service.py
from typing import List, Optional
from app.models import Organization, TeamMember, ProjectAccessControl
from app.schemas import OrganizationCreate, MemberCreate

class CollaborationService:
    """Service for managing collaboration features"""

    @staticmethod
    async def create_organization(
        user_id: str,
        org_data: OrganizationCreate
    ) -> Organization:
        """Create new organization"""
        org = Organization(
            owner_id=user_id,
            **org_data.dict()
        )
        await org.save()

        # Add owner as admin member
        member = TeamMember(
            organization_id=org.id,
            user_id=user_id,
            role="owner"
        )
        await member.save()

        return org

    @staticmethod
    async def share_project(
        project_id: int,
        user_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        permission_level: str = "view"
    ) -> ProjectAccessControl:
        """Share project with user or organization"""
        access = ProjectAccessControl(
            project_id=project_id,
            user_id=user_id,
            organization_id=organization_id,
            permission_level=permission_level
        )
        await access.save()
        return access
```

### WebSocket Server

```python
# app/api/v1/endpoints/collaboration_ws.py
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = set()
        self.active_connections[project_id].add(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int):
        self.active_connections[project_id].remove(websocket)

    async def broadcast(self, message: dict, project_id: int):
        if project_id in self.active_connections:
            for connection in self.active_connections[project_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@router.websocket("/ws/projects/{project_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    project_id: int,
    current_user: User = Depends(get_current_user_ws)
):
    await manager.connect(websocket, project_id)
    try:
        while True:
            data = await websocket.receive_json()
            # Handle different message types
            await handle_message(data, project_id, current_user)
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)
```

## Frontend Integration

### Custom Hooks

```typescript
// hooks/use-collaboration.ts
import { useEffect, useState } from 'react';
import { useWebSocket } from './use-websocket';

export function useCollaboration(projectId: number) {
  const ws = useWebSocket(`/ws/projects/${projectId}`);
  const [activeUsers, setActiveUsers] = useState<User[]>([]);
  const [locks, setLocks] = useState<ResourceLock[]>([]);

  useEffect(() => {
    ws.on('presence:update', (event) => {
      setActiveUsers(event.users);
    });

    ws.on('lock:acquired', (event) => {
      setLocks(prev => [...prev, event.lock]);
    });

    ws.on('lock:released', (event) => {
      setLocks(prev => prev.filter(l => l.id !== event.lock.id));
    });

    return () => {
      ws.disconnect();
    };
  }, [projectId]);

  return {
    activeUsers,
    locks,
    acquireLock: (resourceType, resourceId) => {
      return ws.send({
        type: 'lock:acquire',
        resource_type: resourceType,
        resource_id: resourceId
      });
    }
  };
}
```

### React Context

```typescript
// contexts/CollaborationContext.tsx
import React, { createContext, useContext, useState } from 'react';

interface CollaborationContextType {
  activeUsers: User[];
  locks: ResourceLock[];
  comments: Comment[];
  addComment: (comment: Comment) => void;
}

const CollaborationContext = createContext<CollaborationContextType | null>(null);

export function CollaborationProvider({ children, projectId }) {
  const collaboration = useCollaboration(projectId);

  return (
    <CollaborationContext.Provider value={collaboration}>
      {children}
    </CollaborationContext.Provider>
  );
}

export function useCollaborationContext() {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error('useCollaborationContext must be used within CollaborationProvider');
  }
  return context;
}
```

## Testing

### Backend Tests

```python
# tests/test_collaboration.py
import pytest
from app.services.collaboration_service import CollaborationService

@pytest.mark.asyncio
async def test_create_organization(test_user):
    """Test organization creation"""
    org = await CollaborationService.create_organization(
        user_id=test_user.id,
        org_data=OrganizationCreate(
            name="Test Org",
            slug="test-org"
        )
    )

    assert org.name == "Test Org"
    assert org.owner_id == test_user.id

    # Verify owner is added as member
    members = await TeamMember.filter(organization_id=org.id).all()
    assert len(members) == 1
    assert members[0].role == "owner"

@pytest.mark.asyncio
async def test_share_project(test_user, test_project):
    """Test project sharing"""
    access = await CollaborationService.share_project(
        project_id=test_project.id,
        user_id=test_user.id,
        permission_level="edit"
    )

    assert access.permission_level == "edit"
```

### Frontend Tests

```typescript
// components/__tests__/CommentBox.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentBox } from '../CommentBox';

describe('CommentBox', () => {
  it('should add comment on submit', async () => {
    const onCommentAdded = jest.fn();
    render(
      <CommentBox
        projectId={123}
        onCommentAdded={onCommentAdded}
      />
    );

    const textarea = screen.getByPlaceholderText(/add a comment/i);
    fireEvent.change(textarea, { target: { value: 'Test comment' } });

    const button = screen.getByRole('button', { name: /comment/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(onCommentAdded).toHaveBeenCalled();
    });
  });
});
```

## Performance Optimization

### Database Indexing

```sql
-- Add indexes for common queries
CREATE INDEX idx_team_members_org ON team_members(organization_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_project_access_project ON project_access_control(project_id);
CREATE INDEX idx_activity_logs_project_created ON activity_logs(project_id, created_at DESC);
```

### Caching

```python
# Use Redis for caching
from redis import Redis
from functools import lru_cache

redis = Redis(host='localhost', port=6379)

@lru_cache(maxsize=1000)
def get_user_organizations(user_id: str):
    """Cache user's organizations"""
    cache_key = f"user:{user_id}:organizations"
    cached = redis.get(cache_key)

    if cached:
        return json.loads(cached)

    orgs = TeamMember.filter(user_id=user_id).select_related('organization')
    redis.setex(cache_key, 300, json.dumps(orgs))  # 5 min TTL
    return orgs
```

## Security Considerations

### Input Validation

```python
from pydantic import BaseModel, validator

class OrganizationCreate(BaseModel):
    name: str
    slug: str

    @validator('slug')
    def slug_alphanumeric(cls, v):
        if not v.replace('-', '').isalnum():
            raise ValueError('Slug must be alphanumeric')
        return v.lower()
```

### Permission Checks

```python
from functools import wraps

def require_permission(permission: str):
    """Decorator to check permissions"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            project_id = kwargs.get('project_id')
            user = kwargs.get('current_user')

            has_permission = await check_permission(
                user.id,
                project_id,
                permission
            )

            if not has_permission:
                raise HTTPException(403, "Insufficient permissions")

            return await func(*args, **kwargs)
        return wrapper
    return decorator

@router.delete("/projects/{project_id}")
@require_permission("admin")
async def delete_project(project_id: int, current_user: User):
    ...
```

## Monitoring

### Logging

```python
import logging

logger = logging.getLogger(__name__)

logger.info(f"User {user.id} created organization {org.id}")
logger.warning(f"Failed lock acquisition for resource {resource_id}")
logger.error(f"WebSocket error: {error}", exc_info=True)
```

### Metrics

```python
from prometheus_client import Counter, Histogram

# Define metrics
collaboration_operations = Counter(
    'collaboration_operations_total',
    'Total collaboration operations',
    ['operation_type']
)

lock_acquisition_time = Histogram(
    'lock_acquisition_seconds',
    'Time to acquire resource lock'
)

# Use metrics
collaboration_operations.labels(operation_type='share_project').inc()
with lock_acquisition_time.time():
    lock = await acquire_lock(...)
```

## Related Documentation

- [API Reference](./api-reference.md) - Complete API docs
- [Troubleshooting](./troubleshooting.md) - Common issues

---

**Last Updated:** 2025-01-14
