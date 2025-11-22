# Frontend-Backend Data Flow Architecture

## Overview

The Qontinui web application implements a modern, layered architecture with clear separation between frontend (Next.js) and backend (FastAPI). This document describes the complete data flow from user interaction through the frontend, across the network boundary, through backend processing, and back to the user interface.

### Key Architectural Characteristics
- **Async-first:** Both frontend (React) and backend (FastAPI) use asynchronous patterns
- **Type-safe:** TypeScript frontend with Pydantic validation on backend
- **Security-focused:** HttpOnly cookies, CSRF protection, rate limiting, token rotation
- **Real-time capable:** WebSocket support for streaming execution and collaboration
- **Offline-ready:** Message queuing, automatic reconnection, optimistic updates

---

## Architecture Diagram

```mermaid
graph TB
    subgraph "Browser Environment"
        subgraph "1. UI Layer"
            A1[React Components]
            A2[Next.js Pages]
            A3[Form Inputs]
            style A1 fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
            style A2 fill:#bbdefb,stroke:#1976d2,stroke-width:2px
            style A3 fill:#90caf9,stroke:#1976d2,stroke-width:2px
        end

        subgraph "2. State Management Layer"
            B1[Zustand Stores]
            B2[React Query Cache]
            B3[Context API]
            style B1 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
            style B2 fill:#e1bee7,stroke:#7b1fa2,stroke-width:2px
            style B3 fill:#ce93d8,stroke:#7b1fa2,stroke-width:2px
        end

        subgraph "3. Service Layer"
            C1[AuthService]
            C2[ProjectService]
            C3[HttpClient]
            C4[WebSocket Client]
            style C1 fill:#fff3e0,stroke:#f57c00,stroke-width:2px
            style C2 fill:#ffe0b2,stroke:#f57c00,stroke-width:2px
            style C3 fill:#ffcc80,stroke:#f57c00,stroke-width:2px
            style C4 fill:#ffb74d,stroke:#f57c00,stroke-width:2px
        end

        subgraph "4. Token Management"
            D1[TokenManager]
            D2[TokenRefreshService]
            D3[TokenValidator]
            style D1 fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
            style D2 fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
            style D3 fill:#a5d6a7,stroke:#388e3c,stroke-width:2px
        end

        subgraph "5. Browser Storage"
            E1[HttpOnly Cookies<br/>access_token, refresh_token]
            E2[localStorage<br/>token_expiry, UI state]
            style E1 fill:#fce4ec,stroke:#c2185b,stroke-width:2px
            style E2 fill:#f8bbd0,stroke:#c2185b,stroke-width:2px
        end
    end

    subgraph "Network Boundary"
        F1[HTTP/HTTPS<br/>REST API]
        F2[WebSocket<br/>wss://]
        style F1 fill:#e0f2f1,stroke:#00897b,stroke-width:3px
        style F2 fill:#b2dfdb,stroke:#00897b,stroke-width:3px
    end

    subgraph "FastAPI Backend"
        subgraph "6. Middleware Stack"
            G1[CORSMiddleware]
            G2[SecurityHeadersMiddleware]
            G3[RequestIDMiddleware]
            G4[SlidingWindowSessionMiddleware]
            G5[MetricsMiddleware]
            style G1 fill:#fff9c4,stroke:#f57f17,stroke-width:2px
            style G2 fill:#fff59d,stroke:#f57f17,stroke-width:2px
            style G3 fill:#fff176,stroke:#f57f17,stroke-width:2px
            style G4 fill:#ffee58,stroke:#f57f17,stroke-width:2px
            style G5 fill:#ffeb3b,stroke:#f57f17,stroke-width:2px
        end

        subgraph "7. Authentication Layer"
            H1[Cookie/Bearer Transport]
            H2[JWT Strategy]
            H3[UserManager]
            H4[Token Blacklist]
            style H1 fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
            style H2 fill:#b3e5fc,stroke:#0288d1,stroke-width:2px
            style H3 fill:#81d4fa,stroke:#0288d1,stroke-width:2px
            style H4 fill:#4fc3f7,stroke:#0288d1,stroke-width:2px
        end

        subgraph "8. Route Layer"
            I1[API Router]
            I2[Rate Limiter]
            I3[Pydantic Validation]
            style I1 fill:#f1f8e9,stroke:#689f38,stroke-width:2px
            style I2 fill:#dcedc8,stroke:#689f38,stroke-width:2px
            style I3 fill:#c5e1a5,stroke:#689f38,stroke-width:2px
        end

        subgraph "9. Business Logic Layer"
            J1[Service Layer]
            J2[Permission Service]
            J3[CRUD Operations]
            style J1 fill:#fbe9e7,stroke:#d84315,stroke-width:2px
            style J2 fill:#ffccbc,stroke:#d84315,stroke-width:2px
            style J3 fill:#ffab91,stroke:#d84315,stroke-width:2px
        end

        subgraph "10. Data Layer"
            K1[SQLAlchemy ORM]
            K2[Async Session]
            K3[Transaction Manager]
            style K1 fill:#ede7f6,stroke:#512da8,stroke-width:2px
            style K2 fill:#d1c4e9,stroke:#512da8,stroke-width:2px
            style K3 fill:#b39ddb,stroke:#512da8,stroke-width:2px
        end
    end

    subgraph "11. External Services"
        L1[(PostgreSQL<br/>Partitioned Tables)]
        L2[(Redis<br/>Cache & Queue)]
        L3[AWS S3<br/>Object Storage]
        L4[Stripe API<br/>Billing]
        style L1 fill:#e0f7fa,stroke:#00838f,stroke-width:2px
        style L2 fill:#b2ebf2,stroke:#00838f,stroke-width:2px
        style L3 fill:#80deea,stroke:#00838f,stroke-width:2px
        style L4 fill:#4dd0e1,stroke:#00838f,stroke-width:2px
    end

    %% Request Flow
    A1 --> B1
    A2 --> B2
    A3 --> B3
    B1 --> C2
    B2 --> C3
    B3 --> C1
    C1 --> D1
    C2 --> C3
    C3 --> D2
    D1 --> D3
    D2 --> E1
    E1 -.->|Auto-sent with requests| F1
    E2 -.->|Read for expiry check| D3

    C3 --> F1
    C4 --> F2

    F1 --> G1
    F2 --> G1
    G1 --> G2
    G2 --> G3
    G3 --> G4
    G4 --> G5
    G5 --> H1
    H1 --> H2
    H2 --> H3
    H3 --> H4
    H4 --> I1
    I1 --> I2
    I2 --> I3
    I3 --> J1
    J1 --> J2
    J2 --> J3
    J3 --> K1
    K1 --> K2
    K2 --> K3
    K3 --> L1
    J1 -.->|Cache| L2
    J1 -.->|Files| L3
    J1 -.->|Payments| L4

    %% Response Flow (dashed)
    L1 -.->|Query results| K3
    K3 -.->|Models| K2
    K2 -.->|Serialized| J3
    J3 -.->|Response| I3
    I3 -.->|JSON| F1
    F1 -.->|HTTP Response| C3
    C3 -.->|Data| B2
    B2 -.->|Update| A1
```

