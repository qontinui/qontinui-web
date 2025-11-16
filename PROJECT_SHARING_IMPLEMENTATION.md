# Project Sharing UI Implementation

This document summarizes the project sharing functionality added to the automation builder and project pages.

## Overview

Added comprehensive project sharing capabilities to the qontinui-web automation builder, allowing users to:
- Share projects with individual users or organizations
- Set granular permission levels (View, Comment, Edit, Admin)
- Set optional expiration dates for shared access
- Manage collaborators and their permissions
- View sharing status and permissions in the UI

## Files Created

### 1. ShareProjectDialog Component
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/components/ShareProjectDialog.tsx`

**Features:**
- Dual mode sharing: individual users or entire organizations
- Email input for user sharing with validation
- Organization dropdown selector
- Permission level selector (View, Comment, Edit, Admin)
- Optional expiration date picker with calendar icon
- Live collaborator list with:
  - Avatar/initials
  - Email display
  - Permission badges
  - Inline permission editing
  - Remove access button
- Share link generation and copy functionality
- Loading states and error handling
- Toast notifications for all actions

**UI Design:**
- Dark theme matching automation builder
- Color-coded permission badges
- Responsive layout with max height for scrolling
- Clean separation between sharing modes
- Disabled state for owner permissions

### 2. useProjectSharing Hook
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/hooks/useProjectSharing.ts`

**Functionality:**
- Manages sharing state (collaborators, organizations)
- Integrates with existing collaboration services:
  - `ProjectCollaborationService` for sharing operations
  - `OrganizationService` for organization management
- Provides methods:
  - `addUser(email, permission, expiresAt?)` - Share with user
  - `addOrganization(orgId, permission, expiresAt?)` - Share with org
  - `changePermission(collaboratorId, permission)` - Update permissions
  - `revokeAccess(collaboratorId)` - Remove access
  - `generateShareLink()` - Generate shareable link
  - `getMyPermission()` - Get current user's permission
  - `reload()` - Refresh collaborator list
- Auto-loads data when enabled
- Optimistic UI updates for permission changes

### 3. PermissionBadge Component
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/components/PermissionBadge.tsx`

**Features:**
- Color-coded badges for each permission level:
  - **View** - Gray with Eye icon
  - **Comment** - Blue with Mail icon
  - **Edit** - Green with Edit icon
  - **Admin** - Purple with Shield icon
  - **Owner** - Amber with Crown icon
- Three size variants (sm, md, lg)
- Compact icon-only variant (`PermissionIcon`)
- Consistent with UI design system

## Files Modified

### 1. EditorToolbar Component
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/components/EditorToolbar.tsx`

**Changes:**
- Added Share2 icon import
- Added `onShare` prop to interface
- Added Share button with icon and label
- Positioned Share button in right-side secondary actions
- Added divider before Import/Export buttons
- Disabled when no item selected

### 2. AutomationBuilder Component
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/AutomationBuilder.tsx`

**Changes:**
- Added `shareDialogOpen` state
- Imported `ShareProjectDialog` and `useProjectSharing`
- Added `PermissionLevel` type import
- Integrated `useProjectSharing` hook with project ID and enabled flag
- Added `myPermission` state to track current user's permission
- Added `handleShare` callback to open dialog
- Passed sharing props to `ItemMetadataPanel`
- Rendered `ShareProjectDialog` at component root
- Auto-loads permission when selected item changes

### 3. ItemMetadataPanel Component
**Location:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/components/automation-builder/components/ItemMetadataPanel.tsx`

**Changes:**
- Added `PermissionBadge` import
- Added `PermissionLevel` type import
- Added `Users` icon import
- Extended props interface:
  - `currentPermission?: PermissionLevel`
  - `collaboratorCount?: number`
  - `onOpenShare?: () => void`
- Added permission badge next to workflow type badge
- Added sharing info section showing:
  - Collaborator count with Users icon
  - "Not shared" state when no collaborators
  - "Manage" button to open share dialog

## API Integration

### Existing Services Used

The implementation leverages existing collaboration services:

1. **ProjectCollaborationService** (`/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/services/collaboration/project-collaboration-service.ts`)
   - `shareProject(projectId, userId, permission)` - POST `/api/v1/projects/{id}/share`
   - `shareWithOrganization(projectId, orgId, permission)` - POST `/api/v1/projects/{id}/share`
   - `getCollaborators(projectId)` - GET `/api/v1/projects/{id}/collaborators`
   - `updateCollaboratorPermission(projectId, userId, permission)` - PUT `/api/v1/projects/{id}/collaborators/{userId}`
   - `revokeAccess(projectId, userId)` - DELETE `/api/v1/projects/{id}/collaborators/{userId}`
   - `getProjectAccessLevel(projectId)` - GET `/api/v1/projects/{id}/permissions`

2. **OrganizationService** (`/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/services/collaboration/organization-service.ts`)
   - `getOrganizations()` - GET `/api/v1/organizations/`

### Expected Backend Endpoints

The following API endpoints should exist or be created:

1. **POST** `/api/v1/projects/{id}/share`
   - Share project with user or organization
   - Body: `{ user_id?: string, organization_id?: string, permission: PermissionLevel, expires_at?: string }`
   - Response: `201 Created`

