# Authentication & Authorization Architecture

## Overview
This document outlines the complete authentication and authorization architecture for Qontinui, including user registration, login flows, token management, and permission checking mechanisms.

## System Components

### Core Frameworks & Libraries
- **FastAPI-Users**: Comprehensive authentication system for FastAPI
- **Python-Jose**: JWT token creation and validation
- **Passlib with Bcrypt**: Secure password hashing
- **AWS SES**: Email delivery for verification and notifications
- **PostgreSQL**: User data, sessions, and ACL storage

### Database Models
- **User**: User credentials and profile information
- **DeviceSession**: Active device sessions and refresh tokens
- **ProjectAccessControl**: Project-level permissions and ACLs

## Architecture Diagrams

### 1. Registration & Email Verification Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend
    participant FastAPI
    participant FastAPIUsers as FastAPI-Users
    participant Passlib
    participant DB as Database
    participant SES as AWS SES

    User->>Frontend: Submit registration form
    Frontend->>FastAPI: POST /auth/register
    FastAPI->>FastAPIUsers: Create user request

    FastAPIUsers->>Passlib: Hash password with Bcrypt
    Passlib-->>FastAPIUsers: Hashed password

    FastAPIUsers->>DB: Insert User record<br/>(is_active=false, is_verified=false)
    DB-->>FastAPIUsers: User created

    FastAPIUsers->>DB: Generate verification token
    DB-->>FastAPIUsers: Token stored

    FastAPIUsers->>SES: Send verification email<br/>with token link
    SES-->>User: Verification email

    FastAPIUsers-->>Frontend: Registration successful<br/>(pending verification)
    Frontend-->>User: Check your email message

    Note over User,SES: Email Verification Process

    User->>User: Click verification link
    User->>Frontend: GET /verify?token=xxx
    Frontend->>FastAPI: POST /auth/verify

    FastAPI->>FastAPIUsers: Validate token
    FastAPIUsers->>DB: Check token validity<br/>and expiration

    alt Token valid
        FastAPIUsers->>DB: Update User<br/>(is_verified=true)
        DB-->>FastAPIUsers: Updated
        FastAPIUsers-->>Frontend: Verification successful
        Frontend-->>User: Account verified, please login
    else Token invalid/expired
        FastAPIUsers-->>Frontend: Invalid token
        Frontend-->>User: Verification failed
    end
```

### 2. Login & JWT Generation Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend
    participant AuthContext as Frontend Auth Context
    participant FastAPI
    participant FastAPIUsers as FastAPI-Users
    participant Passlib
    participant Jose as Python-Jose
    participant DB as Database

    User->>Frontend: Enter credentials
    Frontend->>FastAPI: POST /auth/login

    FastAPI->>FastAPIUsers: Authenticate request
    FastAPIUsers->>DB: Query User by email
    DB-->>FastAPIUsers: User record

    FastAPIUsers->>FastAPIUsers: Check is_active && is_verified

    alt User not active/verified
        FastAPIUsers-->>Frontend: Account not activated
        Frontend-->>User: Error message
    else User active and verified
        FastAPIUsers->>Passlib: Verify password hash
        Passlib-->>FastAPIUsers: Password valid

        FastAPIUsers->>Jose: Generate access token<br/>(exp: 15 min)
        Jose-->>FastAPIUsers: Access JWT

        FastAPIUsers->>Jose: Generate refresh token<br/>(exp: 30 days)
        Jose-->>FastAPIUsers: Refresh JWT

        FastAPIUsers->>DB: Create DeviceSession record<br/>(device_info, refresh_token_hash, IP)
        DB-->>FastAPIUsers: Session created

        FastAPIUsers-->>Frontend: tokens: {access, refresh}<br/>user: {id, email, ...}

        Frontend->>AuthContext: Store tokens & user data
        AuthContext->>AuthContext: Set httpOnly cookies<br/>Store user in context

        AuthContext-->>User: Logged in successfully
    end
```

### 3. Token Refresh Mechanism

