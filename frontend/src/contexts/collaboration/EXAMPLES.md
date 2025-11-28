# Usage Examples

This document provides practical examples of using the refactored collaboration contexts.

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [Using Individual Hooks](#using-individual-hooks)
3. [Common Patterns](#common-patterns)
4. [Real-World Components](#real-world-components)
5. [Advanced Usage](#advanced-usage)

---

## Basic Setup

### Option 1: Combined Provider (Recommended)

```tsx
import { CollaborationProvider } from "@/contexts/collaboration";

function App() {
  const projectId = "project-123";
  const workflowId = "workflow-456"; // optional

  return (
    <CollaborationProvider projectId={projectId} workflowId={workflowId}>
      <Dashboard />
      <Editor />
      <CommentsSidebar />
    </CollaborationProvider>
  );
}
```

### Option 2: Individual Providers

```tsx
import {
  OrganizationProvider,
  PermissionsProvider,
  CommentsProvider,
  ActivityProvider,
} from "@/contexts/collaboration";

function App() {
  const projectId = "project-123";
  const workflowId = "workflow-456";

  return (
    <OrganizationProvider>
      <PermissionsProvider>
        <CommentsProvider projectId={projectId} workflowId={workflowId}>
          <ActivityProvider projectId={projectId}>
            <MyApp />
          </ActivityProvider>
        </CommentsProvider>
      </PermissionsProvider>
    </OrganizationProvider>
  );
}
```

---

## Using Individual Hooks

### Organization Management

```tsx
import { useOrganization } from "@/contexts/collaboration";

function OrganizationSelector() {
  const { currentOrg, organizations, switchOrganization } = useOrganization();

  return (
    <select
      value={currentOrg?.id}
      onChange={(e) => switchOrganization(e.target.value)}
    >
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
```

### Permission Checking

```tsx
import { usePermissions } from "@/contexts/collaboration";

function ProtectedButton() {
  const { canEdit, canAdmin, hasPermission } = usePermissions();

  if (!canEdit) {
    return <span>Read-only mode</span>;
  }

  return (
    <div>
      <button>Edit</button>
      {canAdmin && <button>Admin Settings</button>}
      {hasPermission("delete") && <button>Delete</button>}
    </div>
  );
}
```

### User Presence

```tsx
import { usePresence } from "@/contexts/collaboration";

function ActiveUsersList() {
  const { activeUsers } = usePresence();

  return (
    <div className="active-users">
      <h3>Active Users ({activeUsers.length})</h3>
      <ul>
        {activeUsers.map((user) => (
          <li key={user.id}>
            <Avatar src={user.avatar} />
            <span>{user.name}</span>
            <StatusDot status={user.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Edit Locks

```tsx
import { useEditLock } from "@/contexts/collaboration";

function WorkflowEditor({ workflowId }) {
  const { currentLock, acquireEditLock, releaseEditLock, hasLock } =
    useEditLock();

  const handleStartEdit = async () => {
    try {
      await acquireEditLock("workflow", workflowId);
      // Lock acquired, enable editing
    } catch (error) {
      alert("Cannot acquire lock. Someone else is editing.");
    }
  };

  const handleStopEdit = async () => {
    await releaseEditLock();
  };

  const isEditing = hasLock("workflow", workflowId);

  return (
    <div>
      {!isEditing ? (
        <button onClick={handleStartEdit}>Start Editing</button>
      ) : (
        <>
          <WorkflowCanvas />
          <button onClick={handleStopEdit}>Stop Editing</button>
        </>
      )}
      {currentLock && !isEditing && (
        <div className="locked-notice">Locked by {currentLock.user_name}</div>
      )}
    </div>
  );
}
```

### Comments

```tsx
import { useComments } from "@/contexts/collaboration";

function CommentSection() {
  const { comments, addComment, deleteComment, refreshComments } =
    useComments();
  const [newComment, setNewComment] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    await addComment(newComment);
    setNewComment("");
  };

  return (
    <div className="comments">
      <h3>Comments ({comments.length})</h3>

      <form onSubmit={handleSubmit}>
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
        />
        <button type="submit">Post</button>
      </form>

      <div className="comment-list">
        {comments.map((comment) => (
          <Comment
            key={comment.id}
            comment={comment}
            onDelete={() => deleteComment(comment.id)}
          />
        ))}
      </div>

      <button onClick={refreshComments}>Refresh</button>
    </div>
  );
}
```

### Activity Feed

```tsx
import { useActivity } from "@/contexts/collaboration";

function ActivityFeed() {
  const { activityFeed, refreshActivity } = useActivity();

  return (
    <div className="activity-feed">
      <div className="header">
        <h3>Recent Activity</h3>
        <button onClick={refreshActivity}>Refresh</button>
      </div>

      <ul>
        {activityFeed.map((activity) => (
          <li key={activity.id}>
            <ActivityIcon type={activity.type} />
            <span className="user">{activity.user_name}</span>
            <span className="action">{activity.description}</span>
            <span className="time">{formatTime(activity.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### WebSocket Status

```tsx
import { useWebSocket } from "@/contexts/collaboration";

function ConnectionStatus() {
  const { isConnected, connect, disconnect } = useWebSocket();

  return (
    <div className="connection-status">
      <div
        className={`indicator ${isConnected ? "connected" : "disconnected"}`}
      >
        {isConnected ? "● Connected" : "○ Disconnected"}
      </div>

      {!isConnected && <button onClick={connect}>Reconnect</button>}

      {isConnected && <button onClick={disconnect}>Disconnect</button>}
    </div>
  );
}
```

---

## Common Patterns

### Pattern 1: Permission-Based Rendering

```tsx
import { usePermissions } from "@/contexts/collaboration";

function ConditionalFeatures() {
  const { canView, canComment, canEdit, canAdmin } = usePermissions();

  return (
    <div>
      {canView && <ViewerPanel />}
      {canComment && <CommentButton />}
      {canEdit && <EditToolbar />}
      {canAdmin && <AdminSettings />}
    </div>
  );
}
```

### Pattern 2: Combining Multiple Contexts

```tsx
import {
  usePermissions,
  useEditLock,
  useComments,
} from "@/contexts/collaboration";

function SmartEditor({ workflowId }) {
  const { canEdit } = usePermissions();
  const { currentLock, acquireEditLock } = useEditLock();
  const { addComment } = useComments();

  const handleEdit = async () => {
    if (!canEdit) {
      await addComment("I need edit access to this workflow");
      return;
    }

    if (currentLock) {
      alert("Already being edited by someone else");
      return;
    }

    await acquireEditLock("workflow", workflowId);
  };

  return (
    <button onClick={handleEdit}>{canEdit ? "Edit" : "Request Access"}</button>
  );
}
```

### Pattern 3: Real-time Collaboration Indicator

```tsx
import {
  usePresence,
  useEditLock,
  useWebSocket,
} from "@/contexts/collaboration";

function CollaborationIndicator({ workflowId }) {
  const { activeUsers } = usePresence();
  const { currentLock } = useEditLock();
  const { isConnected } = useWebSocket();

  const viewers = activeUsers.filter(
    (u) =>
      u.current_resource_type === "workflow" &&
      u.current_resource_id === workflowId
  );

  return (
    <div className="collab-indicator">
      {!isConnected && <OfflineIcon />}

      <div className="viewers">
        {viewers.map((user) => (
          <Avatar key={user.id} user={user} />
        ))}
      </div>

      {currentLock && (
        <div className="lock-status">
          <LockIcon />
          <span>Editing: {currentLock.user_name}</span>
        </div>
      )}
    </div>
  );
}
```

---

## Real-World Components

### Example 1: Workflow Dashboard

```tsx
import {
  useOrganization,
  usePermissions,
  useActivity,
  useWebSocket,
} from "@/contexts/collaboration";

function WorkflowDashboard() {
  const { currentOrg } = useOrganization();
  const { canEdit, canAdmin } = usePermissions();
  const { activityFeed } = useActivity();
  const { isConnected } = useWebSocket();

  return (
    <div className="dashboard">
      {/* Header */}
      <header>
        <h1>{currentOrg?.name} - Workflows</h1>
        <ConnectionBadge isConnected={isConnected} />
      </header>

      {/* Main Content */}
      <div className="content">
        <WorkflowList />

        {canEdit && (
          <aside>
            <CreateWorkflowButton />
          </aside>
        )}
      </div>

      {/* Sidebar */}
      <aside className="activity-sidebar">
        <h3>Recent Activity</h3>
        <ActivityList items={activityFeed} />
      </aside>

      {/* Admin Panel */}
      {canAdmin && (
        <section className="admin-panel">
          <AdminControls />
        </section>
      )}
    </div>
  );
}
```

### Example 2: Collaborative Canvas Editor

```tsx
import {
  usePermissions,
  usePresence,
  useEditLock,
  useComments,
} from "@/contexts/collaboration";

function CanvasEditor({ workflowId }) {
  const { canEdit } = usePermissions();
  const { activeUsers } = usePresence();
  const { currentLock, acquireEditLock, releaseEditLock, hasLock } =
    useEditLock();
  const { comments, addComment } = useComments();

  const [selectedPosition, setSelectedPosition] = useState(null);

  const handleCanvasClick = (position) => {
    if (!hasLock("workflow", workflowId)) {
      setSelectedPosition(position);
    }
  };

  const handleAddComment = async (content) => {
    await addComment(content, selectedPosition);
    setSelectedPosition(null);
  };

  const isEditing = hasLock("workflow", workflowId);
  const isLocked = currentLock && !isEditing;

  return (
    <div className="canvas-editor">
      {/* Toolbar */}
      <Toolbar>
        {canEdit && !isEditing && (
          <button onClick={() => acquireEditLock("workflow", workflowId)}>
            Start Editing
          </button>
        )}
        {isEditing && <button onClick={releaseEditLock}>Stop Editing</button>}
      </Toolbar>

      {/* Canvas */}
      <Canvas onClick={handleCanvasClick} readOnly={!isEditing}>
        {/* Render workflow nodes */}
        <WorkflowNodes disabled={!isEditing} />

        {/* Render comments as annotations */}
        {comments.map((comment) => (
          <CommentMarker
            key={comment.id}
            comment={comment}
            position={comment.position}
          />
        ))}

        {/* Show cursors of active users */}
        {activeUsers.map((user) => (
          <Cursor
            key={user.id}
            position={user.cursor_position}
            color={user.color}
            name={user.name}
          />
        ))}
      </Canvas>

      {/* Lock Notice */}
      {isLocked && (
        <div className="lock-notice">
          <LockIcon />
          <span>Currently being edited by {currentLock.user_name}</span>
        </div>
      )}

      {/* Comment Dialog */}
      {selectedPosition && (
        <CommentDialog
          position={selectedPosition}
          onSubmit={handleAddComment}
          onCancel={() => setSelectedPosition(null)}
        />
      )}

      {/* Active Users */}
      <ActiveUsersList users={activeUsers} />
    </div>
  );
}
```

### Example 3: Comments Sidebar with Threads

```tsx
import { useComments, usePermissions } from "@/contexts/collaboration";

function CommentsSidebar() {
  const { comments, addComment, updateComment, deleteComment } = useComments();
  const { canComment, canEdit } = usePermissions();
  const [replyingTo, setReplyingTo] = useState(null);

  const threads = groupCommentsIntoThreads(comments);

  const handleReply = async (threadId, content) => {
    await addComment(content, { thread_id: threadId });
    setReplyingTo(null);
  };

  return (
    <aside className="comments-sidebar">
      <h2>Comments</h2>

      {canComment && <NewCommentForm onSubmit={addComment} />}

      <div className="threads">
        {threads.map((thread) => (
          <CommentThread
            key={thread.id}
            thread={thread}
            onReply={canComment ? setReplyingTo : undefined}
            onEdit={canEdit ? updateComment : undefined}
            onDelete={canEdit ? deleteComment : undefined}
          />
        ))}
      </div>

      {replyingTo && (
        <ReplyDialog
          threadId={replyingTo}
          onSubmit={(content) => handleReply(replyingTo, content)}
          onCancel={() => setReplyingTo(null)}
        />
      )}
    </aside>
  );
}
```

---

## Advanced Usage

### Custom Hook: Combined Permission Check

```tsx
import { usePermissions } from "@/contexts/collaboration";

function useCanPerformAction(action: "view" | "comment" | "edit" | "delete") {
  const { canView, canComment, canEdit, hasPermission } = usePermissions();

  switch (action) {
    case "view":
      return canView;
    case "comment":
      return canComment;
    case "edit":
      return canEdit;
    case "delete":
      return hasPermission("admin");
    default:
      return false;
  }
}

// Usage
function ActionButton({ action }) {
  const canPerform = useCanPerformAction(action);

  return <button disabled={!canPerform}>{action}</button>;
}
```

### Custom Hook: Lock Management

```tsx
import { useEditLock } from "@/contexts/collaboration";
import { useEffect } from "react";

function useAutoAcquireLock(
  resourceType: ResourceType,
  resourceId: string,
  shouldAcquire: boolean
) {
  const { acquireEditLock, releaseEditLock, hasLock } = useEditLock();

  useEffect(() => {
    if (shouldAcquire && !hasLock(resourceType, resourceId)) {
      acquireEditLock(resourceType, resourceId);
    }

    return () => {
      if (hasLock(resourceType, resourceId)) {
        releaseEditLock();
      }
    };
  }, [shouldAcquire, resourceType, resourceId]);

  return hasLock(resourceType, resourceId);
}

// Usage
function AutoLockEditor({ workflowId, autoEdit }) {
  const isLocked = useAutoAcquireLock("workflow", workflowId, autoEdit);

  return <Editor readOnly={!isLocked} />;
}
```

### Custom Hook: Real-time Comment Notifications

```tsx
import { useComments } from "@/contexts/collaboration";
import { useEffect, useRef } from "react";

function useCommentNotifications() {
  const { comments } = useComments();
  const prevCountRef = useRef(comments.length);

  useEffect(() => {
    if (comments.length > prevCountRef.current) {
      const newComment = comments[comments.length - 1];
      showNotification(`New comment from ${newComment.user_name}`);
    }
    prevCountRef.current = comments.length;
  }, [comments]);
}

// Usage
function NotifiedCommentSection() {
  useCommentNotifications();
  const { comments } = useComments();

  return <CommentList comments={comments} />;
}
```

### Selective Context Usage

```tsx
// Only import and use what you need
import { PermissionsProvider, usePermissions } from "@/contexts/collaboration";

// This component doesn't need other contexts
function MinimalComponent() {
  return (
    <PermissionsProvider>
      <ProtectedContent />
    </PermissionsProvider>
  );
}

function ProtectedContent() {
  const { canView, canEdit } = usePermissions();

  if (!canView) return <AccessDenied />;

  return (
    <div>
      <Content />
      {canEdit && <EditButton />}
    </div>
  );
}
```

---

## Testing Examples

### Testing with Individual Contexts

```tsx
import { render, screen } from "@testing-library/react";
import { CommentsProvider } from "@/contexts/collaboration";

describe("CommentSection", () => {
  it("displays comments", async () => {
    const mockComments = [
      { id: "1", content: "Test comment", user_name: "John" },
    ];

    jest.spyOn(commentService, "getComments").mockResolvedValue(mockComments);

    render(
      <CommentsProvider projectId="test" workflowId="test">
        <CommentSection />
      </CommentsProvider>
    );

    expect(await screen.findByText("Test comment")).toBeInTheDocument();
  });
});
```

### Testing Permission Logic

```tsx
import { renderHook } from "@testing-library/react";
import { PermissionsProvider, usePermissions } from "@/contexts/collaboration";

describe("usePermissions", () => {
  it("calculates permissions correctly", () => {
    const wrapper = ({ children }) => (
      <PermissionsProvider initialAccess="edit">{children}</PermissionsProvider>
    );

    const { result } = renderHook(() => usePermissions(), { wrapper });

    expect(result.current.canView).toBe(true);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canAdmin).toBe(false);
  });
});
```

---

## Performance Tips

### 1. Use Only What You Need

```tsx
// ❌ Bad: Imports everything
const collaboration = useCollaboration(); // deprecated anyway

// ✅ Good: Only import what you need
const { canEdit } = usePermissions();
```

### 2. Memoize Expensive Calculations

```tsx
import { useComments } from "@/contexts/collaboration";
import { useMemo } from "react";

function CommentStats() {
  const { comments } = useComments();

  const stats = useMemo(
    () => ({
      total: comments.length,
      resolved: comments.filter((c) => c.resolved).length,
      byUser: groupByUser(comments),
    }),
    [comments]
  );

  return <div>{/* render stats */}</div>;
}
```

### 3. Split Components by Context

```tsx
// ✅ Good: Each component uses only what it needs
function Dashboard() {
  return (
    <div>
      <OrgSelector /> {/* uses useOrganization */}
      <PermissionBadge /> {/* uses usePermissions */}
      <ActiveUsers /> {/* uses usePresence */}
    </div>
  );
}

// Each component re-renders independently
```

---

This examples file should give you a comprehensive understanding of how to use the refactored collaboration contexts in various scenarios!
