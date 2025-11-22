# Activity Tracking

Complete guide to tracking project activities, viewing audit logs, and monitoring team collaboration.

## Overview

Qontinui's activity tracking system provides comprehensive logging of all project actions, enabling real-time activity feeds, audit trails, and collaboration monitoring.

## Activity Feed

### Viewing Project Activity

```typescript
// Get project activity feed
const getProjectActivity = async (
  projectId: number,
  options: {
    limit?: number;
    offset?: number;
    actionType?: string;
    userId?: string;
    resourceType?: string;
    startDate?: string;
    endDate?: string;
  } = {}
) => {
  const params = new URLSearchParams({
    project_id: projectId.toString(),
    ...options
  });

  const response = await fetch(`/api/v1/activity?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};
```

### Activity Data Model

```typescript
interface ActivityLog {
  id: string;
  project_id: number;
  user_id: string;
  action_type: ActionType;
  resource_type: ResourceType;
  resource_id: string;
  resource_name?: string;
  changes?: any; // Detailed change information
  metadata?: any; // Additional context
  created_at: string;

  // Populated relations
  user: {
    id: string;
    username: string;
    full_name?: string;
    avatar_url?: string;
  };
}

enum ActionType {
  CREATED = 'created',
  MODIFIED = 'modified',
  DELETED = 'deleted',
  SHARED = 'shared',
  COMMENTED = 'commented',
  LOCKED = 'locked',
  UNLOCKED = 'unlocked',
  VIEWED = 'viewed',
  EXPORTED = 'exported',
  IMPORTED = 'imported'
}

enum ResourceType {
  WORKFLOW = 'workflow',
  STATE = 'state',
  IMAGE = 'image',
  TRANSITION = 'transition',
  ACTION = 'action',
  PROJECT = 'project'
}
```

### Activity Feed Component

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

export function ActivityFeed({ projectId }: { projectId: number }) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading
  } = useInfiniteQuery({
    queryKey: ['activity', projectId],
    queryFn: ({ pageParam = 0 }) =>
      getProjectActivity(projectId, {
        limit: 20,
        offset: pageParam
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === 20 ? pages.length * 20 : undefined
  });

  const activities = data?.pages.flat() ?? [];

  return (
    <div className="space-y-2">
      {activities.map(activity => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}

      {hasNextPage && (
        <Button onClick={() => fetchNextPage()}>
          Load More
        </Button>
      )}
    </div>
  );
}

function ActivityItem({ activity }: { activity: ActivityLog }) {
  return (
    <div className="flex items-start gap-3 p-3 border-b">
      <Avatar user={activity.user} size="sm" />
      <div className="flex-1">
        <div className="text-sm">
          <span className="font-medium">{activity.user.username}</span>
          {' '}
          <ActionDescription activity={activity} />
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(activity.created_at), {
            addSuffix: true
          })}
        </div>
      </div>
      <ActivityIcon type={activity.action_type} />
    </div>
  );
}
```

## Filtering Activities

### Filter Options

```typescript
export function ActivityFilters({ projectId, onFilterChange }: {
  projectId: number;
  onFilterChange: (filters: any) => void;
}) {
  const [filters, setFilters] = useState({
    actionType: undefined,
    resourceType: undefined,
    userId: undefined,
    dateRange: { start: undefined, end: undefined }
  });

  return (
    <div className="space-y-4">
      <Select
        value={filters.actionType}
        onChange={(value) => {
          const newFilters = { ...filters, actionType: value };
          setFilters(newFilters);
          onFilterChange(newFilters);
        }}
      >
        <option value="">All Actions</option>
        <option value="created">Created</option>
        <option value="modified">Modified</option>
        <option value="deleted">Deleted</option>
        <option value="commented">Commented</option>
        <option value="shared">Shared</option>
      </Select>

      <Select
        value={filters.resourceType}
        onChange={(value) => {
          const newFilters = { ...filters, resourceType: value };
          setFilters(newFilters);
          onFilterChange(newFilters);
        }}
      >
        <option value="">All Resources</option>
        <option value="workflow">Workflows</option>
        <option value="state">States</option>
        <option value="image">Images</option>
        <option value="transition">Transitions</option>
      </Select>

      <UserSelector
        projectId={projectId}
        value={filters.userId}
        onChange={(userId) => {
          const newFilters = { ...filters, userId };
          setFilters(newFilters);
          onFilterChange(newFilters);
        }}
        placeholder="Filter by user..."
      />

      <DateRangePicker
        value={filters.dateRange}
        onChange={(range) => {
          const newFilters = { ...filters, dateRange: range };
          setFilters(newFilters);
          onFilterChange(newFilters);
        }}
      />
    </div>
  );
}
```

## Audit Logs

### Comprehensive Audit Trail

```typescript
// Get detailed audit logs
const getAuditLogs = async (
  projectId: number,
  options: {
    includeViews?: boolean; // Include view actions
    includeSystem?: boolean; // Include system actions
    minSeverity?: 'low' | 'medium' | 'high';
  } = {}
) => {
  const params = new URLSearchParams({
    project_id: projectId.toString(),
    ...options
  });

  const response = await fetch(`/api/v1/audit?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};
```

### Audit Log Format

```typescript
interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_username: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before?: any; // State before change
  after?: any; // State after change
  ip_address?: string;
  user_agent?: string;
  severity: 'low' | 'medium' | 'high';
  tags: string[];
}
```

## Exporting Activity Data

### Export to CSV

```typescript
const exportActivityToCSV = async (projectId: number) => {
  const response = await fetch(
    `/api/v1/activity/export?project_id=${projectId}&format=csv`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `activity-${projectId}-${Date.now()}.csv`;
  a.click();
};
```

### Export to JSON

```typescript
const exportActivityToJSON = async (projectId: number) => {
  const activities = await getProjectActivity(projectId, {
    limit: 10000 // Max export
  });

  const json = JSON.stringify(activities, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `activity-${projectId}-${Date.now()}.json`;
  a.click();
};
```

## Real-Time Activity Updates

### WebSocket Activity Stream

```typescript
// Subscribe to real-time activity updates
const subscribeToActivity = (projectId: number) => {
  ws.send({
    type: 'activity:subscribe',
    project_id: projectId
  });

  ws.on('message', (event) => {
    if (event.type === 'activity:new') {
      // Update UI with new activity
      addActivityToFeed(event.activity);

      // Show notification
      if (event.activity.user_id !== currentUser.id) {
        showNotification(
          `${event.activity.user.username} ${event.activity.action_type} ${event.activity.resource_name}`
        );
      }
    }
  });
};
```

## Activity Analytics

### Activity Metrics

```typescript
interface ActivityMetrics {
  total_activities: number;
  activities_by_type: Record<ActionType, number>;
  activities_by_user: Record<string, number>;
  activities_by_hour: Record<string, number>;
  most_active_resource: {
    type: ResourceType;
    id: string;
    name: string;
    activity_count: number;
  };
  busiest_day: {
    date: string;
    activity_count: number;
  };
}

const getActivityMetrics = async (
  projectId: number,
  startDate: string,
  endDate: string
): Promise<ActivityMetrics> => {
  const response = await fetch(
    `/api/v1/activity/metrics?project_id=${projectId}&start=${startDate}&end=${endDate}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );

  return await response.json();
};
```

## Related Documentation

- [Real-Time Sync](./real-time-sync.md) - Live activity updates
- [Permissions](./permissions.md) - Activity permission auditing
- [API Reference](./api-reference.md) - Activity API endpoints

---

**Last Updated:** 2025-01-14
