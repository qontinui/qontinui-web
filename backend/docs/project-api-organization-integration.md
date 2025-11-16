# Project API Organization Integration

## Summary

This document describes the updates made to the project API endpoints to integrate with the organization system. All project endpoints now support organization-based access control and permissions.

## Endpoints Modified

### 1. GET /api/v1/projects/

**Changes:**
- Added optional `organization_id` query parameter to filter projects by organization
- Changed from owner-only filtering to full permission-based filtering
- Returns all projects user has access to via ownership, direct access, or organization membership
- Uses `permission_service.get_user_accessible_projects()` for filtering

**Request Example:**
```http
GET /api/v1/projects/?organization_id=abc-123-def&skip=0&limit=100
```

**Response:** List of projects the user can access

**Permission Checks:**
- If `organization_id` provided: Verifies user is a member of that organization
- Returns only projects user has access to (via any access method)

---

### 2. POST /api/v1/projects/

**Changes:**
- Accepts optional `organization_id` in request body
- If `organization_id` provided: Validates user is a member and creates project in that org
- If `organization_id` not provided: Automatically uses user's personal organization
- Validates organization membership before creating project

**Request Example:**
```json
{
  "name": "My Project",
  "description": "Project description",
  "configuration": {},
  "organization_id": "abc-123-def"  // Optional
}
```

**Response:** Created project with `organization_id` field populated

**Permission Checks:**
- If `organization_id` provided: Requires user to be a "member" of the organization
- If `organization_id` not provided: Automatically uses personal organization (no check needed)

---

### 3. GET /api/v1/projects/{project_id}

**Changes:**
- Replaced `verify_project_access()` with `permission_service.can_user_access_project()`
- Checks for VIEW permission level using the new permission hierarchy
- Returns 403 if user lacks access

**Permission Checks:**
- Requires VIEW permission or higher
- Checks ownership, direct access, and organization membership

---

### 4. PUT /api/v1/projects/{project_id}

**Changes:**
- Replaced `verify_project_access()` with `permission_service.can_user_access_project()`
- Checks for EDIT permission level
- Returns 403 if user lacks access

**Permission Checks:**
- Requires EDIT permission or higher
- Checks ownership, direct access, and organization membership

---

### 5. DELETE /api/v1/projects/{project_id}

**Changes:**
- Replaced `verify_project_access()` with `permission_service.can_user_access_project()`
- Checks for ADMIN permission level (typically only owner has this)
- Returns 403 if user lacks access

**Permission Checks:**
- Requires ADMIN permission
- Typically only project owners have ADMIN permission

---

## New Endpoints Added

### GET /api/v1/organizations/{organization_id}/projects

**Purpose:** List all projects in a specific organization

**Request Example:**
```http
GET /api/v1/organizations/abc-123-def/projects?skip=0&limit=100
```

**Response:** List of projects in the organization

**Permission Checks:**
- Requires user to be a "member" of the organization
- Only returns projects the user has access to within that organization

**Implementation Details:**
- Gets all accessible projects for the user
- Filters to only projects where `organization_id` matches
- Applies pagination (skip/limit)

---

## Permission Service Updates

### New Method: `get_personal_organization()`

```python
async def get_personal_organization(
    db: AsyncSession,
    user_id: UUID
) -> Optional[Organization]
```

**Purpose:** Retrieve a user's personal organization

**Implementation:**
- Queries for organizations owned by user with slug containing "-personal"
- Returns the personal organization or None if not found

---

### New Method: `check_organization_membership()`

```python
async def check_organization_membership(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    required_role: str = "member"
) -> Optional[TeamMember]
```

**Purpose:** Check if user has required role in an organization

**Parameters:**
- `required_role`: String role name ("viewer", "member", "admin", "owner")

**Returns:**
- TeamMember object if user has required role
- None if user lacks required role

**Role Hierarchy:**
- viewer < member < admin < owner

---

## Schema Updates

### ProjectCreate Schema

**Added Field:**
```python
organization_id: UUID | None = None
```

**Purpose:** Allow specifying organization when creating a project

---

### ProjectInDBBase Schema

**Added Field:**
```python
organization_id: UuidAsString | None = None
```

**Purpose:** Include organization_id in all project responses

---

## CRUD Updates

### `create_project()` Function

**Added Parameter:**
```python
organization_id: UUID | None = None
```

**Changes:**
- Accepts optional `organization_id`
- Sets `project.organization_id` during creation

---

## Permission Hierarchy

### Permission Levels (for projects)

From lowest to highest:
1. **VIEW** - Can view project
2. **COMMENT** - Can view and comment
3. **EDIT** - Can view, comment, and edit
4. **ADMIN** - Full control (typically owner only)

