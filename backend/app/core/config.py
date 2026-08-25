"""Application configuration using Pydantic settings.

Loads configuration from environment variables and .env file.
"""

import ipaddress
import json
import re
import socket
import warnings
from typing import Any, cast
from urllib.parse import urlparse

from pydantic import (
    AnyHttpUrl,
    Field,
    PostgresDsn,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings

# Trust posture is derived FAIL-CLOSED (see ``is_production_posture``): only a
# literal ``development`` ENVIRONMENT is a local/dev posture that may trust the
# hermetic local IdP; every other value — staging (a cosmetic staging->prod
# migration leftover, so prod runs with ENVIRONMENT=staging — see the root
# CLAUDE.md), production, or anything unexpected — is treated as production
# posture so the dev-local-auth guardrail can never go inert.

# Numeric-only IPv4 forms the OS resolver still accepts but ``ipaddress`` does
# not: single-integer (2130706433), short (127.1), hex (0x7f000001), and
# octal (0177.0.0.1) parts. Each dot-separated part is decimal or 0x-hex (the
# host has already been lower-cased); a leading-zero decimal part is octal, which
# ``socket.inet_aton`` resolves. The pattern is deliberately restrictive so a
# real hostname (which always contains a non-[0-9a-fx.] character or a leading
# alpha label) can never be routed through numeric normalisation.
_NUMERIC_IPV4_RE = re.compile(r"^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+)){0,3}$")

# Hosts that mean "an issuer served from this machine / the local dev box".
# A production-posture backend that trusts a loopback/local Cognito issuer would
# be trusting a token any local process can mint — the exact thing the guardrail
# forbids. host.docker.internal is included because a container reaches the host
# dev IdP through it.
_LOOPBACK_ISSUER_HOSTS = frozenset(
    {"127.0.0.1", "localhost", "0.0.0.0", "::1", "host.docker.internal"}  # noqa: S104
)

# Database names that belong to the SHARED dev database. When dev-local-auth is
# enabled the JIT-provisioned dev user must not land here, so the guardrail
# refuses to boot against these and forces an isolated DATABASE_URL.
_SHARED_DEV_DB_NAMES = frozenset({"qontinui_db", "db"})


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

    # NOTE: the local FastAPI-Users token secrets (ACCESS_SECRET_KEY /
    # RESET_PASSWORD_SECRET_KEY / VERIFICATION_SECRET_KEY) were removed —
    # Cognito is the sole user-authentication mechanism and the local
    # HS256 token / password-reset / email-verify stack is gone.
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
    COORD_DEVICE_URL: str | None = Field(
        default=None,
        description=(
            "Base URL of the coord that issues DEVICE identities, when that "
            "is not the same coord as COORD_URL. Unset (the default) means "
            "'same as COORD_URL', so every existing deployment is unchanged."
        ),
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
        # web app-client, runner app-client, mobile app-client, CI app-client.
        # The runner + mobile present user tokens to /users/me, so their
        # client ids must be trusted as audiences too. The CI client
        # (`qontinui-ci`, USER_PASSWORD_AUTH-only, public) lets Spec CI + E2E
        # mint a ci-bot token without AWS creds — its `aud`/`client_id` must
        # therefore be accepted here (Phase T1 of the legacy-auth-teardown).
        default=(
            "q6ns1a8bokf2np1mj8v8arl31,"
            "67f2a1a0cmgileob23lniud5t7,"
            "7sirquecq6svomsoe34pblfp24,"
            "tb0epbojige1900ipu6q80j6b"
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

    # Dev-local-auth on-ramp (local web UI-Bridge verification on-ramp, Phase 1).
    # Master gate for the hermetic local-IdP login flow. When set, the backend is
    # expected to run with COGNITO_ISSUER pointed at the local IdP
    # (scripts/dev_local_idp.py / spec_ci_local_idp.py, http://127.0.0.1:8770) and
    # COGNITO_ALLOWED_AUDIENCES=qontinui-web-local, so an injected UI-Bridge tab can
    # present a locally-minted, Cognito-shaped token that the REAL verifier accepts
    # and JIT-provisions. This is a DEV-ONLY seam and mirrors how
    # NEXT_PUBLIC_ENABLE_SPEC_CI gates the frontend spec-CI path. The prod
    # guardrail below (`_enforce_dev_local_auth_safety`) makes it structurally
    # impossible to enable under a production-posture ENVIRONMENT.
    QONTINUI_DEV_LOCAL_AUTH: bool = Field(
        default=False,
        description=(
            "Master dev flag for the hermetic local-IdP auth on-ramp. Dev/local "
            "only — the backend REFUSES TO BOOT if this is set while "
            "ENVIRONMENT is a production posture (staging/production)."
        ),
    )

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

    # Anchor-keyed proactive memory recall (plan
    # 2026-07-29-memory-anchored-derived-records, Phase 5).
    #
    # DEFAULT-OFF, and it must stay off until the separate efficacy
    # harness (2026-07-29-memory-recall-efficacy-benchmark) can measure
    # the injected context's value against its token cost. Proactive
    # recall spends tokens on EVERY session whether or not the records
    # help, so "it seems useful" is not evidence — turning it on without
    # the measurement is how a retrieval feature becomes a permanent
    # unmeasured tax. With the flag off, `POST /memory/query` still
    # ACCEPTS `anchored_to` and reports `anchored_arm="skipped_disabled"`
    # rather than silently returning nothing.
    MEMORY_ANCHORED_RECALL_ENABLED: bool = Field(
        default=False,
        description=(
            "Enable anchor-keyed proactive recall on POST /memory/query "
            "(anchored_to). Off until the recall-efficacy benchmark runs."
        ),
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

    @field_validator("ENVIRONMENT")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """Normalise and validate ENVIRONMENT.

        Case and surrounding whitespace are normalised so a mis-cased or
        padded value (``"Production"``, ``"staging "``) maps to its canonical
        form. Without this, the exact-match posture checks scattered through
        the app (``settings.ENVIRONMENT == "production"``) would silently miss
        a mis-cased prod value and run with dev-relaxed security. A genuinely
        unknown value is REJECTED (fail-safe: the app refuses to boot rather
        than run under an ambiguous trust posture).
        """
        normalized = v.strip().lower()
        allowed = ["development", "staging", "production"]
        if normalized not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of: {allowed}")
        return normalized

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

    @property
    def is_production_posture(self) -> bool:
        """True unless ENVIRONMENT is exactly local ``development`` (FAIL-CLOSED).

        The trust posture is derived by *exclusion*, not by an allow-list: only
        a literal ``development`` posture is treated as non-production. Prod runs
        with ENVIRONMENT=staging (a cosmetic migration leftover), so staging
        counts as production; so does ``production`` and — critically — any
        value that is empty, mis-cased, or otherwise unexpected. Deriving prod
        posture as "not development" (rather than membership in a
        ``{staging, production}`` set) means the dev-local-auth guardrail errs
        SAFE: it can never silently go inert because ENVIRONMENT drifted to a
        value nobody thought to add to a set. The ``.strip().lower()`` mirrors
        ``validate_environment`` so the check holds even for a value that
        somehow bypassed that validator.
        """
        return self.ENVIRONMENT.strip().lower() != "development"

    @property
    def cognito_issuer_is_loopback(self) -> bool:
        """True when COGNITO_ISSUER points at a loopback/local host.

        Deliberately broad — this backs the prod guardrail, so it must catch
        loopback-equivalent forms, not just the exact strings used by the dev
        flow: the named set (0.0.0.0, host.docker.internal), any ``.localhost``
        name (RFC 6761), a trailing-dot FQDN, every IP form the stdlib
        recognises as loopback (127.0.0.0/8, ``::1`` in any expansion, and the
        IPv4-mapped ``::ffff:127.0.0.1``), AND the numeric/short/octal/hex IPv4
        spellings the OS resolver still routes to loopback but ``ipaddress``
        rejects (``127.1``, ``2130706433``, ``0x7f000001``, ``0177.0.0.1``).
        """
        # urlparse strips IPv6 brackets; normalise case and a trailing dot.
        host = (urlparse(self.COGNITO_ISSUER).hostname or "").lower().rstrip(".")
        if not host:
            return False
        if host in _LOOPBACK_ISSUER_HOSTS:
            return True
        if host == "localhost" or host.endswith(".localhost"):
            return True
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            # Not a canonical IP literal. Before giving up, catch the numeric
            # IPv4 forms a real resolver still accepts (short/octal/decimal/hex)
            # — 127.1 / 2130706433 / 0x7f000001 / 0177.0.0.1 all resolve to
            # loopback. Only attempt this for a numeric-ish host so a genuine
            # hostname can never be mis-normalised into loopback.
            if _NUMERIC_IPV4_RE.match(host):
                try:
                    packed = socket.inet_aton(host)
                except OSError:
                    return False
                return ipaddress.IPv4Address(packed).is_loopback
            return False
        if ip.is_loopback:
            return True
        # IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — unwrap and re-check.
        mapped = getattr(ip, "ipv4_mapped", None)
        return bool(mapped is not None and mapped.is_loopback)

    @staticmethod
    def _database_name(database_url: str) -> str:
        """Extract the database name from a PostgreSQL DSN (path, no query)."""
        path = urlparse(database_url).path.lstrip("/")
        # Strip anything after a "?" that urlparse may leave when the DSN is
        # not fully URL-shaped.
        return path.split("?", 1)[0]

    @model_validator(mode="after")
    def _enforce_dev_local_auth_safety(self) -> "Settings":
        """Fail-fast guardrail around the dev-local-auth on-ramp.

        Two structural protections, both enforced at settings-instantiation time
        (before the app can boot):

        1. **Prod guardrail (the security core).** Under a production-posture
           ENVIRONMENT (staging/production), REFUSE TO BOOT if either the
           ``QONTINUI_DEV_LOCAL_AUTH`` master flag is set OR ``COGNITO_ISSUER``
           resolves to a loopback/local host. Both would let a locally-minted
           token be trusted in prod — impossible by construction now.

        2. **Isolated dev DB (anomaly fix).** When dev-local-auth is active —
           EITHER the ``QONTINUI_DEV_LOCAL_AUTH`` master flag is set OR
           ``COGNITO_ISSUER`` resolves to a loopback/local host (only reachable
           under a dev posture, per protection 1) — refuse to run against the
           shared dev database so the JIT-provisioned dev user cannot pollute
           it, forcing an explicit isolated ``DATABASE_URL``. The loopback
           signal is included because it is what ACTUALLY activates local-auth:
           the Cognito verifier is purely issuer-driven, so pointing
           ``COGNITO_ISSUER`` at the local IdP grants full local-auth even if a
           dev forgets to set the master flag — and that path must not be
           allowed to write into the shared dev DB either.
        """
        if self.is_production_posture:
            reasons: list[str] = []
            if self.QONTINUI_DEV_LOCAL_AUTH:
                reasons.append("QONTINUI_DEV_LOCAL_AUTH is set")
            if self.cognito_issuer_is_loopback:
                reasons.append(
                    "COGNITO_ISSUER resolves to a loopback/local host "
                    f"({self.COGNITO_ISSUER!r})"
                )
            if reasons:
                raise ValueError(
                    "Refusing to boot: dev-local-auth is forbidden under a "
                    f"production-posture ENVIRONMENT={self.ENVIRONMENT!r} "
                    "(staging is treated as production) because "
                    + " and ".join(reasons)
                    + ". The hermetic local IdP must NEVER be trusted in "
                    "production. Unset QONTINUI_DEV_LOCAL_AUTH and point "
                    "COGNITO_ISSUER at the real Cognito issuer, or run with "
                    "ENVIRONMENT=development for local-auth."
                )

        if self.QONTINUI_DEV_LOCAL_AUTH or self.cognito_issuer_is_loopback:
            db_name = self._database_name(str(self.DATABASE_URL)).lower()
            if db_name in _SHARED_DEV_DB_NAMES:
                trigger = (
                    "QONTINUI_DEV_LOCAL_AUTH=1"
                    if self.QONTINUI_DEV_LOCAL_AUTH
                    else "COGNITO_ISSUER points at the local IdP "
                    f"({self.COGNITO_ISSUER!r})"
                )
                raise ValueError(
                    f"Refusing to boot: {trigger} activates dev-local-auth, "
                    "which must run against an ISOLATED database, but "
                    f"DATABASE_URL names the shared dev database {db_name!r}. "
                    "The dev-local-auth flow JIT-provisions a synthetic dev "
                    "user; set DATABASE_URL to a dedicated database (e.g. "
                    "'qontinui_local_auth') so it cannot pollute shared dev data."
                )

        return self

    class Config:
        """Pydantic configuration for Settings class."""

        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Ignore extra env vars like PYTHONPATH set by EB


settings = Settings()


def coord_device_base() -> str:
    """Base URL of the coord that issues DEVICE identities.

    COORD_URL is overloaded: it addresses the admin/service-token
    bridge (whose shared secret is paired with ONE coord), the operator
    proxy routes, AND the device-identity surface — JWKS verification of
    device tokens plus the device-routing reads behind the runner proxy.

    Those are independent trust relationships and they do not have to
    point at the same coord. A dev box legitimately runs a LOCAL coord
    container for the admin bridge while its runner is paired to the
    fleet's coord, and device tokens are then signed by a key the local
    coord has never held. Before this split there was no way to express
    that: measured 2026-08-25, the local secret authenticated against the
    local coord (200) and was rejected by the fleet coord (401), so
    repointing COORD_URL to fix device verification would have
    fail-fast-ed the backend at boot in strategy_client.startup().

    Unset (the default) means "same as COORD_URL", so every existing
    deployment — prod, CI, single-coord dev — is byte-for-byte unchanged.
    """
    return (settings.COORD_DEVICE_URL or settings.COORD_URL).rstrip("/")
