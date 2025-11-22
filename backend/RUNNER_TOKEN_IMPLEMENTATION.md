# Runner Token Management System - Implementation Summary

## Overview

This document describes the complete implementation of the runner token management system for qontinui-web. The system provides dedicated authentication tokens for desktop runners, separate from user JWT tokens, with comprehensive connection tracking and audit trails.

## Implementation Date
November 19, 2025

## Key Features

- **Dedicated Runner Tokens**: Separate authentication tokens for desktop runners
- **Secure Token Storage**: SHA-256 hashed tokens, never stored in plain text
- **Connection Tracking**: Complete audit trail of all runner connections
- **Token Revocation**: Soft delete with audit trail
- **Expiration Support**: Optional token expiration dates
- **Rate Limiting**: Maximum tokens per user configurable
- **Dual Authentication**: Supports both JWT and runner tokens in WebSocket connections

## Architecture

### Database Models

#### 1. RunnerToken Model
**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/runner_token.py`

```python
class RunnerToken(Base):
    __tablename__ = "runner_tokens"

    # Fields
    id: UUID (primary key)
    user_id: UUID (foreign key to users)
    name: str  # User-friendly name
    token_hash: str  # SHA-256 hash (64 chars)
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None
    is_revoked: bool
    revoked_at: datetime | None
    last_ip_address: str | None
    last_user_agent: str | None
```

**Indexes**:
- `ix_runner_tokens_user_id`
- `ix_runner_tokens_token_hash` (unique)
- `ix_runner_tokens_is_revoked`
- `ix_runner_tokens_last_used_at`

#### 2. RunnerConnection Model
**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/runner_connection.py`

```python
class RunnerConnection(Base):
    __tablename__ = "runner_connections"

    # Fields
    id: int (primary key, auto-increment)
    runner_token_id: UUID (foreign key to runner_tokens)
    user_id: UUID (foreign key to users)
    connected_at: datetime
    disconnected_at: datetime | None
    duration_seconds: int | None
    ip_address: str | None
    user_agent: str | None
    project_id: int | None
    session_id: str | None
```

**Indexes**:
- `ix_runner_connections_runner_token_id`
- `ix_runner_connections_user_id`
- `ix_runner_connections_connected_at`

### Database Migration

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/alembic/versions/cca9ba33dd5c_add_runner_token_and_connection_models.py`

**Revision ID**: `cca9ba33dd5c`
**Down Revision**: `675031faaab9`

To apply the migration:
```bash
cd backend
poetry run alembic upgrade head
```

To rollback:
```bash
poetry run alembic downgrade -1
```

### Pydantic Schemas

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/schemas/runner.py`

#### Request Schemas
- `RunnerTokenCreate`: Create new token
- `RunnerTokenUpdate`: Update token (rename)

#### Response Schemas
- `RunnerTokenResponse`: Token info (without secret)
- `RunnerTokenWithSecret`: Token info with actual token (only on creation)
- `RunnerConnectionResponse`: Connection info
- `RunnerConnectionHistory`: Paginated connection list
- `RunnerTokenStats`: Token usage statistics

### Security Implementation

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/core/security.py`

#### Token Generation
```python
def generate_runner_token() -> str:
    """Generates: qontinui_runner_<64 hex chars>"""
    random_bytes = secrets.token_hex(32)
    return f"qontinui_runner_{random_bytes}"
```

#### Token Hashing
```python
def hash_runner_token(token: str) -> str:
    """SHA-256 hash for secure storage"""
    return hashlib.sha256(token.encode()).hexdigest()
```

#### Token Verification
```python
def verify_runner_token(token: str, token_hash: str) -> bool:
    """Verify token against stored hash"""
    return hash_runner_token(token) == token_hash
```

### CRUD Operations

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/crud/runner.py`

#### Token Management
- `create_runner_token()` - Create new token (returns token + hash)
- `get_runner_tokens()` - List user's tokens with connection counts
- `get_runner_token_by_id()` - Get specific token
- `get_runner_token_by_hash()` - Find token by hash (for auth)
- `validate_runner_token()` - Validate plain token and return record
- `revoke_runner_token()` - Soft delete token
- `delete_runner_token()` - Hard delete token
- `update_token_last_used()` - Update last used timestamp
- `update_runner_token_name()` - Rename token

