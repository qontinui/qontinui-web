from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from slowapi.errors import RateLimitExceeded
import time
import logging

from app.api.v1.api import api_router
from app.core.config import settings
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.middleware.rate_limit import limiter, rate_limit_exceeded_handler
from app.middleware.error_handler import (
    app_exception_handler,
    validation_exception_handler,
    http_exception_handler,
    general_exception_handler,
    AppException
)

# Configure logging
logging.basicConfig(
    level=logging.INFO if settings.ENVIRONMENT == "production" else logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if settings.ENVIRONMENT == "development" else None,
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None
)

# Add exception handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
if settings.ENVIRONMENT == "development":
    app.add_exception_handler(Exception, general_exception_handler)

# Add rate limiting
if settings.RATE_LIMIT_ENABLED:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# Add trusted host middleware for production
if settings.ENVIRONMENT == "production":
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["qontinui.com", "*.qontinui.com", "localhost"]
    )

# Set up CORS
origins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002",
           "http://localhost:3003", "http://localhost:3004"]

if settings.ENVIRONMENT == "production":
    origins = ["https://qontinui.com", "https://app.qontinui.com", "https://www.qontinui.com"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.on_event("startup")
def startup_event():
    # Initialize database
    db = SessionLocal()
    init_db(db)
    db.close()


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
        "environment": settings.ENVIRONMENT
    }

    # Check database connectivity
    try:
        from sqlalchemy import text
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        health_status["database"] = "connected"
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["database"] = f"error: {str(e)}"

    return health_status