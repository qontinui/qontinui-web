# Quick Start: Implementing Production-Grade Libraries

**Goal:** Get started with the recommended libraries in 1 hour

This guide provides the fastest path to start implementing production-grade libraries in qontinui-web.

---

## Prerequisites

✅ Python 3.12+
✅ Node.js 20+
✅ PostgreSQL running
✅ Git repository clean (commit current work)

---

## Phase 0: Low-Risk Additions (30 minutes)

These additions don't break existing code and provide immediate value.

### 1. Install Dependencies (5 minutes)

```bash
# Backend
cd backend
poetry add zod structlog

# Frontend
cd frontend
pnpm add @tanstack/react-query @tanstack/react-query-devtools zod @hookform/resolvers
```

### 2. Add TanStack Query Provider (10 minutes)

The file is already created! Just integrate it:

**Edit `frontend/app/layout.tsx`:**

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

**Verify:** Start dev server, check for TanStack Query DevTools in bottom-right corner.

### 3. Use Zod for One Form (15 minutes)

The validation schemas are already created in `frontend/lib/validations/auth.ts`!

**Update one form to use Zod:**

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginFormData } from '@/lib/validations/auth'

function LoginForm() {
  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    }
  })

  const onSubmit = (data: LoginFormData) => {
    // data is now fully validated and typed!
    console.log(data)
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* Your form fields */}
    </form>
  )
}
```

**Verify:** Try submitting invalid data, see Zod validation messages.

---

## Phase 1: Quick Win - Structured Logging (15 minutes)

Replace basic logging with structured logs.

### 1. Install structlog

```bash
cd backend
poetry add structlog
```

### 2. Configure Logging

The config file is already created at `backend/app/config/logging_config.py`!

**Update `backend/app/main.py`:**

```python
from app.config.logging_config import configure_logging, get_logger

# At startup
configure_logging(environment="development")
logger = get_logger(__name__)

@app.on_event("startup")
async def startup():
    logger.info("application_starting", version="0.1.0")
```

### 3. Use in One Endpoint

```python
from app.config.logging_config import get_logger

logger = get_logger(__name__)

@router.get("/users/me")
async def get_current_user(current_user: User = Depends(get_current_user)):
    logger.info("user_profile_accessed", user_id=current_user.id)
    return current_user
```

**Verify:** Check logs for structured JSON output (in development, it's pretty-printed).

---

## Phase 2: Optional - Start Redis (15 minutes)

If you want to set up caching/Celery later, start Redis now.

### Using Docker (Recommended)

```bash
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:7-alpine
```

### Verify

```bash
docker ps  # Should see redis container
redis-cli ping  # Should return PONG
```

### Test Connection

The Redis config is already created at `backend/app/config/redis_config.py`!

```python
from app.config.redis_config import get_redis

@app.on_event("startup")
async def startup():
    redis = await get_redis()
    await redis.set("test", "hello")
    value = await redis.get("test")
    print(f"Redis test: {value}")  # Should print: Redis test: hello
```

---

## Verification

After these quick additions, you should have:

✅ TanStack Query DevTools visible in frontend
✅ Zod validation working in at least one form
✅ Structured logging in at least one endpoint
✅ (Optional) Redis running and connected

---

## What You've Gained

1. **Better form validation** - Type-safe schemas with Zod
2. **Better debugging** - Structured logs easy to search
3. **Better state management** - React Query caching and DevTools
4. **No breaking changes** - All additions are backwards compatible

---

## Next Steps

Now that you have the foundation:

### This Week
- Migrate more forms to use Zod validation
- Add TanStack Query to API data fetching
- Add structured logging to more endpoints

### Next Week
- Consider asyncpg migration (3x performance)
- Or consider fastapi-users (remove ~800 lines of code)

### Later
- Add Celery for background tasks
- Add comprehensive caching strategy
- Generate TypeScript API client

---

## Need Help?

**Documentation:**
- `TECHNOLOGY_RECOMMENDATIONS.md` - Why these libraries?
- `IMPLEMENTATION_MAPPING.md` - What code gets replaced?
- `SETUP_INSTRUCTIONS.md` - Detailed setup for all libraries
- `docs/migration-guides/` - Step-by-step migration guides

**Reference Code:**
- `/home/jspinak/nextjs-fastapi-template` - Production example
- `/home/jspinak/PyNextStack` - Educational example

**Created Configuration Files:**
All starter files are already created and ready to use:
- `backend/app/config/redis_config.py`
- `backend/app/config/logging_config.py`
- `backend/app/celery_app.py`
- `frontend/lib/providers/query-provider.tsx`
- `frontend/lib/validations/auth.ts`
- `scripts/generate-api-client.sh`

---

**Time Investment:** 1 hour
**Risk:** Low (non-breaking additions)
**Benefit:** Immediate improvement in DX and code quality

**Ready for more?** See `SETUP_INSTRUCTIONS.md` for the full implementation plan.

---

**Last Updated:** 2025-10-13
