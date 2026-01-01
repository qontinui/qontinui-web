# Permission Utilities - Integration Examples

## Full Component Examples

### 1. Project Editor Component

```tsx
import React from "react";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";
import { PermissionGate } from "@/components/collaboration/PermissionGate";
import type { Project } from "@/lib/schemas";

interface ProjectEditorProps {
  project: Project;
}

export function ProjectEditor({ project }: ProjectEditorProps) {
  const { canEdit, canComment, canAdmin, isOwner, permissionLevel, isLoading } =
    useProjectPermissions(project);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!canEdit) {
    return (
      <div>
        <ReadOnlyBanner />
        <ProjectViewer project={project} />
      </div>
    );
  }

  return (
    <div className="project-editor">
      <header>
        <h1>{project.name}</h1>
        <PermissionBadge level={permissionLevel} />
      </header>

      <main>
        <WorkflowEditor project={project} />

        {/* Comments panel - visible if can comment */}
        <PermissionGate project={project} requiredPermission="comment">
          <CommentPanel projectId={project.id} />
        </PermissionGate>
      </main>

      <aside>
        {/* Edit tools - visible if can edit */}
        {canEdit && (
          <section>
            <h2>Edit Tools</h2>
            <EditToolbar />
            <SaveButton />
          </section>
        )}

        {/* Admin tools - visible if can admin */}
        <PermissionGate project={project} requiredPermission="admin">
          <section>
            <h2>Admin Tools</h2>
            <ShareProjectButton />
            <ManageCollaborators />
          </section>
        </PermissionGate>

        {/* Owner tools - visible if owner */}
        {isOwner && (
          <section>
            <h2>Owner Tools</h2>
            <TransferOwnership />
            <DeleteProjectButton />
          </section>
        )}
      </aside>
    </div>
  );
}
```

### 2. Project List with Permission Indicators

```tsx
import React from "react";
import { useProjects } from "@/hooks/use-projects";
import { getPermissionLabel } from "@/lib/permissions";
import { PermissionGate } from "@/components/collaboration/PermissionGate";

export function ProjectList() {
  const { data: projects, isLoading } = useProjects();

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="project-list">
      {projects?.map((project) => (
        <div key={project.id} className="project-card">
          <h3>{project.name}</h3>
          <p>{project.description}</p>

          {/* Show permission level */}
          <span className="permission-badge">
            {getPermissionLabel(project.permission_level || "view")}
          </span>

          {/* Show actions based on permission */}
          <div className="actions">
            <button>View</button>

            <PermissionGate project={project} requiredPermission="edit">
              <button>Edit</button>
            </PermissionGate>

            <PermissionGate project={project} requiredPermission="admin">
              <button>Share</button>
            </PermissionGate>

            <PermissionGate project={project} requiredPermission="owner">
              <button>Delete</button>
            </PermissionGate>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 3. Collaboration Sidebar

```tsx
import React from "react";
import { useCollaboration } from "@/contexts/collaboration-context";
import { PermissionGate } from "@/components/collaboration/PermissionGate";

export function CollaborationSidebar({ project }) {
  const { activeUsers, comments, canComment, canAdmin, addComment } =
    useCollaboration();

  return (
    <aside className="collaboration-sidebar">
      {/* Active users - visible to all */}
      <section>
        <h2>Active Users</h2>
        <UserPresenceList users={activeUsers} />
      </section>

      {/* Comments - visible if can comment */}
      {canComment && (
        <section>
          <h2>Comments</h2>
          <CommentList comments={comments} />
          <CommentForm onSubmit={addComment} />
        </section>
      )}

      {/* Collaboration settings - visible if can admin */}
      <PermissionGate project={project} requiredPermission="admin">
        <section>
          <h2>Collaboration Settings</h2>
          <CollaborationSettings />
        </section>
      </PermissionGate>
    </aside>
  );
}
```

### 4. Permission Management UI

```tsx
import React, { useState } from "react";
import {
  useProjectPermissions,
  useIsProjectOwner,
} from "@/hooks/useProjectPermissions";
import {
  getPermissionLevelOptions,
  type PermissionLevel,
} from "@/lib/permissions";

interface CollaboratorRowProps {
  collaborator: {
    id: string;
    email: string;
    permission: PermissionLevel;
  };
  onUpdate: (id: string, permission: PermissionLevel) => void;
  onRemove: (id: string) => void;
}

