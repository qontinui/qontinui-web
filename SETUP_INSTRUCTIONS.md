# Setup Instructions for Production-Grade Libraries

This document provides step-by-step instructions for implementing the recommended libraries from `TECHNOLOGY_RECOMMENDATIONS.md`.

## Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL 14+
- Redis 7+ (optional, for Phase 1)
- Docker (optional, for containerized services)

---

## Phase 1: Critical Performance & Security

### 1. Install Dependencies

#### Backend
```bash
cd backend

# Add production-grade libraries
poetry add fastapi-users[sqlalchemy] asyncpg redis structlog

# Development dependencies
poetry add --group dev pytest-asyncio
```

#### Frontend
```bash
cd frontend

# Add production-grade libraries
pnpm add @tanstack/react-query @tanstack/react-query-devtools zod @hookform/resolvers

# Development dependencies
pnpm add -D @hey-api/openapi-ts @hey-api/client-fetch
```

### 2. Configuration Files

The following configuration files have been created:

1. **Backend:**
   - `backend/app/config/redis_config.py` - Redis client setup
   - `backend/app/celery_app.py` - Celery for background tasks
   - `backend/app/config/logging_config.py` - Structured logging

2. **Frontend:**
   - `frontend/lib/providers/query-provider.tsx` - TanStack Query setup
   - `frontend/lib/validations/auth.ts` - Zod validation schemas

3. **Scripts:**
   - `scripts/generate-api-client.sh` - API client generation

### 3. Environment Variables

Add to `backend/.env`:

```bash
# Database (update to use asyncpg)
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/qontinui

# Redis
REDIS_URL=redis://localhost:6379/0

# Celery
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# fastapi-users secrets (generate new secrets!)
ACCESS_SECRET_KEY=<generate-with-openssl-rand-hex-32>
RESET_PASSWORD_SECRET_KEY=<generate-with-openssl-rand-hex-32>
VERIFICATION_SECRET_KEY=<generate-with-openssl-rand-hex-32>
ACCESS_TOKEN_EXPIRE_SECONDS=3600

# Logging
LOG_LEVEL=INFO
ENVIRONMENT=development  # or production

# Sentry (optional, for production)
SENTRY_DSN=https://your-sentry-dsn
```

Generate secrets:
```bash
openssl rand -hex 32  # Run 3 times for each secret
```

### 4. Start Redis (Local Development)

#### Option 1: Docker
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

#### Option 2: Native Install
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl start redis

# Check connection
redis-cli ping  # Should return PONG
```

### 5. Update Database Configuration

Replace synchronous database setup with async:

**Before (backend/app/database.py):**
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
```

