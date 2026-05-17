# Audit Logging Quick Reference

## Quick Start

### Import
```python
from app.core.audit import audit_logger
from fastapi import Request
```

### Add Request to Endpoint
```python
async def my_endpoint(
    ...,
    request: Request,  # Add this
):
```

### Log Events
```python
# After the operation succeeds
await audit_logger.log_xxx(
    db=db,
    user_id=current_user.id,
    ...,
    request=request,
)
await db.commit()  # Important!
```

## Event Types

### Team Membership Changes
```python
await audit_logger.log_team_membership_change(
    db=db,
    user_id=current_user.id,
    action="add_member",  # or "remove_member", "change_role"
    organization_id=organization_id,
    target_user_id=target_user.id,
    role="member",  # new role
    old_role=None,  # if changing, provide old role
    request=request,
)
```

### Permission Changes
```python
await audit_logger.log_permission_change(
    db=db,
    user_id=current_user.id,
    action="grant_access",  # or "revoke_access", "change_permission"
    project_id=project_id,
    target_user_id=target_user.id,
    permission_level="edit",  # new level
    old_level="view",  # if changing, provide old level
    request=request,
)
```

### Account Modifications
```python
await audit_logger.log_account_modification(
    db=db,
    user_id=current_user.id,
    target_user_id=user_id,
    changes_dict={
        "before": {"email": "old@example.com", "is_active": True},
        "after": {"email": "new@example.com", "is_active": True}
    },
    action="update_email",  # or "update_profile", "delete_account"
    request=request,
)
```

### PII Access
```python
await audit_logger.log_pii_access(
    db=db,
    user_id=current_user.id,
    resource_type="user",
    resource_id=str(user_id),
    fields_accessed=["email", "phone", "full_name"],
    reason="Admin user profile view",
    request=request,
)
```

### Authentication (Ready to Use)
```python
await audit_logger.log_authentication(
    db=db,
    user_id=user.id,  # None for failed attempts
    action="login",  # or "logout", "failed_login"
    success=True,
    metadata={"method": "password"},  # optional
    request=request,
)
```

### Generic Event
```python
await audit_logger.log_audit_event(
    db=db,
    user_id=current_user.id,
    action="custom_action",
    resource_type="custom_resource",
    resource_id="123",
    event_category=audit_logger.CATEGORY_RESOURCE_ACCESS,
    metadata={"key": "value"},
    request=request,
)
```

## Event Categories

Use these constants from `audit_logger`:
- `CATEGORY_PERMISSION_CHANGE` - "permission_change"
- `CATEGORY_MEMBERSHIP_CHANGE` - "membership_change"
- `CATEGORY_PII_ACCESS` - "pii_access"
- `CATEGORY_ACCOUNT_MODIFICATION` - "account_modification"
- `CATEGORY_AUTHENTICATION` - "authentication"
- `CATEGORY_RESOURCE_ACCESS` - "resource_access"
- `CATEGORY_SYSTEM_CONFIG` - "system_config"

## Query Examples

### List All Recent Logs
```bash
GET /api/v1/admin/audit-logs/?limit=50
```

### Filter by Category
```bash
GET /api/v1/admin/audit-logs/?event_category=pii_access
```

### User-Specific Logs
```bash
GET /api/v1/admin/audit-logs/user/{user_id}
```

### Resource-Specific Logs
```bash
GET /api/v1/admin/audit-logs/resource/project/123
```

### Date Range
```bash
GET /api/v1/admin/audit-logs/?start_date=2025-11-01T00:00:00Z&end_date=2025-11-21T23:59:59Z
```

### Statistics
```bash
GET /api/v1/admin/audit-logs/stats
```

## What to Log

### Always Log
- Team membership changes (add, remove, role change)
- Permission changes (grant, revoke, modify)
- Account modifications (update, delete)
- PII access (viewing user data with email/phone/name)
- Authentication events (login, logout, failures)

### Don't Log
- Regular data queries (non-PII)
- Health checks
- Public endpoints
- Routine operations without security impact

## Common Patterns

### Capture Before/After State
```python
# Before operation
before_state = {
    "email": user.email,
    "is_active": user.is_active
}

# Perform operation
user.email = new_email

# After operation
after_state = {
    "email": user.email,
    "is_active": user.is_active
}

# Log
await audit_logger.log_account_modification(
    db=db,
    user_id=current_user.id,
    target_user_id=user.id,
    changes_dict={"before": before_state, "after": after_state},
    action="update_email",
    request=request,
)
```

### Log Only on Success
```python
try:
    # Perform operation
    member = TeamMember(...)
    db.add(member)
    await db.commit()

    # Only log if successful
    await audit_logger.log_team_membership_change(...)
    await db.commit()

except Exception as e:
    # Don't log if operation failed
    await db.rollback()
    raise
```

### Log PII Access
```python
# When returning user data with PII fields
user = await get_user(db, user_id)

# Check which PII fields are present
pii_fields = []
if user.email:
    pii_fields.append("email")
if user.full_name:
    pii_fields.append("full_name")
if user.phone:
    pii_fields.append("phone")

# Log access
if pii_fields:
    await audit_logger.log_pii_access(
        db=db,
        user_id=current_user.id,
        resource_type="user",
        resource_id=str(user_id),
        fields_accessed=pii_fields,
        reason="User profile view",
        request=request,
    )
    await db.commit()
```

## Testing

### Verify Logs Created
```python
# After operation
from app.models.audit_log import AuditLog

# Query recent logs
result = await db.execute(
    select(AuditLog)
    .where(AuditLog.user_id == current_user.id)
    .order_by(AuditLog.created_at.desc())
    .limit(1)
)
log = result.scalar_one_or_none()

assert log is not None
assert log.action == "add_member"
assert log.event_category == "membership_change"
```

### Test with curl
```bash
# Perform operation that should log
curl -X POST http://localhost:8000/api/v1/organizations/{org_id}/members \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "...", "role": "member"}'

# Check logs
curl http://localhost:8000/api/v1/admin/audit-logs/?limit=1 \
  -H "Authorization: Bearer <admin_token>"
```

## Troubleshooting

### Logs Not Appearing
1. Check you called `await db.commit()` after logging
2. Verify endpoint has `request: Request` parameter
3. Check database migration was applied
4. Verify no exceptions during logging

### Missing IP Address
- Ensure `request` parameter is passed
- Check proxy headers are configured correctly
- IP extraction handles X-Forwarded-For and X-Real-IP

### Missing Correlation ID
- Passes automatically if client sends X-Request-ID header
- Otherwise generated automatically
- Both cases are handled

### Performance Issues
- Logging is async and fast
- Indexes cover all common queries
- Consider batching for bulk operations

## Examples in Codebase

See these files for working examples:
- `/app/api/v1/endpoints/organizations.py` - Team membership logging
- `/app/api/v1/endpoints/users.py` - Account modifications and PII access
- `/app/core/audit.py` - Complete utility reference

## Migration

To apply database changes:
```bash
cd /mnt/c/Users/Joshua/Documents/qontinui-root/qontinui-web/backend
alembic upgrade head
```

## Documentation

- **Full Docs:** `/AUDIT_LOGGING_IMPLEMENTATION.md`
- **Summary:** `/AUDIT_LOGGING_SUMMARY.md`
- **Quick Reference:** This file
