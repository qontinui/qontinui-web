# Collaboration Services

Comprehensive collaboration features for qontinui-web, enabling real-time team collaboration on projects.

## Overview

The collaboration services provide:

- **Organization Management** - Create and manage teams/organizations
- **Project Collaboration** - Share projects and manage permissions
- **Edit Locking** - Prevent concurrent modifications with resource locking
- **Comments & Discussions** - Threaded comments with mentions and reactions
- **Activity Tracking** - Audit log of all project activities
- **Real-time Sync** - WebSocket-based real-time updates and presence

## Services

### OrganizationService

Manages organizations and team membership.

```typescript
import { organizationService } from "@/services/service-factory";

// Create an organization
const org = await organizationService.createOrganization(
  "My Team",
  "Team workspace for project collaboration"
);

// Invite team members
await organizationService.inviteMember(org.id, "user@example.com", "member");

// Get all members
const members = await organizationService.getMembers(org.id);

// Switch organization context
await organizationService.switchOrganization(org.id);
```

### ProjectCollaborationService

Handles project sharing and permission management.

```typescript
import { projectCollaborationService } from "@/services/service-factory";

// Share project with a user
await projectCollaborationService.shareProject(
  projectId,
  userId,
  "edit" // permission level: 'view' | 'comment' | 'edit' | 'admin' | 'owner'
);

// Share with entire organization
await projectCollaborationService.shareWithOrganization(
  projectId,
  orgId,
  "view"
);

// Check permissions
const canEdit = await projectCollaborationService.canPerformAction(
  projectId,
  "edit"
);

// Get all collaborators
const collaborators =
  await projectCollaborationService.getCollaborators(projectId);
```

### LockService

Prevents concurrent edits with resource locking.

```typescript
import { lockService } from "@/services/service-factory";

// Acquire a lock on a workflow
const lock = await lockService.acquireLock(
  projectId,
  "workflow",
  workflowId,
  300 // timeout in seconds
);

// Lock is automatically refreshed every 2 minutes
// Manual refresh if needed
await lockService.refreshLock(lock.id);

// Release lock when done
await lockService.releaseLock(lock.id);

// Check lock status
const currentLock = await lockService.getLockStatus(
  projectId,
  "workflow",
  workflowId
);

if (currentLock && lockService.isLockedByOther(currentLock)) {
  console.log(`Locked by ${currentLock.user_name}`);
}
```

### CommentService

Manage comments and discussions on projects.

```typescript
import { commentService } from "@/services/service-factory";

// Add a comment
const comment = await commentService.addComment(
  projectId,
  workflowId,
  "Great workflow design!",
  { x: 100, y: 200 }, // optional position on canvas
  ["@user123"] // optional mentions
);

// Reply to a comment
const reply = await commentService.replyToComment(
  comment.id,
  "Thanks! Let me know if you have suggestions."
);

// Resolve a comment thread
await commentService.resolveComment(comment.id);

// Get all comments for a workflow
const comments = await commentService.getComments(projectId, workflowId);

// Add reactions
await commentService.addReaction(comment.id, "👍");
```

### ActivityService

Track and display project activity.

```typescript
import { activityService } from "@/services/service-factory";

// Track activity (usually done automatically)
await activityService.trackUpdate(
  projectId,
  "workflow",
  workflowId,
  { name: "old" } // changes object
);

// Get activity feed
const activities = await activityService.getActivityFeed(projectId, {
  limit: 50,
  offset: 0,
  action_types: ["create", "update"],
  resource_types: ["workflow"],
});

// Get activity for specific resource
const workflowActivity = await activityService.getResourceActivity(
  projectId,
  "workflow",
  workflowId
);

// Subscribe to real-time updates
const subscription = activityService.subscribeToActivity(
  projectId,
  (activity) => {
    console.log("New activity:", activity);
  }
);

// Unsubscribe when done
subscription.unsubscribe();
```

### WebSocketCollaborationService

Real-time collaboration features via WebSocket.

```typescript
import { WebSocketCollaborationService } from "@/services/collaboration";

// Create and connect
const wsService = new WebSocketCollaborationService(
  {
    projectId,
    token: accessToken,
  },
  {
    onPresenceUpdate: (presence) => {
      console.log(`${presence.user_name} is ${presence.status}`);
    },
    onCursorMove: (data) => {
      console.log(`${data.user_name} moved cursor to`, data.x, data.y);
    },
    onLockUpdate: (data) => {
      console.log("Lock update:", data.lock, data.action);
    },
    onResourceUpdate: (data) => {
      console.log("Resource updated:", data.resource_type, data.resource_id);
    },
    onCommentAdded: (comment) => {
      console.log("New comment:", comment);
    },
    onActivityUpdate: (activity) => {
      console.log("New activity:", activity);
    },
    onConnect: () => {
      console.log("Connected to collaboration server");
    },
    onDisconnect: (reason) => {
      console.log("Disconnected:", reason);
    },
  }
);

await wsService.connect();

// Send presence updates
wsService.sendPresenceUpdate("active", "workflow-123");

// Share cursor position
wsService.sendCursorPosition(250, 350, "canvas-viewport");

// Notify about resource changes
wsService.sendResourceUpdate("workflow", workflowId, {
  name: "Updated Workflow",
});

// Disconnect when done
wsService.disconnect();
```

