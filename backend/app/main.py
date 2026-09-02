import asyncio
import os
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from starlette.exceptions import HTTPException as StarletteHTTPException

# Cloud-control side-effect import — must run before api_router is built so
# cloud-control's add_route_registrar / add_model_registrar / etc. are
# registered before api.py and models/__init__.py fire their hooks.
# OSS-only deployments have no cloud-control package installed; the
# ImportError is silently swallowed and the OSS app boots normally.
# QONTINUI_DISABLE_CLOUD_EXTENSIONS=1 skips the import even where the package
# IS installed (e.g. CI installs the sibling for tests) — used by
# scripts/export_openapi.py --base to compute the BASE (OSS-only) declared
# surface, which is what prod api.qontinui.io actually serves and what coord's
# route-serving observer reads as its declared-route source.
if os.environ.get("QONTINUI_DISABLE_CLOUD_EXTENSIONS") != "1":
    try:
        import qontinui_cloud_control  # noqa: F401  -- side-effect: registers extension hooks
    except ImportError:
        pass

from app.api.v1.api import api_router
from app.api.v1.endpoints.session_repository import EXPORT_PROVENANCE_HEADERS
from app.config.logging_config import configure_logging, get_logger
from app.core.config import settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.middleware.database_timing import (
    DatabaseTimingMiddleware,
    init_database_timing,
)
from app.middleware.error_handler import (
    AppError,
    app_exception_handler,
    db_operational_exception_handler,
    db_timeout_exception_handler,
    general_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.metrics_middleware import MetricsMiddleware
from app.middleware.rate_limit import limiter, rate_limit_exceeded_handler
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware

# Configure structured logging
configure_logging(environment=settings.ENVIRONMENT)
logger = get_logger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=(
        f"{settings.API_V1_STR}/openapi.json"
        if settings.ENVIRONMENT == "development"
        else None
    ),
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
    redirect_slashes=False,  # Prevent 307 redirects that break proxy
)

# Add exception handlers
app.add_exception_handler(AppError, app_exception_handler)  # type: ignore
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
# DB-unavailable 503s (pool saturation / connection failure) MUST be TYPED
# handlers, never an ``Exception`` catch-all: typed handlers run inside
# ExceptionMiddleware (inside CORSMiddleware) so the 503 carries CORS headers;
# a catch-all runs in ServerErrorMiddleware (outside CORS) and browsers
# misreport the failure as a CORS error (2026-07-21 prod incident).
app.add_exception_handler(SQLAlchemyTimeoutError, db_timeout_exception_handler)  # type: ignore
app.add_exception_handler(OperationalError, db_operational_exception_handler)  # type: ignore
# asyncpg reality (review HIGH-2): the async request path surfaces DB-down as
# builtin ConnectionRefusedError (connect / pre-ping) or InterfaceError
# (statement-time drop) — OperationalError only covers the sync engine.
app.add_exception_handler(InterfaceError, db_operational_exception_handler)  # type: ignore
app.add_exception_handler(ConnectionRefusedError, db_operational_exception_handler)  # type: ignore
if settings.ENVIRONMENT == "development":
    app.add_exception_handler(Exception, general_exception_handler)

# Add rate limiting
if settings.RATE_LIMIT_ENABLED:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore

# Add trusted host middleware for production
# Custom implementation that exempts health check endpoints from host validation
# This allows AWS ELB health checks (which use internal IPs) to pass while still
# protecting against Host header injection attacks on all other endpoints
if settings.ENVIRONMENT == "production":
    from app.middleware.trusted_host import TrustedHostMiddleware

    # Default production hosts if not configured via environment variable
    allowed_hosts = settings.ALLOWED_HOSTS or [
        "qontinui.io",
        "www.qontinui.io",
        "api.qontinui.io",
        "qontinui.com",
        "www.qontinui.com",
    ]

    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=allowed_hosts,
        exempt_paths=["/health"],  # Allow health checks without host validation
    )
    logger.info(
        "trusted_host_middleware_enabled",
        allowed_hosts=allowed_hosts,
        exempt_paths=["/health"],
    )

# Set up CORS
if settings.BACKEND_CORS_ORIGINS:
    # Convert AnyHttpUrl objects to strings and strip trailing slashes
    origins = [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]
    logger.info("Using CORS origins from settings", origins=origins)