```mermaid
sequenceDiagram
    autonumber
    participant Frontend
    participant AuthContext as Frontend Auth Context
    participant Interceptor as Axios Interceptor
    participant FastAPI
    participant Jose as Python-Jose
    participant DB as Database

    Note over Frontend,DB: Access Token Expired Scenario

    Frontend->>FastAPI: API Request with expired access token
    FastAPI->>Jose: Validate access token
    Jose-->>FastAPI: Token expired (401)
    FastAPI-->>Frontend: 401 Unauthorized

    Frontend->>Interceptor: Catch 401 error
    Interceptor->>Interceptor: Check if token refresh in progress

    alt Refresh not in progress
        Interceptor->>AuthContext: Get refresh token
        AuthContext-->>Interceptor: Refresh token

        Interceptor->>FastAPI: POST /auth/refresh
        Note right of Interceptor: Headers: {Authorization: Bearer refresh_token}

        FastAPI->>Jose: Validate refresh token
        Jose-->>FastAPI: Token valid, extract user_id

        FastAPI->>DB: Query DeviceSession by token hash
        DB-->>FastAPI: Session record

        FastAPI->>FastAPI: Check session validity<br/>(not revoked, not expired)

        alt Session valid
            FastAPI->>Jose: Generate new access token
            Jose-->>FastAPI: New access JWT

            FastAPI->>DB: Update DeviceSession<br/>(last_activity timestamp)
            DB-->>FastAPI: Updated

            FastAPI-->>Interceptor: New access token
            Interceptor->>AuthContext: Update stored token
            AuthContext-->>Interceptor: Token updated

            Interceptor->>FastAPI: Retry original request<br/>with new token
            FastAPI-->>Interceptor: Success response
            Interceptor-->>Frontend: Return data
        else Session invalid/revoked
            FastAPI-->>Interceptor: 401 Unauthorized
            Interceptor->>AuthContext: Clear auth state
            AuthContext->>AuthContext: Redirect to login
        end
    else Refresh in progress
        Interceptor->>Interceptor: Wait for refresh completion
        Interceptor->>FastAPI: Retry with new token
    end
```

### 4. Device Session Tracking

```mermaid
graph TB
    subgraph "Device Session Management"
        Login[User Login] --> CreateSession[Create DeviceSession]
        CreateSession --> StoreMetadata[Store Session Metadata]

        StoreMetadata --> SessionData{Session Data}
        SessionData --> DeviceInfo[Device Info:<br/>User-Agent, Browser, OS]
        SessionData --> Location[IP Address & Location]
        SessionData --> TokenHash[Refresh Token Hash]
        SessionData --> Timestamps[Created/Last Activity]

        SessionData --> DBRecord[(DeviceSession Table)]

        subgraph "Session Lifecycle"
            DBRecord --> Active[Active Session]
            Active --> |Each API call| UpdateActivity[Update last_activity]
            Active --> |Manual logout| Revoke[Revoke session]
            Active --> |30 days inactive| Expire[Auto-expire]
            Active --> |User action| RevokeAll[Revoke all devices]

            Revoke --> Deleted[Session deleted/marked revoked]
            Expire --> Deleted
            RevokeAll --> Deleted
        end

        subgraph "Security Features"
            DBRecord --> Monitor[Monitor Sessions]
            Monitor --> Anomaly{Anomaly Detection}
            Anomaly --> |Suspicious location| Alert[Alert user]
            Anomaly --> |Multiple devices| Notify[Notify user]
            Anomaly --> |Concurrent logins| Check[Security check]
        end
    end

    style Login fill:#e1f5ff
    style CreateSession fill:#b3e5fc
    style DBRecord fill:#81d4fa
    style Deleted fill:#ff8a80
    style Alert fill:#ffab91
```

### 5. Permission Checking Cascade

```mermaid
flowchart TD
    Start([API Request with JWT]) --> ValidateToken{Validate JWT Token}

    ValidateToken --> |Invalid/Expired| Reject401[Return 401 Unauthorized]
    ValidateToken --> |Valid| ExtractUser[Extract user_id from token]

    ExtractUser --> LoadUser[Load User from Database]
    LoadUser --> CheckActive{is_active &&<br/>is_verified?}

    CheckActive --> |No| Reject403[Return 403 Forbidden:<br/>Account not active]
    CheckActive --> |Yes| CheckSuperuser{Is Superuser?}

    CheckSuperuser --> |Yes| GrantAccess[Grant Full Access]
    CheckSuperuser --> |No| CheckOrgAccess{Check Organization<br/>Access}

    subgraph "Organization Level ACL"
        CheckOrgAccess --> QueryOrgRole[Query User-Organization relationship]
        QueryOrgRole --> OrgRole{User Role?}

        OrgRole --> |Owner| OrgOwnerAccess[Full org permissions]
        OrgRole --> |Admin| OrgAdminAccess[Manage org & projects]
        OrgRole --> |Member| CheckProjectAccess{Check Project ACL}
        OrgRole --> |None| RejectOrg[Return 403:<br/>No org access]
    end

    subgraph "Project Level ACL"
        CheckProjectAccess --> QueryProjectACL[Query ProjectAccessControl]
        QueryProjectACL --> ProjectACL{User Permission?}

        ProjectACL --> |Owner| ProjectOwner[Full project control:<br/>CRUD, settings, delete]
        ProjectACL --> |Editor| ProjectEditor[Edit project:<br/>Update, add content]
        ProjectACL --> |Viewer| ProjectViewer[Read-only access]
        ProjectACL --> |None| CheckPublic{Is project public?}

        CheckPublic --> |Yes| PublicViewer[Read-only public access]
        CheckPublic --> |No| RejectProject[Return 403:<br/>No project access]
    end

    subgraph "Resource Level (Optional)"
        ProjectOwner --> ResourceCheck[Check specific resource]
        ProjectEditor --> ResourceCheck
        ProjectViewer --> ResourceCheck
        PublicViewer --> ResourceCheck

        ResourceCheck --> ResourcePermission{Validate action<br/>on resource}
        ResourcePermission --> |Allowed| GrantAccess
        ResourcePermission --> |Denied| RejectResource[Return 403:<br/>Insufficient permissions]
    end

    OrgOwnerAccess --> GrantAccess
    OrgAdminAccess --> ResourceCheck

    GrantAccess --> ExecuteAction[Execute API Action]
    ExecuteAction --> AuditLog[Log action in audit trail]
    AuditLog --> ReturnSuccess[Return 200 Success]

    style Start fill:#e1f5ff
    style GrantAccess fill:#a5d6a7
    style ExecuteAction fill:#81c784
    style ReturnSuccess fill:#66bb6a
    style Reject401 fill:#ff8a80
    style Reject403 fill:#ff8a80
    style RejectOrg fill:#ff8a80
    style RejectProject fill:#ff8a80
    style RejectResource fill:#ff8a80
```