## Usage Patterns

### Complete Collaboration Setup

```typescript
import {
  projectCollaborationService,
  lockService,
  commentService,
  activityService,
  WebSocketCollaborationService,
} from "@/services/service-factory";

// 1. Check permissions
const canEdit = await projectCollaborationService.canPerformAction(
  projectId,
  "edit"
);

if (!canEdit) {
  throw new Error("You do not have edit permissions");
}

// 2. Acquire lock
const lock = await lockService.acquireLock(projectId, "workflow", workflowId);

// 3. Set up real-time collaboration
const wsService = new WebSocketCollaborationService(
  { projectId, token: accessToken },
  {
    onResourceUpdate: (data) => {
      // Handle remote changes
      if (data.resource_id === workflowId) {
        mergeRemoteChanges(data.changes);
      }
    },
    onLockUpdate: (data) => {
      // Update UI when locks change
      if (data.action === "acquired") {
        showLockedIndicator(data.lock);
      }
    },
  }
);

await wsService.connect();

// 4. Make changes
const changes = updateWorkflow(workflow);

// 5. Track activity
await activityService.trackUpdate(projectId, "workflow", workflowId, changes);

// 6. Notify others via WebSocket
wsService.sendResourceUpdate("workflow", workflowId, changes);

// 7. Cleanup
await lockService.releaseLock(lock.id);
wsService.disconnect();
```

### Organization-wide Project Sharing

```typescript
import {
  organizationService,
  projectCollaborationService,
} from "@/services/service-factory";

// Get current organization
const org = organizationService.getCurrentOrganization();

if (org) {
  // Share with organization
  await projectCollaborationService.shareWithOrganization(
    projectId,
    org.id,
    "view" // All members can view
  );

  // Give specific members edit access
  const members = await organizationService.getMembers(org.id);
  const editors = members.filter(
    (m) => m.role === "admin" || m.role === "owner"
  );

  for (const member of editors) {
    await projectCollaborationService.shareProject(
      projectId,
      member.user_id,
      "edit"
    );
  }
}
```

### Comment Threads with Mentions

```typescript
import { commentService } from "@/services/service-factory";

// Create a comment thread
const mainComment = await commentService.addComment(
  projectId,
  workflowId,
  "Could you review this workflow logic? @john @sarah",
  { x: 200, y: 150, element_id: "action-123" },
  ["john-user-id", "sarah-user-id"]
);

// Get mentions (users will be notified)
const mentions = await commentService.getMentions(projectId);

// Reply with follow-up
const reply = await commentService.replyToComment(
  mainComment.id,
  "Thanks for the feedback! I made the changes."
);

// Resolve when discussion is complete
await commentService.resolveComment(mainComment.id);
```

## Integration with Service Factory

All collaboration services are available as singleton instances through the service factory:

```typescript
import {
  organizationService,
  projectCollaborationService,
  lockService,
  commentService,
  activityService,
} from "@/services/service-factory";
```

The services are automatically configured with:

- Authentication via HttpClient
- Token management
- Error handling
- Retry logic
- CSRF protection

## Error Handling

All services throw errors that should be handled appropriately:

```typescript
try {
  await lockService.acquireLock(projectId, "workflow", workflowId);
} catch (error) {
  if (error.message.includes("already locked")) {
    // Resource is locked by another user
    showLockedMessage();
  } else {
    // Other error
    showErrorNotification(error.message);
  }
}
```

## TypeScript Support

All services are fully typed with comprehensive TypeScript definitions. Import types from:

```typescript
import type {
  Organization,
  TeamMember,
  Collaborator,
  Lock,
  Comment,
  Activity,
  PermissionLevel,
  ResourceType,
  // ... and many more
} from "@/types/collaboration";
```

## Best Practices

1. **Always check permissions** before attempting actions
2. **Acquire locks** before editing shared resources
3. **Release locks** promptly when done editing
4. **Track activities** for important changes (automatic in most cases)
5. **Use WebSocket service** for real-time collaboration features
6. **Handle errors gracefully** and show appropriate UI feedback
7. **Clean up resources** (subscriptions, WebSocket connections) when components unmount

## Backend Requirements

These services require corresponding backend endpoints:

- `/api/v1/organizations/*` - Organization management
- `/api/v1/projects/{id}/share` - Project sharing
- `/api/v1/projects/{id}/locks` - Lock management
- `/api/v1/projects/{id}/comments` - Comments
- `/api/v1/projects/{id}/activity` - Activity tracking
- `/api/v1/projects/{id}/collaboration/ws` - WebSocket endpoint

Ensure the backend implements these endpoints with proper authentication and authorization.
