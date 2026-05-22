"""
Centralized test credentials configuration.

This module exposes the local development credentials. The actual values
live in ONE place — ``qontinui-web/dev-credentials.json`` (the repo-root
single source of truth) — and are loaded at import time below. The same
JSON is read by the TypeScript side
(``frontend/tests/e2e/test-credentials.ts``), so the two cannot drift.

IMPORTANT: These credentials are ONLY for local development and testing.
They must NEVER be used in production environments.

To change the dev password:
  1. Edit ``dev-credentials.json`` (this is the ONLY value to change).
  2. Run ``backend/reset_local_password.py`` to re-hash existing local
     DB users.
The gitignored local env files (``frontend/.env.local``,
``qontinui-runner/.env``) are per-developer machine config — update them
to match if your local web/runner auto-login relies on them. The drift
guard (``scripts/check_dev_credentials_drift.py``) fails CI if a literal
credential is hardcoded anywhere instead of read from the JSON.
"""

import json
from pathlib import Path

# Repo root = .../qontinui-web. This file is at
# qontinui-web/backend/app/core/test_credentials.py → parents[3] is the root.
_CREDENTIALS_PATH = Path(__file__).resolve().parents[3] / "dev-credentials.json"

with _CREDENTIALS_PATH.open(encoding="utf-8") as _f:
    _CREDS = json.load(_f)

# Standard development password - use this for ALL dev users.
# Sourced from dev-credentials.json; do NOT hardcode a literal here.
STANDARD_DEV_PASSWORD: str = _CREDS["password"]

# Primary development user - used for BOTH runner AND web during development.
# This is the single default user for all local development.
DEV_USER_EMAIL: str = _CREDS["email"]
DEV_USER_USERNAME: str = _CREDS["username"]
DEV_USER_PASSWORD: str = STANDARD_DEV_PASSWORD
DEV_USER_IS_SUPERUSER: bool = _CREDS["is_superuser"]
DEV_USER_IS_VERIFIED: bool = _CREDS["is_verified"]


def get_dev_credentials() -> dict:
    """Get the standard development user credentials.

    This is the SINGLE user used for:
    - qontinui-runner auto-login
    - qontinui-web E2E tests
    - Manual development testing
    """
    return {
        "email": DEV_USER_EMAIL,
        "username": DEV_USER_USERNAME,
        "password": DEV_USER_PASSWORD,
        "is_superuser": DEV_USER_IS_SUPERUSER,
        "is_verified": DEV_USER_IS_VERIFIED,
    }


# Aliases for backward compatibility
def get_runner_dev_credentials() -> dict:
    """Alias for get_dev_credentials() - runner uses the same dev user."""
    return get_dev_credentials()


def get_web_test_credentials() -> dict:
    """Alias for get_dev_credentials() - web tests use the same dev user."""
    return get_dev_credentials()


def get_admin_credentials() -> dict:
    """Alias for get_dev_credentials() - admin is the same as dev user."""
    return get_dev_credentials()