### 6. Complete System Integration

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI[User Interface]
        AuthContext[Auth Context Provider]
        Interceptor[Axios Interceptor]

        UI --> AuthContext
        AuthContext --> Interceptor
    end

    subgraph "API Gateway Layer"
        FastAPI[FastAPI Application]
        Middleware[Auth Middleware]
        Dependencies[Security Dependencies]

        FastAPI --> Middleware
        Middleware --> Dependencies
    end

    subgraph "Authentication Layer"
        FastAPIUsers[FastAPI-Users]
        Jose[Python-Jose<br/>JWT Handler]
        Passlib[Passlib + Bcrypt<br/>Password Hasher]

        FastAPIUsers --> Jose
        FastAPIUsers --> Passlib
    end

    subgraph "Authorization Layer"
        PermissionChecker[Permission Checker Service]
        ACLResolver[ACL Resolver]
        RoleEvaluator[Role Evaluator]

        PermissionChecker --> ACLResolver
        PermissionChecker --> RoleEvaluator
    end

    subgraph "Data Layer"
        UserModel[(User Model)]
        SessionModel[(DeviceSession Model)]
        ACLModel[(ProjectAccessControl Model)]
        OrgModel[(Organization Model)]

        UserModel --- SessionModel
        UserModel --- ACLModel
        UserModel --- OrgModel
    end

    subgraph "External Services"
        SES[AWS SES<br/>Email Service]
        AuditLog[Audit Log Service]
    end

    Interceptor -.->|HTTP Requests| FastAPI
    Dependencies --> FastAPIUsers
    FastAPIUsers --> UserModel
    FastAPIUsers --> SessionModel
    FastAPIUsers --> SES

    Dependencies --> PermissionChecker
    PermissionChecker --> ACLModel
    PermissionChecker --> OrgModel
    PermissionChecker --> UserModel

    PermissionChecker --> AuditLog

    style FastAPIUsers fill:#4fc3f7
    style Jose fill:#81d4fa
    style Passlib fill:#81d4fa
    style SES fill:#fff59d
    style UserModel fill:#90caf9
    style SessionModel fill:#90caf9
    style ACLModel fill:#90caf9
