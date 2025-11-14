# API Reference

Complete API documentation for Qontinui's collaboration features.

## Base URL

```
Production: https://api.qontinui.com/api/v1
Development: http://localhost:8000/api/v1
```

## Authentication

All API requests require authentication via Bearer token:

```http
Authorization: Bearer <access_token>
```

## Organizations

### Create Organization

```http
POST /organizations
```

**Request Body:**
```json
{
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "description": "Main organization for Acme",
  "avatar_url": "https://example.com/avatar.png",
  "settings": {
    "defaultMemberRole": "member",
    "allowMemberInvites": true
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "owner_id": "uuid",
  "created_at": "2025-01-14T12:00:00Z"
}
```

### List Organizations

```http
GET /organizations
```

**Query Parameters:**
- `limit` (number): Max results (default: 50)
- `offset` (number): Pagination offset

### Get Organization

```http
GET /organizations/{org_id}
```

### Update Organization

```http
PATCH /organizations/{org_id}
```

### Delete Organization

```http
DELETE /organizations/{org_id}
```

## Team Members

### List Members

```http
GET /organizations/{org_id}/members
```

### Add Member

```http
POST /organizations/{org_id}/members
```

**Request Body:**
```json
{
  "user_id": "uuid",
  "role": "member"
}
```

### Update Member Role

```http
PATCH /organizations/{org_id}/members/{member_id}
```

### Remove Member

```http
DELETE /organizations/{org_id}/members/{member_id}
```

## Invitations

### Send Invitation

```http
POST /organizations/{org_id}/invitations
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "role": "member",
  "message": "Join our team!",
  "expiresIn": 7
}
```

### Accept Invitation

```http
POST /invitations/{token}/accept
```

### List Invitations

```http
GET /organizations/{org_id}/invitations
```

## Project Sharing

### Share Project with User

```http
POST /projects/{project_id}/share
```

**Request Body:**
```json
{
  "email": "colleague@example.com",
  "permission_level": "edit",
  "expires_at": "2025-02-14T12:00:00Z",
  "notify": true
}
```

### Share with Organization

```http
POST /projects/{project_id}/share/organization
```

**Request Body:**
```json
{
  "organization_id": "uuid",
  "permission_level": "edit"
}
```

### List Project Access

```http
GET /projects/{project_id}/access
```

**Response:**
```json
{
  "users": [...],
  "organizations": [...]
}
```

### Update Permission

```http
PATCH /projects/{project_id}/access/users/{user_id}
```

### Revoke Access

```http
DELETE /projects/{project_id}/access/users/{user_id}
```

## Comments

### Create Comment

```http
POST /comments
```

**Request Body:**
```json
{
  "project_id": 123,
  "workflow_id": "uuid",
  "content": "Great work! @alice please review",
  "mentions": ["alice-user-id"],
  "position": { "x": 100, "y": 200 }
}
```

### List Comments

```http
GET /comments?project_id=123&resolved=false
```

### Resolve Comment

```http
POST /comments/{comment_id}/resolve
```

### Reply to Comment

```http
POST /comments
```

**Request Body:**
```json
{
  "parent_comment_id": "uuid",
  "content": "Thanks for the feedback!"
}
```

## Resource Locks

### Acquire Lock

```http
POST /locks
```

**Request Body:**
```json
{
  "project_id": 123,
  "resource_type": "workflow",
  "resource_id": "uuid",
  "duration": 300
}
```

### Extend Lock

```http
POST /locks/{lock_id}/extend
```

### Release Lock

```http
DELETE /locks/{lock_id}
```

### Check Lock

```http
GET /locks?project_id=123&resource_type=workflow&resource_id=uuid
```

## Activity Logs

### Get Project Activity

```http
GET /activity?project_id=123&limit=20&offset=0
```

**Query Parameters:**
- `action_type` (string): Filter by action
- `resource_type` (string): Filter by resource
- `user_id` (string): Filter by user
- `start_date` (ISO string): Start date
- `end_date` (ISO string): End date

### Export Activity

```http
GET /activity/export?project_id=123&format=csv
```

## WebSocket API

### Connection

```
ws://localhost:8000/ws/projects/{project_id}?token={access_token}
```

### Message Types

#### Presence Events

**Join:**
```json
{
  "type": "presence:join",
  "project_id": 123
}
```

**Update:**
```json
{
  "type": "presence:update",
  "project_id": 123,
  "status": "editing",
  "resource_id": "uuid"
}
```

#### Lock Events

**Acquired:**
```json
{
  "type": "lock:acquired",
  "lock": {...},
  "project_id": 123
}
```

#### Resource Updates

**Updated:**
```json
{
  "type": "resource:updated",
  "project_id": 123,
  "resource_type": "workflow",
  "resource_id": "uuid",
  "changes": {...}
}
```

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| 400 | Bad Request | Invalid request data |
| 401 | Unauthorized | Missing or invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource conflict (version mismatch) |
| 412 | Precondition Failed | ETag/version mismatch |
| 422 | Unprocessable Entity | Validation error |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

## Rate Limits

- **Default**: 100 requests per minute per user
- **WebSocket**: 1000 messages per minute per connection

## Pagination

List endpoints support pagination:

```http
GET /resource?limit=20&offset=40
```

**Response includes:**
```json
{
  "data": [...],
  "total": 150,
  "limit": 20,
  "offset": 40
}
```

---

**Last Updated:** 2025-01-14