function CollaboratorRow({
  collaborator,
  onUpdate,
  onRemove,
}: CollaboratorRowProps) {
  const options = getPermissionLevelOptions();

  return (
    <tr>
      <td>{collaborator.email}</td>
      <td>
        <select
          value={collaborator.permission}
          onChange={(e) =>
            onUpdate(collaborator.id, e.target.value as PermissionLevel)
          }
        >
          {options.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button onClick={() => onRemove(collaborator.id)}>Remove</button>
      </td>
    </tr>
  );
}

export function PermissionManagement({ project, collaborators }) {
  const isOwner = useIsProjectOwner(project);
  const [newCollaborator, setNewCollaborator] = useState({
    email: "",
    permission: "view" as PermissionLevel,
  });

  if (!isOwner) {
    return <div>Only the project owner can manage permissions.</div>;
  }

  const handleAdd = async () => {
    // API call to add collaborator
    await addCollaborator(project.id, newCollaborator);
    setNewCollaborator({ email: "", permission: "view" });
  };

  const handleUpdate = async (id: string, permission: PermissionLevel) => {
    // API call to update permission
    await updateCollaboratorPermission(project.id, id, permission);
  };

  const handleRemove = async (id: string) => {
    // API call to remove collaborator
    await removeCollaborator(project.id, id);
  };

  return (
    <div className="permission-management">
      <h2>Manage Collaborators</h2>

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Permission</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {collaborators.map((collaborator) => (
            <CollaboratorRow
              key={collaborator.id}
              collaborator={collaborator}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
            />
          ))}
        </tbody>
      </table>

      <div className="add-collaborator">
        <h3>Add Collaborator</h3>
        <input
          type="email"
          placeholder="Email"
          value={newCollaborator.email}
          onChange={(e) =>
            setNewCollaborator({ ...newCollaborator, email: e.target.value })
          }
        />
        <PermissionSelector
          value={newCollaborator.permission}
          onChange={(permission) =>
            setNewCollaborator({ ...newCollaborator, permission })
          }
        />
        <button onClick={handleAdd}>Add</button>
      </div>
    </div>
  );
}
```

### 5. Workflow Builder with Permissions

```tsx
import React from "react";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";
import { PermissionGate } from "@/components/collaboration/PermissionGate";

export function WorkflowBuilder({ project, workflow }) {
  const { canEdit, canComment, isLoading } = useProjectPermissions(project);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="workflow-builder">
      {/* Canvas - always visible */}
      <WorkflowCanvas workflow={workflow} readOnly={!canEdit} />

      {/* Editing toolbar - only if can edit */}
      <PermissionGate
        project={project}
        requiredPermission="edit"
        fallback={<ReadOnlyToolbar />}
      >
        <EditingToolbar />
      </PermissionGate>

      {/* Properties panel */}
      <PropertiesPanel workflow={workflow} readOnly={!canEdit} />

      {/* Comment overlay - if can comment */}
      {canComment && <CommentOverlay workflowId={workflow.id} />}
    </div>
  );
}
```

### 6. Context Menu with Permission Filtering

```tsx
import React from "react";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";

interface ContextMenuProps {
  project: Project;
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ project, x, y, onClose }: ContextMenuProps) {
  const { canEdit, canAdmin, isOwner } = useProjectPermissions(project);

  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      {/* View actions - always available */}
      <MenuItem onClick={handleView}>View Details</MenuItem>
      <MenuItem onClick={handleCopy}>Copy</MenuItem>

      {/* Edit actions - only if can edit */}
      {canEdit && (
        <>
          <MenuDivider />
          <MenuItem onClick={handleEdit}>Edit</MenuItem>
          <MenuItem onClick={handleDuplicate}>Duplicate</MenuItem>
        </>
      )}

      {/* Admin actions - only if can admin */}
      {canAdmin && (
        <>
          <MenuDivider />
          <MenuItem onClick={handleShare}>Share</MenuItem>
          <MenuItem onClick={handleExport}>Export</MenuItem>
        </>
      )}

      {/* Owner actions - only if owner */}
      {isOwner && (
        <>
          <MenuDivider />
          <MenuItem onClick={handleDelete} variant="danger">
            Delete
          </MenuItem>
        </>
      )}
    </div>
  );
}
```

### 7. Form with Permission Checks

```tsx
import React, { useState } from "react";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";

export function ProjectSettingsForm({ project }) {
  const { canEdit, canAdmin, isOwner, isLoading } =
    useProjectPermissions(project);
  const [formData, setFormData] = useState({
    name: project.name,
    description: project.description,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canEdit) {
      toast.error("You do not have permission to edit this project");
      return;
    }

    try {
      await updateProject(project.id, formData);
      toast.success("Project updated");
    } catch (error) {
      toast.error("Failed to update project");
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Basic info - editable if can edit */}
      <fieldset disabled={!canEdit}>
        <legend>Basic Information</legend>
        <input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
        <textarea
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
        />
      </fieldset>

      {/* Advanced settings - only if can admin */}
      {canAdmin && (
        <fieldset>
          <legend>Advanced Settings</legend>
          <AdvancedSettings project={project} />
        </fieldset>
      )}

      {/* Danger zone - only if owner */}
      {isOwner && (
        <fieldset className="danger-zone">
          <legend>Danger Zone</legend>
          <TransferOwnershipButton />
          <DeleteProjectButton />
        </fieldset>
      )}

      {/* Submit button */}
      <button type="submit" disabled={!canEdit}>
        Save Changes
      </button>
    </form>
  );
}
```

### 8. Permission-aware Navigation

```tsx
import React from "react";
import { useParams, Navigate } from "react-router-dom";
import { useProject } from "@/hooks/use-projects";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";