#### Connection Management
- `create_connection_record()` - Log connection start
- `close_connection_record()` - Log connection end
- `get_connection_history()` - Paginated history
- `get_active_connections()` - Currently active connections
- `get_connection_by_session_id()` - Find connection by session
- `get_runner_token_stats()` - Token usage statistics

### REST API Endpoints

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/runners.py`

**Base Path**: `/api/v1/runners`

#### Token Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/tokens` | Create new runner token |
| GET | `/tokens` | List all tokens (optional: `?include_revoked=true`) |
| GET | `/tokens/{token_id}` | Get specific token |
| PATCH | `/tokens/{token_id}` | Update token (rename) |
| DELETE | `/tokens/{token_id}` | Revoke token (soft delete) |
| DELETE | `/tokens/{token_id}/permanent` | Delete token permanently |

#### Connection Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/connections` | Get connection history (`?limit=50&offset=0`) |
| GET | `/connections/active` | Get active connections |
| GET | `/stats` | Get token usage statistics |

### WebSocket Authentication

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/deps.py`

#### New Authentication Function
```python
async def authenticate_runner(token: str) -> tuple[User, RunnerToken | None]:
    """
    Authenticate either JWT token or runner token.

    Returns:
        - If JWT: (User, None)
        - If runner token: (User, RunnerToken)
    """
```

**Updated WebSocket**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/automation_ws.py`

- Now accepts both JWT and runner tokens
- Automatically logs connection start/end for runner tokens
- Tracks connection metadata (IP, session_id, duration)
- Returns auth method in connection acknowledgment

### Configuration

**File**: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/core/config.py`

New settings:
```python
RUNNER_TOKEN_DEFAULT_EXPIRY_DAYS: int = 90  # Default expiration
RUNNER_TOKEN_MAX_PER_USER: int = 10  # Maximum tokens per user
```

Add to `.env`:
```bash
RUNNER_TOKEN_DEFAULT_EXPIRY_DAYS=90
RUNNER_TOKEN_MAX_PER_USER=10
```

## Usage Examples

### Creating a Token

**Request**:
```bash
curl -X POST http://localhost:8000/api/v1/runners/tokens \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Laptop",
    "expires_in_days": 90
  }'
```

**Response**:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "My Laptop",
  "created_at": "2025-11-19T10:30:00Z",
  "expires_at": "2026-02-17T10:30:00Z",
  "last_used_at": null,
  "is_revoked": false,
  "last_ip_address": null,
  "connection_count": 0,
  "token": "qontinui_runner_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2"
}
```

**IMPORTANT**: Save the token! It will never be shown again.

### Listing Tokens

**Request**:
```bash
curl http://localhost:8000/api/v1/runners/tokens \
  -H "Authorization: Bearer <jwt_token>"
```

**Response**:
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "My Laptop",
    "created_at": "2025-11-19T10:30:00Z",
    "expires_at": "2026-02-17T10:30:00Z",
    "last_used_at": "2025-11-19T11:45:00Z",
    "is_revoked": false,
    "last_ip_address": "192.168.1.100",
    "connection_count": 15
  }
]
```

### Connecting via WebSocket

**With Runner Token**:
```javascript
const ws = new WebSocket(
  `ws://localhost:8000/api/v1/ws/automation/runner?token=qontinui_runner_...`
);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "connected") {
    console.log("Auth method:", msg.auth_method);  // "runner_token"
    console.log("Token name:", msg.token_name);    // "My Laptop"
  }
};
```

### Viewing Connection History

**Request**:
```bash
curl http://localhost:8000/api/v1/runners/connections?limit=10&offset=0 \
  -H "Authorization: Bearer <jwt_token>"
```

**Response**:
```json
{
  "connections": [
    {
      "id": 1,
      "runner_token_id": "123e4567-e89b-12d3-a456-426614174000",
      "runner_name": "My Laptop",
      "connected_at": "2025-11-19T11:45:00Z",
      "disconnected_at": "2025-11-19T12:30:00Z",
      "duration_seconds": 2700,
      "ip_address": "192.168.1.100",
      "project_id": null
    }
  ],
  "total": 15,
  "active_count": 1,
  "limit": 10,
  "offset": 0
}
```

### Getting Statistics

**Request**:
```bash
curl http://localhost:8000/api/v1/runners/stats \
  -H "Authorization: Bearer <jwt_token>"