---

## Detailed Flow Scenarios

### Scenario 1: Authentication Flow (Login)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React Component
    participant Auth as AuthService
    participant HTTP as HttpClient
    participant BE as Backend /auth/login
    participant JWT as JWT Strategy
    participant DB as PostgreSQL
    participant Cookie as Cookie Service

    User->>UI: Enter credentials + click login
    UI->>Auth: login(username, password, remember_me)
    Auth->>HTTP: POST /api/v1/auth/jwt/login
    Note over HTTP: credentials: 'include'
    HTTP->>BE: Form data (username, password)

    BE->>DB: Authenticate user
    DB-->>BE: User record

    alt Authentication successful
        BE->>BE: Generate device fingerprint
        BE->>DB: Create/update device session
        BE->>JWT: create_access_token(user_id)
        BE->>JWT: create_refresh_token(user_id, remember_me)
        JWT-->>BE: Tokens generated

        BE->>Cookie: Set HttpOnly cookies
        Note over Cookie: access_token (1h)<br/>refresh_token (30-90d)
        Cookie-->>BE: Cookies set in response

        BE->>DB: Update last_login_at
        BE->>DB: Track analytics event

        BE-->>HTTP: 200 OK + TokenResponse body + Set-Cookie headers
        HTTP-->>Auth: Token expiry timestamps
        Auth->>Auth: Store expiry in localStorage
        Auth->>HTTP: GET /api/v1/auth/users/me
        HTTP->>BE: Request with access_token cookie
        BE-->>HTTP: User data
        HTTP-->>Auth: Current user
        Auth-->>UI: Login successful + user data
        UI-->>User: Redirect to dashboard
    else Authentication failed
        BE-->>HTTP: 401 Unauthorized
        HTTP-->>Auth: Login failed
        Auth-->>UI: Error message
        UI-->>User: Display error
    end
