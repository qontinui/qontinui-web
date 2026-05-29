"""Application configuration using Pydantic settings.

Loads configuration from environment variables and .env file.
"""

import json
import warnings
from typing import Any, cast

from pydantic import AnyHttpUrl, Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All settings can be configured via environment variables or .env file.
    See .env.example for available options.
    """

    # Project
    PROJECT_NAME: str = "Qontinui API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = Field(default="development", description="Current environment")

    # Database
    DATABASE_URL: PostgresDsn | str = Field(
        default="postgresql://user:pass@localhost/db",
        description="PostgreSQL connection string",
    )

    # Security
    SECRET_KEY: str = Field(
        default="change-me-in-production-min-32-chars",
        min_length=32,
        description="Secret key for JWT encoding",
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 1 hour
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30  # Standard refresh token expiry
    REMEMBER_ME_TOKEN_EXPIRE_DAYS: int = (
        90  # Long-lived refresh token for trusted devices
    )

    # Sliding Window Session Configuration
    SLIDING_WINDOW_ENABLED: bool = Field(
        default=True, description="Enable sliding window session extension"
    )
    SLIDING_WINDOW_THRESHOLD_MINUTES: int = Field(
        default=5, description="Minutes before token expiry to trigger auto-refresh"
    )
    MAX_SESSION_DAYS: int = Field(
        default=30, description="Absolute maximum session duration in days"
    )

    # fastapi-users secrets (should be different from SECRET_KEY)
    ACCESS_SECRET_KEY: str | None = Field(
        default=None,
        min_length=32,
        description="Secret key for access tokens (fastapi-users)",
    )
    RESET_PASSWORD_SECRET_KEY: str | None = Field(
        default=None, min_length=32, description="Secret key for password reset tokens"
    )
    VERIFICATION_SECRET_KEY: str | None = Field(
        default=None,
        min_length=32,
        description="Secret key for email verification tokens",
    )
    ACCESS_TOKEN_EXPIRE_SECONDS: int = 3600  # 1 hour

    # CORS
    BACKEND_CORS_ORIGINS: list[AnyHttpUrl] = []
    BACKEND_CORS_ORIGIN_REGEX: str = ""

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str] | str:
        """Parse CORS origins from string or list format."""
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            return cast(list[str], json.loads(v))
        elif isinstance(v, list):
            return v
        raise ValueError(v)

    # Server
    HOST: str = Field(default="0.0.0.0")  # noqa: S104 - intentional bind for server
    PORT: int = Field(default=8000)
    RELOAD: bool = Field(default=True)
    DEBUG: bool = Field(default=True)

    # Frontend
    FRONTEND_URL: str = Field(default="http://localhost:3001")

    # Backend URL (for CSP reporting, webhooks, etc.)
    BACKEND_URL: str = Field(
        default="http://localhost:8000",
        description="Backend URL for external references (CSP reports, webhooks)",
    )

    # Runner connection URLs (for desktop app)
    RUNNER_WS_URL: str = Field(
        default="ws://localhost:8000",
        description="WebSocket URL for qontinui-runner desktop app",
    )
    RUNNER_BACKEND_URL: str = Field(
        default="http://localhost:8000",
        description="Backend HTTP(S) URL for qontinui-runner API calls",
    )

    # Qontinui API URL (for template matching and other features)
    QONTINUI_API_URL: str = Field(
        default="http://localhost:8001",
        description="Qontinui API URL for template matching and other features",
    )

    # User settings
    FIRST_SUPERUSER_EMAIL: str | None = None
    FIRST_SUPERUSER_PASSWORD: str | None = None

    # Email settings
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_TLS: bool = True
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_EMAIL: str = "noreply@qontinui.com"
    SUPPORT_EMAIL: str = Field(
        default="support@qontinui.com",
        description="Email address for receiving feedback and support messages",
    )

    # AWS Settings (for SES)
    AWS_REGION: str = Field(default="eu-central-1", description="AWS region for SES")
    USE_SES_API: bool = Field(
        default=True,
        description="Use AWS SES API instead of SMTP (recommended for AWS deployments)",
    )

    # Rate limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_HOUR: int = 600

    # Redis (for task queue) - Optional, will fall back to synchronous operations
    # Default is False for production since we don't have Redis in AWS yet
    REDIS_ENABLED: bool = Field(
        default=False, description="Enable Redis for task queue and caching"
    )
    REDIS_URL: str | None = Field(
        default=None,
        description=(
            "Full Redis connection URL (e.g. rediss://:<token>@host:6379/0). Canonical "
            "input: carries scheme/TLS/auth/host/port/db in one place, so the client is "
            "provider-agnostic (ElastiCache, Upstash, local) and supports managed Redis "
            "requiring TLS + AuthToken. Takes precedence over REDIS_HOST/PORT/DB, which "
            "remain a local-dev fallback when this is unset."
        ),
    )
    REDIS_HOST: str = Field(default="localhost")
    REDIS_PORT: int = Field(default=6379)
    REDIS_DB: int = Field(default=0)

    # Strategy Collaboration (Phase 1) — coord service-account bridge.
    # Feature is DISABLED until COORD_ADMIN_SECRET is set (i.e. until
    # the next coord deploy provisions it); endpoints then return 503.
    COORD_URL: str = Field(
        default="http://localhost:9870",
        description="Base URL of qontinui-coord for the strategy bridge",
    )
    COORD_ADMIN_SECRET: str | None = Field(
        default=None,
        description=(
            "Shared secret for POST /coord/auth/service-token. Unset = "
            "strategy feature disabled. Set-but-wrong = fail-fast at startup."
        ),
    )
    STRATEGY_SERVICE_NAME: str = Field(
        default="qontinui-web-strategy",
        description="sub=service:<name> the web backend mints at coord",
    )

    # AWS Cognito user-pool identity (unified-Cognito-identity Phase 1).
    # The web backend dual-accepts Cognito user-pool JWTs alongside the
    # local FastAPI-Users HS256 JWT. Defaults target the production web
    # pool; override per-environment via env vars. Setting
    # COGNITO_USER_POOL_ID to "" disables the Cognito accept path
    # entirely (only the local JWT is honoured).
    COGNITO_USER_POOL_ID: str = Field(
        default="us-east-1_rgTB9dbZ1",
        description="Cognito user pool id (e.g. us-east-1_rgTB9dbZ1). "
        "Empty disables Cognito JWT acceptance.",
    )
    COGNITO_REGION: str = Field(
        default="us-east-1",
        description="AWS region of the Cognito user pool",
    )
    COGNITO_ISSUER: str = Field(
        default="",
        description=(
            "Cognito token issuer URL. Derived from "
            "COGNITO_REGION + COGNITO_USER_POOL_ID when left blank: "
            "https://cognito-idp.<region>.amazonaws.com/<pool_id>"
        ),
    )
    COGNITO_ALLOWED_AUDIENCES: str = Field(
        # web app-client, runner app-client, mobile app-client. The
        # runner + mobile present user tokens to /users/me, so their
        # client ids must be trusted as audiences too.
        default=(
            "q6ns1a8bokf2np1mj8v8arl31,"
            "67f2a1a0cmgileob23lniud5t7,"
            "7sirquecq6svomsoe34pblfp24"
        ),
        description=(
            "Comma-separated set of accepted Cognito app-client ids. A "
            "token is accepted if its `aud` (ID tokens) OR `client_id` "
            "(access tokens) is in this set."
        ),
    )

    @field_validator("COGNITO_ISSUER", mode="before")
    @classmethod
    def derive_cognito_issuer(cls, v: str | None, info: Any) -> str:
        """Derive the Cognito issuer from region + pool id when unset.

        An explicit COGNITO_ISSUER always wins; otherwise build the
        canonical Cognito issuer URL. If no pool id is configured the
        issuer is empty (Cognito accept disabled).
        """
        if v:
            return v.rstrip("/")
        pool_id = info.data.get("COGNITO_USER_POOL_ID") or ""
        region = info.data.get("COGNITO_REGION") or ""
        if not pool_id or not region:
            return ""
        return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"

    @property
    def cognito_allowed_audiences_list(self) -> list[str]:
        """Parse COGNITO_ALLOWED_AUDIENCES into a trimmed, non-empty list."""
        return [
            a.strip()
            for a in (self.COGNITO_ALLOWED_AUDIENCES or "").split(",")
            if a.strip()
        ]

    # Stripe
    STRIPE_SECRET_KEY: str | None = Field(default=None, description="Stripe secret key")
    STRIPE_PUBLISHABLE_KEY: str | None = Field(
        default=None, description="Stripe publishable key"
    )
    STRIPE_WEBHOOK_SECRET: str | None = Field(
        default=None, description="Stripe webhook secret"
    )
    STRIPE_PRICE_HOBBY: str | None = Field(
        default=None, description="Stripe Price ID for Hobby tier"
    )
    STRIPE_PRICE_PRO: str | None = Field(
        default=None, description="Stripe Price ID for Pro tier"
    )

    # Object Storage (S3/MinIO)
    STORAGE_BACKEND: str = Field(
        default="local", description="Storage backend: local, s3, minio"
    )
    STORAGE_BUCKET_NAME: str = Field(
        default="qontinui", description="S3/MinIO bucket name"
    )
    STORAGE_REGION: str = Field(
        default="us-east-1", description="AWS region or MinIO region"
    )
    STORAGE_ACCESS_KEY: str | None = Field(
        default=None, description="S3/MinIO access key"
    )
    STORAGE_SECRET_KEY: str | None = Field(
        default=None, description="S3/MinIO secret key"
    )
    STORAGE_ENDPOINT_URL: str | None = Field(
        default=None, description="MinIO endpoint URL (e.g., http://localhost:9000)"
    )
    STORAGE_USE_SSL: bool = Field(
        default=True, description="Use SSL for storage connections"
    )

    # CloudFront CDN (optional, for production image delivery)
    USE_CLOUDFRONT: bool = Field(
        default=False, description="Use CloudFront CDN for image delivery"
    )
    CLOUDFRONT_DOMAIN: str | None = Field(
        default=None,
        description="CloudFront distribution domain (e.g., d123abc.cloudfront.net)",
    )
    CLOUDFRONT_DISTRIBUTION_ID: str | None = Field(
        default=None, description="CloudFront distribution ID (for cache invalidation)"
    )

    # Background cleanup jobs
    CLEANUP_ENABLED: bool = Field(
        default=True,
        description="Enable automatic cleanup of expired sessions and old data",
    )
    CLEANUP_SESSION_DAYS: int = Field(
        default=90, description="Delete device sessions not accessed in this many days"
    )
    CLEANUP_ANALYTICS_DAYS: int = Field(
        default=90, description="Delete analytics events older than this many days"
    )
    CLEANUP_SCHEDULE: str = Field(
        default="0 2 * * *",
        description="Cron schedule for cleanup jobs (format: minute hour day month weekday)",
    )

    # Device verification settings
    REQUIRE_DEVICE_VERIFICATION: bool = Field(
        default=False,
        description="Require email verification for new devices (optional feature)",
    )
    DEVICE_VERIFICATION_REQUIRED_FOR_TRUSTED: bool = Field(
        default=True,
        description="Device must be verified before it can be marked as trusted",
    )

    # Runner token settings
    RUNNER_TOKEN_DEFAULT_EXPIRY_DAYS: int = Field(
        default=90,
        description="Default expiration for runner tokens in days (0 = never expires)",
    )
    RUNNER_TOKEN_MAX_PER_USER: int = Field(
        default=10,
        description="Maximum number of runner tokens a user can create",
    )

    # Database query timing settings
    SLOW_QUERY_THRESHOLD_MS: int = Field(
        default=100,
        description="Threshold in milliseconds for logging slow queries",
    )
    ENABLE_QUERY_LOGGING: bool = Field(
        default=False,
        description="Enable database query logging and statistics (disable in production for performance)",
    )
    MAX_QUERIES_PER_REQUEST: int = Field(
        default=20,
        description="Maximum number of queries per request before warning (N+1 detection)",
    )

    # Render Logging for UI Bridge State Discovery
    # Captures DOM snapshots for co-occurrence analysis
    RENDER_LOG_ENABLED: bool = Field(
        default=True,
        description="Enable render logging for UI Bridge state discovery",
    )
    RENDER_LOG_IMAGE_DIR: str = Field(
        default="debug_data/render_images",
        description="Directory for storing render log images",
    )
    RENDER_LOG_RETENTION_DAYS: int = Field(
        default=7,
        description="Auto-delete render logs older than this many days",
    )
    RENDER_LOG_MAX_SNAPSHOTS: int = Field(
        default=1000,
        description="Maximum number of render snapshots to keep",
    )

    # Allowed hosts for TrustedHostMiddleware
    ALLOWED_HOSTS: list[str] = Field(
        default=[],
        description="Allowed hosts for TrustedHostMiddleware in production. Empty list uses defaults.",
    )

    @field_validator("ALLOWED_HOSTS", mode="before")
    @classmethod
    def parse_allowed_hosts(cls, v: str | list[str]) -> list[str]:
        """Parse allowed hosts from string or list format."""
        if isinstance(v, str) and not v:
            return []
        if isinstance(v, str) and v.startswith("["):
            return cast(list[str], json.loads(v))
        if isinstance(v, str):
            return [h.strip() for h in v.split(",")]
        if isinstance(v, list):
            return v
        return []

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str, info: Any) -> str:
        """Validate SECRET_KEY has sufficient length and complexity."""
        if v == "change-me" or len(v) < 32:
            # Check if ENVIRONMENT is development
            environment = info.data.get("ENVIRONMENT", "development")
            if environment != "development":
                raise ValueError(
                    "SECRET_KEY must be at least 32 characters in production"
                )
            warnings.warn("Using weak SECRET_KEY in development mode", stacklevel=2)
        return v

    @field_validator(
        "ACCESS_SECRET_KEY", "RESET_PASSWORD_SECRET_KEY", "VERIFICATION_SECRET_KEY"
    )
    @classmethod
    def validate_fastapi_users_secrets(cls, v: str | None, info: Any) -> str:
        """Default fastapi-users secrets to SECRET_KEY if not provided."""
        if v is None:
            # Get SECRET_KEY from values (already validated)
            secret_key = info.data.get("SECRET_KEY")
            if secret_key:
                warnings.warn(
                    f"{info.field_name} not set, using SECRET_KEY as fallback. "
                    "Consider setting unique secrets for production.",
                    stacklevel=2,
                )
                return cast(str, secret_key)
            raise ValueError(f"{info.field_name} or SECRET_KEY must be set")
        return v

    @field_validator("ENVIRONMENT")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """Validate ENVIRONMENT is one of allowed values."""
        allowed = ["development", "staging", "production"]
        if v not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of: {allowed}")
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Validate DATABASE_URL is present and PostgreSQL-based."""
        if not v:
            raise ValueError("DATABASE_URL is required")
        # Only PostgreSQL is supported
        if "postgresql" not in v.lower():
            raise ValueError("Only PostgreSQL is supported for DATABASE_URL")
        return v

    class Config:
        """Pydantic configuration for Settings class."""

        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Ignore extra env vars like PYTHONPATH set by EB


settings = Settings()