export function ProjectRoute({ children, requiredPermission }) {
  const { projectId } = useParams();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { hasPermission, isLoading: permissionLoading } =
    useProjectPermissions(project);

  if (projectLoading || permissionLoading) {
    return <LoadingPage />;
  }

  if (!project) {
    return <Navigate to="/projects" />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div>
        <h1>Access Denied</h1>
        <p>You don't have permission to access this page.</p>
        <Link to={`/projects/${projectId}`}>Go to project overview</Link>
      </div>
    );
  }

  return <>{children}</>;
}

// Usage in router
<Route path="/projects/:projectId">
  <Route index element={<ProjectOverview />} />
  <Route
    path="edit"
    element={
      <ProjectRoute requiredPermission="edit">
        <ProjectEditor />
      </ProjectRoute>
    }
  />
  <Route
    path="settings"
    element={
      <ProjectRoute requiredPermission="admin">
        <ProjectSettings />
      </ProjectRoute>
    }
  />
</Route>;
```

### 9. Real-time Collaboration with Permissions

```tsx
import React, { useEffect } from "react";
import { useCollaboration } from "@/contexts/collaboration-context";
import { useProjectPermissions } from "@/hooks/useProjectPermissions";

export function CollaborativeEditor({ project, workflow }) {
  const { canEdit, canComment } = useProjectPermissions(project);
  const { activeUsers, currentLock, acquireEditLock, releaseEditLock } =
    useCollaboration();

  // Acquire lock when entering edit mode
  useEffect(() => {
    if (canEdit) {
      acquireEditLock("workflow", workflow.id);
      return () => releaseEditLock();
    }
  }, [canEdit, workflow.id]);

  // Check if someone else is editing
  const isLockedByOther = currentLock && !currentLock.isOwnedByCurrentUser;

  return (
    <div className="collaborative-editor">
      {/* Show active users */}
      <ActiveUsersIndicator users={activeUsers} />

      {/* Show lock status */}
      {isLockedByOther && (
        <Banner>
          {currentLock.user_name} is currently editing this workflow
        </Banner>
      )}

      {/* Editor */}
      <Editor workflow={workflow} readOnly={!canEdit || isLockedByOther} />

      {/* Comment system */}
      {canComment && <CommentSystem workflowId={workflow.id} />}
    </div>
  );
}
```

### 10. Utility Functions for API Calls

```tsx
import { canUserEdit, canUserAdmin } from "@/lib/permissions";
import { useAuth } from "@/contexts/auth-context";

export async function saveWorkflow(project: Project, workflow: Workflow) {
  const { user } = useAuth();

  // Check permission before making API call
  if (!canUserEdit(project, user)) {
    throw new Error("You do not have permission to edit this project");
  }

  const response = await fetch(
    `/api/projects/${project.id}/workflows/${workflow.id}`,
    {
      method: "PUT",
      body: JSON.stringify(workflow),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to save workflow");
  }

  return response.json();
}

export async function shareProject(
  project: Project,
  email: string,
  permission: PermissionLevel
) {
  const { user } = useAuth();

  // Only admins can share projects
  if (!canUserAdmin(project, user)) {
    throw new Error("You do not have permission to share this project");
  }

  const response = await fetch(`/api/projects/${project.id}/share`, {
    method: "POST",
    body: JSON.stringify({ email, permission }),
  });

  if (!response.ok) {
    throw new Error("Failed to share project");
  }

  return response.json();
}
```

## Testing Examples

```typescript
import { render, screen } from '@testing-library/react';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { ProjectEditor } from './ProjectEditor';

// Mock the hook
jest.mock('@/hooks/useProjectPermissions');

describe('ProjectEditor', () => {
  it('shows editor when user can edit', () => {
    (useProjectPermissions as jest.Mock).mockReturnValue({
      canEdit: true,
      canComment: true,
      canAdmin: false,
      isOwner: false,
      isLoading: false,
    });

    render(<ProjectEditor project={mockProject} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('shows read-only view when user cannot edit', () => {
    (useProjectPermissions as jest.Mock).mockReturnValue({
      canEdit: false,
      canComment: true,
      canAdmin: false,
      isOwner: false,
      isLoading: false,
    });

    render(<ProjectEditor project={mockProject} />);
    expect(screen.getByText('Read-only mode')).toBeInTheDocument();
  });

  it('shows admin tools when user is admin', () => {
    (useProjectPermissions as jest.Mock).mockReturnValue({
      canEdit: true,
      canComment: true,
      canAdmin: true,
      isOwner: false,
      isLoading: false,
    });

    render(<ProjectEditor project={mockProject} />);
    expect(screen.getByText('Share Project')).toBeInTheDocument();
  });
});
```