```

### Scenario 2: Protected API Request with Token Refresh

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Comp as React Component
    participant RQ as React Query
    participant Svc as ProjectService
    participant HTTP as HttpClient
    participant Token as TokenRefreshService
    participant BE as Backend /projects
    participant Auth as Auth Middleware
    participant DB as PostgreSQL

    User->>Comp: Click "Load Projects"
    Comp->>RQ: useProjects()
    RQ->>Svc: getProjects()
    Svc->>HTTP: fetchWithAuth('/projects/')

    HTTP->>HTTP: Check token expiry
    Note over HTTP: Expires in < 60s?

    alt Token expiring soon
        HTTP->>Token: refreshAccessToken()
        Token->>BE: POST /auth/jwt/refresh + refresh_token cookie
        BE->>BE: Validate refresh token
        BE->>BE: Check token not blacklisted
        BE->>BE: Blacklist old refresh token
        BE->>BE: Generate new tokens
        BE-->>Token: New tokens in cookies + body
        Token->>Token: Store new expiry timestamps
        Token-->>HTTP: Refresh successful
    end

    HTTP->>BE: GET /projects/ + access_token cookie
    Note over HTTP: credentials: 'include'

    BE->>Auth: Extract token from cookie
    Auth->>Auth: Validate JWT signature
    Auth->>Auth: Check expiry
    Auth->>Auth: Check not blacklisted
    Auth->>DB: Load user by ID
    DB-->>Auth: User record
    Auth->>Auth: Verify user is active
    Auth-->>BE: Current user

    BE->>BE: Check permissions
    BE->>DB: Query projects WHERE owner_id = user_id
    DB-->>BE: Project records
    BE->>BE: Serialize to JSON
    BE-->>HTTP: 200 OK + projects data

    HTTP-->>Svc: Response
    Svc-->>RQ: Projects array
    RQ->>RQ: Cache data (1 min)
    RQ-->>Comp: Projects data
    Comp-->>User: Display projects list
```

