# Technology Recommendations for qontinui-web

**Date:** 2025-10-13
**Status:** Active Development (Breaking changes acceptable)

This document outlines production-grade library recommendations for standard web application functionality in qontinui-web, based on research of current best practices (2024-2025) and analysis of reference implementations.

---

## Reference Implementation Analysis

### Examined Repositories

1. **vintasoftware/nextjs-fastapi-template** (Primary Reference)
   - Professional consultancy-maintained template
   - Production-ready architecture with end-to-end type safety
   - Uses modern best practices (Zod, fastapi-users, PostgreSQL + asyncpg)
   - CI/CD workflows included
   - Vercel deployment ready

2. **PyNextStack**
   - Educational/demo project
   - Shows MongoDB + Redis integration patterns
   - JWT authentication implementation example
   - Good for understanding concepts, not production patterns

### Key Findings

- **fastapi-users** is the de facto standard for FastAPI authentication
- **SQLAlchemy 2.0 + asyncpg** is the production standard for PostgreSQL
- **shadcn/ui + Radix UI** dominates modern Next.js UI development
- **React Hook Form + Zod** replaces older form libraries
- **TanStack Query** (React Query) is the server state management standard

---

## Current qontinui-web Stack

### Backend (FastAPI)
```
FastAPI: 0.116.2
SQLAlchemy: 2.0.43
PostgreSQL: psycopg2-binary 2.9.10
Pydantic: 2.11.9
python-jose: 3.5.0 (JWT)
passlib + bcrypt: password hashing
slowapi: 0.1.9 (rate limiting)
alembic: 1.16.5 (migrations)
```

### Frontend (Next.js)
```
Next.js: 15.5.2
React: 19.1.0
Tailwind CSS: ^4
Radix UI: Multiple components already installed
react-hook-form: 7.62.0 ✓
recharts: 3.2.1 ✓
sonner: 2.0.7 ✓ (toasts)
@xyflow/react: 12.8.5 (workflow diagrams)
```

---

## Recommended Additions and Upgrades

### 1. Authentication & User Management

#### **CRITICAL: Add fastapi-users**

**Current State:** Custom authentication with python-jose + passlib
**Recommended:** fastapi-users library

**Why:**
- Industry standard for FastAPI authentication
- Pre-built user management endpoints
- Multiple authentication strategies (JWT, OAuth, sessions)
- Email verification and password reset flows
- Active maintenance (v14.0.1 released Jan 2025)
- Used in vintasoftware template (production reference)

**Implementation:**
```python
# pyproject.toml additions
fastapi-users[sqlalchemy] = "^13.0.0"  # or latest 14.x

Features:
- Automatic user registration/login/logout endpoints
- Password validation and hashing
- JWT token management
- OAuth provider integration (Google, GitHub, etc.)
- Email verification workflows
- Role-based access control support
```

**Migration Path:**
1. Install fastapi-users
2. Create User model extending fastapi-users base
3. Set up authentication backends (JWT strategy)
4. Implement UserManager for custom logic
5. Replace custom auth endpoints with fastapi-users routers
6. Migrate existing users (if any) to new schema

### 2. Database Optimization

#### **CRITICAL: Switch to asyncpg**

**Current State:** psycopg2-binary (synchronous)
**Recommended:** asyncpg (asynchronous)

**Why:**
- 3x faster than psycopg2
- Full async/await support for FastAPI
- Production standard for async PostgreSQL
- Used in both reference implementations

**Implementation:**
```python
# Remove from dependencies
psycopg2-binary = "^2.9.10"

# Add
asyncpg = ">=0.29.0,<0.30"

# Update SQLAlchemy connection string
postgresql+asyncpg://user:pass@host/db
```

**Migration:**
- Update database.py to use create_async_engine
- Convert all session usage to async_session
- Update all database operations to async/await
- Test thoroughly (this is a significant change)

### 3. State Management (Frontend)

#### **Add TanStack Query (React Query)**

**Current State:** No dedicated server state management
**Recommended:** TanStack Query v5