### Team Roles (for organizations)

From lowest to highest:
1. **VIEWER** - Can view organization details
2. **MEMBER** - Can create projects in organization
3. **ADMIN** - Can manage members and settings
4. **OWNER** - Full control of organization

---

## Access Control Logic

### How Project Access is Determined

Users can access a project if ANY of these are true:

1. **Ownership:** User is the project owner (grants ADMIN permission)
2. **Direct Access:** User has a ProjectAccessControl entry (grants specified permission)
3. **Organization Access:** User is a member of an organization that has ProjectAccessControl (grants specified permission)

### Access Control Flow

```
1. Check if user is project owner → ADMIN permission
2. Check ProjectAccessControl for user_id match → Use specified permission
3. Check ProjectAccessControl for organization_id match + user is member → Use specified permission
4. No access found → Deny access (403)
```

---

## Breaking Changes

### None - Fully Backward Compatible

All changes are additive and backward compatible:

- **Existing projects:** Will work as before, using owner_id for access control
- **New optional fields:** organization_id is optional in ProjectCreate
- **Enhanced endpoints:** Existing functionality preserved, new features added
- **Permission checks:** More comprehensive but backward compatible

### Migration Considerations

- Existing projects should have their `organization_id` set to the owner's personal organization via migration
- The migration creates personal organizations for all existing users
- ProjectAccessControl entries were created during migration for existing projects

---

## Testing Recommendations

### Test Cases to Validate

1. **Create project without organization_id:**
   - Should default to user's personal organization
   - Should succeed for any authenticated user

2. **Create project with organization_id:**
   - Should succeed if user is member of that organization
   - Should fail (403) if user is not a member

3. **List projects:**
   - Should return all accessible projects (owned, directly shared, org shared)
   - Should filter by organization_id if provided
   - Should require org membership when filtering by organization_id

4. **Get single project:**
   - Should succeed with VIEW permission
   - Should fail (403) without VIEW permission

5. **Update project:**
   - Should succeed with EDIT permission
   - Should fail (403) without EDIT permission

6. **Delete project:**
   - Should succeed with ADMIN permission (typically owner only)
   - Should fail (403) without ADMIN permission

7. **List organization projects:**
   - Should succeed for organization members
   - Should fail (403) for non-members
   - Should only return projects user can access

---

## Code Structure

### Files Modified

1. `/backend/app/api/v1/endpoints/projects.py` - Project endpoints
2. `/backend/app/api/v1/endpoints/organizations.py` - Organization endpoints (added projects list)
3. `/backend/app/services/permission_service.py` - Permission checking service
4. `/backend/app/schemas/project.py` - Project schemas
5. `/backend/app/crud/project.py` - Project CRUD operations

### Key Dependencies

- `app.services.permission_service.permission_service` - Central permission checking
- `app.models.organization.PermissionLevel` - Permission level enum
- `app.models.organization.TeamRole` - Team role enum
- `app.models.organization.TeamMember` - Team membership model
- `app.models.organization.ProjectAccessControl` - Access control model

---

## API Documentation

### Permission Service Methods Used

```python
# Check if user can access a project
await permission_service.can_user_access_project(
    db, user_id, project_id, PermissionLevel.VIEW
)

# Get user's personal organization
await permission_service.get_personal_organization(db, user_id)

# Check organization membership
await permission_service.check_organization_membership(
    db, user_id, organization_id, "member"
)

# Get all accessible projects
await permission_service.get_user_accessible_projects(db, user_id)
```

---

## Next Steps

### Future Enhancements

1. **Project Templates:** Allow creating projects from organization templates
2. **Project Transfer:** Allow transferring projects between organizations
3. **Bulk Operations:** Allow bulk project operations for organization admins
4. **Advanced Filtering:** Add more filtering options (by tags, status, etc.)
5. **Project Sharing UI:** Build frontend UI for sharing projects with users/orgs

### Monitoring

Log events to monitor:
- `create_project_request` - Project creation attempts
- `create_project_success` - Successful project creations
- `get_projects_request` - Project listing requests
- `access_granted` - Successful permission checks
- `access_denied` - Failed permission checks
- `personal_org_not_found` - Missing personal organizations (error condition)

---

## Conclusion

The project API has been successfully updated to use organization-based access control. All endpoints now:

1. Check permissions using the centralized permission service
2. Support organization-based filtering and access
3. Default to personal organizations for backward compatibility
4. Use hierarchical permission levels (VIEW, COMMENT, EDIT, ADMIN)
5. Support both direct and organization-based access patterns

The implementation is fully backward compatible while adding powerful new organization features.
