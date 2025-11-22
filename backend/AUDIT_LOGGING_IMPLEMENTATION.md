# Comprehensive Audit Logging Implementation

## Overview

This document describes the comprehensive audit logging system implemented for qontinui-web backend to meet SOC 2 compliance requirements. The system provides detailed tracking of all security-critical operations including permission changes, team membership modifications, PII access, and account changes.

## Architecture

### Components

1. **Enhanced AuditLog Model** (`app/models/audit_log.py`)
   - Tracks user actions with comprehensive metadata
   - Includes event categorization for compliance reporting
   - Supports request correlation for tracing related events
   - Stores before/after state for all modifications

2. **Audit Logger Utility** (`app/core/audit.py`)
   - Centralized service for logging security-critical operations
   - Automatic IP address extraction from requests
   - Correlation ID generation and tracking
   - Sensitive data sanitization (passwords, tokens)

3. **Admin Query Endpoints** (`app/api/v1/endpoints/audit_logs.py`)
   - Comprehensive filtering and search capabilities
   - User-specific audit trails
   - Resource-specific audit trails
   - Statistical dashboards for compliance reporting

4. **Integrated Logging** (in existing endpoints)
   - Organizations API: Team membership changes
   - Users API: Profile updates, account deletions, PII access
   - Projects API: Permission changes (ready for integration)

## Database Schema

### AuditLog Table Fields

| Field | Type | Description | Indexed |
|-------|------|-------------|---------|
| `id` | Integer | Primary key | Yes |
| `user_id` | UUID | User who performed the action | Yes |
| `action` | String | Action performed (e.g., "add_member") | Yes |
| `resource_type` | String | Type of resource (e.g., "organization") | Yes |
| `resource_id` | String | ID of the resource | Yes |
| `event_category` | String | Event category for compliance | Yes |
| `correlation_id` | String | Request correlation ID | Yes |
| `target_user_id` | UUID | User affected by the action | Yes |
| `changes` | JSON | Before/after state | No |
| `log_metadata` | JSON | Additional metadata | No |
| `ip_address` | String | IP address of the actor | No |
| `created_at` | DateTime | When the event occurred | Yes |

### Event Categories

- `permission_change` - Project access control changes
- `membership_change` - Team/organization membership changes
- `pii_access` - Access to personally identifiable information
- `account_modification` - User account updates or deletions
- `authentication` - Login, logout, failed attempts
- `resource_access` - General resource access
- `system_config` - System configuration changes

### Composite Indexes

For optimal query performance:

```sql
CREATE INDEX ix_audit_logs_user_created ON audit_logs (user_id, created_at);
CREATE INDEX ix_audit_logs_category_created ON audit_logs (event_category, created_at);
CREATE INDEX ix_audit_logs_resource ON audit_logs (resource_type, resource_id, created_at);
CREATE INDEX ix_audit_logs_target_user ON audit_logs (target_user_id, created_at);
```

## API Endpoints

### Admin Audit Log Endpoints (Admin Only)

All endpoints require superuser authentication.

#### List All Audit Logs
```http
GET /api/v1/admin/audit-logs/
```

**Query Parameters:**
- `skip` (int, default: 0) - Pagination offset
- `limit` (int, default: 100, max: 1000) - Results per page
- `user_id` (UUID) - Filter by user who performed action
- `target_user_id` (UUID) - Filter by user affected by action
- `action` (string) - Filter by action type
- `resource_type` (string) - Filter by resource type
- `resource_id` (string) - Filter by resource ID
- `event_category` (string) - Filter by event category
- `correlation_id` (string) - Filter by correlation ID
- `start_date` (datetime) - Filter events after this date
- `end_date` (datetime) - Filter events before this date