**Why:**
- #1 most popular state management in State of React 2024
- 41K+ GitHub stars
- Automatic caching, revalidation, background refetching
- Optimistic updates
- Replaces Redux for server state

**Implementation:**
```bash
pnpm add @tanstack/react-query
```

```typescript
// Use for all API data fetching
const { data, isLoading, error } = useQuery({
  queryKey: ['users'],
  queryFn: () => fetch('/api/users').then(res => res.json())
})
```

#### **Add Zustand (Optional, for Client State)**

**Current State:** No client state management
**Recommended:** Zustand (if needed for complex UI state)

**Why:**
- 45K+ GitHub stars
- Minimal boilerplate
- TypeScript-first
- 20-30% smaller than Redux

**When to use:**
- User preferences (theme, sidebar state)
- UI state not tied to server data
- Complex form wizards

### 4. Form Validation Enhancement

#### **Add Zod for Schema Validation**

**Current State:** react-hook-form installed, no schema validator
**Recommended:** Zod + @hookform/resolvers

**Why:**
- TypeScript-first schema validation
- End-to-end type safety with Pydantic
- Industry standard in 2024-2025
- Works perfectly with react-hook-form

**Implementation:**
```bash
pnpm add zod @hookform/resolvers
```

```typescript
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
})

const form = useForm({
  resolver: zodResolver(schema)
})
```

### 5. API Client Generation

#### **Add OpenAPI TypeScript Client Generator**

**Current State:** Manual API calls
**Recommended:** @hey-api/openapi-ts

**Why:**
- Automatic TypeScript client from FastAPI's OpenAPI schema
- Type-safe API calls
- Hot-reloads when backend routes change
- Used in vintasoftware template

**Implementation:**
```bash
pnpm add @hey-api/openapi-ts @hey-api/client-fetch
```

```json
// package.json
"scripts": {
  "generate-client": "openapi-ts --input http://localhost:8000/openapi.json --output ./lib/api"
}
```

### 6. Background Task Processing (Backend)

#### **Add Celery + Redis for Heavy Tasks**

**Current State:** No background task processing
**Recommended:** Celery + Redis

**Why:**
- Production standard for Python background tasks
- Multi-process workers
- Task persistence (survives restarts)
- Task scheduling (cron-like)
- Perfect for:
  - Image processing (qontinui uses Pillow)
  - Long-running automation tasks
  - Email sending
  - Report generation

**Implementation:**
```python
# pyproject.toml
celery = "^5.4.0"
redis = "^5.2.0"

# For simple tasks, use FastAPI BackgroundTasks (already available)
# For heavy computation, use Celery
```

**When to use:**
- Image processing: Celery
- Quick email sends: FastAPI BackgroundTasks
- Long automation runs: Celery

### 7. Caching Layer

#### **Add Redis for Caching**

**Current State:** No caching layer
**Recommended:** Redis + fastapi-redis-cache

**Why:**
- Essential for production performance
- Cache API responses
- Session storage
- Rate limiting backend (slowapi supports Redis)
- Required for Celery anyway

**Implementation:**
```python
# pyproject.toml
redis = "^5.2.0"
fastapi-redis-cache = "^0.3.0"  # or aioredis

# Use for:
- GET endpoint response caching
- Database query result caching
- ML model inference caching (if applicable)
```

### 8. Logging & Monitoring

#### **Add Structured Logging**

**Current State:** Basic Python logging
**Recommended:** structlog + Sentry

**Why:**
- Machine-readable logs (JSON)
- Correlation IDs for request tracking
- Integration with monitoring tools
- Production error tracking

**Implementation:**
```python
# pyproject.toml
structlog = "^24.1.0"
sentry-sdk = {extras = ["fastapi"], version = "^2.21.0"}

# Configure structlog for JSON logging in production
# Configure Sentry for error tracking
```

### 9. Testing Enhancement

#### **Add Vitest for Frontend Testing**

**Current State:** No frontend testing framework
**Recommended:** Vitest + React Testing Library + Playwright

**Why:**
- 4x faster than Jest
- Vite-powered (Next.js 15 compatible)
- Modern, better DX
- Jest-compatible API (easy migration)