### Scenario 3: WebSocket Streaming (Real-time Execution)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React Component
    participant Store as ExecutionStore
    participant WS as WebSocket Client
    participant BE as Backend WS /execution/stream
    participant Exec as Execution Engine
    participant DB as PostgreSQL

    User->>UI: Click "Run Workflow"
    UI->>Store: startExecution(workflowId)
    Store->>BE: POST /api/v1/automation/execute
    BE->>DB: Create execution record
    DB-->>BE: execution_id
    BE-->>Store: execution_id

    Store->>WS: connect(execution_id)
    WS->>BE: WebSocket handshake + token
    BE->>BE: Authenticate token
    BE-->>WS: Connection established

    BE->>Exec: Start workflow execution

    loop For each action
        Exec->>DB: Insert automation_log
        Exec->>BE: Emit event: action_start
        BE-->>WS: Message: action_start
        WS->>Store: onMessage(event)
        Store->>Store: Update actionStates
        Store-->>UI: State change
        UI-->>User: Show progress

        Exec->>Exec: Execute action

        Exec->>DB: Update automation_log
        Exec->>BE: Emit event: action_complete
        BE-->>WS: Message: action_complete
        WS->>Store: onMessage(event)
        Store->>Store: Update actionStates
        Store-->>UI: State change
        UI-->>User: Update progress
    end

    Exec->>BE: Emit event: execution_complete
    BE-->>WS: Message: execution_complete
    WS->>Store: onMessage(event)
    Store->>Store: executionStatus = 'completed'
    Store-->>UI: State change
    UI-->>User: Show completion

    WS->>WS: Start heartbeat (30s)

    alt Connection lost
        WS->>WS: Detect disconnect
        WS->>WS: Queue messages
        WS->>WS: Exponential backoff retry
        WS->>BE: Reconnect with last_event_id
        BE-->>WS: Replay missed events
        WS->>WS: Process queued + replayed
        WS->>Store: Sync state
    end
```

### Scenario 4: Optimistic Update with Rollback

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React Component
    participant Mut as useMutation Hook
    participant Cache as React Query Cache
    participant Svc as ProjectService
    participant BE as Backend /projects
    participant DB as PostgreSQL

    User->>UI: Edit project name
    UI->>Mut: mutate({ id, name: 'New Name' })

    Mut->>Cache: cancelQueries(['projects', 'detail', id])
    Cache-->>Mut: Cancelled

    Mut->>Cache: getQueryData(['projects', 'detail', id])
    Cache-->>Mut: Previous data snapshot

    Mut->>Cache: setQueryData(['projects', 'detail', id], new data)
    Note over Cache,Mut: OPTIMISTIC UPDATE
    Cache-->>UI: Trigger re-render
    UI-->>User: Instant feedback (name changed)

    Mut->>Svc: updateProject(id, { name })
    Svc->>BE: PATCH /projects/:id

    alt Update successful
        BE->>DB: UPDATE projects SET name = ? WHERE id = ?
        DB-->>BE: Updated record
        BE-->>Svc: 200 OK + updated project
        Svc-->>Mut: Success
        Mut->>Cache: invalidateQueries(['projects', 'detail', id])
        Mut->>Cache: invalidateQueries(['projects', 'list'])
        Cache->>BE: Refetch fresh data
        BE-->>Cache: Latest data
        Cache-->>UI: Re-render with server data
        UI-->>User: Confirmed update
    else Update failed
        BE-->>Svc: 400/500 Error
        Svc-->>Mut: Error
        Mut->>Cache: setQueryData(['projects', 'detail', id], previous)
        Note over Cache,Mut: ROLLBACK
        Cache-->>UI: Trigger re-render
        UI-->>User: Name reverted + error message
    end
```

---

## Component Responsibilities

### Frontend Components

#### 1. UI Layer
- **React Components:** Presentation logic, event handling, user interaction
- **Next.js Pages:** Routing, SSR/SSG, code splitting
- **Form Inputs:** Validation, controlled components, error display

#### 2. State Management Layer
- **Zustand Stores:** Global state (canvas, execution, UI settings)
  - Immer middleware for immutable updates
  - Persist middleware for localStorage sync
  - Devtools integration for debugging
- **React Query Cache:** Server state caching, background refetching
  - 1-minute stale time
  - Automatic refetch on window focus (production)
  - Exponential backoff retry (3 attempts)
- **Context API:** Authentication state, theme, feature flags

#### 3. Service Layer
- **AuthService:** Login, logout, token refresh, user management
- **ProjectService:** CRUD operations, collaboration, exports
- **HttpClient:** Generic HTTP wrapper with retry logic, error handling
- **WebSocket Client:** Real-time streaming, auto-reconnect, message queuing

#### 4. Token Management
- **TokenManager:** Orchestrates token operations, stores expiry timestamps
- **TokenRefreshService:** Handles refresh logic with deduplication
- **TokenValidator:** Validates expiry, extracts claims from JWT