else:
    origins = [
        "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3011",  # dev-local-auth verify-web frontend (/verify-web on-ramp)
        "http://localhost:1420",  # qontinui-runner Tauri app
        "tauri://localhost",  # Tauri custom protocol
        "https://tauri.localhost",  # Tauri HTTPS protocol
        # Allow frontend on Windows to access WSL backend
        # Note: WSL IP may change, consider using localhost instead
        "http://172.27.67.252:3001",
        "http://172.27.67.252:3000",
        "http://172.24.89.15:3001",
        "http://172.24.89.15:3000",
    ]
    logger.info("Using development CORS origins", origins=origins)

# Add database query timing middleware (if enabled)
if settings.ENABLE_QUERY_LOGGING:
    app.add_middleware(DatabaseTimingMiddleware)
    logger.info(
        "database_timing_middleware_enabled",
        slow_query_threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        max_queries_per_request=settings.MAX_QUERIES_PER_REQUEST,
    )

# Add HTTP request logging middleware
app.add_middleware(LoggingMiddleware)
logger.info("http_request_logging_enabled")

# Add metrics tracking middleware
app.add_middleware(MetricsMiddleware)

# NOTE: the sliding-window session middleware was removed with the local
# FastAPI-Users token stack — it re-minted local HS256 access tokens
# mid-session, which can never apply to Cognito sessions (Cognito access
# tokens carry no ``type:"access"`` claim). Cognito owns token lifetime
# and refresh via its hosted UI / refresh tokens.

# Add request ID tracking middleware (should be first for proper context binding)
app.add_middleware(RequestIDMiddleware)

# Add security headers middleware (executes after CORS in request flow)
app.add_middleware(SecurityHeadersMiddleware)
logger.info("security_headers_middleware_enabled", environment=settings.ENVIRONMENT)

# Response compression. Nothing else in the stack does it: the Elastic
# Beanstalk nginx overlay (`backend/.platform/nginx/conf.d/`) sets timeouts
# only, an ALB does not compress at all, and the CloudFront distribution's
# `Compress` behaviour is scoped to `images/*` served from S3 — not this API.
#
# It earns its place on the fleet's `.claude/` corpus, which the runner fetches
# on the spawn critical path inside a 4 s budget and resolves FAIL-SOFT, so a
# link too slow to finish degrades to cache and then to embedded defaults rather
# than erroring. Measured over that corpus (87 units, 2026-08-25): 1,988,661
# bytes uncompressed against ~701,500 gzipped at level 6, i.e. 486 KB/s of
# sustained throughput required versus 171. The gzip figure moves by a few tens
# of bytes between runs because the measurement harness mints fresh row ids.
# That is complementary to the metadata projection on
# `/api/v1/agent-text-units/index`, not a substitute — the projection carries a
# cold resolve, compression carries the body fetch that follows it.
#
# Added INSIDE CORSMiddleware (which is added after this, so it stays
# outermost), and outside everything else, so it compresses the final body.
# Streaming is safe: Starlette's GZipMiddleware excludes `text/event-stream`
# outright (`DEFAULT_EXCLUDED_CONTENT_TYPES`, verified in the pinned 1.3.1),
# passes non-HTTP scopes straight through, and never double-encodes a response
# that already carries a `Content-Encoding`.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
logger.info("gzip_middleware_enabled", minimum_size=1024, compresslevel=6)

# Response headers a browser client is allowed to READ.
#
# Only six response headers are CORS-safelisted (Cache-Control,
# Content-Language, Content-Length, Content-Type, Expires, Last-Modified,
# Pragma); every other one is invisible to `fetch` on a cross-origin response
# unless it is listed here. The frontend runs cross-origin whenever
# NEXT_PUBLIC_API_URL names the API host — `ApiConfig.IS_REMOTE_BACKEND`, the
# deployed shape — so an unlisted header is not "missing in some edge case",
# it is missing in production while still present in local same-origin dev.
#
# It fails SILENTLY: `response.headers.get(name)` returns None, which is the
# same answer as "the server never sent it". Nothing logs, nothing 500s, and
# the client's fallback path runs as if the server had been less honest than
# it was. Add a header here in the same change that starts emitting it.
CORS_EXPOSE_HEADERS: list[str] = [
    "X-Total-Count",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "X-Request-ID",
    # The session-repository export's provenance set. `X-Content-Sha256` is
    # also what `/api/v1/plan-library/{id}/export` returns its digest in, so
    # that route's documented contract is readable from a browser for the
    # first time too.
    *EXPORT_PROVENANCE_HEADERS,
]