**Implementation:**
```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom
pnpm add -D playwright  # for E2E tests
```

**Testing Strategy:**
- Vitest: Unit tests for components and hooks
- Playwright: E2E tests for user flows
- pytest: Backend API tests (already have pytest)

### 10. Email Sending

#### **Current: aiosmtplib (Good)**

**Status:** ✓ Already optimal
**Alternative:** SendGrid or AWS SES for production

**Why current choice is good:**
- async email sending ✓
- Works with BackgroundTasks ✓

**Production enhancement:**
```python
# For production, consider adding:
# - SendGrid for managed service
# - AWS SES for scalability
# - Email templates with Jinja2

fastapi-mail = "^1.4.1"  # For templating
```

### 11. File Upload & Storage

#### **Add S3 Integration for Production**

**Current State:** Local file storage (not suitable for production)
**Recommended:** AWS S3 + boto3 with presigned URLs

**Why:**
- Don't store files in containers (ephemeral)
- Scalable, reliable storage
- Direct browser-to-S3 uploads (offload from backend)
- Industry standard

**Implementation:**
```python
# pyproject.toml
boto3 = "^1.37.0"

# Pattern:
1. Backend generates presigned URL
2. Frontend uploads directly to S3
3. Backend receives notification
4. Virus scanning for security-critical apps
```

### 12. Admin Dashboard (Future)

#### **Consider SQLAdmin**

**Current State:** None
**Recommended:** SQLAdmin (when needed)

**Why:**
- Auto-generated CRUD interfaces
- Built for SQLAlchemy
- Modern UI
- Good for internal tools

**Implementation (future):**
```python
sqladmin = "^0.19.0"
```

---

## Implementation Priority

### Phase 1: Critical Performance & Security
1. ✓ **Switch to asyncpg** - Major performance improvement
2. ✓ **Add fastapi-users** - Security and maintainability
3. ✓ **Add Redis** - Required for caching and Celery
4. ✓ **Add Zod** - Type safety for forms

### Phase 2: Development Experience
5. ✓ **Add TanStack Query** - Better data fetching
6. ✓ **Add OpenAPI client generator** - Type-safe API
7. ✓ **Add structlog** - Better debugging
8. ✓ **Add Vitest** - Frontend testing

### Phase 3: Production Scaling
9. ✓ **Add Celery** - Background processing
10. ✓ **Add Sentry** - Error tracking
11. ✓ **Add S3 integration** - File storage
12. ✓ **Add Zustand** - Client state (if needed)

---

## Breaking Changes Are Acceptable

**Remember:** This project is in active development. Backward compatibility is not a priority. These changes will significantly improve code quality and production readiness.

### Major Refactors Required

1. **Authentication System**
   - Replace custom JWT handling with fastapi-users
   - Migrate user model to fastapi-users schema
   - Update all auth-dependent endpoints

2. **Database Layer**
   - Convert all sync database calls to async
   - Update SQLAlchemy session management
   - Test all database operations thoroughly

3. **API Client**
   - Generate TypeScript client from OpenAPI
   - Replace manual fetch calls with typed client
   - Update error handling patterns

---

## Libraries to Keep (Already Optimal)

### Backend
- ✓ FastAPI 0.116.2 - Latest stable
- ✓ SQLAlchemy 2.0.43 - Modern async support
- ✓ Pydantic 2.11.9 - Latest v2
- ✓ slowapi - Good rate limiting choice
- ✓ alembic - Standard migrations tool
- ✓ aiosmtplib - Async email sending

### Frontend
- ✓ Next.js 15.5.2 - Latest
- ✓ React 19.1.0 - Latest
- ✓ Tailwind CSS 4 - Latest
- ✓ Radix UI - Best accessible primitives
- ✓ react-hook-form - Industry standard
- ✓ recharts - Good charting library
- ✓ sonner - Best toast notifications
- ✓ @xyflow/react - Workflow diagrams

---

## Libraries to Remove

### Backend
- ❌ **psycopg2-binary** - Replace with asyncpg
- Consider removing **python-jose** after fastapi-users migration (it has its own JWT handling)