```

**Response**:
```json
{
  "total_tokens": 3,
  "active_tokens": 2,
  "revoked_tokens": 1,
  "expired_tokens": 0,
  "total_connections": 45,
  "active_connections": 1,
  "most_recent_connection": "2025-11-19T11:45:00Z"
}
```

### Revoking a Token

**Request**:
```bash
curl -X DELETE http://localhost:8000/api/v1/runners/tokens/{token_id} \
  -H "Authorization: Bearer <jwt_token>"
```

**Response**: `204 No Content`

## Security Considerations

### Token Security
1. **Hashing**: Tokens are hashed using SHA-256 before storage
2. **Format**: Identifiable prefix `qontinui_runner_` for monitoring
3. **Entropy**: 256 bits of randomness using `secrets` module
4. **One-time Display**: Plain text token only shown during creation

### Token Validation
1. **Revocation**: Tokens can be soft-deleted (audit trail) or hard-deleted
2. **Expiration**: Optional expiration dates enforced
3. **Active User Check**: User must be active to authenticate
4. **Rate Limiting**: Maximum tokens per user enforced

### Audit Trail
1. **Connection Logging**: Every connection tracked with timestamps
2. **IP Tracking**: Source IP addresses logged
3. **Duration Tracking**: Connection duration calculated on disconnect
4. **Revocation Tracking**: Revocation timestamp and status preserved

## Design Decisions

### Why Separate Runner Tokens?

1. **Security**: Dedicated tokens limit blast radius if compromised
2. **Management**: Users can revoke specific desktop runners without affecting web sessions
3. **Audit**: Clear separation between web and desktop runner activity
4. **Flexibility**: Different expiration policies for different use cases

### Why Hash Tokens?

1. **Security**: Even if database is compromised, tokens cannot be recovered
2. **Standard Practice**: Industry standard for API token storage
3. **Performance**: SHA-256 is fast enough for authentication
4. **Simplicity**: No need for complex encryption key management

### Why Soft Delete?

1. **Audit Trail**: Keeps history of revoked tokens
2. **Compliance**: May be required for security audits
3. **Recovery**: Can investigate which tokens were compromised
4. **Statistics**: Accurate usage statistics even after revocation

### Why Connection Tracking?

1. **Security**: Detect suspicious activity (unusual IPs, connection patterns)
2. **Debugging**: Troubleshoot connection issues
3. **Analytics**: Understand desktop runner usage patterns
4. **Compliance**: Audit trail for security requirements

## Testing

### Manual Testing Checklist

1. **Token Creation**
   - [ ] Create token with expiration
   - [ ] Create token without expiration
   - [ ] Verify token is only shown once
   - [ ] Verify max tokens limit enforced

2. **Token Authentication**
   - [ ] Connect WebSocket with runner token
   - [ ] Connect WebSocket with JWT token
   - [ ] Verify both work correctly
   - [ ] Verify connection is logged for runner tokens

3. **Token Revocation**
   - [ ] Revoke token
   - [ ] Verify cannot authenticate with revoked token
   - [ ] Verify revoked token appears in listing with `include_revoked=true`
   - [ ] Permanent delete token

4. **Connection Tracking**
   - [ ] Connect and disconnect
   - [ ] Verify connection appears in history
   - [ ] Verify duration is calculated
   - [ ] Verify active connections show current connections

5. **Token Management**
   - [ ] List tokens
   - [ ] Update token name
   - [ ] View token details
   - [ ] View statistics

### API Testing

Use the provided Postman/Insomnia collection (to be created) or test manually:

```bash
# Test token creation
./scripts/test_runner_tokens.sh create

# Test token authentication
./scripts/test_runner_tokens.sh auth

# Test connection tracking
./scripts/test_runner_tokens.sh connections
```

## Migration Guide

### Applying the Migration

```bash
cd backend
poetry run alembic upgrade head
```

Expected output:
```
INFO  [alembic.runtime.migration] Running upgrade 675031faaab9 -> cca9ba33dd5c, add_runner_token_and_connection_models
```

### Rollback (if needed)

```bash
poetry run alembic downgrade -1
```

### Verify Migration

```bash
poetry run python -c "from app.models.runner_token import RunnerToken; print('✓ Models loaded')"
poetry run python -c "from app.api.v1.endpoints import runners; print('✓ API endpoints loaded')"
```

## Frontend Integration

### TypeScript Types (to be created)

```typescript
interface RunnerToken {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_revoked: boolean;
  last_ip_address: string | null;
  connection_count: number;
}