# CORS middleware must be added LAST so it executes FIRST (middleware order is reversed)
cors_origin_regex = settings.BACKEND_CORS_ORIGIN_REGEX or None
if cors_origin_regex:
    logger.info("Using CORS origin regex", regex=cors_origin_regex)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=CORS_EXPOSE_HEADERS,
)

app.include_router(api_router, prefix=settings.API_V1_STR)

# Mount embedding service at /api/embeddings (no /v1 prefix — the Rust runner's
# EmbeddingClient and the web backend's own semantic_search endpoint both call
# http://127.0.0.1:8001/api/embeddings/compute-text directly).
from app.api.embeddings import router as embeddings_router  # noqa: E402

app.include_router(embeddings_router, prefix="/api/embeddings", tags=["embeddings"])

# Mount wrapper marketplace at /api/wrappers (no /v1 prefix — the runner's
# install-event pings target /api/wrappers/<id>/install-events directly per
# the wrapper-runner integration plan, Phase 6).
from app.api.v1.endpoints.wrappers import router as wrappers_router  # noqa: E402

app.include_router(wrappers_router, prefix="/api/wrappers", tags=["wrappers"])

# Mount static files for avatars
uploads_dir = Path("uploads")
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Background task handle for the wrapper-registry sync loop. The stale-
# connection / clipboard / file cleanups and the cron dispatch now run inside
# the in-process asyncio scheduler (app.core.scheduler), not here.
_wrapper_sync_task: asyncio.Task | None = None


def _boot_side_effects_disabled() -> bool:
    """True when this process is a test run, so boot-time side effects skip.

    ``TESTING=1`` is exported by ``backend/tests/conftest.py`` before any app
    module is imported (and by the ``backend-ci.yml`` test steps), so reading
    the environment is the same idiom ``app/core/sentry_config.py`` already
    uses to go inert under pytest. There is no ``settings.TESTING`` field to
    read instead.

    Why app startup must be inert under tests: ``TestClient(app)`` used as a
    context manager runs the lifespan, so *when* the app boots inside a pytest
    session is decided by which collected file first pulls the client fixture.
    Any boot step that writes shared rows, touches the network, or spawns a
    session-long background loop therefore leaks into unrelated tests, and the
    blast radius changes with the collected file set. Each call site guarded by
    this predicate documents why it is safe to skip; ``scheduler.start()`` is
    deliberately NOT guarded (see its own comment).
    """
    return os.getenv("TESTING") == "1"


def _suppress_proactor_connection_lost(loop, context):
    exc = context.get("exception")
    transport = context.get("transport")
    # Proactor _call_connection_lost on a force-RST'd client surfaces as a
    # ConnectionResetError (WinError 10054) on a _ProactorSocketTransport.
    # Benign on Windows; never blanket-swallow ConnectionResetError elsewhere.
    if (
        isinstance(exc, ConnectionResetError)
        and type(transport).__name__ == "_ProactorSocketTransport"
    ):
        return  # benign on Windows; client RST'd us
    loop.default_exception_handler(context)