### Frontend
- No removals needed - current stack is modern and appropriate

---

## Configuration Files Needed

### 1. TanStack Query Provider

```typescript
// app/providers/query-provider.tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.Node }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

### 2. OpenAPI Client Generation Script

```bash
#!/bin/bash
# scripts/generate-api-client.sh

# Start backend if not running
# Wait for server
# Generate client
openapi-ts --input http://localhost:8000/openapi.json --output ./lib/api

echo "API client generated successfully!"
```

### 3. Redis Configuration

```python
# backend/app/config/redis.py
from redis import asyncio as aioredis
from app.config.settings import settings

redis_client = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True
)

async def get_redis():
    return redis_client
```

### 4. Celery Configuration

```python
# backend/app/celery_app.py
from celery import Celery
from app.config.settings import settings

celery_app = Celery(
    "qontinui",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.task_routes = {
    "app.tasks.*": {"queue": "main-queue"},
}

@celery_app.task
def process_image(image_path: str):
    # Image processing logic
    pass
```

---

## Environment Variables to Add

```bash
# Backend .env additions

# Redis
REDIS_URL=redis://localhost:6379/0

# Celery
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# Sentry (production)
SENTRY_DSN=https://...

# AWS S3 (production)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=qontinui-uploads
AWS_REGION=us-east-1

# fastapi-users secrets
ACCESS_SECRET_KEY=<generate-new-secret>
RESET_PASSWORD_SECRET_KEY=<generate-new-secret>
VERIFICATION_SECRET_KEY=<generate-new-secret>
ACCESS_TOKEN_EXPIRE_SECONDS=3600
```

---

## Migration Strategy

### 1. Development Environment Setup

```bash
# Install new dependencies
cd backend
poetry add fastapi-users[sqlalchemy] asyncpg redis celery structlog sentry-sdk boto3

cd frontend
pnpm add @tanstack/react-query zod @hookform/resolvers @hey-api/openapi-ts
pnpm add -D vitest @testing-library/react playwright
```

### 2. Database Migration Steps

1. Create new asyncpg engine alongside psycopg2
2. Test async operations in non-critical endpoints
3. Gradually migrate endpoints to async
4. Remove psycopg2 when all migrations complete

### 3. Authentication Migration Steps

1. Install fastapi-users
2. Create new User model with fastapi-users base
3. Set up parallel authentication (old + new)
4. Migrate endpoints one by one
5. Remove old auth system

### 4. Testing Strategy

- Write tests for new functionality before migration
- Keep old tests running during migration
- Update tests after successful migration
- Delete old tests when migration complete

---

## Success Metrics

### Performance
- API response time < 200ms (90th percentile)
- Database query time < 50ms (90th percentile)
- Frontend page load < 2s (90th percentile)
- Lighthouse score > 90

### Code Quality
- TypeScript strict mode with no `any` types
- Test coverage > 80% for critical paths
- Zero high-severity security vulnerabilities
- Linter errors = 0

### Developer Experience
- Hot reload working for frontend and backend
- Type-safe API calls (no manual fetch)
- Auto-generated API documentation
- Structured logging for easy debugging

---

## Resources

### Documentation
- fastapi-users: https://fastapi-users.github.io/fastapi-users/
- TanStack Query: https://tanstack.com/query
- Zod: https://zod.dev
- SQLAlchemy async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html

### Reference Implementations
- Vintasoftware template: /home/jspinak/nextjs-fastapi-template
- PyNextStack: /home/jspinak/PyNextStack

### Tools
- OpenAPI TypeScript: https://github.com/hey-api/openapi-ts
- Vitest: https://vitest.dev
- Playwright: https://playwright.dev

---

## Next Steps

1. Review this document with the team
2. Prioritize implementation phases
3. Create GitHub issues for each major change
4. Start with Phase 1 (Critical changes)
5. Update documentation as changes are implemented

---

**Maintained by:** Joshua Spinak
**Last Updated:** 2025-10-13
**Status:** Living document - update as technology landscape evolves