**Response:**
```json
{
  "total": 1523,
  "logs": [
    {
      "id": 1234,
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "user_email": "admin@example.com",
      "user_username": "admin",
      "action": "add_member",
      "resource_type": "organization",
      "resource_id": "660e8400-e29b-41d4-a716-446655440000",
      "event_category": "membership_change",
      "target_user_id": "770e8400-e29b-41d4-a716-446655440000",
      "target_user_email": "newuser@example.com",
      "target_user_username": "newuser",
      "changes": null,
      "log_metadata": {
        "role": "member"
      },
      "ip_address": "192.168.1.100",
      "correlation_id": "abc123-def456-ghi789",
      "created_at": "2025-11-21T10:30:00Z"
    }
  ],
  "skip": 0,
  "limit": 100
}
```

#### Get User-Specific Audit Logs
```http
GET /api/v1/admin/audit-logs/user/{user_id}
```

Returns all audit logs where the user either performed the action or was affected by it.

**Query Parameters:**
- `skip` (int)
- `limit` (int)
- `event_category` (string)
- `start_date` (datetime)
- `end_date` (datetime)

#### Get Resource-Specific Audit Logs
```http
GET /api/v1/admin/audit-logs/resource/{resource_type}/{resource_id}
```

Example:
```http
GET /api/v1/admin/audit-logs/resource/project/123
```

Returns all audit events affecting a specific resource.

**Query Parameters:**
- `skip` (int)
- `limit` (int)
- `event_category` (string)
- `start_date` (datetime)
- `end_date` (datetime)

#### Get Audit Statistics
```http
GET /api/v1/admin/audit-logs/stats
```

Returns comprehensive statistics for compliance dashboards.

**Response:**
```json
{
  "total_events": 15234,
  "events_by_category": {
    "membership_change": 523,
    "permission_change": 1234,
    "pii_access": 2341,
    "account_modification": 156,
    "authentication": 10980
  },
  "events_by_action": {
    "add_member": 234,
    "remove_member": 89,
    "change_role": 200,
    "update_profile": 100
  },
  "recent_events_24h": 234,
  "recent_events_7d": 1523,
  "top_users": [
    {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "admin@example.com",
      "username": "admin",
      "event_count": 523
    }
  ]
}
```

## Logged Operations

### Team Membership Changes
**Logged in:** `app/api/v1/endpoints/organizations.py`

| Endpoint | Action | Event Category |
|----------|--------|----------------|
| `POST /organizations/{org_id}/members` | `add_member` | `membership_change` |
| `PUT /organizations/{org_id}/members/{user_id}` | `change_role` | `membership_change` |
| `DELETE /organizations/{org_id}/members/{user_id}` | `remove_member` | `membership_change` |

**Logged Data:**
- User performing the action
- User being added/modified/removed (target_user_id)
- Organization ID
- Role (before and after for updates)
- IP address
- Correlation ID

### Account Modifications
**Logged in:** `app/api/v1/endpoints/users.py`

| Endpoint | Action | Event Category |
|----------|--------|----------------|
| `PUT /users/me/profile` | `update_profile` | `account_modification` |
| `PUT /users/{user_id}` | `admin_update_account` | `account_modification` |
| `DELETE /users/{user_id}` | `delete_account` | `account_modification` |

**Logged Data:**
- User performing the action
- User being modified (target_user_id)
- Before/after state (excluding passwords)
- IP address
- Correlation ID

### PII Access
**Logged in:** `app/api/v1/endpoints/users.py`

| Endpoint | Action | Event Category |
|----------|--------|----------------|
| `GET /users/` | `access_pii` | `pii_access` |
| `GET /users/{user_id}` | `access_pii` | `pii_access` |

**Logged Data:**
- User accessing the PII
- Resource type and ID
- Specific PII fields accessed (email, phone, full_name)
- Reason for access
- IP address
- Correlation ID

### Permission Changes (Ready for Integration)
**To be logged in:** `app/api/v1/endpoints/projects.py`

Use `audit_logger.log_permission_change()` for:
- Granting project access
- Revoking project access
- Changing permission levels

## Usage Examples

### Basic Usage in Endpoints