#### 5. Browser Storage
- **HttpOnly Cookies:** Stores actual token values (XSS protection)
- **localStorage:** Stores token expiry timestamps, UI preferences

### Backend Components

#### 6. Middleware Stack (Executes in Order)
1. **CORSMiddleware:** Handles CORS preflight, allows credentials
2. **SecurityHeadersMiddleware:** Adds CSP, HSTS, X-Frame-Options, etc.
3. **RequestIDMiddleware:** Generates UUID, binds to logs for tracing
4. **SlidingWindowSessionMiddleware:** Auto-refreshes tokens if expiring soon
5. **MetricsMiddleware:** Tracks request timing, user activity

#### 7. Authentication Layer
- **Cookie/Bearer Transport:** Extracts token from cookie (preferred) or Authorization header
- **JWT Strategy:** Validates signature, checks expiry, verifies claims
- **UserManager:** Registration, password reset, email verification
- **Token Blacklist:** Redis-backed revoked token tracking

#### 8. Route Layer
- **API Router:** FastAPI route organization (/api/v1/*)
- **Rate Limiter:** SlowAPI with Redis backing (5-100 req/min)
- **Pydantic Validation:** Request/response schema validation

#### 9. Business Logic Layer
- **Service Layer:** Business logic (auth_analytics, device_fingerprint, etc.)
- **Permission Service:** Organization/project access control
- **CRUD Operations:** Database operations repository pattern

#### 10. Data Layer
- **SQLAlchemy ORM:** Async models, relationships, queries
- **Async Session:** Database connection pooling (5 connections + 10 overflow)
- **Transaction Manager:** Auto-commit on success, auto-rollback on error

#### 11. External Services
- **PostgreSQL:** Partitioned tables (automation_logs, analytics_events)
- **Redis:** Caching, token blacklist, rate limiting, task queue
- **AWS S3:** Object storage for screenshots, exports
- **Stripe API:** Subscription billing, payment processing

---

## Performance Considerations

### Frontend Optimizations

#### 1. React Query Caching
- **Stale time:** 1 minute (prevents unnecessary refetches)
- **Cache time:** 5 minutes (garbage collection)
- **Placeholder data:** Prevents loading flicker on re-renders
- **Background refetch:** Updates data without blocking UI

#### 2. Optimistic Updates
- Instant UI feedback before server confirmation
- Automatic rollback on failure
- Reduces perceived latency by 200-500ms

#### 3. Code Splitting
- Next.js automatic page-level splitting
- Dynamic imports for large components
- Reduces initial bundle size by 40-60%

#### 4. WebSocket Connection Reuse
- Single WebSocket per execution (not per action)
- Heartbeat prevents idle disconnection
- Message queuing during reconnection (100 messages max)

#### 5. Zustand with Immer
- Efficient immutable updates without spread operators
- Structural sharing (only changed parts re-render)
- 10-20% faster than Redux for typical operations

### Backend Optimizations

#### 1. Async Database Operations
- Non-blocking I/O (handles 1000+ concurrent connections)
- Connection pooling (5 base + 10 overflow)
- Prepared statements (SQL injection prevention + performance)

#### 2. Table Partitioning
- **automation_logs:** Monthly partitions (query speedup: 10-50x)
- **analytics_events:** Monthly partitions (retention-based cleanup)
- **automation_input_events:** Weekly partitions (granular archival)

#### 3. Strategic Indexing
- Composite indexes for common query patterns
- Partial indexes for filtered queries
- GIN indexes for JSONB columns

#### 4. Redis Caching
- User session data (reduces DB queries by 70%)
- Rate limit counters (in-memory performance)
- Token blacklist (TTL-based expiration)

#### 5. Sliding Window Token Refresh
- Proactive refresh (prevents 401 errors)
- Reduces round-trips (no explicit refresh calls)
- Threshold: 5 minutes before expiry

### Network Optimizations

#### 1. Response Compression
- Gzip compression (reduces payload by 60-80%)
- Enabled for responses > 1KB

#### 2. HTTP/2 Support
- Multiplexing (parallel requests)
- Server push (not currently used but available)

#### 3. CDN for Static Assets
- Next.js images optimized and cached
- Vercel Edge Network (global distribution)

---

## Security Considerations

### Frontend Security

#### 1. HttpOnly Cookies
- **Tokens never accessible to JavaScript** (XSS protection)
- **SameSite: lax** (CSRF protection)
- **Secure flag in production** (HTTPS-only)
- **Path restrictions:** refresh_token only sent to /api/v1/auth

#### 2. CSRF Protection
- CSRF token for POST/PUT/DELETE requests
- Read from `<meta name="csrf-token">` or cookies
- Validated on backend

#### 3. Input Sanitization
- React automatically escapes JSX content
- DOMPurify for rich text (if used)
- Zod validation for form inputs

#### 4. Content Security Policy
- Restricts script sources
- Prevents inline script execution
- Mitigates XSS attacks

### Backend Security

#### 1. Authentication & Authorization
- **JWT with separate secrets** (access vs refresh)
- **Token rotation** (old refresh tokens blacklisted)
- **Device fingerprinting** (suspicious login detection)
- **Sliding window sessions** (30-day absolute max)

#### 2. Password Security
- **Argon2 hashing** (preferred, memory-hard)
- **Bcrypt fallback** (legacy support)
- **Minimum strength requirements** (8 chars, upper, lower, digit)
- **Rate limiting** (5 login attempts per minute)

#### 3. Rate Limiting
- **Per-IP limits:** 200 requests/day, 50/hour
- **Auth endpoints:** 5 requests/minute (login, password reset)
- **Redis-backed** (distributed rate limiting)
- **Retry-After headers** (client backoff guidance)

#### 4. SQL Injection Prevention
- **Parameterized queries** (SQLAlchemy)
- **ORM usage** (no raw SQL by default)
- **Input validation** (Pydantic schemas)

#### 5. Security Headers
- **HSTS:** Force HTTPS (production)
- **X-Frame-Options:** DENY (clickjacking prevention)
- **X-Content-Type-Options:** nosniff
- **CSP:** Restrict resource loading
- **Referrer Policy:** strict-origin-when-cross-origin

#### 6. Audit Logging
- **All auth events tracked** (login, logout, password change)
- **Device information recorded** (IP, user agent, fingerprint)
- **Suspicious activity monitoring** (multiple failed logins, new devices)
- **Enhanced audit logs** (SOC 2 compliance fields added)

---

## Data Flow Patterns

### 1. Request-Response (REST)
**Use case:** CRUD operations, one-time queries

**Pros:**
- Simple, well-understood
- Cacheable with standard HTTP
- Stateless (scales horizontally)

**Cons:**
- Chatty for complex operations (multiple round-trips)
- Polling required for updates

### 2. WebSocket Streaming
**Use case:** Real-time execution, collaboration, notifications

**Pros:**
- Bidirectional communication
- Low latency (no polling overhead)
- Server push capability

**Cons:**
- Stateful (requires connection management)
- More complex error handling
- Proxy/firewall issues

### 3. Optimistic Updates
**Use case:** User edits, immediate feedback required

**Pros:**
- Zero perceived latency
- Better UX (no spinners)
- Works offline (queued)

**Cons:**
- Rollback complexity
- Potential inconsistencies
- User confusion if rolled back

### 4. Server-Sent Events (Not Currently Used)
**Use case:** One-way server push (notifications, updates)

**Pros:**
- Simpler than WebSocket
- Auto-reconnection built-in
- Works over HTTP

**Cons:**
- One-way only
- Less efficient than WebSocket
- Browser connection limits

---

## Error Handling Patterns

### Frontend Error Handling

#### 1. Network Errors
```typescript
if (!navigator.onLine) {
  throw new Error('No internet connection. Please check your network.');
}
```

#### 2. Token Refresh Errors
```typescript
// Automatically retry request after refresh
if (response.status === 401 && attempt === 1) {
  const refreshed = await this.refreshAccessToken();
  if (refreshed) {
    return this.fetchWithAuth(url, options, attempt + 1);
  }
  // Refresh failed - logout user
  window.dispatchEvent(new CustomEvent('session-expired'));
}
```

#### 3. Rate Limiting
```typescript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  await delay(parseInt(retryAfter) * 1000);
  return this.fetchWithAuth(url, options, attempt + 1);
}
```

#### 4. Server Errors (5xx)
```typescript
if (response.status >= 500 && attempt <= maxRetries) {
  const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
  await delay(backoff);
  return this.fetchWithAuth(url, options, attempt + 1);
}
```

### Backend Error Handling

#### 1. Validation Errors (400)
```python
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "error": "VALIDATION_ERROR",
            "message": "Invalid request data",
            "details": [{"field": e["loc"], "message": e["msg"]} for e in exc.errors()],
            "timestamp": time.time(),
            "path": str(request.url.path)
        }
    )
```

#### 2. Authentication Errors (401)
```python
if not user or not user.is_active:
    raise HTTPException(
        status_code=401,
        detail="LOGIN_BAD_CREDENTIALS",
        headers={"WWW-Authenticate": "Bearer"}
    )
```

#### 3. Authorization Errors (403)
```python
if not await permission_service.can_user_access_project(db, user.id, project_id):
    raise HTTPException(
        status_code=403,
        detail="Not enough permissions"
    )
```

#### 4. Database Errors
```python
try:
    await session.commit()
except IntegrityError:
    await session.rollback()
    raise HTTPException(status_code=409, detail="Resource already exists")
except Exception:
    await session.rollback()
    raise
```

---

## Monitoring and Observability

### Metrics Tracked

#### Frontend Metrics
- **Page load time:** Performance.timing API
- **API call duration:** Timestamp diff in HttpClient
- **Error rates:** Error boundary tracking
- **Cache hit rate:** React Query devtools

#### Backend Metrics
- **Request duration:** MetricsMiddleware timing
- **Endpoint usage:** Stored in analytics_events table
- **Error rates:** Logged per endpoint
- **Database query time:** SQLAlchemy logging
- **WebSocket connections:** Active connection count

### Logging

#### Frontend Logging
```typescript
// Structured logging
console.log({
  level: 'error',
  message: 'API request failed',
  url: request.url,
  status: response.status,
  timestamp: Date.now()
});
```

#### Backend Logging (Structlog)
```python
logger.info("user_login",
    user_id=str(user.id),
    email=user.email,
    device_fingerprint=fingerprint,
    ip_address=request.client.host,
    request_id=request.state.request_id
)
```

### Distributed Tracing
- **Request ID:** Generated in backend, returned in X-Request-ID header
- **Correlation:** Frontend can include X-Request-ID in subsequent related requests
- **Log aggregation:** Request ID allows finding all logs for a single request chain

---

## References

### Architecture Documents
- [Data Flow Architecture](./data-flow-architecture.md) - State management details
- [Authentication Architecture](./auth-architecture.md) - Auth flow specifics
- [Deployment Architecture](./deployment-architecture.md) - Infrastructure details

### Key Files

#### Frontend
- `/frontend/src/lib/api-client.ts` - Main API client
- `/frontend/src/services/http-client.ts` - HTTP wrapper with retries
- `/frontend/src/services/auth/auth-service.ts` - Authentication
- `/frontend/src/stores/canvas-store.ts` - Canvas state management
- `/frontend/src/stores/execution-store.ts` - Execution state

#### Backend
- `/backend/app/main.py` - FastAPI application entry
- `/backend/app/api/v1/api.py` - Route registration
- `/backend/app/middleware/` - Middleware implementations
- `/backend/app/auth/config.py` - fastapi-users configuration
- `/backend/app/core/security.py` - JWT token generation

### External Documentation
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Query Documentation](https://tanstack.com/query/latest)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Next.js Documentation](https://nextjs.org/docs)