```

## Security Measures

### Password Security
- **Hashing**: Bcrypt with automatic salt generation (via Passlib)
- **Work Factor**: Configurable rounds (default: 12)
- **Validation**: Minimum 8 characters, complexity requirements enforced

### Token Security

#### Access Tokens (JWT)
- **Algorithm**: HS256 (HMAC-SHA256)
- **Expiration**: 15 minutes
- **Claims**: user_id, email, exp, iat, jti
- **Storage**: Memory only (Frontend Auth Context)

#### Refresh Tokens
- **Algorithm**: HS256 (HMAC-SHA256)
- **Expiration**: 30 days
- **Storage**: httpOnly cookie + hashed in DeviceSession table
- **Rotation**: Optional on each refresh
- **Revocation**: Supported via DeviceSession deletion

### Session Security
- **Device Fingerprinting**: User-Agent, IP address tracking
- **Concurrent Session Limits**: Configurable max devices per user
- **Anomaly Detection**: Geographic location changes, unusual access patterns
- **Session Revocation**: Individual or bulk session termination

### API Security
- **CORS**: Strict origin validation
- **Rate Limiting**: Per-endpoint and per-user limits
- **CSRF Protection**: Token validation for state-changing operations
- **SQL Injection Prevention**: Parameterized queries via SQLAlchemy ORM

### Email Security
- **Verification Tokens**: Cryptographically secure random tokens
- **Token Expiration**: 24 hours for email verification
- **One-time Use**: Tokens invalidated after successful verification
- **Rate Limiting**: Email send limits to prevent abuse

## Permission Levels

### System Level
- **Superuser**: Full system access, bypass all ACLs

### Organization Level
- **Owner**: Full organization control, billing, member management
- **Admin**: Project management, member role assignment
- **Member**: Access to assigned projects only

### Project Level
- **Owner**: Full project control, deletion, settings
- **Editor**: Modify project content, invite collaborators
- **Viewer**: Read-only access to project
- **Public**: Unauthenticated read access (if enabled)

## Data Flow Examples

### Example 1: New User Registration
1. User submits registration form
2. Password hashed with Bcrypt (12 rounds)
3. User record created (inactive, unverified)
4. Verification token generated and stored
5. AWS SES sends verification email
6. User clicks link, token validated
7. User record updated (verified=true)
8. User can now login

### Example 2: Authenticated API Request
1. Frontend sends request with access token (Authorization header)
2. FastAPI middleware intercepts request
3. Python-Jose validates JWT signature and expiration
4. User ID extracted from token claims
5. Permission checker validates user access to resource
6. ACL cascade: User → Organization → Project → Resource
7. Action executed if authorized
8. Audit log entry created
9. Response returned

### Example 3: Token Refresh
1. Access token expires (15 min)
2. Axios interceptor catches 401 error
3. Refresh token sent to /auth/refresh endpoint
4. Server validates refresh token
5. DeviceSession checked (not revoked, not expired)
6. New access token generated
7. DeviceSession.last_activity updated
8. Original request retried with new access token

## Database Schema

### User Table
```
- id (UUID, PK)
- email (String, Unique, Indexed)
- hashed_password (String)
- is_active (Boolean)
- is_verified (Boolean)
- is_superuser (Boolean)
- created_at (Timestamp)
- updated_at (Timestamp)
```

### DeviceSession Table
```
- id (UUID, PK)
- user_id (UUID, FK → User.id, Indexed)
- refresh_token_hash (String, Unique)
- device_info (JSON: user_agent, browser, os, device_type)
- ip_address (String)
- location (JSON: city, country, coordinates)
- created_at (Timestamp)
- last_activity (Timestamp, Indexed)
- expires_at (Timestamp, Indexed)
- is_revoked (Boolean, Default: False)
```

### ProjectAccessControl Table
```
- id (UUID, PK)
- user_id (UUID, FK → User.id, Indexed)
- project_id (UUID, FK → Project.id, Indexed)
- permission_level (Enum: owner, editor, viewer)
- granted_by (UUID, FK → User.id)
- granted_at (Timestamp)
- expires_at (Timestamp, Nullable)
- UNIQUE(user_id, project_id)
```

## Configuration

### Environment Variables
```
# JWT Settings
JWT_SECRET_KEY=<cryptographically-secure-random-key>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# Password Hashing
BCRYPT_ROUNDS=12

# AWS SES
AWS_REGION=us-east-1
AWS_SES_SENDER_EMAIL=noreply@qontinui.com
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>

# Security
ALLOWED_ORIGINS=https://qontinui.io
MAX_DEVICES_PER_USER=5
SESSION_INACTIVITY_DAYS=30
```

## Monitoring & Observability

### Metrics to Track
- Failed login attempts (potential brute force)
- Token refresh rate (anomaly detection)
- Active sessions per user
- Email verification conversion rate
- Permission denied requests (403 responses)
- Token expiration/refresh cycles

### Audit Events
- User registration
- Email verification
- Login/logout events
- Token refresh
- Password changes
- Permission grants/revocations
- Session revocations
- Failed authentication attempts

## Future Enhancements

1. **OAuth2 Integration**: Google, GitHub, Microsoft SSO
2. **Multi-Factor Authentication (MFA)**: TOTP, SMS, email codes
3. **Passwordless Authentication**: Magic links, WebAuthn
4. **Advanced Session Management**: Trusted devices, remember me
5. **Granular Permissions**: Resource-level permissions, custom roles
6. **Federation**: Cross-organization access, guest users
7. **Biometric Authentication**: Face ID, Touch ID support
8. **Security Keys**: Hardware token support (YubiKey, etc.)

## References

- [FastAPI-Users Documentation](https://fastapi-users.github.io/fastapi-users/)
- [Python-Jose Documentation](https://python-jose.readthedocs.io/)
- [Passlib Documentation](https://passlib.readthedocs.io/)
- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
