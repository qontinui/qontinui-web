import json
import warnings

from pydantic import AnyHttpUrl, Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Project
    PROJECT_NAME: str = "Qontinui API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = Field("development", description="Current environment")

    # Database
    DATABASE_URL: PostgresDsn | str = Field(
        ..., description="PostgreSQL connection string"
    )

    # Security
    SECRET_KEY: str = Field(
        ..., min_length=32, description="Secret key for JWT encoding"
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 1 hour
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    BACKEND_CORS_ORIGINS: list[AnyHttpUrl] = []

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str] | str:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            return json.loads(v)
        elif isinstance(v, list):
            return v
        raise ValueError(v)

    # Server
    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=8000)
    RELOAD: bool = Field(default=True)
    DEBUG: bool = Field(default=True)

    # Frontend
    FRONTEND_URL: str = Field(default="http://localhost:3001")

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

    # Rate limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_HOUR: int = 600

    # Redis (for task queue)
    REDIS_HOST: str = Field(default="localhost")
    REDIS_PORT: int = Field(default=6379)
    REDIS_DB: int = Field(default=0)

    # Stripe
    STRIPE_SECRET_KEY: str | None = Field(None, description="Stripe secret key")
    STRIPE_PUBLISHABLE_KEY: str | None = Field(
        None, description="Stripe publishable key"
    )
    STRIPE_WEBHOOK_SECRET: str | None = Field(None, description="Stripe webhook secret")
    STRIPE_PRICE_HOBBY: str | None = Field(
        None, description="Stripe Price ID for Hobby tier"
    )
    STRIPE_PRICE_PRO: str | None = Field(
        None, description="Stripe Price ID for Pro tier"
    )

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if v == "change-me" or len(v) < 32:
            if cls.model_fields.get("ENVIRONMENT") != "development":
                raise ValueError(
                    "SECRET_KEY must be at least 32 characters in production"
                )
            warnings.warn("Using weak SECRET_KEY in development mode")
        return v

    @field_validator("ENVIRONMENT")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        allowed = ["development", "staging", "production"]
        if v not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of: {allowed}")
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if not v:
            raise ValueError("DATABASE_URL is required")
        if (
            "sqlite" in v.lower()
            and cls.model_fields.get("ENVIRONMENT") == "production"
        ):
            raise ValueError("SQLite is not allowed in production")
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