```python
from fastapi import Request
from app.core.audit import audit_logger

# Team membership change
await audit_logger.log_team_membership_change(
    db=db,
    user_id=current_user.id,
    action="add_member",
    organization_id=organization_id,
    target_user_id=new_member.id,
    role="member",
    request=request,
)
await db.commit()

# Account modification
await audit_logger.log_account_modification(
    db=db,
    user_id=current_user.id,
    target_user_id=user_id,
    changes_dict={
        "before": {"email": "old@example.com"},
        "after": {"email": "new@example.com"}
    },
    action="update_email",
    request=request,
)
await db.commit()

# PII access
await audit_logger.log_pii_access(
    db=db,
    user_id=current_user.id,
    resource_type="user",
    resource_id=str(user_id),
    fields_accessed=["email", "phone", "full_name"],
    reason="Admin user profile view",
    request=request,
)
await db.commit()

# Permission change
await audit_logger.log_permission_change(
    db=db,
    user_id=current_user.id,
    action="grant_access",
    project_id=project_id,
    target_user_id=target_user.id,
    permission_level="edit",
    old_level="view",
    request=request,
)
await db.commit()
```

### IP Address and Correlation ID

The audit logger automatically extracts:
- IP address from `X-Forwarded-For`, `X-Real-IP`, or direct client
- Correlation ID from `X-Request-ID` or `X-Correlation-ID` headers
- Generates new correlation ID if none provided

## SOC 2 Compliance Query Examples

### 1. All Permission Changes in Last 90 Days

```http
GET /api/v1/admin/audit-logs/?event_category=permission_change&start_date=2025-08-23T00:00:00Z
```

### 2. All Actions by Specific User

```http
GET /api/v1/admin/audit-logs/user/550e8400-e29b-41d4-a716-446655440000
```

### 3. All Changes to Specific User Account

```http
GET /api/v1/admin/audit-logs/?target_user_id=550e8400-e29b-41d4-a716-446655440000&event_category=account_modification
```

### 4. All PII Access Events

```http
GET /api/v1/admin/audit-logs/?event_category=pii_access
```

### 5. All Admin Actions

```http
GET /api/v1/admin/audit-logs/?action=admin_update_account
```

### 6. Trace Related Events by Correlation ID

```http
GET /api/v1/admin/audit-logs/?correlation_id=abc123-def456-ghi789
```

### 7. All Team Membership Changes for Organization

```http
GET /api/v1/admin/audit-logs/resource/organization/660e8400-e29b-41d4-a716-446655440000?event_category=membership_change
```

### 8. Failed Login Attempts (when authentication logging added)

```http
GET /api/v1/admin/audit-logs/?action=failed_login&start_date=2025-11-20T00:00:00Z
```

### 9. Recent Activity (Last 24 Hours)

```http
GET /api/v1/admin/audit-logs/stats
```

Check `recent_events_24h` field.

### 10. Most Active Users (for anomaly detection)

```http
GET /api/v1/admin/audit-logs/stats
```

Check `top_users` field.

## Direct Database Queries

For advanced reporting or when API access is not suitable:

### All permission changes in last 90 days
```sql
SELECT
    al.id,
    al.created_at,
    u1.email as actor_email,
    al.action,
    al.resource_type,
    al.resource_id,
    u2.email as target_email,
    al.changes,
    al.ip_address
FROM audit_logs al
LEFT JOIN users u1 ON al.user_id = u1.id
LEFT JOIN users u2 ON al.target_user_id = u2.id
WHERE al.event_category = 'permission_change'
  AND al.created_at >= NOW() - INTERVAL '90 days'
ORDER BY al.created_at DESC;
```

### All actions by specific user
```sql
SELECT
    created_at,
    action,
    resource_type,
    resource_id,
    event_category,
    ip_address
FROM audit_logs
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;
```

### All PII access events
```sql
SELECT
    al.created_at,
    u.email as accessor,
    al.resource_type,
    al.resource_id,
    al.log_metadata->>'fields_accessed' as pii_fields,
    al.log_metadata->>'reason' as reason,
    al.ip_address
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.event_category = 'pii_access'
ORDER BY al.created_at DESC;
```