interface RunnerTokenWithSecret extends RunnerToken {
  token: string;  // Only available on creation
}

interface RunnerConnection {
  id: number;
  runner_token_id: string;
  runner_name: string;
  connected_at: string;
  disconnected_at: string | null;
  duration_seconds: number | null;
  ip_address: string | null;
  project_id: number | null;
}
```

### React Hook (to be created)

```typescript
// useRunnerTokens.ts
export function useRunnerTokens() {
  const { data: tokens, isLoading, error } = useQuery({
    queryKey: ['runner-tokens'],
    queryFn: async () => {
      const res = await fetch('/api/v1/runners/tokens', {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      return res.json();
    }
  });

  return { tokens, isLoading, error };
}
```

## Files Modified/Created

### New Files Created
1. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/runner_token.py`
2. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/runner_connection.py`
3. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/schemas/runner.py`
4. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/crud/runner.py`
5. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/runners.py`
6. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/alembic/versions/cca9ba33dd5c_add_runner_token_and_connection_models.py`
7. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/RUNNER_TOKEN_IMPLEMENTATION.md` (this file)

### Files Modified
1. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/__init__.py`
2. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/models/user.py`
3. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/core/security.py`
4. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/core/config.py`
5. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/v1/api.py`
6. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/deps.py`
7. `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/automation_ws.py`

## Next Steps

1. **Run Migration**: Apply the database migration
2. **Test API**: Manually test all endpoints
3. **Frontend UI**: Create UI for token management
4. **Documentation**: Update API documentation
5. **Monitoring**: Add metrics for token usage
6. **Rate Limiting**: Consider rate limiting token creation
7. **Notifications**: Email notifications for new tokens/connections

## API Specification

### Complete OpenAPI Endpoints

```yaml
/api/v1/runners/tokens:
  post:
    summary: Create runner token
    tags: [runners]
    security: [bearerAuth]
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              name:
                type: string
                example: "My Laptop"
              expires_in_days:
                type: integer
                nullable: true
                example: 90
    responses:
      201:
        description: Token created (includes actual token - save it!)

  get:
    summary: List runner tokens
    tags: [runners]
    security: [bearerAuth]
    parameters:
      - name: include_revoked
        in: query
        schema:
          type: boolean
          default: false
    responses:
      200:
        description: List of tokens

/api/v1/runners/tokens/{token_id}:
  get:
    summary: Get specific token
    tags: [runners]
    security: [bearerAuth]

  patch:
    summary: Update token (rename)
    tags: [runners]
    security: [bearerAuth]

  delete:
    summary: Revoke token (soft delete)
    tags: [runners]
    security: [bearerAuth]

/api/v1/runners/tokens/{token_id}/permanent:
  delete:
    summary: Permanently delete token
    tags: [runners]
    security: [bearerAuth]

/api/v1/runners/connections:
  get:
    summary: Get connection history
    tags: [runners]
    security: [bearerAuth]
    parameters:
      - name: limit
        in: query
        schema:
          type: integer
          default: 50
          maximum: 100
      - name: offset
        in: query
        schema:
          type: integer
          default: 0

/api/v1/runners/connections/active:
  get:
    summary: Get active connections
    tags: [runners]
    security: [bearerAuth]

/api/v1/runners/stats:
  get:
    summary: Get token usage statistics
    tags: [runners]
    security: [bearerAuth]
```

## Troubleshooting

### Token Not Working
1. Check if token is revoked: `GET /api/v1/runners/tokens`
2. Check if token is expired
3. Verify token format starts with `qontinui_runner_`
4. Check user is still active

### Connection Not Logged
1. Verify using runner token (not JWT)
2. Check database connection
3. Review server logs for errors
4. Verify migration was applied

### Migration Failed
1. Check database connection
2. Verify no conflicting table names
3. Check Alembic history: `poetry run alembic history`
4. Try manual rollback and reapply

## Support

For issues or questions:
1. Check logs: `tail -f backend/logs/app.log`
2. Review API documentation: http://localhost:8000/docs
3. Check database: `psql -U qontinui_user -d qontinui_db`

## Changelog

### v1.0.0 (2025-11-19)
- Initial implementation
- Database models for tokens and connections
- REST API endpoints
- WebSocket authentication support
- Database migration
- Complete documentation