**After:**
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Use asyncpg driver
engine = create_async_engine(
    DATABASE_URL,  # postgresql+asyncpg://...
    echo=True,
    future=True
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def get_db():
    async with async_session_maker() as session:
        yield session
```

### 6. Integrate TanStack Query Provider

Update `frontend/app/layout.tsx`:

```typescript
import { QueryProvider } from '@/lib/providers/query-provider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
```

### 7. Update Package.json Scripts

Add to `frontend/package.json`:

```json
{
  "scripts": {
    "generate-client": "openapi-ts --input http://localhost:8000/openapi.json --output ./lib/api",
    "dev": "next dev --turbopack -p 3001",
    "build": "next build --turbopack"
  }
}
```

---

## Phase 2: Development Experience

### 1. Generate API Client

Start backend, then run:

```bash
cd frontend
pnpm run generate-client
```

This creates type-safe API client in `frontend/lib/api/`.

**Usage example:**
```typescript
import { DefaultService } from '@/lib/api'

// Type-safe API calls!
const users = await DefaultService.getUsers()
```

### 2. Set up Structured Logging

Update `backend/app/main.py`:

```python
from app.config.logging_config import configure_logging, get_logger

# Configure on startup
configure_logging(environment=settings.ENVIRONMENT)
logger = get_logger(__name__)

@app.on_event("startup")
async def startup():
    logger.info("application_starting", version="0.1.0")
```

**Usage in endpoints:**
```python
from app.config.logging_config import get_logger

logger = get_logger(__name__)

@app.get("/users")
async def get_users():
    logger.info("fetching_users", count=10)
    # ... endpoint logic
```

### 3. Implement fastapi-users

This is a larger migration. See the dedicated migration guide:

```bash
# Create migration guide
cat > backend/FASTAPI_USERS_MIGRATION.md << 'EOF'
# fastapi-users Migration Guide

## Step 1: Install fastapi-users

```bash
poetry add fastapi-users[sqlalchemy]
```

## Step 2: Create User Model

Create `backend/app/models/user.py`:

```python
from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(SQLAlchemyBaseUserTableUUID, Base):
    pass
```

## Step 3: Set up User Manager

Create `backend/app/auth/user_manager.py`:

```python
from fastapi_users import BaseUserManager, UUIDIDMixin

class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.RESET_PASSWORD_SECRET_KEY
    verification_token_secret = settings.VERIFICATION_SECRET_KEY

    async def on_after_register(self, user: User, request: Optional[Request] = None):
        print(f"User {user.id} has registered.")
```

See vintasoftware/nextjs-fastapi-template for complete example.
EOF
```

---

## Phase 3: Production Scaling

### 1. Set up Celery Workers

Start Celery worker:

```bash
cd backend
celery -A app.celery_app worker --loglevel=info --queues=default,image-processing,email
```

For development, use:
```bash
watchmedo auto-restart --directory=./app --pattern=*.py -- celery -A app.celery_app worker --loglevel=info
```

### 2. Add Monitoring (Flower)

```bash
poetry add flower

# Start Flower
celery -A app.celery_app flower --port=5555
```

Access at: http://localhost:5555

### 3. Set up Testing

#### Backend Tests
```bash
cd backend
poetry add --group dev pytest-asyncio httpx

# Run tests
pytest
```

#### Frontend Tests
```bash
cd frontend
pnpm add -D vitest @testing-library/react @testing-library/jest-dom

# Add to package.json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}

# Run tests
pnpm test
```

---

## Verification Checklist

After setup, verify:

### Backend
- [ ] FastAPI starts without errors
- [ ] `/docs` shows OpenAPI documentation
- [ ] Database connection works (async)
- [ ] Redis connection works
- [ ] Celery worker starts
- [ ] Structured logs appear in console
- [ ] Tests pass: `pytest`

### Frontend
- [ ] Next.js dev server starts
- [ ] API client generates successfully
- [ ] TanStack Query DevTools appear (bottom-right in dev)
- [ ] No TypeScript errors: `pnpm tsc`
- [ ] Linter passes: `pnpm lint`

### Integration
- [ ] Frontend can call backend API
- [ ] Type-safe API calls work
- [ ] Form validation with Zod works
- [ ] Background tasks execute in Celery

---

## Common Issues

### Issue: Redis connection refused
**Solution:** Make sure Redis is running
```bash
docker ps  # Check if redis container is running
redis-cli ping  # Should return PONG
```

### Issue: Database connection error with asyncpg
**Solution:** Update DATABASE_URL to use `postgresql+asyncpg://` driver

### Issue: API client generation fails
**Solution:**
1. Ensure backend is running: `curl http://localhost:8000/docs`
2. Check OpenAPI spec: `curl http://localhost:8000/openapi.json`

### Issue: TanStack Query not working
**Solution:** Make sure QueryProvider wraps your app in layout.tsx

---

## Next Steps

1. Migrate authentication to fastapi-users
2. Convert all database operations to async
3. Implement Celery tasks for heavy operations
4. Add comprehensive tests
5. Set up CI/CD pipeline

Refer to `TECHNOLOGY_RECOMMENDATIONS.md` for detailed implementation guidance.

---

**Maintained by:** Joshua Spinak
**Last Updated:** 2025-10-13