### Changes to specific user account
```sql
SELECT
    al.created_at,
    u.email as changed_by,
    al.action,
    al.changes,
    al.ip_address
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.target_user_id = '770e8400-e29b-41d4-a716-446655440000'
  AND al.event_category = 'account_modification'
ORDER BY al.created_at DESC;
```

### Events by category (last 30 days)
```sql
SELECT
    event_category,
    COUNT(*) as event_count
FROM audit_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY event_category
ORDER BY event_count DESC;
```

### Most active users (last 7 days)
```sql
SELECT
    u.email,
    u.username,
    COUNT(*) as action_count
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.created_at >= NOW() - INTERVAL '7 days'
  AND al.user_id IS NOT NULL
GROUP BY u.email, u.username
ORDER BY action_count DESC
LIMIT 20;
```

### Trace request by correlation ID
```sql
SELECT
    al.created_at,
    al.action,
    al.resource_type,
    al.resource_id,
    u.email,
    al.ip_address
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE al.correlation_id = 'abc123-def456-ghi789'
ORDER BY al.created_at;
```

## Migration Instructions

### Apply Database Migration

```bash
cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend

# Update the migration file's down_revision to point to latest migration
# Then run:
alembic upgrade head
```

### Verify Migration

```sql
-- Check table structure
\d audit_logs

-- Verify indexes exist
\di audit_logs*

-- Check foreign key constraints
\d+ audit_logs
```

## Integration Checklist for New Endpoints

When adding audit logging to new endpoints:

1. **Import audit logger**
   ```python
   from app.core.audit import audit_logger
   ```

2. **Add Request parameter to endpoint**
   ```python
   async def my_endpoint(
       ...,
       request: Request,
   ):
   ```

3. **Choose appropriate logging function**
   - `log_permission_change()` - For access control
   - `log_team_membership_change()` - For org/team changes
   - `log_pii_access()` - When reading PII
   - `log_account_modification()` - For user account changes
   - `log_audit_event()` - Generic logging

4. **Log the event**
   ```python
   await audit_logger.log_xxx(
       db=db,
       user_id=current_user.id,
       ...,
       request=request,
   )
   await db.commit()
   ```

5. **Test the implementation**
   - Verify log is created
   - Check all fields are populated
   - Verify IP address and correlation ID

## Security Considerations

1. **Password Sanitization**: Passwords are automatically redacted in the `changes` field
2. **Token Sanitization**: API keys, secrets, and tokens are redacted
3. **Admin-Only Access**: All audit log query endpoints require superuser privileges
4. **Immutable Logs**: Audit logs should never be deleted (consider archival after 7 years)
5. **IP Address Logging**: Captures true client IP even behind proxies

## Retention Policy

Recommended retention policy for SOC 2 compliance:
- **Active Database**: 1 year
- **Cold Storage**: 7 years
- **Deletion**: After 7 years

Implement with scheduled job:
```sql
-- Archive logs older than 1 year to cold storage
-- Then delete from active database
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '1 year';
```

## Performance Considerations

1. **Indexes**: All common query patterns are indexed
2. **Async Operations**: All logging is async to minimize latency
3. **Batching**: Consider batching for bulk operations
4. **Partitioning**: For high-volume systems, consider table partitioning by date

## Future Enhancements

1. **Authentication Logging**: Add login/logout/failed attempt tracking
2. **Project Permission Logging**: Integrate into projects.py
3. **Automated Alerts**: Suspicious activity detection
4. **Export Functionality**: CSV/PDF export for compliance reports
5. **Real-time Monitoring**: WebSocket streaming for security dashboards
6. **Anomaly Detection**: ML-based unusual activity detection

## Support

For questions or issues:
- Check this documentation
- Review code comments in `app/core/audit.py`
- Examine example integrations in `organizations.py` and `users.py`
- Consult SOC 2 compliance requirements