@app.on_event("startup")
async def startup_event():
    # Test runs skip the boot steps that mutate shared rows, reach the network,
    # or spawn session-long background loops — see _boot_side_effects_disabled.
    skip_side_effects = _boot_side_effects_disabled()

    logger.info(
        "application_starting",
        version=settings.VERSION,
        environment=settings.ENVIRONMENT,
        project=settings.PROJECT_NAME,
        boot_side_effects_skipped=skip_side_effects,
    )

    # Announce a device-identity split before anything depends on it. Pure
    # logging (no network, no shared rows), so it runs even when boot side
    # effects are skipped: the whole point is that this configuration is
    # otherwise only discovered at the first token rejection.
    from app.services.coord_jwks import warn_if_device_coord_split

    warn_if_device_coord_split()

    # Suppress the benign Windows-Proactor ConnectionResetError raised when a
    # WS client force-RSTs us (Python bug #39010 lineage). No-op on non-Windows
    # since the transport type won't match there.
    asyncio.get_running_loop().set_exception_handler(_suppress_proactor_connection_lost)

    # Initialize Sentry for error tracking. (`os` is imported at module scope;
    # the redundant function-local `import os` that used to sit here made `os` a
    # function-local name, so any earlier use in this function raised
    # UnboundLocalError.)
    from app.core.sentry_config import configure_sentry

    sentry_dsn = os.getenv("SENTRY_DSN")
    if sentry_dsn:
        configure_sentry(
            dsn=sentry_dsn,
            environment=settings.ENVIRONMENT,
            release=f"qontinui-backend@{settings.VERSION}",
            traces_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 0.0,
            profiles_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 0.0,
        )
        logger.info("sentry_configured", environment=settings.ENVIRONMENT)
    else:
        logger.info("sentry_not_configured", reason="SENTRY_DSN not set")

    # Initialize Redis connection (optional)
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            await RedisConfig.get_client()
            logger.info("redis_initialized", status="connected")
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.warning(
                "redis_initialization_failed",
                error=str(e),
                error_type=type(e).__name__,
                note="Continuing without Redis",
            )
    else:
        logger.info("redis_disabled", note="Redis is disabled via configuration")

    # Initialize database (seed the FIRST_SUPERUSER shell row).
    #
    # Skipped under tests. `init_db` does exactly one thing: if
    # `settings.FIRST_SUPERUSER_EMAIL` is set, SELECT `auth.users` for it and
    # INSERT+commit a shell superuser row when absent (tables themselves come
    # from alembic, not from here). Nothing in the suite needs that row — the
    # only file that pulls the app fixture, `tests/test_file_execution_e2e.py`,
    # overrides `current_active_user` with a MagicMock — and neither
    # `tests/conftest.py` nor `.github/workflows/backend-ci.yml` sets
    # FIRST_SUPERUSER_EMAIL, so in CI this block is ALREADY a no-op.
    #
    # It is gated anyway because when the var IS set (a dev box with a local
    # `.env`) it becomes a boot-time write into the very database the tests use
    # (conftest points DATABASE_URL at `qontinui_test`), and its SELECT requires
    # `auth.users` to exist — which couples app boot to the `test_engine`
    # fixture's create_all/drop_all ordering. A raise here aborts startup, so a
    # boot pinned ahead of `test_engine` would take the whole session down.
    if skip_side_effects:
        logger.info("database_init_skipped", reason="TESTING=1")
    else:
        try:
            async with AsyncSessionLocal() as db:
                await init_db(db)
            logger.info("database_initialized", status="success")
        except (ConnectionRefusedError, TimeoutError) as e:
            logger.error(
                "database_connection_failed",
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            # Re-raise to prevent app from starting with broken DB
            raise
        except Exception as e:
            logger.error(
                "database_initialization_failed",
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            # Re-raise to prevent app from starting with broken DB
            raise

    # Initialize database query timing
    if settings.ENABLE_QUERY_LOGGING:
        from app.db.session import async_engine, sync_engine

        init_database_timing(async_engine, sync_engine)

    # Initialize ARQ connection pool (optional, requires Redis)
    if settings.REDIS_ENABLED:
        try:
            from redis.exceptions import RedisError

            from app.worker.arq_pool import get_arq_pool

            await get_arq_pool()
            logger.info("arq_pool_initialized", status="connected")
        except (RedisError, ConnectionError, TimeoutError, OSError) as e:
            # redis.exceptions.RedisError (incl. its ConnectionError) does NOT
            # subclass the builtin ConnectionError, so it must be listed
            # explicitly — otherwise a Redis hiccup escapes this guard and
            # aborts app startup ("Application startup failed. Exiting.")
            # instead of degrading to "no task queue".
            logger.warning(
                "arq_initialization_failed",
                error=str(e),
                error_type=type(e).__name__,
                note="Continuing without task queue",
            )
    else:
        logger.info("arq_pool_disabled", note="Task queue disabled (Redis not enabled)")

    # Start the in-process asyncio scheduler. This single background loop owns
    # EVERY periodic behavior in the backend: the tenant-memory lifecycle +
    # MEMORY.md bridge (formerly Celery beat, which was never deployed and so
    # never fired), the cron workflow dispatch (formerly RedBeat), and the
    # stale-connection / clipboard / file cleanups (formerly three ad-hoc
    # asyncio.create_task loops right here). Every tick is gated on a Postgres
    # advisory lock, so N replicas run exactly one executor per task.
    #
    # DELIBERATELY NOT gated on `skip_side_effects`. Killing the scheduler under
    # tests also stops `memory_reindex` / `memory_consolidate` /
    # `memory_bridge_sync`, and `tests/test_memory_api_db.py`'s hybrid-query
    # tests depend on those having run — with the scheduler off that file fails a
    # varying 1-5 tests per run. The one dangerous task, `scheduled_dispatch`, is
    # already switched off for the suite by
    # `tests/conftest.py`'s QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED=0 (see
    # tests/test_scheduler_dispatch_sweeper_off_in_tests.py). Keep the blast
    # radius at that one task.
    try:
        from app.core.scheduler import scheduler

        await scheduler.start()
    except Exception as e:  # noqa: BLE001 - a dead schedule must not kill boot
        logger.error(
            "scheduler_start_failed",
            error=str(e),
            error_type=type(e).__name__,
            note="Continuing without the in-process scheduler",
        )

    # Phase 6 — start the wrapper-registry sync background task. Pulls
    # registry.json from github.com/qontinui/wrappers-registry on startup
    # and every hour thereafter, upserting wrapper_entries. Failures are
    # logged inside the loop and never propagate.
    #
    # Skipped under tests: `_sync_loop` fetches registry.json over the NETWORK
    # and `commit()`s `wrapper_entries` immediately, then hourly, for the rest of
    # the process's life. It is not a scheduler task, so no
    # QONTINUI_SCHEDULER_* switch reaches it and `scheduler.status()` cannot even
    # show it — an unobservable session-long writer against the test database.
    # Nothing in the suite touches `start_sync_job` / `sync_registry` or asserts
    # on registry-synced `wrapper_entries` rows.
    if skip_side_effects:
        logger.info("wrapper_registry_sync_skipped", reason="TESTING=1")
    else:
        try:
            from app.services.wrapper_sync_service import start_sync_job

            global _wrapper_sync_task
            _wrapper_sync_task = start_sync_job()
            logger.info("wrapper_registry_sync_started", interval_seconds=3600)
        except (ImportError, RuntimeError) as e:
            logger.warning(
                "wrapper_registry_sync_failed_to_start",
                error=str(e),
                error_type=type(e).__name__,
                note="Continuing without wrapper registry sync",
            )

    # (The Phase 3D redbeat startup-resync lived here. It is gone with RedBeat:
    # schedule state is now a Postgres column — `scheduled_workflow_runs.
    # next_fire_at` — so there is nothing to re-hydrate into Redis, and a Redis
    # flush can no longer drop a schedule.)

    # Strategy Collaboration (Phase 1) service-account bridge. No-op
    # until COORD_ADMIN_SECRET is set; fail-fast when set-but-misconfig.
    #
    # Skipped under tests because "no-op unless COORD_ADMIN_SECRET is set" is
    # NOT reliable here: the secret is a plain settings field, and an operator
    # box that exports it for coord work would have the test process mint a real
    # token against coord over the network at boot (fail-fast → raises and kills
    # the whole session) and then keep a `_refresh_loop` task alive for the rest
    # of it. `/strategy` route tests build their own client and mock the mint;
    # the live-coord ones live under tests/integration/, which conftest ignores.
    if skip_side_effects:
        logger.info("strategy_client_startup_skipped", reason="TESTING=1")
    else:
        from app.services.strategy import strategy_client

        await strategy_client.startup()

    # Recording-pipeline async-run recovery (Phase 4 of plan
    # 2026-05-17-web-runner-ws-bridge-plan-b.md). Flips stale
    # in-flight rows to ``timed_out`` so polling clients see a
    # terminal state after a web restart.
    #
    # Skipped under tests: it is a boot-time bulk `UPDATE ... SET
    # status='timed_out'` + commit over every `queued`/`running`
    # recording_pipeline_runs row, on the real engine — i.e. it rewrites rows
    # other tests may have seeded, at a moment decided by collection order. This
    # is the side effect originally measured perturbing unrelated tests. No test
    # depends on it today, and one that wants the sweep can await
    # `recover_running_runs_on_boot()` itself.
    if skip_side_effects:
        logger.info("recording_pipeline_recovery_skipped", reason="TESTING=1")
    else:
        try:
            from app.services.recording_pipeline_subscriber import (
                recover_running_runs_on_boot,
            )

            await recover_running_runs_on_boot()
            logger.info("recording_pipeline_recovery_complete")
        except Exception as exc:  # noqa: BLE001 - non-fatal at boot
            logger.error(
                "recording_pipeline_recovery_failed",
                error=str(exc),
            )


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("application_shutting_down")

    # Stop the scheduler. It cancels its loop AND any in-flight run, so each
    # run's `finally` releases its Postgres advisory lock before we exit —
    # a lock leaked on a pooled connection would block the next replica's tick.
    try:
        from app.core.scheduler import scheduler

        await scheduler.stop()
    except Exception as e:  # noqa: BLE001 - never block shutdown
        logger.warning(
            "scheduler_stop_failed", error=str(e), error_type=type(e).__name__
        )

    global _wrapper_sync_task
    if _wrapper_sync_task is not None:
        _wrapper_sync_task.cancel()
        try:
            await _wrapper_sync_task
        except asyncio.CancelledError:
            logger.info("wrapper_registry_sync_task_cancelled")

    # Close Redis connection
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            await RedisConfig.close()
            logger.info("redis_closed")
        except (ConnectionError, OSError) as e:
            logger.warning(
                "redis_close_error", error=str(e), error_type=type(e).__name__
            )

        # Close ARQ connection pool
        try:
            from app.worker.arq_pool import close_arq_pool

            await close_arq_pool()
            logger.info("arq_pool_closed")
        except (ConnectionError, OSError) as e:
            logger.warning("arq_close_error", error=str(e), error_type=type(e).__name__)

    # Flush any pending metrics before shutdown
    from app.db.session import AsyncSessionLocal
    from app.services.metrics_service import metrics_service

    if AsyncSessionLocal is not None:
        async with AsyncSessionLocal() as db:
            try:
                await metrics_service.force_flush(db)
                logger.info("metrics_flushed")
            except (ConnectionError, TimeoutError) as e:
                logger.error(
                    "error_flushing_metrics", error=str(e), error_type=type(e).__name__
                )


@app.get("/")
def root():
    return {"message": "Qontinui API", "version": settings.VERSION}


@app.get("/health")
async def health_check():
    """Health check endpoint with database connectivity check"""
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }

    # Check async database connectivity
    try:
        from sqlalchemy import text

        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        health_status["database"] = "connected"
        health_status["database_driver"] = "asyncpg"
        logger.debug("health_check_success", database="connected", driver="asyncpg")
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["database"] = f"error: {str(e)}"
        logger.error("health_check_database_error", error=str(e))

    # Check Redis connectivity (if enabled)
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            redis_client = await RedisConfig.get_client()
            await redis_client.ping()
            health_status["redis"] = "connected"
            logger.debug("health_check_redis_success")
        except Exception as e:
            health_status["redis"] = f"error: {str(e)}"
            logger.warning("health_check_redis_error", error=str(e))
    else:
        health_status["redis"] = "disabled"

    # DB connection-pool gauges (checked-out / overflow / capacity /
    # occupancy) — the same snapshot MetricsMiddleware samples per request,
    # exposed here for pollers (ELB health checks, CloudWatch scrapes).
    try:
        from app.core.db_pool_metrics import observe_async_engine_pool

        health_status["db_pool"] = observe_async_engine_pool()
    except Exception as e:  # noqa: BLE001 - health must never 500
        health_status["db_pool"] = {"error": str(e)}
        logger.warning("health_check_db_pool_error", error=str(e))

    # In-process scheduler. Every registered task is reported even if it has
    # never run — a never-run task shows null last_run_at rather than being
    # absent, so "the schedule is dead" is VISIBLE instead of silent (the exact
    # failure mode that let the Celery beat schedule never fire, unnoticed).
    try:
        from app.core.scheduler import scheduler_status

        health_status["scheduler"] = scheduler_status()
    except Exception as e:  # noqa: BLE001 - health must never 500
        health_status["scheduler"] = {"error": str(e)}
        logger.warning("health_check_scheduler_error", error=str(e))

    return health_status


@app.get("/favicon.ico")
async def favicon():
    """Return 204 No Content for favicon requests"""
    from fastapi.responses import Response

    return Response(status_code=204)