2. **GET** `/api/v1/projects/{id}/collaborators`
   - Get all collaborators for a project
   - Response: `Collaborator[]`

3. **PUT** `/api/v1/projects/{id}/collaborators/{userId}`
   - Update collaborator permission
   - Body: `{ permission: PermissionLevel }`
   - Response: `Collaborator`

4. **DELETE** `/api/v1/projects/{id}/collaborators/{userId}`
   - Revoke collaborator access
   - Response: `204 No Content`

5. **GET** `/api/v1/projects/{id}/permissions`
   - Get current user's permission level
   - Response: `{ permission: PermissionLevel }`

6. **GET** `/api/v1/organizations/`
   - Get user's organizations
   - Response: `Organization[]`

### Share Link Generation

The `generateShareLink` function currently returns a placeholder:
```typescript
`${baseUrl}/shared/project/${projectId}?token=PLACEHOLDER_TOKEN`
```

To implement fully, create a backend endpoint:
- **POST** `/api/v1/projects/{id}/share-link`
- Generates a unique token for public/link-based sharing
- Returns: `{ link: string, token: string, expires_at?: string }`

## Types Used

All types are defined in `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/frontend/src/types/collaboration.ts`:

```typescript
type PermissionLevel = 'none' | 'view' | 'comment' | 'edit' | 'admin' | 'owner';

interface Collaborator {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  name: string | null;
  permission: PermissionLevel;
  added_at: string;
  added_by: string;
}

interface Organization {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
  member_count: number;
  project_count: number;
}

interface ProjectShare {
  user_id?: string;
  organization_id?: string;
  permission: PermissionLevel;
}
```

## User Interface Locations

### 1. Automation Builder Toolbar
**Location:** Top center of automation builder
- Share button with Share2 icon and "Share" label
- Appears when a workflow is selected
- Opens ShareProjectDialog on click

### 2. Share Project Dialog
**Access:** Click "Share" button in toolbar
- Modal dialog with dark theme
- Max width: 2xl (32rem / 512px)
- Max height: 85vh with scrolling
- Sections:
  - Mode tabs (User/Organization)
  - Share form with permission selector and expiration
  - Share link section (if enabled)
  - Collaborator list

### 3. Item Metadata Panel
**Location:** Right sidebar when workflow selected
- Permission badge next to workflow type
- Sharing info card with:
  - Collaborator count
  - "Manage" button to open share dialog
- Shows when `currentPermission` or `collaboratorCount` provided

## Features Summary

### Permission Levels
1. **View** - Can view the project
2. **Comment** - Can view and add comments
3. **Edit** - Can view, comment, and edit
4. **Admin** - Full control except ownership transfer
5. **Owner** - Complete control (cannot be changed/removed)

### Sharing Options
- **Share with user** - Enter email address
- **Share with organization** - Select from dropdown
- **Set expiration date** - Optional date picker
- **Generate share link** - Copy shareable URL

### Permission Management
- **Change permission** - Inline dropdown for each collaborator
- **Remove access** - Trash button with confirmation
- **View current permission** - Badge in metadata panel
- **Collaborator count** - Displayed in metadata panel

### Visual Indicators
- Color-coded permission badges
- User avatars with initials
- Loading spinners for async operations
- Toast notifications for success/error
- Disabled states for protected actions
- Empty state messages

## Testing Checklist

- [ ] Open share dialog from toolbar
- [ ] Share with individual user by email
- [ ] Share with organization from dropdown
- [ ] Set expiration date for shared access
- [ ] Change collaborator permission level
- [ ] Remove collaborator access
- [ ] Generate and copy share link
- [ ] View permission badge in metadata panel
- [ ] View collaborator count in metadata panel
- [ ] Click "Manage" to open share dialog
- [ ] Handle errors gracefully
- [ ] Verify toast notifications appear
- [ ] Test with no collaborators (empty state)
- [ ] Test with owner permission (non-editable)
- [ ] Test responsive layout

## Future Enhancements

1. **Email Invitations**
   - Send email notifications to new collaborators
   - Include accept/decline functionality
   - Track invitation status

2. **Access Expiration**
   - Fully implement expiration date logic in backend
   - Show expiration dates in collaborator list
   - Auto-revoke expired access
   - Send expiration warnings

3. **Advanced Permissions**
   - Custom permission sets
   - Role-based access control
   - Granular permissions (read actions, write actions, etc.)

4. **Activity Tracking**
   - Log sharing events
   - Show who shared with whom
   - Track permission changes
   - Display in activity feed

5. **Bulk Operations**
   - Share with multiple users at once
   - Bulk permission updates
   - Import collaborators from CSV

6. **Share Templates**
   - Save common sharing configurations
   - Quick apply to multiple projects
   - Default sharing rules for new projects

7. **Collaboration Features**
   - Real-time presence indicators
   - Live cursors for concurrent editing
   - Comments and annotations
   - Change tracking and version history

## Notes

- The implementation follows the existing code style and patterns
- All UI components use the project's design system (shadcn/ui)
- Dark theme consistent with automation builder
- TypeScript strictly typed throughout
- Error handling with user-friendly messages
- Optimistic UI updates for better UX
- Accessible with proper ARIA labels and keyboard support

## Conclusion

This implementation provides a complete project sharing system for the automation builder, allowing teams to collaborate effectively on workflows with granular permission controls and an intuitive UI.
